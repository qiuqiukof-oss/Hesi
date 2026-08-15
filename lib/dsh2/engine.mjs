/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// DSH2 — 进程内 DeepSeek Harness 引擎（Phase 2 深度集成）
//
// 与 Phase 1（子进程 + iframe）不同，本模块把 DSH 核心直接嵌入 Hesi 进程：
//   - boot() 加载 composition.yml（headless 组合的精简版，模型经 DSH_MODEL env 注入）
//   - 每个 Hesi 聊天会话 ↔ 一个 DSH Agent（多轮持续对话，JSONL 持久化 + 自动压缩）
//   - session/event 事件流实时翻译为 Hesi SSE 事件（reasoning/token/tool/usage）
//
// 本文件为 ESM（DSH 包均为 ESM），Hesi 的 CJS 服务器通过 await import() 加载。
// 复用 Hesi-Q node_modules 中 @deepseek-ai/dsh 依赖树（全部 0.1.0-rc.6，版本一致）。
// ============================================================

import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// CJS 模块经 default interop 引入
import providerConfig from '../llm-provider/provider-config.js'
import workspace from '../workspace.js'

const COMPOSITION_URL = new URL('./composition.yml', import.meta.url)

/** @type {import('@deepseek-ai/cordis').Context|null} */
let ctx = null
let bootPromise = null
/** Hesi 会话 id → DSH agent（多轮持续） */
const agentByHesi = new Map()

/**
 * 进程级唯一后缀：DSH 的 JSONL 持久化按 sessionId 存盘，同名重建会 id collision
 * （Hesi 重启后磁盘上有旧日志）。加进程后缀：同进程内多轮持续、跨重启天然无冲突。
 */
const PROC_TAG = process.pid.toString(36) + Date.now().toString(36)

/** 工具调用追踪：callId → { name, ts }（tool/result 事件顶层不带 name，需反查）。 */
const toolCalls = new Map()

/** Hesi 项目根（mcp-server.js 所在目录，供 composition mcp-client cwd 使用）。 */
const HESI_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** 与 Phase 1 同源：DSH 引擎使用的 provider（HESI_DSH_PROVIDER，默认 deepseek）。 */
function getDshProvider() {
  return process.env.HESI_DSH_PROVIDER || 'deepseek'
}

/** 模型：HESI_DSH_MODEL → provider 已选模型 → 默认 deepseek-v4-flash。 */
function getDshModel(cfg) {
  return process.env.HESI_DSH_MODEL || cfg.model || 'deepseek-v4-flash'
}

/** 启动前注入 Hesi 模型配置到进程环境（credentials-local / llm-deepseek 读取）。 */
function applyHesiEnv() {
  const cfg = providerConfig.getConfig(getDshProvider())
  if (cfg.apiKey) process.env.DEEPSEEK_API_KEY = cfg.apiKey
  if (cfg.baseUrl) process.env.DEEPSEEK_BASE_URL = cfg.baseUrl
  process.env.DSH_MODEL = getDshModel(cfg)
  process.env.DSH_TELEMETRY_DISABLED = '1'
  process.env.HESI_DSH_ROOT = HESI_ROOT
  try {
    process.env.DSH_CWD = workspace.getWorkspace()
  } catch { /* ignore */ }
}

/** 幂等获取引擎实例（boot 一次，全进程复用）。@returns {Promise<import('@deepseek-ai/cordis').Context>} */
export async function ensureEngine() {
  if (ctx) return ctx
  if (!bootPromise) {
    bootPromise = (async () => {
      applyHesiEnv()
      ctx = await boot('hesi-dsh2', fileURLToPath(COMPOSITION_URL))
      return ctx
    })()
  }
  return bootPromise
}

/** 取（或创建）某 Hesi 会话对应的 DSH Agent。@returns {Promise<object>} */
export async function getOrCreateAgent(hesiSessionId, { cwd } = {}) {
  const engine = await ensureEngine()
  if (agentByHesi.has(hesiSessionId)) return agentByHesi.get(hesiSessionId)
  const agents = engine.get('agents')
  const defaultModel = engine.get('agentDefaultModel')
  const sessions = engine.get('sessions')
  if (!agents || !defaultModel || !sessions) {
    throw new Error('DSH 引擎核心服务未就绪（agents/agentDefaultModel/sessions）')
  }
  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: SessionId(`hesi-${hesiSessionId}-${PROC_TAG}`),
    meta: { cwd: cwd || workspace.getWorkspace() },
    agentOptions: { provider: selection.provider, model: selection.model },
  })
  agentByHesi.set(hesiSessionId, agent)
  return agent
}

