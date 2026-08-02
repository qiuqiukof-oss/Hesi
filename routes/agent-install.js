/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Agent Install API — 一键安装 AI 智能体 / CLI 工具
//
// U盘智能体愿景：插上即用、离线优先（规避墙）、新手/开发者开箱即用。
//
// 端点：
//   GET  /api/agents/install/registry        — 可一键安装的智能体清单（含离线缓存可用性）
//   GET  /api/agents/install/status          — 当前安装任务状态
//   POST /api/agents/install/:agentId        — 触发安装（异步，进度经 WebSocket 推送）
//   POST /api/agents/install/:agentId/cancel — 取消进行中的安装
//
// 安装方式（按优先级自动选择）：
//   1. 离线缓存：若 ./offline-cache/<id>/ 存在 → 直接复制到 ./agents/<id>（U 盘预装，零网络）
//   2. 便携 Node：若 ./node/npm.* 存在 → 用便携 npm 安装（离线环境仍可工作）
//   3. 系统 npm：否则用 PATH 中的 npm 安装
//   4. 模拟：QCLI_INSTALL_DRYRUN=1 或 spec.simulate → 仅演示进度管线（无需网络）
//
// 安全：agentId 必须经过 INSTALL_REGISTRY 白名单校验，杜绝任意命令执行。
// ============================================================
const { Router } = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isNativeFile, writeAgentLauncher } = require('../lib/agent-launcher');

const ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

/**
 * @typedef {Object} InstallSpec
 * @property {string}  displayName
 * @property {string}  icon
 * @property {string}  category
 * @property {string}  desc
 * @property {'npm-global'|'npm-local'|'copy'|'command'} method
 * @property {string}  [npmPackage]
 * @property {string}  [command]
 * @property {string[]} [args]
 * @property {string}  binName
 * @property {string}  targetDir     — 相对 ROOT 的本地安装目录（如 agents/opencode）
 * @property {string}  offlineCache  — 相对 ROOT 的离线缓存目录
 * @property {boolean} [simulate]
 * @property {string}  [pinnedVersion]
 * @property {boolean} [featured]    — 在欢迎页 U 盘区优先展示
 */

/**
 * 可安装的智能体白名单。只有此处列出的 id 才能被安装。
 * 包名已与实际发行对齐：opencode -> npm:opencode-ai；codex -> npm:@openai/codex。
 * ohmyopenagent 为你的自有框架，从本地源码 agents-src/ohmyopenagent 安装（非 npm registry）。
 * @type {Record<string, InstallSpec>}
 */
const INSTALL_REGISTRY = {
  opencode: {
    displayName: 'OpenCode',
    icon: '⚡',
    category: 'agent',
    desc: '终端原生 AI 编码智能体（U 盘预装，插上即用）',
    method: 'npm-global',
    npmPackage: 'opencode-ai',
    binName: 'opencode',
    targetDir: 'agents/opencode',
    offlineCache: 'offline-cache/opencode',
    pinnedVersion: '1.18.3',
    featured: true,
  },
  ohmyopenagent: {
    displayName: 'OhMyOpenAgent',
    icon: '🤖',
    category: 'agent',
    desc: '多 Agent 编排平台（U 盘预装，开箱即可编排）',
    method: 'copy',
    npmPackage: null,
    sourceDir: 'agents-src/ohmyopenagent',
    binName: 'oma',
    targetDir: 'agents/ohmyopenagent',
    offlineCache: 'offline-cache/ohmyopenagent',
    pinnedVersion: '0.1.0',
    featured: true,
  },
  codex: {
    displayName: 'Codex',
    icon: '🔮',
    category: 'agent',
    desc: 'OpenAI Codex CLI（支持离线缓存安装）',
    method: 'npm-global',
    npmPackage: '@openai/codex',
    binName: 'codex',
    targetDir: 'agents/codex',
    offlineCache: 'offline-cache/codex',
    pinnedVersion: '0.144.6',
    // 不再在欢迎页「AI 智能体（一键安装）」展示；改为与 Claude Code 等一致的手动安装卡片。
    featured: false,
  },
};

