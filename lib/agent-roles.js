// @ts-check
// ============================================================
// Phase 1 S3 — 动态角色预设（配置驱动，零新代码路径）
//
// 多 Agent 协作中，子 Agent 的角色按黑板/任务状态实时切换
// （coder → debugger → reviewer），只动态注入 system 片段 + 工具引导，
// 不改代码逻辑、不加新路径。
//
// 软约束：CLI Agent（opencode/codex）多数不支持按调用限制工具集，
// 故 toolGuidance 以 prompt 引导为主，非硬隔离。
// ============================================================
'use strict';

const ROLES = {
  coder: {
    systemFragment: '你是代码实现者：负责根据需求编写/修改代码，遵循项目既有风格与测试约定，完成即验证。',
    toolGuidance: ['read_file', 'write_file', 'exec_terminal'],
  },
  debugger: {
    systemFragment: '你是调试专家：专注定位并修复失败测试/运行报错，先复现再修复，避免盲目改动无关代码。',
    toolGuidance: ['read_file', 'exec_terminal'],
  },
  reviewer: {
    systemFragment: '你是代码审查者：只审查不修改，指出风险、潜在 bug、与约定不符之处，并给出具体改进建议。',
    toolGuidance: ['read_file'],
  },
  tester: {
    systemFragment: '你是测试工程师：编写并运行测试，覆盖关键路径与边界，清晰报告通过与失败。',
    toolGuidance: ['read_file', 'exec_terminal'],
  },
  deployer: {
    systemFragment: '你是部署负责人：负责构建与部署，确认环境、检查产物，并准备回滚预案。',
    toolGuidance: ['exec_terminal'],
  },
};

// 失败时自动转岗映射（coder/reviewer/tester/deployer → debugger 救火）
const RECOVERY_ROLE = {
  coder: 'debugger',
  reviewer: 'debugger',
  tester: 'debugger',
  deployer: 'debugger',
  debugger: 'debugger',
};

/** 取角色预设；未知角色返回 null。 */
function getRole(name) {
  return ROLES[name] || null;
}

/** 取失败时的转岗角色（默认 debugger）。 */
function resolveRecoveryRole(name) {
  return RECOVERY_ROLE[name] || 'debugger';
}

/**
 * 生成角色前缀行（注入 prompt 用）。
 * @param {string} [role]
 * @returns {string[]} 角色片段行；无角色或未知角色返回 []
 */
function rolePrefix(role) {
  if (!role) return [];
  const r = ROLES[role];
  if (!r) return [];
  const lines = [`[角色] ${r.systemFragment}`];
  if (Array.isArray(r.toolGuidance) && r.toolGuidance.length) {
    lines.push(`你的可用工具引导：${r.toolGuidance.join('、')}（软约束，按需使用）`);
  }
  return lines;
}

module.exports = { ROLES, RECOVERY_ROLE, getRole, resolveRecoveryRole, rolePrefix };
