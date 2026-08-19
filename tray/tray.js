/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';
// ============================================================
// Hesi 系统托盘启动器（轻量，复用 Hesi 自带便携 Node，无 Electron）
//
// 设计目标：让"下载/拷 U 盘"得到的 Hesi 像一个普通软件——
//   双击 tray.bat / tray.sh → 托盘出现图标 →
//   菜单「打开 Hesi」打开网页、「打开（CDP 模式）」用独立浏览器实例打开、
//   「停止服务」/「退出」一键关停。
//
// 后台用 QCLI_PORTABLE 指向的便携 Node 拉起 server.js；
// 托盘退出时确保把服务子进程一起杀掉，不留孤儿进程。
// 若托盘 UI 因环境无法启动（无图形界面等），服务仍正常后台运行。
// ============================================================
const { spawn, execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- SEA（Single Executable Application）感知 ----
// 打包为 tray.exe 后，__dirname 不再是脚本目录，需从 process.execPath 推导。
let sea = false;
try { sea = require('node:sea').isSea(); } catch (e) { sea = false; }
const EXE_DIR = path.dirname(process.execPath);
if (sea) {
  // 让 systray2 的 "./traybin"（相对 cwd）与 node_modules 解析都命中 exe 所在目录
  try { process.chdir(EXE_DIR); } catch (e) { /* ignore */ }
}
const ROOT = path.resolve(sea ? EXE_DIR : __dirname, '..');   // Hesi 根目录（tray 的上一级）

// ---- 调试日志：任何崩溃都先落盘，避免“一闪即逝”看不到原因 ----
// 普通 bat 启动（非 SEA）日志落在 tray/ 目录；SEA 则落在 exe 同目录。
const DEBUG_LOG = path.join(sea ? EXE_DIR : __dirname, 'tray_debug.log');
function dbg(...args) {
  try {
    const line = '[' + new Date().toISOString() + '] ' +
      args.map((x) => (x && x.stack) ? x.stack
        : (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
    fs.appendFileSync(DEBUG_LOG, line);
  } catch (e) { /* 日志失败不能影响主流程 */ }
}
// 全局兜底：未捕获异常/拒绝都落盘，绝不静默死亡
process.on('uncaughtException', (e) => {
  dbg('[FATAL uncaughtException]', e && (e.stack || e.message) || e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  dbg('[WARN unhandledRejection]', e && (e.stack || e.message) || e);
});
dbg('=== tray 启动 === execPath=', process.execPath, 'sea=', sea, 'platform=', os.platform(), 'cwd=', process.cwd(), 'ROOT=', ROOT);

function loadSysTray() {
  const candidates = [
    'systray2',                                         // 正常 node_modules 解析（dev / 磁盘 node_modules）
    path.join(EXE_DIR, 'node_modules', 'systray2'),     // SEA：tray.exe 旁带 node_modules/systray2
    path.join(__dirname, 'node_modules', 'systray2'),   // dev：__dirname = tray/
  ];
  let lastErr;
  for (const c of candidates) {
    try { return require(c).default; } catch (e) { lastErr = e; }
  }
  dbg('[FATAL] 未找到 systray2 依赖。请先在 tray/ 目录运行：npm install。最后错误:', lastErr && lastErr.message);
  throw lastErr || new Error('systray2 not found');
}
let SysTray;
try {
  SysTray = loadSysTray();
} catch (e) {
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 4264;
const IS_WIN = os.platform() === 'win32';
const ICON = IS_WIN
  ? path.join(sea ? EXE_DIR : __dirname, 'icon.ico')
  : path.join(sea ? EXE_DIR : __dirname, 'icon.png');

// 便携 Node 路径（按优先级查找，避免依赖系统 PATH 里的 node）
function portableNode() {
  const cands = [];
  if (process.env.QCLI_PORTABLE) {
    cands.push(IS_WIN
      ? path.join(process.env.QCLI_PORTABLE, 'node', 'node.exe')
      : path.join(process.env.QCLI_PORTABLE, 'node', 'bin', 'node'));
  }
  // Hesi 自带便携 Node（与 tray/ 同级的 ../node/node.exe）
  cands.push(IS_WIN
    ? path.join(ROOT, 'node', 'node.exe')
    : path.join(ROOT, 'node', 'bin', 'node'));
  for (const p of cands) {
    if (fs.existsSync(p)) { dbg('[node] 命中便携 Node:', p); return p; }
  }
  dbg('[warn] 未找到 Hesi 自带 node，回退系统 PATH 的 node（若 PATH 无 node 将启动失败）');
  return 'node';
}

let serverProc = null;
const PID_FILE = path.join(ROOT, 'data', 'hesi-server.pid');

function writeServerPid(pid) {
  try {
    fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid));
  } catch (e) { /* ignore */ }
}
function clearServerPid() {
  try { fs.unlinkSync(PID_FILE); } catch (e) { /* ignore */ }
}
// 同步杀进程（跨平台）：Windows 用 taskkill /T 杀整棵树，非 Windows 用进程组 SIGKILL
function killPidSync(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) execSync('taskkill /F /T /PID ' + pid, { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch (e) { /* 进程已不存在则忽略 */ }
}
// 端口级兜底：无论 server 是子进程还是孤儿，退出时确保 4264 端口被释放
function killPortSync() {
  try {
    if (IS_WIN) {
      const out = execSync('netstat -ano | findstr :' + PORT, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const portRe = new RegExp(':' + PORT + '\\b');
      const pids = new Set();
      out.split(/\r?\n/).forEach((line) => {
        if (!portRe.test(line)) return;
        // 仅处理“监听”状态：对端为 0.0.0.0:0 / [::]:0，或状态含 LISTENING/侦听
        if (!/(0\.0\.0\.0:0|\[::\]:0)/.test(line) && !/LISTENING|侦听/i.test(line)) return;
        const cols = line.trim().split(/\s+/);
        const pid = cols[cols.length - 1];
        if (/^\d+$/.test(pid)) pids.add(pid);
      });
      pids.forEach((pid) => { try { execSync('taskkill /F /PID ' + pid, { stdio: 'ignore' }); } catch (e) {} });
    } else {
      const out = execSync('lsof -ti tcp:' + PORT + ' 2>/dev/null || true', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      out.split(/\s+/).forEach((pid) => {
        if (/^\d+$/.test(pid)) { try { process.kill(Number(pid), 'SIGKILL'); } catch (e) {} }
      });
    }
  } catch (e) { /* ignore */ }
}

function startServer() {
  if (serverProc) return;
  const node = portableNode();
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    QCLI_PORTABLE: process.env.QCLI_PORTABLE || ROOT,
    // 默认启用 MCP 子进程，使终端里的 opencode/Claude/Codex 等 agent 能连上 Hesi 的 MCP 服务器。
    // server.js 仅在 --with-mcp 或 QCLI_WITH_MCP=1 时 spawn mcp-server.js 子进程。
    QCLI_WITH_MCP: '1',
  });
  // 等价 tray.bat 的 PATH 注入，使 server.js 拉起的 agent 也能找到便携 node（SEA 与普通 node 模式都注入）
  const NODE_BIN_DIR = IS_WIN ? path.join(ROOT, 'node') : path.join(ROOT, 'node', 'bin');
  env.PATH = NODE_BIN_DIR + path.delimiter + (process.env.PATH || '');
  const logPath = path.join(ROOT, 'server.log');
  let out;
  try { out = fs.openSync(logPath, 'a'); }
  catch (e) { dbg('[warn] 无法打开 server.log:', e && e.message); out = 'ignore'; }
  try {
    serverProc = spawn(node, ['server.js'], {
      cwd: ROOT,
      env,
      detached: !IS_WIN,
      stdio: ['ignore', out, out],
    });
  } catch (e) {
    dbg('[FATAL] 启动 server 子进程失败（node=', node, '）:', e && e.message);
    serverProc = null;
    return; // 不退出：托盘仍可用，便于排查
  }
  serverProc.on('error', (e) => {
    dbg('[error] server 子进程异常（node=', node, '）:', e && e.message);
    serverProc = null;
  });
  serverProc.on('exit', (code, sig) => {
    if (serverProc) {
      dbg('[warn] server 子进程退出 code=', code, 'signal=', sig);
      serverProc = null;
    }
  });
  dbg('[tray] server started (pid ' + serverProc.pid + ') on port ' + PORT + ' node=' + node);
  if (serverProc.pid) writeServerPid(serverProc.pid);
}

function stopServer() {
  // 1) 按已知子进程 pid 同步杀
  const pid = serverProc ? serverProc.pid : null;
  if (pid) killPidSync(pid);
  // 2) PID 文件兜底（serverProc 已被置空但进程仍在的情况）
  let fpid = null;
  try { fpid = parseInt(fs.readFileSync(PID_FILE, 'utf8').toString().trim(), 10); } catch (e) { /* ignore */ }
  if (fpid && fpid !== pid) killPidSync(fpid);
  // 3) 端口级兜底：无论进程是否孤儿，确保服务端口被释放
  killPortSync();
  serverProc = null;
  clearServerPid();
}

function openBrowser() {
  const url = 'http://127.0.0.1:' + PORT;
  try {
    execSync(
      IS_WIN ? 'start "" "' + url + '"'
        : os.platform() === 'darwin' ? 'open "' + url + '"'
          : 'xdg-open "' + url + '"',
      { stdio: 'ignore', shell: true }
    );
  } catch (e) { /* 无图形界面/命令缺失时静默失败 */ }
}

// ---- CDP 模式：启动一个独立的 Chrome/Edge 实例（便于管理 + 可调试）----
// 用独立 user-data-dir，避免干扰接收方自己的浏览器配置；托盘退出时一并关掉。
function findBrowser() {
  if (IS_WIN) {
    const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter(Boolean);
    const cands = bases.flatMap((base) => [
      path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
    for (const c of cands) if (fs.existsSync(c)) return c;
    for (const cmd of ['chrome', 'msedge']) {
      try {
        const p = execSync('where ' + cmd, { stdio: 'pipe' }).toString().split(/\r?\n/)[0];
        if (p) return p.trim();
      } catch (e) { /* not on PATH */ }
    }
    return null;
  }
  if (os.platform() === 'darwin') {
    const cands = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    for (const c of cands) if (fs.existsSync(c)) return c;
  }
  // Linux / 其它：在 PATH 中查找
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable', 'microsoft-edge']) {
    try {
      const p = execSync('command -v ' + cmd, { stdio: 'pipe' }).toString().trim();
      if (p) return p;
    } catch (e) { /* not found */ }
  }
  return null;
}

let cdpProc = null;
function launchBrowserCDP() {
  const url = 'http://127.0.0.1:' + PORT;
  const browser = findBrowser();
  if (!browser) {
    console.warn('[tray] 未找到 Chrome/Edge，改用语默认浏览器打开');
    dbg('[tray] 未找到 Chrome/Edge，回退默认浏览器');
    return openBrowser();
  }
  // 已在运行时不再重复拉起（避免多点触发产生多个实例）
  if (cdpProc) {
    dbg('[tray] CDP 浏览器已在运行，忽略重复请求');
    return;
  }
  const profileDir = path.join(ROOT, 'data', 'cdp-profile');
  // 清掉上次的会话恢复状态：持久化 profile 被强制关闭后，Chrome 下次启动会
  // 自动恢复上一页，再叠加启动 url 就会出现“两个页面”。每次全新空白 profile 只开单页。
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* 占用中则忽略，下次重试 */ }
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    '--remote-debugging-port=9222',
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows',
    '--new-window',
    url,
  ];
  try {
    cdpProc = spawn(browser, args, { detached: !IS_WIN, stdio: 'ignore' });
    cdpProc.on('exit', () => { cdpProc = null; });
    cdpProc.on('error', (e) => {
      dbg('[warn] CDP 浏览器启动失败，回退默认浏览器:', e && e.message);
      cdpProc = null;
      openBrowser();
    });
    dbg('[tray] CDP 浏览器已启动: ' + browser);
  } catch (e) {
    dbg('[warn] CDP 启动异常，回退默认浏览器:', e && e.message);
    openBrowser();
  }
}

function stopBrowser() {
  const pid = cdpProc ? cdpProc.pid : null;
  cdpProc = null;
  if (!pid) return;
  try {
    if (IS_WIN) execSync('taskkill /F /T /PID ' + pid, { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch (e) { /* ignore */ }
}

let tray = null;
try {
  tray = new SysTray({
    copyDir: false,
    menu: {
      title: 'Hesi',
      tooltip: 'Hesi Hub · 端口 ' + PORT,
      icon: fs.existsSync(ICON) ? ICON : '',
      items: [
        { title: '打开 Hesi', tooltip: '用默认浏览器打开' },
        { title: '打开（CDP 模式）', tooltip: '用独立 Chrome/Edge 实例打开（便于管理/可调试）' },
        { title: '停止服务', tooltip: '停止后台服务' },
        { title: '退出', tooltip: '停止服务并退出托盘' },
      ],
    },
  });
  // 以下调用在缺少图形界面/原生托盘二进制时会抛错，统一交由 catch 兜底（服务仍运行）
  // 关键：systray2 的 onError/onExit 会【同步】访问初始化后才创建的 _process，
  // 若在构造后立刻调用会抛 “Cannot read properties of null (reading 'on')” 把整个托盘拖崩。
  // 因此菜单/错误监听必须等 ready() 之后再注册；初始化失败统一由 ready().catch 兜底（服务仍运行）。
  tray.ready().then(() => {
    dbg('[tray] 托盘已就绪');
    tray.onClick((action) => {
      const t = action.item && action.item.title;
      if (t === '打开 Hesi') openBrowser();
      else if (t === '打开（CDP 模式）') launchBrowserCDP();
      else if (t === '停止服务') stopServer();
      else if (t === '退出') shutdown();
    });
    tray.onError((err) => { console.warn('[tray] tray UI error:', err && err.message); dbg('[tray] tray UI error:', err && err.message); });
  }).catch((e) => {
    console.warn('[tray] 托盘初始化失败（原生托盘二进制可能未启动，服务仍后台运行）:', e && e.message);
    dbg('[tray] 托盘初始化失败:', e && e.message);
    tray = null;
  });
} catch (e) {
  console.warn('[tray] 无法启动托盘 UI（服务仍后台运行）:', e && e.message);
  dbg('[tray] 无法启动托盘 UI（服务仍后台运行）:', e && e.message);
  tray = null;
}

// 若端口已被占用（服务已在运行），则不重复拉起，直接打开浏览器
function portInUse() {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(1000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(PORT, '127.0.0.1');
  });
}

portInUse().then((used) => {
  if (used) {
    dbg('[tray] 端口 ' + PORT + ' 已被占用，服务应已在运行');
    console.log('[tray] 端口 ' + PORT + ' 已被占用，服务应已在运行');
  } else {
    startServer();
  }
  setTimeout(openBrowser, 1500);
}).catch((e) => {
  dbg('[warn] portInUse 检查异常:', e && e.message);
  startServer();
  setTimeout(openBrowser, 1500);
});

function shutdown() {
  dbg('[tray] 退出');
  stopServer();
  stopBrowser();
  if (tray) { try { tray.kill(false); } catch (e) {} }
  process.exit(0);
}
process.on('exit', () => { stopServer(); stopBrowser(); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
