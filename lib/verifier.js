/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// P2 Verifier（盲审验收节点）—— 纯函数，零 LLM
//
// 依据《协作工作流讨论与试实施方案》4.1/4.2/4.3：
// - Verifier 只查 DoD 合规（functional + semantic + quality），每轮跑、成本低
// - 盲审铁律：输入白名单 = 冻结计划 + 工件清单 + 检查命令原始输出，
//   **绝不包含 Executor 自述/总结**。一旦读到，判断对象就从
//   「工件成没成」变成「总结说得对不对」→ 循环回路的入口。
// - 二值清单（yes/no + evidence 路径），禁止打分制（打分诱导「再努一把」乒乓循环）
// - 失败时吐出可机读的缺失清单（delta list），Executor 按单修，禁止无目标重做
//
// 本模块不做 IO（不跑命令、不读文件）——检查命令由调用方执行后把
// 原始输出（checkOutputs）传入，本模块只做确定性判定，可单测。
// ============================================================

'use strict';

/**
 * Verifier 输入白名单字段。
 * 盲审纪律：Executor 的自述/总结字段（executorSummary / selfReport / agentLog）
 * 一律不在白名单内——传入即剥离并标记污染。
 */
const INPUT_WHITELIST = new Set(['plan', 'artifacts', 'checkOutputs', 'item', 'dod', 'meta']);

/** 明确的「污染字段」（Executor 自述类），命中即剥离并告警。 */
const CONTAMINATED_FIELDS = ['executorSummary', 'selfReport', 'executorSelfReport', 'summary', 'agentNarrative'];

/**
 * 盲审输入净化：剥离非白名单字段。
 * @param {object} raw 调用方传入的原始输入
 * @param {{strict?: boolean}} [opts] strict=true 时发现污染字段返回 error（默认）；false 仅剥离并标记
 * @returns {{ input: object|null, stripped: string[], error?: string }}
 */
function sanitize(raw, { strict = true } = {}) {
  if (!raw || typeof raw !== 'object') return { input: null, stripped: [], error: 'Verifier 输入必须是对象' };
  const input = {};
  const stripped = [];
  for (const key of Object.keys(raw)) {
    if (CONTAMINATED_FIELDS.includes(key)) {
      stripped.push(key);
      continue; // 剥离，不进入白名单
    }
    if (INPUT_WHITELIST.has(key)) {
      input[key] = raw[key];
    } else {
      stripped.push(key);
    }
  }
  if (strict && stripped.length > 0) {
    return {
      input,
      stripped,
      error: `盲审拒绝：输入包含非白名单字段 [${stripped.join(', ')}]（Executor 自述会污染验收判断）`,
    };
  }
  return { input, stripped, error: undefined };
}

/**
 * 解析 quality 检查的阈值表达式（如 "coverage >= 80" / "lint: 0 errors" / ">90%"）。
 * 支持简单形式：`数值 比较符 阈值`（如 `>= 80`、`< 5`、`= 100`）。
 * 不支持 → null（调用方自行判定）。
 * @param {string} expr
 * @returns {{ op: string, threshold: number }|null}
 */
