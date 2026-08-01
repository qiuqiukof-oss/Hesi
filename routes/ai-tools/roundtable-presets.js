/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// P2.2 圆桌模板预置（轻量静态数据，无新依赖，纯函数可测）
//
// 提供多套「角色 + 协作协议」圆桌模板，供 /api/roundtable/templates 列出、
// /api/roundtable/templates/:id 取详情。前端切换模板后把 protocol + personas
// 注入 discuss 任务提示（见 routes/chat/discuss.js 的 buildCliTask）。
//
// 设计：内联数组，不扫目录、不引依赖，便于单测与离线分发。
// 注意：本模块与圆桌 DAG 的执行模板（workflow-templates/roundtable.json，
// 供 workflow_start 消费）是两件事，互不耦合。
// ============================================================
'use strict';

/**
 * @typedef {Object} Persona
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} viewpoint
 */

/**
 * @typedef {Object} RoundtablePreset
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {{id:string,name:string,roleLabel:string,avatar?:{type:string,value:string},viewpoint?:string}} host
 * @property {Persona[]} personas
 * @property {string} protocol
 * @property {{maxConcurrency?:number}} [suggested]
 */

/** @type {RoundtablePreset[]} */
const PRESETS = [
  {
    id: 'hearth',
    title: '围炉圆桌 · 多角色协作',
    description: '4 个 Agent 围坐协作：前端 / 后端 / 架构师 / 测试，由 AI 助手主持。适用于多方视角权衡的需求讨论、方案评审、代码评审。',
    host: {
      id: 'host',
      name: 'AI 助手 · 主持人',
      roleLabel: 'Moderator',
      avatar: { type: 'emoji', value: '🤖' },
      viewpoint: '主持圆桌、串场、裁定分歧、汇总结论。你（用户）只负责提供议题。',
    },
    personas: [
      { id: 'fox', name: '小狐 Foxy', role: '前端 Frontend', viewpoint: '关注交互、UI 一致性、前端可维护性与边界情况。' },
      { id: 'panda', name: '胖达 Panda', role: '后端 Backend', viewpoint: '关注接口契约、数据一致性、性能与错误处理。' },
      { id: 'owl', name: '博士 Owl', role: '架构师 Architect', viewpoint: '关注整体结构、模块边界、长期演进与技术风险。' },
      { id: 'bunny', name: '查查 Bunny', role: '测试 QA', viewpoint: '关注覆盖路径、回归风险、可验证性与验收标准。' },
    ],
    protocol: '各方仅从自身角色视角发言，先给观点再给依据；出现分歧时由 AI 助手主持人裁定或要求补充证据；讨论结束由 AI 助手汇总共识、分歧与待办。你（用户）只提供议题，不直接参与发言。未参与的席位留为空座，不打断讨论。',
    suggested: { maxConcurrency: 4 },
  },
  {
    id: 'pair',
    title: '前后端结对',
    description: '前端 + 后端两席结对，就同一议题快速对齐接口与实现边界，适合小而具体的功能点讨论。',
    host: {
      id: 'host',
      name: 'AI 助手 · 主持人',
      roleLabel: 'Moderator',
      avatar: { type: 'emoji', value: '🤖' },
      viewpoint: '串场、补充上下文、在前后端分歧时帮助收敛到可落地的契约。',
    },
    personas: [
      { id: 'fe', name: '前端 FE', role: '前端 Frontend', viewpoint: '从用户界面与交互出发，关注参数形状、加载态、错误提示与边界输入。' },
      { id: 'be', name: '后端 BE', role: '后端 Backend', viewpoint: '从数据与持久化出发，关注接口契约、状态码、事务与性能预算。' },
    ],
    protocol: '每轮先由前端提出对接口/数据的期望（含字段、类型、异常），后端据此给出实现约束或反例；AI 助手在每轮末试图收敛出一份最小接口契约草案，分歧处显式标注待确认项。',
    suggested: { maxConcurrency: 2 },
  },
  {
    id: 'review',
    title: '产品 + 研发评审',
    description: '产品 / 前端 / 后端 / 测试四席，从需求价值到落地风险逐层评审，适合方案评审与上线前复查。',
    host: {
      id: 'host',
      name: 'AI 助手 · 主持人',
      roleLabel: 'Moderator',
      avatar: { type: 'emoji', value: '🤖' },
      viewpoint: '确保讨论围绕「用户价值 → 技术可行性 → 风险」推进，并产出可执行的下一步清单。',
    },
    personas: [
      { id: 'pm', name: '产品 PM', role: '产品 Product', viewpoint: '关注用户价值、使用场景与优先级，对「为什么做」负责。' },
      { id: 'fe', name: '前端 FE', role: '前端 Frontend', viewpoint: '关注交互成本、实现复杂度与改动面。' },
      { id: 'be', name: '后端 BE', role: '后端 Backend', viewpoint: '关注数据模型、接口稳定性与系统边界。' },
      { id: 'qa', name: '测试 QA', role: '测试 QA', viewpoint: '关注验收口径、回归风险与可验证性。' },
    ],
    protocol: '按「价值 → 方案 → 风险 → 验收」顺序展开：产品先陈述价值与验收意图，研发两侧评估成本与可行性，测试给出验收口径；AI 助手每轮末汇总共识与待决项，最终产出「做 / 不做 / 条件做」结论。',
    suggested: { maxConcurrency: 4 },
  },
  {
    id: 'debate',
    title: '三方辩论',
    description: '三个立场对立的辩论者（激进 / 保守 / 中立），就争议性技术选型或方案正反对撞，适合权衡决策。',
    host: {
      id: 'host',
      name: 'AI 助手 · 裁判',
      roleLabel: 'Moderator',
      avatar: { type: 'emoji', value: '⚖️' },
      viewpoint: '不站队，负责公平分配发言、逼出论据、最后给出权衡矩阵而非单一结论。',
    },
    personas: [
      { id: 'pro', name: '激进派 Pro', role: '主张采纳', viewpoint: '主张推进该方案，强调收益、紧迫性与机会成本，乐于承担可控风险。' },
      { id: 'con', name: '保守派 Con', role: '主张谨慎', viewpoint: '主张放缓或反对，强调风险、复杂度、维护负担与可逆性。' },
      { id: 'mid', name: '中立派 Neue', role: '折中观察', viewpoint: '站在用户与长期演进视角，寻找折中路径、前提条件与分阶段方案。' },
    ],
    protocol: '每轮三方轮流立论（激进 → 保守 → 中立），必须直接回应上一轮的论点而非自说自话；AI 助手裁判在每轮末提炼「交锋点」，终局给出权衡矩阵（收益/风险/成本/可逆性），不代替决策。',
    suggested: { maxConcurrency: 3 },
  },
];

