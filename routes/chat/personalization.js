// @ts-check
// ============================================================
// 个性化注入助手（Persona / Role / Custom Instructions / Language）
//
// 纯函数 + 常量，零副作用，便于单测。后端 routes/chat/index.js 在拼装
// SELF_AWARE_PROMPT 时调用 composePersonalization()，把「个性/角色/自定义
// 指令/语言」统一拼成一段系统提示文本追加进去。
//
// 设计要点（见 .workbuddy/personalization-settings-plan.md）：
//  - 角色 persona 复用既有专家注册表（ws/experts.getPersona），不新建存储；
//  - 自定义指令采用「覆盖式」：用户填了就用用户的，空则回退 DEFAULT_HARD_METRICS，
//    保证不改现状、不回归；
//  - 注入顺序：语言 → 交流风格(个性) → 角色设定(身份) → 工程准则与自定义指令(约束)，
//    让「用户约束」落在最后、权重最强。
// ============================================================
'use strict';

const expertRegistry = require('../../ws/experts');

// ── 内置语气/风格模板（个性选择）──
// key 即前端下拉值；prompt 是一段轻量「交流风格」系统提示。
const PERSONA_TEMPLATES = {
  balanced: {
    label: '通用均衡',
    prompt:
      '你是一个均衡、可靠的 AI 助手：先理解需求再作答，给结论也给出简要依据，必要时提供可直接运行的代码或命令。',
  },
  terse: {
    label: '极简直接',
    prompt:
      '你习惯极简直接：默认先给结论和可执行代码/命令，少铺垫、不重复、不写废话；除非用户要求，不做长篇解释。',
  },
  rigorous: {
    label: '严谨技术',
    prompt:
      '你严谨技术向：任何涉及现状/可行性/兼容性的判断，先举证（文件路径:行号、命令输出、文档版本）再下结论；引用外部 API 前先核对官方文档；少用「可能」「大概」，不确定就明说。',
  },
  socratic: {
    label: '教学引导',
    prompt:
      '你用教学引导风格：优先用反问帮用户理清问题、暴露前提与盲区，再给答案；解释概念时由浅入深、配例子。',
  },
  creative: {
    label: '创意发散',
    prompt:
      '你偏创意发散：面对开放问题多给几个不同角度的方案与思路，鼓励脑暴，不急着收敛到唯一解。',
  },
  casual: {
    label: '中文口语',
    prompt:
      '你用轻松口语化中文交流：像朋友聊天，适度用口语和语气词，避免过度书面与刻板；技术内容仍准确。',
  },
};

// ── 语言指令（合理拓展）──
const LANGUAGE_INSTRUCTIONS = {
  zh: '始终用简体中文回复（技术术语、代码、命令可保留英文原文）。',
  en: 'Always reply in English (technical terms, code, and commands may stay as-is).',
};

// ── 默认工程硬指标（原 routes/chat/index.js 硬编码段，提升为常量）──
// 用户未填自定义指令时回退到此，保证行为不回归。
const DEFAULT_HARD_METRICS = `## 自我演进工程准则（硬约束）
当你读取、修改、重建自身代码（read_file / write_file / rebuild_frontend / exec_terminal）时，必须遵守：
1. **反臃肿（模块化优先）**：尽量不产生臃肿单文件；当某文件已明显过大或混入多个不相关职责时，优先拆分为模块化，而不是在同一文件继续堆代码。Hesi 已有清晰的目录分层（lib/ routes/ public/components/ 等），新增能力优先挂到对应模块。
2. **少 bug（先查关联再动手）**：改动前先仔细检查关联项——调用方/被调用方、跨文件引用、前端 bundle 归属（main vs lazy）、路由/中间件挂载点、相关单测——确认影响面后再改。改动保持小步、单 commit 可回退；改完跑相关测试/lint 再交付。
3. 结构性改动前先出方案（范围/步骤/风险/回滚/验收），确认后再执行——与「先方案后动手」一脉相承。`;

/**
 * 拼装个性化系统提示段。
 * @param {object} [opts]
 * @param {string} [opts.persona]       个性模板 key（PERSONA_TEMPLATES）
 * @param {string} [opts.role]          角色 expertId；'default' 或空 = 使用内置默认
 * @param {string} [opts.customInstructions]  用户自定义指令（覆盖式）
 * @param {string} [opts.language]      'zh' | 'en' | 'auto' | 其他
 * @returns {string} 追加到 SELF_AWARE_PROMPT 的文本（可能为空串）
 */
function composePersonalization({ persona, role, customInstructions, language } = {}) {
  const blocks = [];

  // 1) 语言指令
  if (language && language !== 'auto' && LANGUAGE_INSTRUCTIONS[language]) {
    blocks.push(`## 回复语言\n${LANGUAGE_INSTRUCTIONS[language]}`);
  }

  // 2) 交流风格（个性模板）
  if (persona && PERSONA_TEMPLATES[persona]) {
    blocks.push(`## 交流风格\n${PERSONA_TEMPLATES[persona].prompt}`);
  }

  // 3) 角色设定（专家 persona，来自项目专家注册表）
  if (role && role !== 'default') {
    let p = null;
    try {
      // 注意：必须经由 registry 实例调用，保留 this 绑定（解构会丢 this）。
      p = expertRegistry.getPersona(role);
    } catch {
      p = null; // 专家不存在时静默降级（best-effort）
    }
    if (p && p.trim()) blocks.push(`## 角色设定\n${p.trim()}`);
  }

  // 4) 工程准则与自定义指令（覆盖式：用户指令优先，空则回退默认硬指标）
  const ci = (customInstructions || '').toString().trim();
  blocks.push(`## 工程准则与自定义指令\n${ci || DEFAULT_HARD_METRICS}`);

  return blocks.join('\n\n');
}

module.exports = {
  PERSONA_TEMPLATES,
  LANGUAGE_INSTRUCTIONS,
  DEFAULT_HARD_METRICS,
  composePersonalization,
};
