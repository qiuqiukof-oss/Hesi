/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 全局预算守卫（Phase 0 — 全自动闭环）
//
// 把分散在 chat 流里的 TOOL_LOOP_GUARD（连续重复守卫，默认 15）提升为
// 跨 step、可复用的 per-run 预算守卫：轮数 / Token / 时间 + 连续重复熔断。
//
// 只做状态与判定，不碰执行；Executor 在每个 step 前后调用它。
// ============================================================

const DEFAULT_LOOP_GUARD = Number(process.env.HESI_LLM_TOOL_LOOP_GUARD) || 15;

class PlanBudget {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxRounds] 最大轮数（0=不限）
   * @param {number} [opts.maxTokens] 最大 token（0=不限）
   * @param {number} [opts.maxMinutes] 最大分钟（0=不限）
   * @param {number} [opts.loopGuard] 连续重复熔断阈值（0=关）
   * @param {number} [opts.windowSize] 震荡检测滑动窗口（默认 8）
   */
  constructor(opts = {}) {
    this.maxRounds = opts.maxRounds || 0;
    this.maxTokens = opts.maxTokens || 0;
    this.maxMinutes = opts.maxMinutes || 0;
    this.loopGuard = opts.loopGuard ?? DEFAULT_LOOP_GUARD;
    this.windowSize = opts.windowSize || 8;
    this._rounds = 0;
    this._tokens = 0;
    this._start = Date.now();
    this._lastSig = null;
    this._repeat = 0;
    // 震荡检测：滑动窗口内出现历史签名（非相邻）→ A→B→A
    this._sigWindow = [];
    // 冻结状态（gatePlan 通过后 freezeAcc 打 hash；修订不得改写验收/预算）
    this._frozenAccHash = null;
    this._frozenBudget = null;
  }

  /** 每轮推进一次；返回 { ok, reason? } */
  tickRound(tokens = 0) {
    this._rounds += 1;
    this._tokens += tokens;
    if (this.maxRounds && this._rounds > this.maxRounds) {
      return { ok: false, reason: `超过最大轮数 ${this.maxRounds}` };
    }
    if (this.maxTokens && this._tokens > this.maxTokens) {
      return { ok: false, reason: `超过 token 预算 ${this.maxTokens}` };
    }
    if (this.maxMinutes && Date.now() - this._start > this.maxMinutes * 60000) {
      return { ok: false, reason: `超过时间预算 ${this.maxMinutes} 分钟` };
    }
    return { ok: true };
  }

  /**
   * 连续重复熔断：sig 为某次动作的规范签名（如工具名集合 / step 结果摘要）。
   * 同 sig 连续出现达到 loopGuard → 熔断。
   * （震荡检测 A→B→A 属于反思环级语义，由 ReplanController.decide 负责——
   *   步骤级 checkLoop 保持「连续重复 + 异签名重置」既有契约，避免误判正常重试。）
   * @returns { ok: boolean, reason?: string }
   */
  checkLoop(sig) {
    if (this.loopGuard > 0) {
      if (sig === this._lastSig) this._repeat += 1;
      else {
        this._lastSig = sig;
        this._repeat = 1;
      }
      if (this._repeat >= this.loopGuard) {
        return { ok: false, reason: '疑似循环，已停止' };
      }
    }
    return { ok: true };
  }

  /**
   * gatePlan 通过后冻结 acceptance 与预算（P0 终止机制：修订不得改写验收标准）。
   * @param {string|null} accHash sha256(JSON.stringify(plan.acceptance))
   * @param {object|null} budget 冻结的预算副本（深拷贝）
   */
  freezeAcc(accHash, budget) {
    this._frozenAccHash = accHash || null;
    this._frozenBudget = budget && typeof budget === 'object'
      ? { maxRounds: budget.maxRounds || 0, maxTokens: budget.maxTokens || 0, maxMinutes: budget.maxMinutes || 0 }
      : null;
  }

  /**
   * 校验冻结状态未被修订篡改（每轮 reviseFn 产出后调用）。
   * @returns { ok: boolean, reason?: string }
   */
  verifyFrozen(accHash, budget) {
    if (this._frozenAccHash && accHash && this._frozenAccHash !== accHash) {
      return { ok: false, reason: 'acceptance 被篡改（冻结校验失败）' };
    }
    if (this._frozenBudget && budget && typeof budget === 'object') {
      const fb = JSON.stringify({ maxRounds: this._frozenBudget.maxRounds, maxTokens: this._frozenBudget.maxTokens, maxMinutes: this._frozenBudget.maxMinutes });
      const cb = JSON.stringify({ maxRounds: budget.maxRounds || 0, maxTokens: budget.maxTokens || 0, maxMinutes: budget.maxMinutes || 0 });
      if (fb !== cb) return { ok: false, reason: '预算被篡改（冻结校验失败）' };
    }
    return { ok: true };
  }

  get rounds() {
    return this._rounds;
  }
  get tokens() {
    return this._tokens;
  }
}

module.exports = { PlanBudget, DEFAULT_LOOP_GUARD };
