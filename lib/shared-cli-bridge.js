/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// ============================================================
// Shared CLI Bridge v2 — 用户 CLI 会话「邀请 AI 协作」
//
// v2 优化（基于球总+AI 讨论）：
// - 执行历史追踪 + 重复命令检测
// - 智能等待（输出稳定性检测）替代硬编码 2.5s
// - 结构化上下文返回值（recentHistory + currentState + delta）
// - 跨 Agent 循环检测（频率限制）
// - /cli 三级模式（单次/锁定/协作）
// ============================================================
const { isSensitive, makeConfirmToken } = require('./sensitive-commands');

// 非行式（交互式全屏）程序：进入即判「交互式程序运行中」，AI 不读历史只提示退出。
const NON_LINEAR_PROGS = new Set([
  'vi', 'vim', 'top', 'htop', 'less', 'more', 'nano', 'man', 'watch',
  'emacs', 'pine', 'mutt', 'lynx', 'irssi',
  'screen', 'tmux', 'ssh', 'telnet', 'ftp', 'mc',
]);

// 命令速度提示：用于智能等待的参数调优
const CMD_SPEED_HINTS = new Map([
  // 快命令：< 1s
  ['ls', 'fast'], ['pwd', 'fast'], ['echo', 'fast'], ['which', 'fast'],
  ['whoami', 'fast'], ['date', 'fast'], ['hostname', 'fast'], ['cd', 'fast'],
  ['cat', 'fast'], ['head', 'fast'], ['tail', 'fast'], ['wc', 'fast'],
  // 中命令：1-5s
  ['git status', 'medium'], ['git diff', 'medium'], ['git log', 'medium'],
  ['npm list', 'medium'], ['npm run', 'medium'], ['node', 'medium'],
  ['python', 'medium'], ['docker ps', 'medium'], ['git branch', 'medium'],
  // 慢命令：5s+
  ['npm install', 'slow'], ['npm ci', 'slow'], ['yarn install', 'slow'],
  ['docker build', 'slow'], ['cargo build', 'slow'], ['make', 'slow'],
  ['cmake', 'slow'], ['go build', 'slow'], ['mvn', 'slow'], ['gradle', 'slow'],
]);

function _guessCmdSpeed(cmd) {
  if (!cmd) return 'medium';
  const trimmed = cmd.trim().split(/\s+/)[0].split('/').pop();
  return CMD_SPEED_HINTS.get(trimmed) || CMD_SPEED_HINTS.get(cmd.trim()) || 'medium';
}

function _waitParamsForSpeed(speed) {
  switch (speed) {
    case 'fast':  return { maxWait: 3000,  pollInterval: 200, stableRounds: 1 };
    case 'slow':  return { maxWait: 15000, pollInterval: 500, stableRounds: 3 };
    default:      return { maxWait: 8000,  pollInterval: 300, stableRounds: 2 };
  }
}

class SharedCliBridge {
  constructor() {
    /** @type {Map<string, { tabId: string, cliId: string, mode: 'readwrite'|'readonly', invitedAt: number }>} */
    this._byUser = new Map();
    /** @type {Map<string, { since: number, owner: string, timer?: NodeJS.Timeout }>} 并发写锁 */
    this._writeLock = new Map();
    /** @type {Map<string, number>} 用户正在输入的信号 */
    this._typingUntil = new Map();
    /** @type {Map<string, { token: string, userId: string, command: string, createdAt: number }>} 敏感命令二次确认令牌 */
    this._confirmTokens = new Map();
    /** @type {Map<string, Array<{ cmd: string, at: number, outputSnippet: string }>>} 执行历史：tabId → 记录列表 */
    this._executionLog = new Map();
    /** @type {Map<string, number>} 跨 Agent 频率限制：`${userId}:${window}` → 调用次数 */
    this._callCounter = new Map();
    /** @type {Map<string, { count: number, firstAt: number }>} 连续失败计数：tabId → { count, firstAt } */
    this._consecutiveFails = new Map();
    /** ws-handler 实例（server 启动后注入） */
    this._wsManager = null;
  }

  // ── 用户输入信号 ──
  markUserTyping(tabId) {
    if (!tabId) return;
    this._typingUntil.set(tabId, Date.now() + 1500);
  }

  isUserTyping(tabId) {
    if (!tabId) return false;
    const until = this._typingUntil.get(tabId) || 0;
    if (Date.now() > until) {
      this._typingUntil.delete(tabId);
      return false;
    }
    return true;
  }

  // ── wsManager ──
  setWsManager(wsManager) { this._wsManager = wsManager; }
  getWsManager() { return this._wsManager; }

