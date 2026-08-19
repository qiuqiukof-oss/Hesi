/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Error Classifier — 结构化错误分类
//
// 将 fetch/fs 等原始错误转换为结构化类型，让 AI 能做更
// 好的决策（如 403 跳过、DNS 失败提示检查网络）。
// ============================================================

/**
 * 将错误分类为结构化格式。
 * @param {Error|object} err
 * @returns {{ type: string, message: string, original?: string }}
 */
function classifyError(err) {
  const msg = (err?.message || String(err || 'Unknown error')).toLowerCase();

  if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') {
    return { type: 'NETWORK_ERROR', message: 'DNS 解析失败，请检查网络连接和域名是否正确' };
  }
  if (err?.code === 'ECONNREFUSED') {
    return { type: 'NETWORK_ERROR', message: '连接被拒绝，目标服务器未运行或端口错误' };
  }
  if (err?.code === 'ECONNRESET') {
    return { type: 'NETWORK_ERROR', message: '连接被重置，可能是防火墙或代理中断' };
  }
  if (err?.code === 'ENETUNREACH') {
    return { type: 'NETWORK_ERROR', message: '网络不可达，请检查网络连接' };
  }
  if (err?.code === 'ETIMEDOUT' || /timeout|abort/i.test(msg)) {
    return { type: 'TIMEOUT', message: '请求超时（15s 无响应）' };
  }

  const status = err?.response?.status || err?.status;
  if (status === 403 || msg.includes('403')) {
    return { type: 'FORBIDDEN', message: '目标屏蔽了自动化访问（HTTP 403）' };
  }
  if (status === 404 || msg.includes('404')) {
    return { type: 'NOT_FOUND', message: '页面不存在（HTTP 404）' };
  }
  if (status === 429 || msg.includes('429') || msg.includes('rate limit')) {
    return { type: 'RATE_LIMITED', message: '请求频率过高，请稍后再试' };
  }
  if (status === 502 || msg.includes('502')) {
    return { type: 'SERVER_ERROR', message: '目标服务器错误（HTTP 502）' };
  }
  if (status >= 500) {
    return { type: 'SERVER_ERROR', message: `目标服务器返回 ${status}` };
  }

  return { type: 'UNKNOWN', message: err?.message || String(err) };
}

module.exports = { classifyError };
