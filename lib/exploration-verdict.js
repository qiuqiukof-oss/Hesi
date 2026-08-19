/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// P2 探索型任务双轨收敛（纯函数，零 LLM）
//
// 依据《协作工作流讨论与试实施方案》第三节：
// - 实施型任务：全部 DoD 通过 → done
// - 探索型任务（调研/分析/评估）：收敛判据 = **下游可以开工时**，
//   「建议 + 置信度 + 开放风险」结束，而非「全答完」——全答完永远等不到
// - 关键纪律：
//   1. 探索发现新问题不是坏信号 → 只进 future-work 日志，永不阻塞
//   2. 反馈只催「原问题的缺答」，不罚「新问题的发现」
//   3. 未答问题必须来源可溯（source 字段），否则不算「已答」
// ============================================================

'use strict';

/**
 * 判定探索型任务的收敛状态。
 * @param {object} ctx
 * @param {Array<{id:string, text:string, required?:boolean}>} ctx.questions 原问题清单（required=true 为下游决策必需）
 * @param {Array<{questionId:string, answer:string, source?:string}>} ctx.answers 本轮已答（含来源）
 * @param {Array<{id?:string, text:string, source?:string}>} [ctx.newQuestions] 本轮新发现的问题（永不阻塞，只入 future-work）
 * @param {number} [ctx.round] 当前轮次（从 1 开始）
 * @param {number} [ctx.maxRounds] 轮次预算（0=不限）
 * @param {number} [ctx.answeredRequiredThreshold] 可选：required 问题答满多少比例算「下游可决策」（默认 1.0）
 * @returns {{
 *   v: 'CONVERGED'|'CONTINUE'|'ESCALATE',
 *   why?: string,
 *   missingRequired: Array<{id:string, text:string}>,
 *   futureWork: Array<{text:string, source?:string}>,
 *   feedback: string[],
 *   confidence: number,     // 0~1：必需问题已答比例（未答全时偏低）
 *   answeredRatio: number,  // 全部问题（含非必需）已答比例
 * }}
 */
function explorationVerdict(ctx = {}) {
  const questions = Array.isArray(ctx.questions) ? ctx.questions : [];
  const answers = Array.isArray(ctx.answers) ? ctx.answers : [];
  const newQuestions = Array.isArray(ctx.newQuestions) ? ctx.newQuestions : [];
  const round = ctx.round || 0;
  const maxRounds = ctx.maxRounds || 0;
  const requiredThreshold = typeof ctx.answeredRequiredThreshold === 'number' ? ctx.answeredRequiredThreshold : 1.0;

  const futureWork = newQuestions
    .filter((q) => q && q.text)
    .map((q) => ({ text: q.text, source: q.source || null }));

  // 有来源可溯的回答才算「已答」（来源可溯 = source 非空）
  const answerByQuestion = new Map();
  for (const a of answers || []) {
    if (!a || !a.questionId) continue;
    const hasSource = Boolean(a.source) && a.source !== 'null';
    const prev = answerByQuestion.get(a.questionId);
    // 同问题多次回答：取有来源的版本优先
    if (!prev || (hasSource && !prev.hasSource)) {
      answerByQuestion.set(a.questionId, { answer: a.answer, hasSource });
    }
  }

  const requiredQs = questions.filter((q) => q.required);
  const answeredRequired = requiredQs.filter((q) => {
    const a = answerByQuestion.get(q.id);
    return a && a.hasSource;
  });
  const missingRequired = requiredQs.filter((q) => {
    const a = answerByQuestion.get(q.id);
    return !a || !a.hasSource;
  }).map((q) => ({ id: q.id, text: q.text }));

  const requiredRatio = requiredQs.length === 0 ? 1 : answeredRequired.length / requiredQs.length;
  const allAnswered = questions.filter((q) => answerByQuestion.has(q.id) && answerByQuestion.get(q.id).hasSource).length;
  const answeredRatio = questions.length === 0 ? 1 : allAnswered / questions.length;
  const confidence = Math.round(Math.min(requiredRatio, 1) * 100) / 100;

  // 判据：必需问题答满（含来源）→ 下游可决策
  if (requiredQs.length === 0 || requiredRatio >= requiredThreshold) {
    return {
      v: 'CONVERGED',
      why: requiredQs.length === 0 ? '无必需问题，按当前掌握信息可决策' : '下游可决策，未答问题入 future-work',
      missingRequired,
      futureWork,
      feedback: [],
      confidence,
      answeredRatio,
    };
  }

  // 轮次预算耗尽仍未答满必需问题 → ESCALATE（人工介入），附缺答清单
  if (maxRounds > 0 && round >= maxRounds) {
    return {
      v: 'ESCALATE',
      why: `轮次预算耗尽（${round}/${maxRounds}）仍缺 ${missingRequired.length} 个必需问题的可溯答案，需人工介入`,
      missingRequired,
      futureWork,
      feedback: missingRequired.map((m) => `缺答：${m.text}`),
      confidence,
      answeredRatio,
    };
  }

  // 继续：只催原问题缺答，不罚新问题发现
  return {
    v: 'CONTINUE',
    missingRequired,
    futureWork,
    feedback: missingRequired.map((m) => `缺答：${m.text}`),
    confidence,
    answeredRatio,
  };
}

module.exports = { explorationVerdict };
