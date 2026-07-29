// @ts-check
// ============================================================
// 聊天安全熔断器（Circuit Breaker）—— 共享状态机
//
// stream-openai.js 与 stream-anthropic.js 此前各自复制了一份
// 「降级继续 + 重复/循环检测 + 轮次/时长/次数硬上限」逻辑（~730 行 ×2），
// 任何修一处必须 mirror 到另一处，是典型的未来 bug 温床。本模块把这套
// 状态机抽成单一可信实现，两个 stream 文件共用。
//
// 唯一刻意保留的差异：警告消息注入到 currentMessages 的 role。
//   - OpenAI 路径：'system'（系统消息合并后行为不变）
//   - Anthropic 路径：'user'（其 system 仅一条，警告走 user 更稳）
// 通过构造参数 warnRole 控制，其余逻辑逐字等价。
// ============================================================
'use strict';

/**
 * @param {object} [opts]
 * @param {'system'|'user'} [opts.warnRole] 警告消息 role（见文件头）
 * @param {number} [opts.maxTotalDurationMs] 单次请求工具链总超时（ms）
 * @param {number} [opts.maxTotalToolCalls] 单次请求累计工具执行硬上限
 */
class CircuitBreaker {
  constructor(opts = {}) {
    this.warnRole = opts.warnRole || 'system';
    this.maxTotalDurationMs = opts.maxTotalDurationMs || 900000; // 默认 15 分钟
    this.maxTotalToolCalls = opts.maxTotalToolCalls || (opts.relaxed ? 400 : 120);

    // 循环/重复检测阈值（env 可调控，优先于内置默认值）。
    // relaxed=true（本地 LLM）：阈值放大 3 倍，避免“第 2~3 次重复即硬停”把正常探索
    // 误判为死循环而掐断回复（用户反馈的“回复中断、原因不明”主因）。
    const _relax = (base) => (opts.relaxed ? base * 3 : base);
    this.toolLoopGuard = Math.max(1, Number(process.env.HESI_LLM_TOOL_LOOP_GUARD) || _relax(15));
    this.dupWindow = Math.max(4, Number(process.env.HESI_DUP_SIG_WINDOW) || _relax(16));
    this.dupThreshold = Math.max(2, Number(process.env.HESI_DUP_SIG_THRESHOLD) || _relax(4));
    // cycle（连续完全相同签名）容忍次数：strict=0（第 2 次即进入降级流程）/
    // relaxed=4（前 4 次重复忽略，第 5 次才警告）。靠 relaxed 或代码改，env 不设。
    this.cycleTolerance = opts.relaxed ? 4 : 0;
    this.cycleRepeats = 0;

    // ── 运行时状态（原分散在两 stream 文件的局部变量）──
    this.softStopWarned = false;   // 是否已发过降级警告
    this.softStopReason = '';      // 警告原因（用于提示消息）
    this.lastToolSignature = '';   // 上一轮完整工具签名（cycle 检测）
    this.lastToolNameSet = '';     // 上一轮工具名集合（consecutive 检测）
    this.consecutiveSameSet = 0;  // 同一工具名集合连续轮数
    this.recentSigs = [];          // 近期工具签名滑动窗口（近似重复检测）
    this.totalToolCalls = 0;       // 累计工具执行次数（含失败）
    this.toolChainStart = Date.now();
  }

  /**
   * 降级继续：首次触发熔断时注入警告并给 LLM 一次补救机会，返回 true；
   * 已警告过则返回 false（调用方应硬停）。
   * @param {import('http').ServerResponse} res
   * @param {Array<object>} currentMessages
   * @param {string} reason
   * @param {string} [detail]
   * @returns {boolean} true=已注入警告(继续) false=已警告过(硬停)
   */
  softStop(res, currentMessages, reason, detail) {
    if (this.softStopWarned) return false;
    this.softStopWarned = true;
    this.softStopReason = reason;
    currentMessages.push({
      role: this.warnRole,
      content: `⚠️ ${reason}。${detail || '请基于已有信息直接输出最终回答，不要再调用新工具。'}`,
    });
    res.write(`data: ${JSON.stringify({ type: 'status', message: `⚠️ ${reason}（降级继续，给模型最后一次机会输出答案）` })}\n\n`);
    return true;
  }

