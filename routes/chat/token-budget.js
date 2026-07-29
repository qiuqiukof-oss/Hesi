/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Token Budget — 跨轮工具结果压缩（AI ↔ CLI 通信 token 最小化）
//
// 目标：在不影响功能的前提下，尽量压低「AI ↔ CLI Agent」通信的 token 消耗。
//
// 策略：
//  1) agent_poll 增量合并：同一 sessionId 的多轮轮询结果，只保留最近一次完整内容
//     （尾部截断），更早的轮次压缩成一句占位说明。Agent 输出可能很大且被多轮
//     poll 反复塞进上下文，这是通信 token 放大的主要来源，必须压缩。
//  2) 单条 agent_poll 上限：最近一次保留内容也做尾部截断，避免单条超大。
//  3) 绝不删除 tool / tool_result 消息本身，也不改动 tool_call_id / tool_use_id，
//     保证 OpenAI 与 Anthropic 两种格式下工具调用链都不会因裁剪而断裂。
//  4) 不触碰 system / user / assistant 正文，避免丢失对话语义。
//  5) read_file / web_fetch / write_file 等 SKIP_TRUNCATE 工具保持原样（不在此压缩），
//     因为它们常被后续 edit 使用，过度截断会破坏功能。
//
// 纯函数风格：直接修改传入消息对象内容（调用方持有 currentMessages 工作副本，安全）。
// ============================================================

const AGENT_POLL_KEEP_TAIL = 8000; // 最近一次 agent_poll 保留的尾部字符数

/**
 * 判断一条工具结果内容是否为 agent_poll 的输出。
 * agent_poll 返回 JSON：{ ok, sessionId, isDelta:true, output, ... }
 * @param {string} content
 * @returns {object|null}
 */
function _parseAgentPoll(content) {
  if (typeof content !== 'string' || content.length < 20) return null;
  if (!content.includes('"sessionId"')) return null;
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj.sessionId === 'string' &&
        (obj.isDelta !== undefined || obj.ev || obj.output !== undefined)) {
      return obj;
    }
  } catch { /* 不是 JSON */ }
  return null;
}

/**
 * 收集消息数组中的所有「工具结果单元」。
 * 兼容两种格式：
 *  - OpenAI:  { role:'tool', content: string, tool_call_id }
 *  - Anthropic:{ role:'user', content:[ { type:'tool_result', content: string|blocks, tool_use_id } ] }
 * @param {Array<object>} messages
 * @returns {Array<{msgIdx:number, blockIdx:number, content:string, apply:(string)=>void}>}
 */
function _collectUnits(messages) {
  const units = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === 'tool' && typeof m.content === 'string') {
      units.push({
        msgIdx: i,
        blockIdx: -1,
        content: m.content,
        apply: (c) => { m.content = c; },
      });
    } else if (m.role === 'user' && Array.isArray(m.content)) {
      m.content.forEach((b, bi) => {
        if (b && b.type === 'tool_result') {
          const c = typeof b.content === 'string'
            ? b.content
            : (Array.isArray(b.content) ? b.content.map(x => x && x.text ? x.text : '').join('') : '');
          units.push({
            msgIdx: i,
            blockIdx: bi,
            content: c,
            apply: (nc) => { b.content = nc; },
          });
        }
      });
    }
  }
  return units;
}

/**
 * 压缩消息数组中的 agent_poll 工具结果，降低 token 消耗。
 * 直接修改传入消息对象（调用方持有工作副本，安全）。
 * @param {Array<object>} messages
 * @returns {Array<object>} 同一引用（已就地压缩）
 */
function pruneToolContext(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const units = _collectUnits(messages);
  if (units.length === 0) return messages;

  // 按 sessionId 分组 agent_poll 单元
  const bySession = new Map();
  for (const u of units) {
    const poll = _parseAgentPoll(u.content);
    if (!poll) continue;
    if (!bySession.has(poll.sessionId)) bySession.set(poll.sessionId, []);
    bySession.get(poll.sessionId).push({ unit: u, poll });
  }

  let changed = false;

  for (const [sid, items] of bySession) {
    if (items.length <= 1) {
      // 仅一轮：对单条做尾部截断（若过长）
      const { unit } = items[0];
      if (unit.content.length > AGENT_POLL_KEEP_TAIL) {
        unit.apply(`${unit.content.slice(-AGENT_POLL_KEEP_TAIL)
           }\n\n[agent_poll 输出已截断至尾部 ${AGENT_POLL_KEEP_TAIL} 字符]`);
        changed = true;
      }
      continue;
    }

    // 多轮：保留最后一条（尾部截断），其余压缩为占位说明
    const last = items[items.length - 1];
    if (last.unit.content.length > AGENT_POLL_KEEP_TAIL) {
      last.unit.apply(`${last.unit.content.slice(-AGENT_POLL_KEEP_TAIL)
         }\n\n[agent_poll 最近一次输出，已截断至尾部 ${AGENT_POLL_KEEP_TAIL} 字符]`);
      changed = true;
    }

    for (let k = 0; k < items.length - 1; k++) {
      const { unit, poll } = items[k];
      const tail = poll.output ? String(poll.output).slice(-500) : '';
      unit.apply(
        `[agent_poll 历史轮次已压缩（session ${sid}，共 ${items.length} 次轮询；最新一次见末条）。${
         tail ? ` 上次尾部预览：\n${tail}` : ''  }]`
      );
      changed = true;
    }
  }

  return messages;
}

module.exports = { pruneToolContext, _parseAgentPoll, _collectUnits };
