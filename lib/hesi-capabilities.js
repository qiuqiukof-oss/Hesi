/**
 * Hesi 核心能力清单 —— CLI Agent 提示词的单一事实源。
 *
 * 用途：agent-callbacks.js 的 buildHesiContextPrompt() 动态读取本清单，
 * 拼装「Hesi 运行环境 + 能力全景」提示词注入给 CLI Agent。
 * 功能演进（新增 / 下线能力）只改本文件，无需改动 prompt 模板或注入点。
 *
 * 仅收录「已实现」的能力（对照 v0.6.4 核实），不含规划中功能（如 Scheduler）。
 */

const HESI_RUNTIME = {
  name: 'Hesi',
  desc: '浏览器内 AI 智能体中枢',
  url: 'http://127.0.0.1:4264',
  loopback: true,
  offline: true,
};

// 中枢 AI（Hesi 本体）已具备、CLI Agent 可借助（经由 <cliq:ask> 请求其替完成）的能力
const HESI_CORE_CAPABILITIES = [
  {
    id: 'chat',
    name: '多轮对话与推理',
    desc: '自然语言多轮对话、意图理解与推理。',
  },
  {
    id: 'plan',
    name: '全自动 Plan 执行器',
    desc: '将目标拆为步骤并真实执行（命令 / 文件操作），含审批闸、双轨执行（直接执行 / AI 管线）、失败反思与自动重规划、执行结果自动回流知识库。',
  },
  {
    id: 'roundtable',
    name: '圆桌多角色讨论',
    desc: '召集多个 AI 角色就议题展开多轮辩论并收敛结论。',
  },
  {
    id: 'rag',
    name: 'RAG 知识库',
    desc: '对话与执行沉淀可被检索召回，作为上下文复用。',
  },
  {
    id: 'browser',
    name: '浏览器自动化',
    desc: '基于 Hesi 托管的浏览器实例进行导航、点击、截图、读取页面。',
  },
  {
    id: 'terminal',
    name: '终端与会话托管',
    desc: 'CLI Agent 的命令即运行在 Hesi 托管的持久终端会话中。',
  },
];

module.exports = { HESI_RUNTIME, HESI_CORE_CAPABILITIES };