/**
 * 列出所有模板的摘要（不含完整 personas 文本，减小响应体积）。
 * @returns {Array<{id:string,title:string,description:string,personaCount:number,protocol:string}>}
 */
function listPresets() {
  return PRESETS.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    personaCount: (p.personas || []).length,
    protocol: p.protocol || '',
  }));
}

// P2-6：批判者/红队角色——预设模板（激进审查每个方案的安全与逻辑缺陷）
PRESETS.push({
  id: 'safety',
  name: '红队安全审查',
  emoji: '🛡️',
  personas: [
    { name: '安全审计', role: 'securityReviewer', viewpoint: '以攻击者视角审视每个方案：找注入点、提权路径、数据泄漏、供应链风险。每轮至少提出 2 个具体漏洞或攻击面，并给出修复建议。' },
    { name: '代码合规', role: 'complianceChecker', viewpoint: '检查方案是否违反安全编码规范、是否有敏感信息硬编码、是否缺少输入校验。用规则编号引用具体违规项。' },
    { name: '架构审查', role: 'archReviewer', viewpoint: '检查方案对系统整体架构的影响：性能回退、单点故障、状态一致性破坏。给出量化的影响评估（高/中/低）。' },
  ],
  protocol: '每轮必须同时呈现：漏洞发现 + 利用路径 + 修复方案 + 严重度评级。达成共识前不得跳过任何一项。',
});

PRESETS.push({
  id: 'critic',
  name: '批判性审视',
  emoji: '🔍',
  personas: [
    { name: '质疑者', role: 'skeptic', viewpoint: '对每轮 AI 助手发言至少提出 2 个质疑：假设是否成立？数据是否充分？边界情况是否覆盖？要求具体反例或实证。' },
    { name: '纠错者', role: 'factChecker', viewpoint: '逐条核验事实性断言：引用来源、数值计算、逻辑链条。发现错误立刻标注并给出正确值。' },
  ],
  protocol: '每轮回复必须包含：① 质疑清单（≥2 条）② 风险等级（高/中/低）③ 替代方案建议。',
});

// conversationSynthesis 预置（多 Agent 场景特别推荐，从多视角弥补单一 LLM 盲区）
// 独立审查 preset（如 verify/review）优先选择此模板——专注代码静态审查，不需要方案建议。<｜end▁of▁thinking｜>

/**
 * 取单个模板详情。
 * @param {string} id
 * @returns {RoundtablePreset|null}
 */
function getPreset(id) {
  if (!id || typeof id !== 'string') return null;
  return PRESETS.find((p) => p.id === id) || null;
}

module.exports = { PRESETS, listPresets, getPreset };
