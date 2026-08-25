/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// ============================================================
// Sensitive Commands — 共享终端 AI 协作的「二次确认」判定
//
// 设计（shared-cli-ai-collab.md P1）：AI 通过 session_collab 写入用户
// 终端属于高风险动作，对破坏性 / 不可逆命令强制二次确认：
//   - AI 先返回 confirmRequired（含 token + 命令预览），不实际执行；
//   - 用户显式调用 session_collab_confirm(token) 才真写。
//
// 判定覆盖：删除/格式化/磁盘/系统级/网络写/权限改写/进程强杀 等。
// 白名单式：match 才认为敏感，未匹配默认放行（培训边界，非沙箱）。
// ============================================================

// 危险模式：按「词边界 + 危险参数」匹配，避免误伤普通命令（如 `rm -rf node_modules`
// 是敏感的，但 `rm file.txt` 也纳入确认以防误操作——按需求「敏感二次确认开」从严）。
const SENSITIVE_PATTERNS = [
  // 删除 / 清空
  /\brm\b/,
  /\bdel\b/,
  /\brd\b/,
  /\bunlink\b/,
  /\bshred\b/,
  /\btruncate\b/,
  // 格式化 / 磁盘
  /\bmkfs\b/,
  /\bformat\b/,
  /\bdd\b/,
  /\bparted\b/,
  /\bfdisk\b/,
  // 系统级
  /\bsystemctl\b/,
  /\bservice\b/,
  /\bchkconfig\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
  /\bmount\b/,
  /\bumount\b/,
  // 进程强杀
  /\bkill\b/,
  /\bkillall\b/,
  /\bpkill\b/,
  // 权限 / 凭证改写
  /\bchmod\b/,
  /\bchown\b/,
  /\bpasswd\b/,
  /\bvisudo\b/,
  /\bcrontab\b/,
  // 网络写 / 远程推送
  /\bgit\b[^]*\bpush\b/,
  /\bcurl\b[^]*\s-X\s+(POST|PUT|DELETE|PATCH)\b/i,
  /\bwget\b/,
  // 包管理写操作（子命令前需词边界，避免误伤 npm-run 等）
  /\bnpm\b[^]*\b(uninstall|rm|install|publish)\b/,
  /\byarn\b[^]*\b(remove|add|publish)\b/,
  /\bapt\b[^]*\b(remove|purge|install|upgrade)\b/,
  /\bbrew\b[^]*\b(uninstall|install|upgrade)\b/,
  // 环境变量 / 配置改写
  /\bexport\b[^]*\b(PATH|HOME|USER|sudo)\b/,
  /\bsetx\b/,
  // 特权提权
  /\bsudo\b/,
  /\bsu\b/,
];

/**
 * 判断命令是否命中敏感模式。
 * @param {string} cmd
 * @returns {boolean}
 */
function isSensitive(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  const normalized = cmd.trim();
  if (!normalized) return false;
  return SENSITIVE_PATTERNS.some((re) => re.test(normalized));
}

/**
 * 生成二次确认令牌（一次性，绑定 userId+命令预览）。
 * 用 crypto.randomUUID 足够随机，无需持久化（进程内存）。
 */
function makeConfirmToken() {
  try {
    return require('crypto').randomUUID();
  } catch {
    return 'cfm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

module.exports = { SENSITIVE_PATTERNS, isSensitive, makeConfirmToken };
