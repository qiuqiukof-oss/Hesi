/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 自然语言 → Plan 生成器（全自动 Phase 1 — auto-Planner 入口）
//
// 接收一段自然语言目标，复用 lib/memory/llm-bridge.complete（支持 openai/anthropic，
// 可测试注入），产出符合 plan-schema 的 plan 对象。生成的 plan 直接进入
// plan-routes 的现有流水线（gatePlan → runPlan → 圆桌/过闸），无需改动 run-plan。
//
// 设计约束：纯异步、零硬编码模型、失败可诊断（带 error.code）。
// ============================================================

const { complete } = require('../../lib/memory/llm-bridge');
const { validatePlan, emptyPlan } = require('./plan-schema');

const SYSTEM_PROMPT = [
  '你是一个「目标 → 可执行 Plan」的拆解器。用户会给你一段自然语言目标。',
  '请把它拆解成一份结构化、机器可验证的 Plan，并【只输出 JSON】，不要任何解释或额外文字（可用 ```json 包裹，但内容只能是 JSON）。',
  '',
  'Plan 字段（严格遵循）：',
  '{',
  '  "objective": "一句话目标（必填）",',
  '  "title": "简短标题（可选）",',
  '  "acceptance": [ { "kind": "command"|"script"|"http"|"manual", "command": "可执行命令（kind 为 command/script 时必填）", "expect": "期望结果（可选）", "description": "验收说明（可选）" } ],',
  '  "steps": [ { "id": "唯一字符串", "goal": "本步目标", "action": "本步指令（给执行器/智能体）", "type": "可选", "verify": { "kind": "...", "command": "..." }, "requireApproval": false } ],',
  '  "approvalPolicy": "marked",',
  '  "allow_external": false,',
  '  "forbidden": [],',
  '  "scope_paths": [],',
  '  "budget": { "maxRounds": 0, "maxTokens": 0, "maxMinutes": 0 }',
  '}',
  '',
  '规则：',
  '- acceptance 优先用 command/script/http 让机器自动验收；确实只能人判时才用 manual。',
  '- steps 的 id 必须唯一；goal/action 必填且具体。',
  '- 尽量给出可由命令行验证的 acceptance（如 grep/node/构建命令），便于全自动闭环自动判定。',
  '- budget 给宽松上限（如 maxRounds=步数*4，maxMinutes=步数*8）。',
  '',
  '示例（用户目标：在仓库根 README 顶部加「构建状态」章节）：',
  JSON.stringify({
    objective: '在仓库根 README.md 顶部新增「构建状态」章节',
    acceptance: [{ kind: 'command', command: "grep -q '构建状态' README.md", expect: 'README.md 含「构建状态」章节' }],
    steps: [{ id: 's1', goal: '插入徽章章节', action: '在 README.md 第 1 行后插入「## 构建状态」及徽章', requireApproval: false }],
    approvalPolicy: 'marked',
    budget: { maxRounds: 4, maxMinutes: 8 },
  }),
].join('\n');

/** 从模型文本中抽出 JSON 对象（容忍 ```json 围栏与两侧多余文字） */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 用 schema 默认值补全 plan，保证进入流水线前形状完整 */
function applyDefaults(plan, objectiveText) {
  const out = emptyPlan();
  out.id = plan.id || (`nl-${  Date.now().toString(36)}`);
  out.title = plan.title || (plan.objective || objectiveText || '自然语言目标').slice(0, 60);
  out.objective = plan.objective || objectiveText || '';
  out.acceptance = Array.isArray(plan.acceptance) ? plan.acceptance : [];
  out.steps = Array.isArray(plan.steps)
    ? plan.steps.map((s, i) => ({
        id: s.id || (`s${  i + 1}`),
        goal: s.goal || '',
        action: s.action || '',
        type: s.type,
        verify: s.verify,
        on_fail: s.on_fail,
        checkpoint: s.checkpoint,
        dependsOn: s.dependsOn,
        requireApproval: typeof s.requireApproval === 'boolean' ? s.requireApproval : undefined,
      }))
    : [];
  if (plan.approvalPolicy) out.approvalPolicy = plan.approvalPolicy;
  if (typeof plan.allow_external === 'boolean') out.allow_external = plan.allow_external;
  if (Array.isArray(plan.forbidden)) out.forbidden = plan.forbidden;
  if (Array.isArray(plan.scope_paths)) out.scope_paths = plan.scope_paths;
  const b = plan.budget && typeof plan.budget === 'object' ? plan.budget : {};
  const n = out.steps.length || 1;
  out.budget = {
    maxRounds: Number(b.maxRounds) || n * 4,
    maxTokens: Number(b.maxTokens) || 0,
    maxMinutes: Number(b.maxMinutes) || n * 8,
  };
  return out;
}

function repairPrompt(errors) {
  return [
    '你刚才生成的 plan 未通过结构校验，错误如下：',
    errors.join('\n'),
    '请修正后重新只输出符合 schema 的 JSON（字段结构与示例一致）。',
  ].join('\n');
}

/**
 * 自然语言目标 → plan 对象（可直接交给 runPlan）。
 * @param {string} text 用户目标
 * @param {{ apiKey?:string, provider?:string, baseUrl?:string, model?:string }} runtime
 * @returns {Promise<object>}
 */
async function generatePlanFromObjective(text, runtime = {}) {
  const { apiKey, provider, baseUrl, model } = runtime || {};
  const userMsg = `目标：\n${  text || ''}`;
  const raw = await complete(SYSTEM_PROMPT, userMsg, { apiKey, provider, model, baseUrl });
  if (!raw) {
    const e = new Error(
      '无法从自然语言生成 plan：缺少 API Key / 模型未配置，或模型调用失败。'
      + '请在「高级」中填写 API Key 与模型，或直接手写 Plan JSON。'
    );
    e.code = 'GEN_FAILED';
    throw e;
  }
  let plan = extractJson(raw);
  let v = plan ? validatePlan(plan) : { ok: false, errors: ['模型未返回可解析的 JSON'] };
  if (!v.ok) {
    // 校验失败 → 带错误反馈修复一次
    const repaired = await complete(repairPrompt(v.errors), userMsg, { apiKey, provider, model, baseUrl });
    const fixed = repaired ? extractJson(repaired) : null;
    if (fixed) {
      plan = fixed;
      v = validatePlan(plan);
    }
  }
  if (!v.ok) {
    const e = new Error(`生成的 plan 未通过校验：${  v.errors.join('；')}`);
    e.code = 'GEN_INVALID';
    e.errors = v.errors;
    throw e;
  }
  return applyDefaults(plan, text);
}

module.exports = { generatePlanFromObjective, extractJson, applyDefaults };
