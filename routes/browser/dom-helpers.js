/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// DOM diff helpers (used by /browser/dom-snapshot and /browser/dom-diff).
// Extracted verbatim from the original routes/browser.js.
// ============================================================

/**
 * 计算简单哈希用于 DOM 快照比较
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * 递归比较两个 DOM 节点树
 */
function compareNodes(a, b, path, diffs) {
  if (a === b) return;

  // 检查节点是否存在
  if (!a && b) {
    diffs.push({ path, type: 'added', details: `新增节点: <${b.tag}>` });
    return;
  }
  if (a && !b) {
    diffs.push({ path, type: 'removed', details: `移除节点: <${a.tag}>` });
    return;
  }

  // 比较标签
  if (a.tag !== b.tag) {
    diffs.push({ path, type: 'modified', details: `标签变更: <${a.tag}> → <${b.tag}>` });
    return; // 标签不同则子树也不同
  }

  // 比较文本
  if (a.text !== b.text) {
    diffs.push({ path, type: 'modified', details: `文本变更: "${(a.text || '').slice(0, 50)}" → "${(b.text || '').slice(0, 50)}"` });
  }

  // 比较 class
  const aClasses = (a.classes || []).sort().join(' ');
  const bClasses = (b.classes || []).sort().join(' ');
  if (aClasses !== bClasses) {
    diffs.push({ path, type: 'modified', details: `class 变更: "${aClasses}" → "${bClasses}"` });
  }

  // 比较 id
  if (a.id !== b.id) {
    diffs.push({ path, type: 'modified', details: `id 变更: "${a.id || ''}" → "${b.id || ''}"` });
  }

  // 比较子节点数量
  if ((a.children || []).length !== (b.children || []).length) {
    diffs.push({ path, type: 'modified', details: `子节点数: ${(a.children || []).length} → ${(b.children || []).length}` });
  }

  // 递归比较子节点
  const maxLen = Math.max((a.children || []).length, (b.children || []).length);
  for (let i = 0; i < maxLen; i++) {
    const childPath = `${path} > ${b.tag}[${i}]`;
    compareNodes(
      (a.children || [])[i],
      (b.children || [])[i],
      childPath,
      diffs
    );
  }
}

/**
 * 统计 DOM 快照中的节点数
 */
function countNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

module.exports = { simpleHash, compareNodes, countNodes };