  /**
   * 记录连续失败（同一 tabId 短时间内多次失败 → 建议用户干预）。
   * @param {string} tabId
   * @param {boolean} success
   * @returns {{ shouldStop: boolean, failCount: number }}
   */
  trackConsecutiveFails(tabId, success) {
    if (!tabId) return { shouldStop: false, failCount: 0 };
    if (success) {
      this._consecutiveFails.delete(tabId);
      return { shouldStop: false, failCount: 0 };
    }
    const existing = this._consecutiveFails.get(tabId) || { count: 0, firstAt: Date.now() };
    existing.count++;
    // 5 分钟窗口内超过 3 次失败 → 建议停止
    if (Date.now() - existing.firstAt > 5 * 60 * 1000) {
      existing.count = 1;
      existing.firstAt = Date.now();
    }
    this._consecutiveFails.set(tabId, existing);
    // 清理过期条目（避免内存泄漏）
    if (this._consecutiveFails.size > 50) {
      const now = Date.now();
      for (const [k, v] of this._consecutiveFails) {
        if (now - v.firstAt > 10 * 60 * 1000) this._consecutiveFails.delete(k);
      }
    }
    return { shouldStop: existing.count >= 3, failCount: existing.count };
  }

  /**
   * 取当前用户「激活中」的 CLI tab。
   * @param {string} userId
   * @returns {{ tabId: string, cliId: string }|null}
   */
  getActiveTab(userId) {
    if (!this._wsManager || !userId) return null;
    const fn = this._wsManager.findActiveTabByUser;
    if (typeof fn !== 'function') return null;
    return fn(userId) || null;
  }

  // ── 执行历史追踪（v2 新增）──
  /**
   * 记录一次命令执行。
   * @param {string} tabId
   * @param {string} cmd
   * @param {string} outputSnippet - 输出摘要（截取前 200 字符）
   */
  recordExecution(tabId, cmd, outputSnippet) {
    if (!tabId || !cmd) return;
    if (!this._executionLog.has(tabId)) {
      this._executionLog.set(tabId, []);
    }
    const log = this._executionLog.get(tabId);
    log.push({ cmd, at: Date.now(), outputSnippet: (outputSnippet || '').slice(0, 200) });
    // 只保留最近 20 条
    if (log.length > 20) log.splice(0, log.length - 20);
  }

  /**
   * 获取最近 N 条执行记录（含相对时间描述）。
   * @param {string} tabId
   * @param {number} [n=5]
   * @returns {Array<{ cmd: string, at: string, outputSnippet: string }>}
   */
  getRecentExecutions(tabId, n = 5) {
    const log = this._executionLog.get(tabId) || [];
    return log.slice(-n).map(e => ({
      cmd: e.cmd,
      at: _relativeTime(e.at),
      outputSnippet: e.outputSnippet,
    }));
  }

