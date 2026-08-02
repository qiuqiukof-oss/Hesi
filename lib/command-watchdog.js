/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// C9 看门狗：命令失败模式掐断（防死循环的最后一道物理防线）
//
// 依据协作工作流讨论结论：即使 ReplanController 漏判，同一条命令反复失败
// 也应被统计掐断 → 升级人工介入，而不是无限重试。
//
// 规则：同一命令（规范化签名）在滑动窗口（默认 10 分钟）内失败 ≥3 次 →
// 返回 escalate=true。成功执行会清零该命令的失败计数（恢复正常信号）。
//
// 纯函数、无 IO，模块级单例供 run-plan 跨任务共享（统计「10 分钟内」全局）。
// ============================================================

'use strict';

/** 命令签名：去掉行尾空白，限制长度（长 heredoc 命令只取前 200 字符） */
function commandSig(command) {
  if (typeof command !== 'string') return '';
  return command.trim().slice(0, 200);
}

class CommandWatchdog {
  /**
   * @param {{ windowMs?: number, maxFails?: number, now?: () => number }} [opts]
   */
  constructor({ windowMs = 10 * 60 * 1000, maxFails = 3, now } = {}) {
    this.windowMs = windowMs;
    this.maxFails = maxFails;
    this._now = typeof now === 'function' ? now : () => Date.now();
    /** @type {Map<string, number[]>} 命令 -> 失败时间戳数组（窗口内） */
    this._fails = new Map();
  }

  /**
   * 记录一次命令执行结果。
   * @param {string} command
   * @param {boolean} ok 执行成功（exit 0 / 步骤 done）
   * @returns {{ escalate: boolean, failCount: number, windowMs: number, maxFails: number }}
   *   escalate=true → 窗口内失败已达阈值，应升级人工介入
   */
  record(command, ok) {
    const key = commandSig(command);
    const now = this._now();
    if (!key) return { escalate: false, failCount: 0, windowMs: this.windowMs, maxFails: this.maxFails };
    if (ok) {
      this._fails.delete(key); // 成功 → 清零（恢复正常信号）
      return { escalate: false, failCount: 0, windowMs: this.windowMs, maxFails: this.maxFails };
    }
    const arr = this._fails.get(key) || [];
    arr.push(now);
    // 滑出窗口的旧失败不计
    while (arr.length > 0 && arr[0] < now - this.windowMs) arr.shift();
    if (arr.length === 0) {
      this._fails.delete(key);
    } else {
      this._fails.set(key, arr);
    }
    return {
      escalate: arr.length >= this.maxFails,
      failCount: arr.length,
      windowMs: this.windowMs,
      maxFails: this.maxFails,
    };
  }

  /** 查询当前某命令窗口内失败次数（不记录）。 */
  failCount(command) {
    const arr = this._fails.get(commandSig(command)) || [];
    const now = this._now();
    return arr.filter((t) => t >= now - this.windowMs).length;
  }

  /** 清理全部状态（测试用 / 主动重置）。 */
  reset() {
    this._fails.clear();
  }
}

/** 模块级单例：跨 runPlan 任务共享，统计「10 分钟内」全局失败模式 */
const sharedWatchdog = new CommandWatchdog();

module.exports = { CommandWatchdog, commandSig, sharedWatchdog };
