/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Phase 1 S1 — 共享黑板（Shared Blackboard）
//
// 多 Agent 协作的结构化状态中心：子 Agent / workflow 步骤读写同一
// 状态对象，替代"靠聊天记录传关键信息"，消除状态漂移。
//
// 设计约束（防膨胀）：
//   - 零新依赖；存储用 data/blackboard/<id>.json（data/ 已在 .gitignore）
//   - 并发安全复用 lib/memory/storage.js 的 withLock + 原子写
//   - Git 仅作可选快照底层：env HESI_BLACKBOARD_GIT=1 且 git 可用才提交，
//     默认关、体积增量 0；任何失败静默降级（不阻断主流程）
//   - 只存"接口契约"（文件状态/任务状态/角色），不存实现细节
// ============================================================
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const storage = require('./memory/storage');

/** 抛出的冲突错误类型（乐观锁失败）。 */
class BlackboardConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlackboardConflictError';
    this.code = 'BLACKBOARD_CONFLICT';
  }
}

/** 目录动态读取：每次调用读 env，便于测试隔离（require 后再改 env 也生效）。 */
function dataDir() {
  return process.env.HESI_BLACKBOARD_DIR
    ? path.resolve(process.env.HESI_BLACKBOARD_DIR)
    : path.join(__dirname, '..', 'data', 'blackboard');
}

function filePathFor(projectId) {
  const safe = String(projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dataDir(), `${safe}.json`);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 空板默认结构（仅"接口契约"）。 */
function defaultBoard(projectId) {
  return {
    projectId: projectId || 'default',
    version: 0,
    status: 'pending',
    files: {},
    tasks: [],
    roles: {},
    logs: [],
  };
}

/** 递归字段级合并：对象合并到叶子，不整体替换子对象（保留未传的子键）。 */
function deepFieldMerge(target, src) {
  const out = Object.assign({}, target);
  for (const k of Object.keys(src)) {
    const sv = src[k];
    if (isPlainObject(sv) && isPlainObject(out[k])) out[k] = deepFieldMerge(out[k], sv);
    else out[k] = sv;
  }
  return out;
}

/**
 * 把 partial 合并进 current（字段级、不覆盖未传键）：
 *   - logs：追加（concat）
 *   - tasks：按 id 合并（存在则覆盖该 task，不存在则 push）
 *   - 其他对象字段：字段级合并（files / roles / 自定义）
 *   - 标量字段：直接覆盖
 */
function mergeInto(current, partial) {
  for (const key of Object.keys(partial)) {
    const pv = partial[key];
    if (pv === undefined) continue;
    if (key === 'logs') {
      const add = Array.isArray(pv) ? pv : [pv];
      current.logs = (Array.isArray(current.logs) ? current.logs : []).concat(add);
    } else if (key === 'tasks') {
      const arr = Array.isArray(pv) ? pv : [pv];
      if (!Array.isArray(current.tasks)) current.tasks = [];
      for (const t of arr) {
        const i = current.tasks.findIndex((x) => x && x.id === t.id);
        if (i >= 0) current.tasks[i] = Object.assign({}, current.tasks[i], t);
        else current.tasks.push(t);
      }
    } else if (isPlainObject(pv) && isPlainObject(current[key])) {
      current[key] = deepFieldMerge(current[key], pv);
    } else {
      current[key] = pv;
    }
  }
}

/** 从 partial 推导 git commit 摘要。 */
function deriveSummary(partial) {
  const keys = Object.keys(partial || {}).filter((k) => k !== 'logs');
  if (keys.length === 0) return 'update';
  return `patch ${keys.join(',')}`;
}

/** 可选 Git 快照：失败静默降级（不阻断主流程）。
 *  改为异步 execFile（fire-and-forget），避免同步 git 提交冻结事件循环、
 *  导致并发 SSE 心跳暂停。返回 void，调用方不依赖其结果。 */
function maybeGitSnapshot(file, partial, projectId) {
  if (process.env.HESI_BLACKBOARD_GIT !== '1') return;
  const root = path.join(__dirname, '..');
  execFile('git', ['-C', root, 'add', file], { stdio: 'ignore' }, (err) => {
    if (err) return; // git 不可用 / 文件被 ignore / 无变更：静默降级
    const summary = deriveSummary(partial);
    execFile('git', ['-C', root, 'commit', '-m', `blackboard(${projectId}): ${summary}`], { stdio: 'ignore' }, () => {});
  });
}

/** 读取当前状态；文件不存在返回 null。 */
function read(projectId) {
  const file = filePathFor(projectId);
  return storage.readJSON(file);
}

/**
 * 字段级合并 + 乐观锁。
 *
 * **注意：本函数是异步的**（底层 storage.withLock 是 in-process Promise 链互斥），
 * 返回 Promise<object>；冲突时不同步 throw，而是**拒绝（reject）该 Promise**。
 * 调用方必须 `await` 或在 `.catch` 中处理，否则冲突会被静默吞掉、且拿到的
 * 是 Promise 而非状态对象（误当对象访问 `.files` 会 undefined）。
 * @param {string} projectId
 * @param {object} partial 要合并的字段
 * @param {{ expectedVersion?: number, expectedChecksums?: Record<string,string> }} [opts]
 *   - expectedVersion：若提供且 ≠ 当前 version → reject BlackboardConflictError
 *   - expectedChecksums：{ path: hash }，若任一 path 当前 hash 不符 → reject BlackboardConflictError
 * @returns {Promise<object>} 更新后的完整状态
 * @throws {BlackboardConflictError} 乐观锁/checksum 冲突（以 Promise rejection 形式，绝不静默覆盖）
 */
function patch(projectId, partial, opts) {
  const file = filePathFor(projectId);
  return storage.withLock(projectId, () => {
    const current = storage.readJSON(file) || defaultBoard(projectId);

    if (opts && opts.expectedVersion !== undefined && opts.expectedVersion !== current.version) {
      throw new BlackboardConflictError(
        `version conflict: expected ${opts.expectedVersion}, current ${current.version}`
      );
    }
    if (opts && opts.expectedChecksums) {
      const files = current.files || {};
      for (const [p, hash] of Object.entries(opts.expectedChecksums)) {
        const cur = files[p] ? files[p].hash : undefined;
        if (cur !== hash) {
          throw new BlackboardConflictError(
            `file checksum conflict for ${p}: expected ${hash}, current ${cur}`
          );
        }
      }
    }

    mergeInto(current, partial);
    current.version = (current.version || 0) + 1;
    current.projectId = projectId || 'default';
    storage.writeJSON(file, current);
    maybeGitSnapshot(file, partial, projectId);
    return current;
  });
}

/** 全量覆写（初始化/重置用）。经 withLock 保证同文件并发安全；异步，返回 Promise<object>。 */
function write(projectId, full) {
  if (!isPlainObject(full)) throw new BlackboardConflictError('write requires a plain object state');
  const file = filePathFor(projectId);
  return storage.withLock(projectId, () => {
    const state = Object.assign(defaultBoard(projectId), full);
    if (typeof state.version !== 'number') state.version = 0;
    storage.writeJSON(file, state);
    return state;
  });
}

/** 删除黑板文件（重置）。 */
function reset(projectId) {
  storage.removeFile(filePathFor(projectId));
}

module.exports = {
  BlackboardConflictError,
  read,
  patch,
  write,
  reset,
  defaultBoard,
};