  /**
   * 检测命令是否重复（最近 60s 内执行过相同命令）。
   * @returns {{ isDuplicate: boolean, lastExecution?: { cmd: string, at: string } }}
   */
  checkDuplicate(tabId, cmd) {
    if (!tabId || !cmd) return { isDuplicate: false };
    const log = this._executionLog.get(tabId) || [];
    const now = Date.now();
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (now - e.at > 60000) break; // 只看 60s 内
      if (e.cmd === cmd) {
        return { isDuplicate: true, lastExecution: { cmd: e.cmd, at: _relativeTime(e.at) } };
      }
    }
    return { isDuplicate: false };
  }

  // ── 智能等待（v2 新增）──
  /**
   * 等待终端输出稳定（替代硬编码 setTimeout）。
   * 检测输出变化：连续 stableRounds 次 pollInterval 无变化 → 视为命令完成。
   * @param {object} wsManager
   * @param {string} tabId
   * @param {number} tailLines
   * @param {{ maxWait?: number, pollInterval?: number, stableRounds?: number }} [opts]
   * @returns {Promise<string>} 稳定后的输出
   */
  async waitForOutput(wsManager, tabId, tailLines, opts = {}) {
    const { maxWait = 8000, pollInterval = 300, stableRounds = 2 } = opts;
    const startTime = Date.now();
    let lastOutput = '';
    let stableCount = 0;

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));
      const current = _stripAnsi(wsManager.readTabOutput(tabId, tailLines) || '');

      if (current === lastOutput) {
        stableCount++;
        if (stableCount >= stableRounds) break;
      } else {
        stableCount = 0;
        lastOutput = current;
      }
    }
    return lastOutput;
  }

  // ── 跨 Agent 频率限制（v2 新增）──
  /**
   * 检查用户 CLI 操作频率。默认 1 分钟内最多 5 次。
   * @param {string} userId
   * @param {number} [maxCalls=5]
   * @param {number} [windowMs=60000]
   * @returns {boolean} true=允许，false=超限
   */
  checkRateLimit(userId, maxCalls = 5, windowMs = 60000) {
    if (!userId) return true;
    const windowIdx = Math.floor(Date.now() / windowMs);
    const key = `${userId}:${windowIdx}`;
    const count = (this._callCounter.get(key) || 0) + 1;
    this._callCounter.set(key, count);
    // 清理过期窗口（避免内存泄漏）
    if (this._callCounter.size > 100) {
      for (const [k] of this._callCounter) {
        const w = Number(k.split(':')[1]);
        if (windowIdx - w > 2) this._callCounter.delete(k);
      }
    }
    return count <= maxCalls;
  }

  /**
   * 在「激活中」的 CLI 上执行一条指令（/cli 斜杠命令核心）。
   * v2：智能等待 + 执行历史 + 结构化返回 + 频率限制。
   */
  async executeOnActiveCli(userId, cmd, opts = {}) {
    const tailLines = Math.min(200, Math.max(1, opts.tailLines || 40));
    if (!userId) return { ok: false, error: 'session_cli 需要 userId。' };

    // 定位：优先共享 tab → 回退激活 tab
    const shared = this.getShared(userId);
    const active = shared && shared.tabId
      ? { tabId: shared.tabId, cliId: shared.cliId }
      : this.getActiveTab(userId);
    if (!active) {
      return { ok: false, error: '没有找到该用户的激活终端。可能原因：1) 终端未打开 2) 终端未输入过命令（未激活）3) userId 不匹配。请先在 Hesi 中打开终端并输入任意命令激活。不要 fallback 到 exec_terminal（那是 AI 的终端，不是用户的）。', noFallback: true };
    }
    const { tabId, cliId } = active;
    if (this.isNonLinear(cliId)) {
      return { ok: false, error: `检测到交互式程序「${cliId}」，请先退出（如 :q / q）再使用 /cli。不要 fallback 到 exec_terminal。`, noFallback: true };
    }
    if (!cmd || !cmd.trim()) return { ok: false, error: 'session_cli 需要 instruction（要执行的指令）。' };

    const wsManager = this._wsManager;
    if (!wsManager) return { ok: false, error: 'wsManager 不可用，无法写入终端。' };

    // 频率限制
    if (!this.checkRateLimit(userId)) {
      return { ok: false, error: '1 分钟内 CLI 操作已达 5 次上限。AI 应停止重试。', shouldStop: true };
    }
    if (this.isUserTyping(tabId)) {
      return { ok: false, error: '用户正在该终端输入，AI 暂缓写入。请稍候 1~2 秒再试。不要 fallback 到 exec_terminal。', noFallback: true };
    }
    if (!this.acquireWrite(tabId, 'ai', 10000)) {
      const owner = this.getWriteLockOwner(tabId);
      return { ok: false, error: `该终端写锁被「${owner || 'unknown'}」占用，请稍后再试。不要 fallback 到 exec_terminal。`, noFallback: true };
    }
    try {
      // 重复命令检测
      const dup = this.checkDuplicate(tabId, cmd);
      if (dup.isDuplicate) {
        return {
          ok: false,
          warning: 'duplicate_detected',
          error: `命令「${cmd}」在最近 60 秒内已执行过（${dup.lastExecution.at}前）。如需再次执行，请确认。`,
          recentExecutions: this.getRecentExecutions(tabId, 3),
        };
      }

      // 敏感命令二次确认
      if (this.isSensitiveCommand(cmd)) {
        const token = this.createConfirmToken(userId, cmd);
        return { ok: false, confirmRequired: true, confirmToken: token, command: cmd, cliId, tabId };
      }

      const before = _stripAnsi(wsManager.readTabOutput(tabId, tailLines) || '');
      const writeOk = wsManager.writeTab(tabId, cmd);
      if (!writeOk) {
        this.trackConsecutiveFails(tabId, false);
        return { ok: false, error: `写入终端失败（tabId=${tabId} 可能已退出）。不要 fallback 到 exec_terminal。`, noFallback: true };
      }

      // 智能等待
      const speed = _guessCmdSpeed(cmd);
      const waitOpts = _waitParamsForSpeed(speed);
      const after = await this.waitForOutput(wsManager, tabId, tailLines, waitOpts);

      // 记录执行
      this.recordExecution(tabId, cmd, after.slice(0, 200));

      // 构建结构化上下文
      const currentState = this._buildCurrentState(wsManager, tabId, tailLines);
      const recentHistory = this.getRecentExecutions(tabId, 5);
      const delta = _computeDelta(before, after, cmd);

      return {
        ok: true,
        tabId,
        cliId,
        executed: cmd,
        recentHistory,
        currentState,
        delta,
        beforeContext: before,
        afterContext: after,
      };
    } finally {
      this.releaseWrite(tabId);
    }
  }

  /**
   * 构建当前态快照。
   */
  _buildCurrentState(wsManager, tabId, tailLines) {
    const lastLines = _stripAnsi(wsManager.readTabOutput(tabId, Math.min(tailLines, 10)) || '');
    // 尝试获取 cwd（从 prompt 解析，如 "user@host:~/project$"）
    const cwd = _extractCwd(lastLines);
    return {
      cwd,
      lastLines: lastLines.split('\n').slice(-5).join('\n'),
      hasRunningProcess: false, // TODO: 探测前台进程（需 ws-handler 扩展）
    };
  }

  // ── 共享终端登记 ──
  invite(userId, tabId, cliId) {
    if (!userId || !tabId) return false;
    this._byUser.set(userId, { tabId, cliId, mode: 'readwrite', invitedAt: Date.now() });
    return true;
  }

  revoke(userId) { return this._byUser.delete(userId); }

  getShared(userId) { return this._byUser.get(userId) || null; }

  getAnyShared() {
    for (const [userId, e] of this._byUser) {
      return { userId, ...e };
    }
    return null;
  }

  listShared() {
    const out = [];
    for (const [userId, e] of this._byUser) out.push({ userId, ...e });
    return out;
  }

  isNonLinear(cliId) {
    if (!cliId) return false;
    const name = String(cliId).toLowerCase().split(/[\\/]/).pop();
    return NON_LINEAR_PROGS.has(name);
  }

  // ── 并发写锁 ──
  acquireWrite(tabId, owner = 'ai', ttlMs = 10000) {
    if (!tabId) return false;
    const existing = this._writeLock.get(tabId);
    if (existing && Date.now() < existing.since + (existing.ttlMs || 10000)) return false;
    if (existing && existing.timer) clearTimeout(existing.timer);
    const entry = { since: Date.now(), owner, ttlMs };
    entry.timer = setTimeout(() => this.releaseWrite(tabId), ttlMs);
    this._writeLock.set(tabId, entry);
    return true;
  }

  releaseWrite(tabId) {
    const e = this._writeLock.get(tabId);
    if (e && e.timer) clearTimeout(e.timer);
    this._writeLock.delete(tabId);
  }

  getWriteLockOwner(tabId) {
    const e = this._writeLock.get(tabId);
    if (!e) return null;
    if (Date.now() >= e.since + (e.ttlMs || 10000)) { this.releaseWrite(tabId); return null; }
    return e.owner;
  }

  // ── 敏感命令二次确认令牌 ──
  createConfirmToken(userId, command) {
    const token = makeConfirmToken();
    this._confirmTokens.set(token, { token, userId, command, createdAt: Date.now() });
    setTimeout(() => {
      const c = this._confirmTokens.get(token);
      if (c && Date.now() - c.createdAt > 5 * 60 * 1000) this._confirmTokens.delete(token);
    }, 5 * 60 * 1000);
    return token;
  }

  consumeConfirmToken(token, userId) {
    if (!token) return null;
    const c = this._confirmTokens.get(token);
    if (!c) return null;
    if (c.userId !== userId) return null;
    if (Date.now() - c.createdAt > 5 * 60 * 1000) { this._confirmTokens.delete(token); return null; }
    this._confirmTokens.delete(token);
    return c.command;
  }

  isSensitiveCommand(cmd) { return isSensitive(cmd); }
}

