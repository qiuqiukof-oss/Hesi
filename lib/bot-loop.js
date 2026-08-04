/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Bot Loop — 统一消息接收循环（通讯接入 A · M2）
//
// 扫码配置只是「拿到凭证」，真正"与 AI 助手连通"需要主动接收消息：
//   - QQ：WebSocket 长连接（官方网关 wss://api.sgroup.qq.com）
//         op10 Hello → op2 Identify(token+intents) → op1 心跳 → op0 事件分发
//         群@机器人 = GROUP_AT_MESSAGE_CREATE（intents 1<<25）
//   - 微信：iLink 长轮询 POST /ilink/bot/getupdates（35s 挂起，游标）
//
// 本模块负责平台循环的生命周期：启动/停止/断线重连/消息→inbound→dispatch→回传。
// 只启动「已配置」平台的循环（fail-closed）；凭证变更/重启自动重新评估。
// ============================================================
const WebSocket = require('ws');
const botConfig = require('./bot-config');
const { normalizeInbound } = require('../routes/bots/adapter');
const { dispatchToChat } = require('../routes/bots/dispatch');

const QQ_GATEWAY = 'https://api.sgroup.qq.com';
const QQ_INTENTS_GROUP_AT = 1 << 25; // 群聊@机器人
const QQ_INTENTS_C2C = 1 << 18;      // 单聊消息（C2C_MESSAGE_CREATE）

/** 各平台循环句柄（stop 函数集合），key=平台 id。 */
const loops = new Map();
/** 启动状态（避免重复启动）。 */
let started = false;

// ── 循环运行状态（bug 修复 2026-08-04：testConnection 读此状态，
// 不再发起与长轮询互斥的探测请求——微信 getupdates 同 bot 并发会被挂起）──
// key=platform，value = { known, expired, lastOkAt, lastError, lastCheck }
const loopState = new Map();

/** 记录某平台循环状态。 */
function setLoopState(platform, patch) {
  loopState.set(platform, { ...(loopState.get(platform) || {}), ...patch, lastCheck: Date.now() });
}

/** 读取某平台循环状态（未跑过返回 { known: false }）。 */
function getLoopState(platform) {
  return loopState.get(platform) || { known: false };
}

// ── 通用：inbound → dispatch → 回传 ──

/**
 * 处理一条平台消息：dispatch 到 chat，结果回传（微信用 context_token）。
 * @param {string} platform
 * @param {object} inbound
 * @param {{ reply?: (chatId: string, text: string, extra?: object) => Promise<any> }} [sender]
 * @returns {Promise<void>}
 */
async function handleInbound(platform, inbound, sender) {
  try {
    const result = await dispatchToChat(inbound, {});
    if (sender && result.ok && result.reply && inbound.chatId) {
      await sender.reply(inbound.chatId, result.reply);
    } else if (result.error) {
      console.warn(`[bot-loop] ${platform} dispatch 失败:`, result.error);
      // bug 修复（2026-08-04）：dispatch 失败也回传简短提示，避免用户
      // 看到"bot 收到消息但完全没反应"（此前只打日志不回复）
      if (sender && inbound.chatId) {
        try { await sender.reply(inbound.chatId, '⚠️ 处理失败，请稍后再试'); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    console.warn(`[bot-loop] ${platform} handleInbound 异常:`, err && err.message);
  }
}

// ── QQ WebSocket 网关循环 ──

/**
 * QQ WS 连接循环：连接→鉴权→心跳→事件分发；断线自动重连（指数退避）。
 * @returns {() => void} stop 函数
 */
function startQQLoop() {
  let ws = null;
  let seq = 0;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let stopped = false;
  let retryDelay = 3000;

  const getToken = async () => {
    const { getAccessToken } = require('../routes/bots/qq');
    return getAccessToken();
  };

  const connect = async () => {
    if (stopped) return;
    try {
      const token = await getToken();
      // 获取网关地址（支持分片，这里只用 shard [0,1] 单分片）
      const gwRes = await fetch(`${QQ_GATEWAY}/gateway`, {
        headers: { Authorization: `QQBot ${token}` },
      });
      if (!gwRes.ok) throw new Error(`gateway HTTP ${gwRes.status}`);
      const gw = await gwRes.json();
      const url = gw.url || 'wss://api.sgroup.qq.com/';
      if (!url.startsWith('wss://')) throw new Error('invalid gateway url');

      ws = new WebSocket(url, { headers: { Authorization: `QQBot ${token}`, 'X-Union-Appid': botConfig.getConfig('qq').appId || '' } });
      ws.on('open', () => { retryDelay = 3000; });
      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
        if (msg.op === 10) {
          // Hello → 鉴权
          seq = 0;
          ws.send(JSON.stringify({
            op: 2,
            d: {
              token: `QQBot ${token}`,
              intents: QQ_INTENTS_GROUP_AT | QQ_INTENTS_C2C,
              shard: [0, 1],
              properties: { $os: 'win32', $browser: 'hesi', $device: 'hesi' },
            },
          }));
          // 心跳
          const interval = msg.d && msg.d.heartbeat_interval || 45000;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: seq }));
            }
          }, interval);
        } else if (msg.op === 0) {
          // Dispatch 事件
          seq = msg.s || seq;
          const t = msg.t || '';
          const d = msg.d || {};
          if (t === 'GROUP_AT_MESSAGE_CREATE' || t === 'C2C_MESSAGE_CREATE') {
            // QQ 消息事件：content 可能含 <@!机器人id> 前缀，剥离
            const text = String(d.content || '').replace(/^<@!?\d+>\s*/, '').trim();
            if (!text) return;
            const chatId = d.group_openid || d.openid || d.author && d.author.member_openid || '';
            const inbound = normalizeInbound('qq', {
              chatId,
              userId: (d.author && d.author.member_openid) || chatId,
              text,
              raw: d,
            }, { chatType: t === 'GROUP_AT_MESSAGE_CREATE' ? 2 : 1 });
            handleInbound('qq', inbound, {
              reply: async (cid, text) => {
                const { sendMessage } = require('../routes/bots/qq');
                const r = await sendMessage(cid, text, { chatType: t === 'GROUP_AT_MESSAGE_CREATE' ? 2 : 1 });
                if (!r.ok) console.warn(`[bot-loop] QQ 回复发送失败: ${r.error}`);
              },
            });
          }
        } else if (msg.op === 7) {
          // Reconnect
          ws.close();
        } else if (msg.op === 9) {
          // Invalid Session（鉴权失败/会话失效）→ 重连（bug 修复 2026-08-04：此前挂起直至超时）
          console.warn('[bot-loop] QQ Invalid Session(op9)，重新连接…');
          ws.close();
        }
      });
      ws.on('close', () => {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (!stopped) {
          reconnectTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      });
      ws.on('error', (err) => { console.warn('[bot-loop] QQ ws error:', err.message); });
    } catch (err) {
      console.warn('[bot-loop] QQ connect 失败:', err.message);
      if (!stopped) {
        reconnectTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      }
    }
  };

  connect();

  return () => {
    stopped = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) { try { ws.close(); } catch {} }
  };
}