/** 销毁某 Hesi 会话的 DSH Agent（开新会话用）。@returns {Promise<boolean>} */
export async function resetSession(hesiSessionId) {
  const agent = agentByHesi.get(hesiSessionId)
  if (!agent) return false
  try { await agent.session.dispose() } catch { /* ignore */ }
  agentByHesi.delete(hesiSessionId)
  return true
}

/**
 * 翻译 DSH SessionEvent → Hesi SSE 帧（数组形式返回，由调用方写流）。
 * @param {object} event - DSH session/event
 * @returns {Array<object>} Hesi SSE payload 列表（type: token/reasoning/status/tool_call_start/tool_call_end/usage）
 */
/** 从 tool-result 块提取文本（content 是块数组，逐层剥）。@param {object} block @returns {string} */
function extractResultText(block) {
  if (!block) return ''
  if (typeof block.content === 'string') return block.content
  if (Array.isArray(block.content)) {
    return block.content
      .map((b) => {
        if (b.type === 'text') return b.text
        if (b.type === 'tool-result') return extractResultText(b)
        return ''
      })
      .join('')
  }
  return ''
}

function translateEvent(event) {
  const out = []
  const { type, data } = event
  switch (type) {
    case 'turn/start':
      out.push({ type: 'status', message: `🧠 DSH 回合开始（第 ${data.turn} 轮）` })
      break
    case 'step/start':
      out.push({ type: 'status', message: `⚙️ DSH 步骤 ${data.step}` })
      break
    case 'assistant/chunk': {
      const c = data.chunk
      if (c.type === 'reasoning-delta') {
        out.push({ type: 'reasoning', content: c.text })
      } else if (c.type === 'text-delta') {
        out.push({ type: 'token', content: c.text })
      } else if (c.type === 'usage') {
        out.push({ type: 'usage', usage: c.usage })
      }
      break
    }
    case 'tool/call': {
      toolCalls.set(data.callId, { name: data.name, ts: Date.now() })
      out.push({ type: 'tool_call_start', names: [data.name] })
      out.push({ type: 'status', message: `🔧 DSH 正在调用: ${data.name}` })
      break
    }
    case 'tool/result': {
      const callId = data.message && data.message.source && data.message.source.callId
      const track = callId ? toolCalls.get(callId) : undefined
      if (track) toolCalls.delete(callId)
      let resultText = ''
      try {
        const content = data.message && data.message.content
        if (Array.isArray(content)) {
          resultText = content
            .filter((b) => b.type === 'tool-result')
            .map(extractResultText)
            .join('\n')
        }
      } catch { /* ignore */ }
      const truncated = resultText.length > 800
      if (truncated) resultText = resultText.slice(0, 800) + '…'
      out.push({
        type: 'tool_call_end',
        name: (track && track.name) || 'tool',
        durMs: track ? Date.now() - track.ts : 0,
        truncated,
        result: resultText,
      })
      break
    }
    case 'turn/end':
      out.push({ type: 'status', message: '🏁 DSH 回合结束' })
      break
    default:
      break
  }
  return out
}

/**
 * 发送一条消息给 DSH Agent 并流式输出事件。
 * @param {string} hesiSessionId - Hesi 聊天会话 id
 * @param {string} text - 用户消息
 * @param {object} [opts]
 * @param {string} [opts.cwd] - agent 工作目录（首次创建时生效）
 * @param {(payload: object) => void} opts.onEvent - 每个翻译后 SSE payload 的回调
 * @returns {Promise<void>}
 */
export async function sendMessage(hesiSessionId, text, { cwd, onEvent } = {}) {
  const engine = await ensureEngine()
  const agent = await getOrCreateAgent(hesiSessionId, { cwd })
  const sessions = engine.get('sessions')

  // 该 agent 会话事件 → 翻译 → onEvent
  let disposeListener = () => {}
  try {
    disposeListener = engine.on('session/event', (session, event) => {
      if (!session || session.id !== agent.session.id) return
      for (const payload of translateEvent(event)) onEvent(payload)
    })
  } catch { /* 若总线不可订阅则降级：仅输出最终结果 */ }

  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await sessions.flush(agent.session)
  } finally {
    disposeListener()
  }
}

/** 引擎状态（供 /api/dsh2/status）。boot 失败时把原因带回给前端。 */
export async function getStatus() {
  let running = false
  let engineError = null
  try {
    running = !!(await ensureEngine())
  } catch (e) {
    engineError = (e && e.message) || String(e)
  }
  return {
    running,
    error: engineError,
    model: getDshModel(providerConfig.getConfig(getDshProvider())),
    provider: getDshProvider(),
    sessions: agentByHesi.size,
  }
}

/** 进程退出时释放（幂等）。 */
export async function dispose() {
  if (bootPromise) {
    try {
      const engine = await bootPromise
      await engine.fiber.dispose()
    } catch { /* ignore */ }
  }
  ctx = null
  bootPromise = null
  agentByHesi.clear()
}