// ── 辅助函数 ──
function _stripAnsi(s) {
  if (typeof s !== 'string') return s;
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function _relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 5000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  return `${Math.floor(diff / 3600000)}小时前`;
}

function _computeDelta(before, after, cmd) {
  if (!before) return after || '';
  if (!after) return '';
  // 简单 delta：after 去掉 before 共有前缀
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  // 找第一个不同的行
  let startIdx = 0;
  while (startIdx < beforeLines.length && startIdx < afterLines.length) {
    if (beforeLines[startIdx] !== afterLines[startIdx]) break;
    startIdx++;
  }
  let delta = afterLines.slice(startIdx).join('\n');
  // 去掉 PTY 回显的命令行（终端会 echo 输入的命令）
  if (cmd && delta) {
    const cmdTrimmed = cmd.trim();
    const deltaLines = delta.split('\n');
    // 跳过与命令匹配的行（PTY 回显）
    let skip = 0;
    for (const line of deltaLines) {
      const l = line.trim();
      if (l === cmdTrimmed || l.endsWith(cmdTrimmed) || l.includes(cmdTrimmed)) {
        skip++;
      } else {
        break;
      }
    }
    if (skip > 0) delta = deltaLines.slice(skip).join('\n');
  }
  return delta;
}

function _extractCwd(text) {
  if (!text) return null;
  // 常见 prompt 格式：user@host:~/project$ 或 user@host:/path$
  const m = text.match(/:(~?\/[^\s$]*)\s*[#$>]/);
  return m ? m[1] : null;
}

const sharedCliBridge = new SharedCliBridge();

module.exports = { SharedCliBridge, sharedCliBridge, NON_LINEAR_PROGS, _stripAnsi };