  /**
   * 通用「降级继续 / 硬停」守卫。
   * - 已警告过：写 forcedStatus + [DONE] + res.end，返回 'stop'（调用方应 return）。
   * - 否则：softStop 注入警告，返回 'continue'（调用方应 continue 重跑一轮）。
   * @returns {'stop'|'continue'}
   */
  guard(res, currentMessages, reason, detail, forcedStatus) {
    if (this.softStopWarned) {
      // 强制停止：在原因前加醒目前缀，确保前端状态栏清晰显示“为何中断”（根治“原因不明”）。
      const msg = forcedStatus && forcedStatus.startsWith('⚠️')
        ? forcedStatus
        : `⚠️ 回复已被安全熔断：${forcedStatus || reason}`;
      res.write(`data: ${JSON.stringify({ type: 'status', message: msg })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return 'stop';
    }
    this.softStop(res, currentMessages, reason, detail);
    return 'continue';
  }

  /**
   * 循环检测：与上一轮完全相同的工具调用。
   * @returns {'stop'|'continue'|'proceed'}
   *   - 'stop'    已硬停（res 已 end），调用方 return
   *   - 'continue' 已注入警告，调用方 continue 重跑一轮
   *   - 'proceed' 未触发，调用方继续落入 dup 检测
   */
  cycle(res, currentMessages, sig, toolCallCount) {
    if (sig === this.lastToolSignature && toolCallCount > 0) {
      this.cycleRepeats++;
      // relaxed 档容忍前 cycleTolerance 次重复（strict=0 → 立即进入降级流程）；
      // 超过后才触发降级继续/硬停，避免本地 LLM 正常重试被误杀。
      if (this.cycleRepeats <= this.cycleTolerance) {
        return 'proceed';
      }
      const r = this.guard(
        res, currentMessages,
        '检测到与上一轮完全相同的工具调用', '请改用不同策略或直接输出最终回答。',
        '工具调用陷入完全相同的循环，已强制停止'
      );
      if (r === 'stop') return 'stop';
      this.lastToolSignature = sig;
      this.cycleRepeats = 0; // 给一次补救机会
      return 'continue';
    }
    this.cycleRepeats = 0;
    this.lastToolSignature = sig;
    return 'proceed';
  }

  /**
   * 近期签名窗口：捕获「参数略有变化但调用模式重复」的循环。
   * @returns {'stop'|'continue'|'proceed'}
   */
  dup(res, currentMessages, sig) {
    const dupCount = this.recentSigs.filter((s) => s === sig).length;
    if (dupCount >= this.dupThreshold) {
      const r = this.guard(
        res, currentMessages,
        `工具调用模式疑似循环（${sig.slice(0, 60)}… 在 ${this.recentSigs.length} 轮内出现 ${dupCount + 1} 次）`,
        '请改用不同策略或直接输出最终回答。',
        `检测到重复工具调用模式（${sig.slice(0, 60)}…），已给过警告，强制停止`
      );
      if (r === 'stop') return 'stop';
      this._pushSig(sig);
      this.lastToolSignature = sig;
      return 'continue';
    }
    this._pushSig(sig);
    this.lastToolSignature = sig;
    return 'proceed';
  }

  /**
   * 工具循环失控防护：同一组工具名连续重复调用。
   * @returns {'stop'|'continue'|'proceed'}
   */
  consecutive(res, currentMessages, nameSet) {
    if (nameSet && nameSet === this.lastToolNameSet) {
      this.consecutiveSameSet++;
    } else {
      this.consecutiveSameSet = 0;
      this.lastToolNameSet = nameSet;
    }
    if (this.toolLoopGuard > 0 && this.consecutiveSameSet >= this.toolLoopGuard) {
      const r = this.guard(
        res, currentMessages,
        `同一组工具连续调用 ${this.consecutiveSameSet} 轮（疑似循环）`,
        '这可能是陷入了不必要的重复。请检查你的进展，改用不同方法或直接输出最终回答。',
        `同一工具连续调用 ${this.consecutiveSameSet} 轮，已给过警告，强制停止`
      );
      if (r === 'stop') return 'stop';
      this.consecutiveSameSet = 0; // 重置计数器，给一次补救机会
      return 'continue';
    }
    return 'proceed';
  }

  /** 累计一次工具执行（每轮内每个工具调用一次）。 */
  tickTotal() {
    this.totalToolCalls++;
  }

  /**
   * 轮次上限尾部处理。
   * @returns {'first'|'already'}
   *   - 'first'   首次触发（已注入警告），调用方应做「无工具最终回答」
   *   - 'already' 已警告过，调用方应硬停
   */
  degradeAtRoundLimit(res, currentMessages, reason, detail) {
    if (this.softStopWarned) return 'already';
    this.softStop(res, currentMessages, reason, detail);
    return 'first';
  }

  _pushSig(sig) {
    this.recentSigs.push(sig);
    if (this.recentSigs.length > this.dupWindow) this.recentSigs.shift();
  }
}

module.exports = { CircuitBreaker };
