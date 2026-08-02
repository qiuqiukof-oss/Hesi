/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// ReplanController — 确定性收敛判断器（纯函数，零 LLM）
//
// 依据《协作工作流终止机制》方案 2.4：让干活 LLM 同时当裁判，
// 循环是必然的。本控制器用「状态签名 + 冻结校验 + 预算」做确定性
// 终止判定，五信号全部零 LLM、可单测：
//
//   DONE     —— acceptance 全过，任务完成
//   STALL    —— 连续两轮签名相同（原地重复）
//   OSCILL   —— 滑动窗口内出现历史签名（A→B→A 震荡）
//   DRIFT    —— plan hash 变了但 git diff 为空（计划漂移）
//   ESCALATE —— acceptance/预算被篡改，或预算耗尽（人工介入）
//   STALLED  —— 连续无进展轮数达阈值（软收敛）
//   CONTINUE —— 继续修订重跑
//
// 纯函数纪律：decide() 只读传入 round，不碰执行、不碰 IO；
// 状态仅保存在实例字段（sigs 窗口 / lastSig / noDeltaCount）。
// ============================================================

'use strict';

const STALL_DEFAULT = 2;   // 连续无进展阈值
const WINDOW_DEFAULT = 8;  // 签名滑动窗口大小

/**
 * 归一化预算（仅比较三上限字段，忽略其它噪声）。
 * @param {object|null|undefined} b
 * @returns {string}
 */
function normBudget(b) {
  if (!b || typeof b !== 'object') return '{}';
  return JSON.stringify({
    maxRounds: b.maxRounds || 0,
    maxTokens: b.maxTokens || 0,
    maxMinutes: b.maxMinutes || 0,
  });
}

class ReplanController {
  /**
   * @param {object} [opts]
   * @param {string|null} [opts.accHash]     gatePlan 通过后冻结的 acceptance hash
   * @param {object|null} [opts.budgetFrozen] 冻结的预算副本
   * @param {number} [opts.windowSize]        签名滑动窗口（默认 8）
   * @param {number} [opts.stallThreshold]    连续无进展阈值（默认 2）
   */
  constructor({ accHash = null, budgetFrozen = null, windowSize = WINDOW_DEFAULT, stallThreshold = STALL_DEFAULT } = {}) {
    this.accHash = accHash || null;
    this.budgetFrozen = budgetFrozen && typeof budgetFrozen === 'object'
      ? JSON.parse(normBudget(budgetFrozen))
      : null;
    this.windowSize = windowSize;
    this.stallThreshold = stallThreshold;
    /** @type {string[]} */ this.sigs = [];
    this.lastSig = null;
    this.noDeltaCount = 0;
  }

  /**
   * 冻结状态（供 gatePlan 通过后调用；与 PlanBudget.freezeAcc 语义一致，
   * 本控制器持有副本用于 decide 内校验）。
   * @param {string|null} accHash
   * @param {object|null} budget
   */
  freeze(accHash, budget) {
    this.accHash = accHash || null;
    this.budgetFrozen = budget && typeof budget === 'object' ? JSON.parse(normBudget(budget)) : null;
  }

  /**
   * 核心判定。纯函数语义：只读 round，不产生副作用（窗口更新在内部完成）。
   *
   * @param {object} round
   * @param {string} [round.planHash]            当前 plan 的规范 hash
   * @param {string} [round.gitDiff]             工作树 diff 摘要（'' 表示地面没动）
   * @param {boolean} [round.acceptanceAllPass]  acceptance 是否全过
   * @param {Array|null} [round.acceptanceResults] acceptance 结果数组（进签名）
   * @param {string} [round.accHash]             当前 acceptance hash（比对冻结）
   * @param {object} [round.budget]              当前预算（比对冻结）
   * @param {number} [round.elapsedMs]           已耗时（毫秒）
   * @returns {{ v: 'DONE'|'STALL'|'OSCILL'|'DRIFT'|'ESCALATE'|'STALLED'|'CONTINUE', why?: string, partial?: boolean }}
   */
  decide(round = {}) {
    // 1. 冻结状态校验（acceptance / 预算被修订篡改 → ESCALATE）
    if (this.accHash && round.accHash && this.accHash !== round.accHash) {
      return { v: 'ESCALATE', why: 'acceptance 被篡改（冻结校验失败）' };
    }
    if (this.budgetFrozen && round.budget && normBudget(this.budgetFrozen) !== normBudget(round.budget)) {
      return { v: 'ESCALATE', why: '预算被篡改（冻结校验失败）' };
    }

    // 2. 硬收敛：acceptance 全过 → DONE
    if (round.acceptanceAllPass === true) {
      return { v: 'DONE', why: '验收全部通过' };
    }

    // 3. 时间预算耗尽（独立维度，不参与签名，避免震荡检测失效）
    if (this.budgetFrozen && this.budgetFrozen.maxMinutes > 0
      && round.elapsedMs > this.budgetFrozen.maxMinutes * 60000) {
      return { v: 'ESCALATE', why: `时间预算耗尽（${this.budgetFrozen.maxMinutes} 分钟）`, partial: true };
    }

    // 4. 状态签名检测
    const sig = [round.planHash || '', round.gitDiff || '', JSON.stringify(round.acceptanceResults || null)].join('|');
    if (this.lastSig !== null && this.lastSig === sig) {
      return { v: 'STALL', why: '原地重复（连续两轮签名相同）' };
    }
    if (this.sigs.includes(sig)) {
      return { v: 'OSCILL', why: '状态震荡（A→B→A，窗口内出现历史签名）' };
    }
    // 计划漂移：plan hash 变了但地面没动（非首轮）
    if (this.lastSig !== null && round.planHash !== null && round.planHash !== undefined
      && round.planHash !== this.lastSig && !round.gitDiff) {
      return { v: 'DRIFT', why: '计划漂移（计划改了但工作树没动）' };
    }

    // 5. 更新窗口与基线
    this.sigs.push(sig);
    if (this.sigs.length > this.windowSize) this.sigs.shift();
    this.lastSig = round.planHash || this.lastSig;

    // 6. 零 Delta 软收敛：连续无进展达阈值 → STALLED
    if (!round.gitDiff) {
      this.noDeltaCount += 1;
      if (this.noDeltaCount >= this.stallThreshold) {
        return { v: 'STALLED', why: '连续无进展，触发软收敛' };
      }
    } else {
      this.noDeltaCount = 0;
    }

    return { v: 'CONTINUE' };
  }
}

module.exports = { ReplanController, normBudget, WINDOW_DEFAULT, STALL_DEFAULT };