/** 解析本地已安装的智能体可执行文件路径（供 routes/agents.js 复用检测）。 */
function findLocalAgentBin(agentId) {
  const spec = INSTALL_REGISTRY[agentId];
  if (!spec) return null;
  const base = path.join(ROOT, spec.targetDir, 'bin');
  const names = isWin
    ? [`${spec.binName  }.cmd`, `${spec.binName  }.bat`, `${spec.binName  }.exe`, spec.binName]
    : [spec.binName];
  for (const n of names) {
    const p = path.join(base, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 读取本地安装目录中的版本记录（version.txt 或 package.json）。 */
function readLocalVersion(agentId) {
  const spec = INSTALL_REGISTRY[agentId];
  if (!spec) return null;
  const dir = path.join(ROOT, spec.targetDir);
  try {
    const vt = path.join(dir, 'version.txt');
    if (fs.existsSync(vt)) return fs.readFileSync(vt, 'utf8').trim();
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      if (j.version) return j.version;
    }
  } catch { /* ignore */ }
  return null;
}

/** 选择 npm 可执行文件：优先便携 Node 自带 npm（离线优先），否则系统 npm。 */
function resolveNpmCmd() {
  const portable = path.join(ROOT, 'node', isWin ? 'npm.cmd' : 'npm');
  if (fs.existsSync(portable)) return { cmd: portable, portable: true };
  return { cmd: 'npm', portable: false };
}

/** 简易递归复制（用于离线缓存 → 本地目录）。statSync 会跟随 junction/symlink，避免把软链当文件复制。 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s); // 跟随符号链接 / Windows junction
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 写出本地安装标记（启动器 + version.txt），让检测与版本读取生效。 */
function writeLocalMarker(spec, version) {
  const dir = path.join(ROOT, spec.targetDir);
  ensureDir(path.join(dir, 'bin'));
  const oc = path.join(ROOT, spec.offlineCache);

  // 解析包名（copy 类智能体从本地源码取 name）。
  let pkgName = spec.npmPackage;
  if (!pkgName && spec.sourceDir) {
    const sp = path.join(ROOT, spec.sourceDir, 'package.json');
    if (fs.existsSync(sp)) pkgName = JSON.parse(fs.readFileSync(sp, 'utf8')).name;
  }

  // 从离线缓存的 package.json 解析真实 bin 入口，并判断原生与否。
  let binRel = `bin/${spec.binName}`;
  let isNative = false;
  if (pkgName && fs.existsSync(oc)) {
    const pj = path.join(oc, 'node_modules', pkgName, 'package.json');
    if (fs.existsSync(pj)) {
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
      const b = j.bin;
      if (b) {
        binRel = typeof b === 'string' ? b : (b[spec.binName] || Object.values(b)[0]);
        binRel = binRel.replace(/^\.\//, '');
        isNative = isNativeFile(path.join(oc, 'node_modules', pkgName, binRel));
      }
    }
  }

  writeAgentLauncher({ binDir: path.join(dir, 'bin'), binName: spec.binName, pkgName, binRel, isNative });
  fs.writeFileSync(path.join(dir, 'version.txt'), version, 'utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 安装任务表：jobId -> { agentId, pid, status, log[], startedAt } */
const jobs = new Map();
/** agentId -> jobId（用于取消与防并发）。 */
const activeByAgent = new Map();
let jobSeq = 0;

/**
 * 执行安装（异步）。进度通过 broadcast() 推送到所有 WebSocket 客户端。
 * @param {string} agentId
 * @param {InstallSpec} spec
 * @param {string} jobId
 * @param {(data:object)=>void} broadcast
 */
async function runInstall(agentId, spec, jobId, broadcast) {
  const progress = (stage, message) => {
    const line = `[${stage}] ${message}`;
    const job = jobs.get(jobId);
    if (job) job.log.push(line);
    broadcast({ type: 'agent:install:progress', agentId, jobId, stage, message, ts: Date.now() });
  };
  const complete = (success, version, error) => {
    const job = jobs.get(jobId);
    if (job) { job.status = success ? 'done' : 'failed'; job.finishedAt = Date.now(); }
    activeByAgent.delete(agentId);
    broadcast({ type: 'agent:install:complete', agentId, jobId, success, version: version || null, error: error || null, ts: Date.now() });
  };

  try {
    const dryRun = process.env.QCLI_INSTALL_DRYRUN === '1' || spec.simulate === true;
    const offlineCacheDir = path.join(ROOT, spec.offlineCache);
    const hasOffline = fs.existsSync(offlineCacheDir);

    if (dryRun) {
      // 仅演示完整进度管线，不触发任何网络/子进程。
      const stages = [
        '准备安装环境',
        '解析依赖（离线缓存 / npm registry）',
        hasOffline ? '从离线缓存复制文件' : '下载并安装文件',
        '生成包装脚本',
        '校验安装',
      ];
      for (const s of stages) {
        await sleep(320);
        progress(s, '…');
      }
      const version = spec.pinnedVersion || '1.0.0';
      writeLocalMarker(spec, version);
      progress('完成', `已就绪（${version}）`);
      await sleep(150);
      complete(true, version, null);
      return;
    }

    if (hasOffline) {
      // 离线优先：直接复制预置缓存，规避墙。
      progress('离线缓存', `发现离线包：${spec.offlineCache}`);
      const targetDir = path.join(ROOT, spec.targetDir);
      ensureDir(targetDir);
      copyDir(offlineCacheDir, targetDir);
      const version = readLocalVersion(agentId) || spec.pinnedVersion || 'bundled';
      progress('完成', `已从离线缓存安装（${version}）`);
      complete(true, version, null);
      return;
    }

    // 本地源码复制（ohmyopenagent 等自有框架：从 agents-src 安装，无需 registry / 网络）。
    if (spec.method === 'copy' && spec.sourceDir) {
      const srcDir = path.join(ROOT, spec.sourceDir);
      if (fs.existsSync(srcDir)) {
        progress('本地源码', `从 ${spec.sourceDir} 复制（离线，免 npm registry）`);
        const targetDir = path.join(ROOT, spec.targetDir);
        ensureDir(targetDir);
        copyDir(srcDir, targetDir);
        const version = readLocalVersion(agentId) || spec.pinnedVersion || 'local';
        progress('完成', `已从本地源码安装（${version}）`);
        complete(true, version, null);
        return;
      }
      // 既有离线缓存也无本地源码：无法离线安装，除非在线安装可用。
    }

    // 在线安装：npm install（便携优先，否则系统 npm）。
    if (spec.method === 'copy') {
      // copy 类智能体（如自有框架）只能离线安装：既无离线缓存也无本地源码则无法继续。
      complete(false, null, '该智能体仅支持离线安装（需要离线缓存包或本地源码 agents-src），当前环境均不存在。');
      return;
    }
    const { cmd, portable } = resolveNpmCmd();
    const targetDir = path.join(ROOT, spec.targetDir);
    ensureDir(targetDir);

    let args;
    if (spec.method === 'npm-local') {
      args = ['install', spec.npmPackage, '--prefix', targetDir, '--no-audit', '--no-fund'];
    } else {
      // npm-global：便携 npm 会装到自身 prefix；系统 npm 走全局。
      args = ['install', '-g', spec.npmPackage, '--no-audit', '--no-fund'];
    }

    progress('安装', `执行：${portable ? '便携' : '系统'} npm ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd: targetDir,
      env: { ...process.env, npm_config_yes: 'true' },
      windowsHide: true,
    });
    const job = jobs.get(jobId);
    if (job) job.pid = child.pid;

    let stdout = '';
    const onData = (chunk) => {
      const text = chunk.toString();
      stdout += text;
      // 按行推送，避免刷屏；保留最后若干行用于日志。
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const l of lines.slice(-3)) progress('install', l.slice(0, 200));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      if (code === 0) {
        // 尝试读取真实版本
        let version = spec.pinnedVersion || 'installed';
        const lsArgs = spec.method === 'npm-local'
          ? ['ls', spec.npmPackage, '--prefix', targetDir, '--json']
          : ['ls', '-g', spec.npmPackage, '--json'];
        // 异步探测版本（不再阻塞事件循环）；失败则用占位版本
        execFile(cmd, lsArgs, { encoding: 'utf8' }, (err, out) => {
          if (!err) {
            try {
              const j = JSON.parse(out);
              const dep = j.dependencies && j.dependencies[spec.npmPackage];
              if (dep && dep.version) version = dep.version;
            } catch { /* 版本探测失败则用占位 */ }
          }
          progress('完成', `安装成功（${version}）`);
          complete(true, version, null);
        });
      } else {
        complete(false, null, `安装进程退出码 ${code}`);
      }
    });
    child.on('error', (err) => {
      complete(false, null, `启动安装失败：${err.message}（请确认 ${portable ? '便携' : '系统'} npm 可用）`);
    });
  } catch (err) {
    complete(false, null, err.message || String(err));
  }
}

/**
 * Create the agent-install router.
 * @param {{ broadcastFn?: (data:object)=>void }} [opts]
 * @returns {import('express').Router}
 */
function createRouter({ broadcastFn } = {}) {
  const router = Router();
  const broadcast = (data) => { try { broadcastFn && broadcastFn(data); } catch { /* ignore */ } };

  // GET /api/agents/install/registry — 可安装清单
  router.get('/agents/install/registry', (req, res) => {
    const list = Object.entries(INSTALL_REGISTRY).map(([id, s]) => ({
      id,
      displayName: s.displayName,
      icon: s.icon,
      category: s.category,
      desc: s.desc,
      featured: !!s.featured,
      offlineAvailable: fs.existsSync(path.join(ROOT, s.offlineCache)),
    }));
    res.json({ agents: list });
  });

  // GET /api/agents/install/status — 当前任务
  router.get('/agents/install/status', (req, res) => {
    const summary = [];
    for (const [jobId, j] of jobs) {
      summary.push({
        jobId,
        agentId: j.agentId,
        status: j.status,
        pid: j.pid || null,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt || null,
        logTail: j.log.slice(-10),
      });
    }
    res.json({ jobs: summary });
  });

  // POST /api/agents/install/:agentId — 触发安装
  router.post('/agents/install/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const spec = INSTALL_REGISTRY[agentId];
    if (!spec) return res.status(404).json({ error: `Unknown agent: ${agentId}` });

    const existing = activeByAgent.get(agentId);
    if (existing && jobs.get(existing) && ['running', 'starting'].includes(jobs.get(existing).status)) {
      return res.status(409).json({ error: '安装已在进行中', jobId: existing });
    }

    const jobId = `job-${  ++jobSeq  }-${  Date.now().toString(36)}`;
    jobs.set(jobId, { agentId, pid: null, status: 'running', log: [], startedAt: Date.now(), finishedAt: null });
    activeByAgent.set(agentId, jobId);

    // 异步执行，立即返回 jobId。
    runInstall(agentId, spec, jobId, broadcast).catch((err) => {
      const job = jobs.get(jobId);
      if (job) { job.status = 'failed'; job.finishedAt = Date.now(); }
      activeByAgent.delete(agentId);
      broadcast({ type: 'agent:install:complete', agentId, jobId, success: false, version: null, error: err.message || String(err), ts: Date.now() });
    });

    res.json({ ok: true, jobId, agentId });
  });

  // POST /api/agents/install/:agentId/cancel — 取消
  router.post('/agents/install/:agentId/cancel', (req, res) => {
    const { agentId } = req.params;
    const jobId = activeByAgent.get(agentId);
    const job = jobId && jobs.get(jobId);
    if (!job || !['running', 'starting'].includes(job.status)) {
      return res.status(404).json({ error: '没有进行中的安装任务' });
    }
    // 通过 pid 终止子进程（npm 会级联终止其 spawn 的 install 进程）。
    // taskkill 改为异步 execFile，避免同步调用冻结事件循环（best-effort，忽略结果）。
    if (job.pid) {
      try {
        if (isWin) execFile('taskkill', ['/PID', String(job.pid), '/T', '/F'], () => {});
        else process.kill(-job.pid, 'SIGTERM');
      } catch { /* best-effort */ }
    }
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    activeByAgent.delete(agentId);
    broadcast({ type: 'agent:install:complete', agentId, jobId, success: false, version: null, error: '已取消', ts: Date.now() });
    res.json({ ok: true, jobId, agentId, cancelled: true });
  });

  return router;
}

module.exports = {
  createRouter,
  INSTALL_REGISTRY,
  findLocalAgentBin,
  readLocalVersion,
};
