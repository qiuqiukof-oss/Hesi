/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// onboarding-state.js — 新手引导「已看状态」纯逻辑（可单测，无 DOM 依赖）
// 由 onboarding.js 调用；状态存于 localStorage[ONBOARDING_KEY]。
// ============================================================

export const ONBOARDING_KEY = 'hesi_onboarding_v2';

/**
 * 安全获取存储对象（隐私模式 / SSR 下可能抛错或无 localStorage）
 * @returns {Storage|null}
 */
function safeStorage() {
  try {
    return (typeof globalThis !== 'undefined' && globalThis.localStorage) ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 是否已看过引导
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function getSeen(storage = safeStorage()) {
  try {
    return !!storage && storage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 标记已看 / 未看
 * @param {boolean} [val]
 * @param {Storage} [storage]
 * @returns {boolean} 是否写入成功（隐私模式下可能失败，但不崩）
 */
export function setSeen(val = true, storage = safeStorage()) {
  try {
    if (!storage) return false;
    if (val) storage.setItem(ONBOARDING_KEY, '1');
    else storage.removeItem(ONBOARDING_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 重置为未看
 * @param {Storage} [storage]
 */
export function resetSeen(storage = safeStorage()) {
  try { storage && storage.removeItem(ONBOARDING_KEY); } catch { /* ignore */ }
}

/**
 * 步骤解析：给步骤数组补 index / isFirst / isLast，供引导 UI 判定进度。
 * 纯函数，便于单测。
 * @param {Array<object>} steps
 * @returns {Array<object>}
 */
export function resolveSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s, i) => ({
    ...s,
    index: i,
    isFirst: i === 0,
    isLast: i === steps.length - 1,
  }));
}
