/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 终端渲染协议字节清洗（terminal-clean）
//
// 把「headless Agent / CLI」在 TTY 里输出的终端控制字节（而非纯文本）
// 彻底剥离，避免把 TUI 协议噪声（opencode / codex / aider 的 OSC 1337
// 能力协商、OSC 99 通知、OSC 8 超链接、ANSI 颜色 / 光标 / 清屏 CSI 等）
// 喂给 AI 模型或泄漏到聊天气泡里。
//
// 暴露两个能力：
//   1. stripTerminalCodes(s)        —— 纯函数，清洗「完整」字符串（单 chunk 已确定完整）。
//   2. createStreamCleaner(opts)    —— 有状态流式清洗器，跨 chunk 边界缓存「未完成的
//                                      转义序列」前缀，直到收到终止符再吐出，解决
//                                      PTY onData / poll delta 把序列切成两片导致的残留。
// ============================================================
'use strict';

// 完整可移除序列（全局、贪婪匹配已终止的序列）：
//   - OSC：以 \x1b] 开头，到 BEL(\x07) 或 ST(\x1b\\) 结束
//   - CSI 及 C1 短序列：\x1b[@-Z\-_] 或 \x1b[...最终字节]
//   - 残余裸 ESC
function stripTerminalCodes(s) {
  if (!s) return s;
  return s
    .replace(/\x1B\][^\x07\x1B]*?(?:\x07|\x1B\\)/g, '') // OSC（超链接 / 1337 能力协商 / 通知）
    .replace(/\x1B(?:[@-Z\\^_]|\[[0-?]*[ -/]*[@-~])/g, '') // CSI 及 C1 短序列（排除 [ ] 这两个引入符）
    .replace(/\x1B/g, ''); // 残余裸 ESC
}

// 判断以 `rest` 开头的转义序列「是否已经完整」（即全局正则能在此处匹配到一个
// 已终止的完整序列）。用于流式清洗器判断尾部是否需要缓存。
function isCompleteEscapePrefix(rest) {
  if (!rest || rest[0] !== '\x1b') return false;
  return (
    /^\x1B\][^\x07\x1B]*?(?:\x07|\x1B\\)/.test(rest) || // 已终止的 OSC
    /^\x1B(?:[@-Z\\^_]|\[[0-?]*[ -/]*[@-~])/.test(rest) // 已终止的 CSI / C1 短序列
  );
}

// 「粘性」(sticky, `y`) 版本，用于流式扫描时判断「从位置 i 起是否有一个已终止的
// 完整序列」，并返回其长度 —— 避免对每个 ESC 做 s.slice(i) 造成的 O(n²) 开销。
const OSC_STICKY = /\x1B\][^\x07\x1B]*?(?:\x07|\x1B\\)/y;
const CSI_STICKY = /\x1B(?:[@-Z\\^_]|\[[0-?]*[ -/]*[@-~])/y;

/**
 * 返回从 s[i]（应为 ESC）开始的「已终止完整序列」长度；若不完整返回 0。
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function completeEscapeLenAt(s, i) {
  OSC_STICKY.lastIndex = i;
  if (OSC_STICKY.test(s)) return OSC_STICKY.lastIndex - i;
  CSI_STICKY.lastIndex = i;
  if (CSI_STICKY.test(s)) return CSI_STICKY.lastIndex - i;
  return 0;
}

/**
 * 创建有状态流式清洗器。
 *
 * 终端转义序列可能恰好被 chunk 边界切开（例如 PTY 一次 onData 只给了一半的
 * OSC 1337，下一半在下一回调里）。若对每个 chunk 单独用 stripTerminalCodes，
 * 前半片因缺少终止符而无法匹配，会作为「裸 ESC + 参数」残留在输出里 —— 这正是
 * 之前 opencode 污染泄漏的根因之一。
 *
 * 本清洗器在遇到「末尾是不完整的转义前缀」时，把该前缀缓存到下一次 feed，
 * 直至序列真正补全（收到终止符）再一次性清洗吐出；已完整的部分则立即吐出。
 *
 * @param {object} [opts]
 * @param {number} [opts.maxCarry=1024] 缓存上限（字节）。超过则视为损坏输出，
 *                                       强制丢弃缓存（安全阀，防止孤 ESC 永久挂起）。
 * @returns {(chunk: string) => string}
 */
function createStreamCleaner(opts = {}) {
  const maxCarry = typeof opts.maxCarry === 'number' ? opts.maxCarry : 1024;
  let carry = ''; // 上一 chunk 残留的、尚未补全的转义前缀

  return function feed(chunk) {
    if (!chunk) return '';
    const s = carry + chunk;
    carry = '';
    if (!s) return '';

    // 从前向后扫描，跳过每一个「已终止的完整序列」，定位第一个「未终止的转义
    // 开启符」作为切分点 —— 从该点到末尾整段缓存，只清洗它之前已确定的片段。
    //
    // 为什么不能用 lastIndexOf('\x1b')：OSC 的 ST 终止符本身是两字节 `\x1b\\`，
    // 也含一个 ESC。当 chunk 边界正好切在 ST 的两字节之间时，lastIndexOf 会锁定
    // ST 那个 ESC，从而把它「之前」尚未终止的 OSC 开启符（\x1b]…）当作已确定内容
    // 冲刷出去 —— stripTerminalCodes 对无终止符的 OSC 只能剥掉裸 ESC，导致 OSC
    // 正文（如 `]99;i=1:d=done`）泄漏进 AI 上下文。前向扫描从根本上避免此盲点。
    let cut = -1;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) !== 0x1B) continue;
      const len = completeEscapeLenAt(s, i);
      if (len > 0) { i += len - 1; continue; } // 跳过整段已完整序列
      cut = i;                                  // 第一个未终止开启符
      break;
    }

    if (cut === -1) return stripTerminalCodes(s); // 无待补全序列，整串清洗

    carry = s.slice(cut);
    if (carry.length > maxCarry) {
      // 安全阀：缓存过长（极可能是乱码孤 ESC），丢弃并强制吐出前面的内容
      const flushed = stripTerminalCodes(s.slice(0, cut));
      carry = '';
      return flushed;
    }
    return stripTerminalCodes(s.slice(0, cut));
  };
}

module.exports = { stripTerminalCodes, isCompleteEscapePrefix, createStreamCleaner };