// ── 微信 iLink 长轮询循环 ──

/**
 * 微信长轮询循环：getUpdates（35s 挂起）→ 逐条 dispatch → context_token 回传。
 * @returns {() => void} stop 函数
 */
function startWechatLoop() {
  let stopped = false;
  let buf = '';
  let timer = null;
  let retryDelay = 3000;

  const tick = async () => {
    if (stopped) return;
    const { getUpdates, sendMessage, extractText } = require('../routes/bots/wechat-bot');
    const r = await getUpdates(buf);
    if (stopped) return;
    if (r.expired) {
      // bug 修复（2026-08-04）：expired 后保留循环——30s 后重试，
      // 期间用户重新扫码（扫码确认后 restartAll 会重启本循环）
      setLoopState('wechat-bot', { known: true, expired: true, lastError: '会话过期（errcode:-14），需重新扫码' });
      console.warn('[bot-loop] 微信会话过期，请重新扫码（30s 后自动重试）');
      if (!stopped) timer = setTimeout(tick, 30000);
      return;
    }
    if (r.ok) {
      retryDelay = 3000;
      buf = r.buf || buf;
      setLoopState('wechat-bot', { known: true, expired: false, lastError: '' });
      for (const m of r.msgs || []) {
        // bug 修复（2026-08-04）：协议真实结构是 item_list[].text_item.text，
        // 原解析 m.text||m.content 永远为空 → 全部 continue 静默丢弃 → bot 不回话
        const content = extractText(m);
        const chatId = m && (m.openid || m.from_user_id || '');
        const contextToken = m && m.context_token;
        if (!content || !chatId) continue;
        const inbound = normalizeInbound('wechat-bot', { chatId, userId: chatId, text: String(content) });
        handleInbound('wechat-bot', inbound, {
          reply: async (cid, text) => {
            if (!contextToken) return;
            const r = await sendMessage(contextToken, text, cid);
            if (!r.ok && !r.expired) console.warn(`[bot-loop] 微信回复发送失败: ${r.error}`);
          },
        });
      }
    } else {
      // 网络/临时错误 → 退避重试；记录状态供 testConnection 展示
      setLoopState('wechat-bot', { known: true, expired: false, lastError: r.error || '轮询失败' });
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
    // bug 修复（2026-08-04）：成功路径留 800ms 最小间隔，避免背靠背高频请求
    if (!stopped) timer = setTimeout(tick, r.ok ? 800 : retryDelay);
  };

  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// ── 总控：按已配置平台启动循环 ──

/**
 * 启动所有已配置平台的接收循环（幂等）。
 * 只启动 isConfigured() 的平台；凭证变更后调用 restartAll() 重新评估。
 */
function startAll() {
  if (started) return;
  started = true;
  startLoops();
}

/** 实际启动（评估当前配置）。 */
function startLoops() {
  // QQ
  if (botConfig.isConfigured('qq') && !loops.has('qq')) {
    console.log('[bot-loop] ✅ QQ 消息接收循环启动（WebSocket 网关）');
    loops.set('qq', startQQLoop());
  }
  // 微信
  if (botConfig.isConfigured('wechat-bot') && !loops.has('wechat-bot')) {
    console.log('[bot-loop] ✅ 微信消息接收循环启动（iLink 长轮询）');
    loops.set('wechat-bot', startWechatLoop());
  }
}

/** 停止所有循环（重启服务时调用）。 */
function stopAll() {
  for (const [id, stop] of loops) {
    try { stop(); } catch {}
    console.log(`[bot-loop] ${id} 循环已停止`);
  }
  loops.clear();
  started = false;
}

/**
 * 凭证变更后重新评估并启动循环（扫码确认成功时调用）。
 * bug 修复（2026-08-04）：此前扫码成功后循环永不启动，需重启服务。
 */
function restartAll() {
  console.log('[bot-loop] 凭证变更，重新评估接收循环…');
  stopAll();
  startAll();
}

module.exports = { startAll, stopAll, startLoops, restartAll, handleInbound, getLoopState };