function parseQualityThreshold(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const m = expr.match(/(>=|<=|>|<|=|==)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { op: m[1], threshold: parseFloat(m[2]) };
}

/**
 * 从命令原始输出中提取数值（最后一个匹配该 pattern 的数字）。
 * @param {string} output
 * @param {string|RegExp} pattern 提取用正则（如 /coverage[:\s]*(\d+(?:\.\d+)?)%?/）
 * @returns {number|null}
 */
function extractNumber(output, pattern) {
  if (!output || typeof output !== 'string') return null;
  const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  const m = output.match(re);
  if (!m) return null;
  const num = m[1] ?? m[0];
  const n = parseFloat(String(num).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 比较两个数值是否满足 op 语义。 */
function compareNumbers(actual, { op, threshold }) {
  switch (op) {
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '=':
    case '==': return actual === threshold;
    default: return false;
  }
}

/**
 * 判定单条 DoD 检查项。
 * @param {object} check DoD 检查项
 * @param {{outputs: Map<string,string>, artifacts: string[]}} ctx
 * @returns {{ check: object, pass: boolean, evidence: string|null, reason?: string }}
 */
function verifyCheck(check, ctx) {
  const outputs = ctx.outputs || new Map();
  const type = check && check.type;

  if (type === 'functional') {
    // 命令二值：exit 0 且（可选 expect 命中）
    const out = outputs.get(check.id || check.check || '') || '';
    const pass = !check.expect || out.includes(check.expect);
    return { check, pass, evidence: pass ? String(out).slice(0, 300) : null, reason: pass ? undefined : 'expect 未命中' };
  }

  if (type === 'semantic') {
    // 二值清单：yes/no + evidence 路径。pass = evidence 存在 且 yes 与 expected 一致（若给定了 expected）
    const hasEvidence = Boolean(check.evidence) && check.evidence !== 'null';
    const pass = hasEvidence && (check.expected === undefined || check.yes === check.expected);
    return {
      check,
      pass,
      evidence: hasEvidence ? check.evidence : null,
      reason: pass ? undefined : (hasEvidence ? `expected=${check.expected} 与 yes=${check.yes} 不一致` : '缺少 evidence 路径'),
    };
  }

  if (type === 'quality') {
    // 硬指标：从输出提取数值比较阈值；无阈值表达式时退化为「输出含关键字」
    const out = outputs.get(check.id || check.check || '') || '';
    if (check.pattern && check.thresholdExpr) {
      const actual = extractNumber(out, check.pattern);
      const parsed = parseQualityThreshold(check.thresholdExpr);
      if (actual === null || parsed === null) {
        return { check, pass: false, evidence: null, reason: '无法从输出提取数值' };
      }
      const pass = compareNumbers(actual, parsed);
      return { check, pass, evidence: pass ? String(out).slice(0, 300) : null, reason: pass ? undefined : `实际 ${actual} 未达 ${check.thresholdExpr}` };
    }
    const keyword = check.keyword || check.expect;
    const pass = !keyword || out.includes(keyword);
    return { check, pass, evidence: pass ? String(out).slice(0, 300) : null, reason: pass ? undefined : `关键字未命中: ${keyword}` };
  }

  // 未知类型：保守判失败（宁可错杀不可放过）
  return { check, pass: false, evidence: null, reason: `未知 DoD 类型: ${type}` };
}

/**
 * 审一件工件（item）：逐条跑它绑定的 DoD。
 * @param {object} item 工件条目 { id, name, dod: [] }
 * @param {{outputs?: Map<string,string>|Record<string,string>, artifacts?: string[]}} [ctx]
 * @returns {{ item: object, checks: Array, pass: boolean }}
 */
function verifyItem(item, ctx = {}) {
  const dod = Array.isArray(item && item.dod) ? item.dod : [];
  const rawOutputs = ctx.outputs instanceof Map ? ctx.outputs : new Map(Object.entries(ctx.outputs || {}));
  const checks = dod.map((c) => {
    const key = c.id || c.check || '';
    const out = rawOutputs.get(key) ?? rawOutputs.get(c.check || '') ?? '';
    return verifyCheck(c, { outputs: new Map(rawOutputs).set(key, out), artifacts: ctx.artifacts || [] });
  });
  return { item, checks, pass: checks.length > 0 && checks.every((c) => c.pass) };
}

/**
 * 汇总缺失清单（delta list）—— 供 Executor 按单修复，禁止无目标重做。
 * @param {Array<ReturnType<typeof verifyItem>>} results
 * @returns {Array<{ itemId: string, itemName?: string, missing: Array<{ type: string, check: string, reason: string }> }>}
 */
function deltaList(results) {
  const delta = [];
  for (const r of results || []) {
    const failed = (r.checks || []).filter((c) => !c.pass);
    if (failed.length === 0) continue;
    delta.push({
      itemId: (r.item && (r.item.id || r.item.name)) || '?',
      itemName: r.item && r.item.name,
      missing: failed.map((c) => ({
        type: c.check && c.check.type,
        check: (c.check && (c.check.id || c.check.check || c.check.question)) || '?',
        reason: c.reason || '未通过',
      })),
    });
  }
  return delta;
}

/**
 * 汇总 Verdict（二值，无打分）。
 * @param {Array<ReturnType<typeof verifyItem>>} results
 * @param {{partialOk?: boolean}} [opts] partialOk=true 时全部缺失但存在部分通过 → 'PARTIAL'
 * @returns {{ v: 'PASS'|'PARTIAL'|'FAIL', passCount: number, totalCount: number, delta: Array }}
 */
function verdict(results, { partialOk = true } = {}) {
  const items = results || [];
  const totalCount = items.reduce((n, r) => n + (r.checks ? r.checks.length : 0), 0);
  const passCount = items.reduce((n, r) => n + (r.checks ? r.checks.filter((c) => c.pass).length : 0), 0);
  const delta = deltaList(items);
  if (delta.length === 0) return { v: 'PASS', passCount, totalCount, delta };
  if (partialOk && items.length > 0 && passCount > 0) return { v: 'PARTIAL', passCount, totalCount, delta };
  return { v: 'FAIL', passCount, totalCount, delta };
}

module.exports = {
  INPUT_WHITELIST,
  CONTAMINATED_FIELDS,
  sanitize,
  parseQualityThreshold,
  extractNumber,
  compareNumbers,
  verifyCheck,
  verifyItem,
  deltaList,
  verdict,
};
