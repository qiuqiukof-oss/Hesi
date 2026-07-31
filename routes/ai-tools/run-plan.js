/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 执行器（Phase 0 — 全自动闭环的"手脚"）
//
// 把通过 gate 的 plan 真正跑起来：
//   1. gatePlan 闸门（决策①）                 —— 不可机器验证即拒收
//   2. openPlanBranch 开 auto-<id> 分支         —— 爆震半径容器
//   3. 逐步：
//        a. budget.tickRound()                 —— 经济/轮数预算
//        b. checkInterception()                —— #34 scope/forbidden 真实前置拦截
//        c. snapshotStep() 步前快照            —— 失败可 rollback 到上锚点
//        d. checkpoint 步 → resolveCheckpoint  —— 决策② 圆桌推导验收（roundtableFn 注入）
//        e. workflowManager 单步执行 + 轮询     —— 复用现有 DAG 引擎
//        f. 失败 → rollbackTo(本步快照)         —— 仅撤销本步改动
//   4. 闭环结束 closeBranch（保留 auto 分支供审计）
//   5. runAcceptance() 跑验收命令              —— 机器可验证闭环
//   6. reflectPlan() → done/partial/diverged   —— #36 反思残差
//
// 解耦：roundtableFn 由调用方注入（路由层用 discuss.runRoundtable 包装），
//       便于单测 mock，避免本文件硬依赖 discuss.js。
// ============================================================

const { execFileSync } = require('child_process');
const { gatePlan, resolveCheckpoint } = require('./plan-contract');
const { planToWorkflowTasks, inScope, isForbidden } = require('./plan-to-workflow');
const { PlanBudget } = require('../../lib/plan-budget');
const { openPlanBranch, snapshotStep, rollbackTo, closeBranch, isRepo } = require('../../lib/plan-git');
const { revisePlan: defaultRevisePlan } = require('./plan-from-nl');
// ── 复用 AI 助手已调好的 LLM 工具环（不重新实现）──
// nonStreamingChat = QCLI_TOOLS + executeToolCall + 3min 熔断 + pruneToolContext
// （与 /api/chat/tools、MCP ai_chat 同一套，踩坑调试好的核心）。
// 注意：chat 模块体量大（memory / context-window / tools / discuss 等），故延迟
// require，仅在 AI 助手步骤真正执行时才加载，避免拖慢 plan 模块加载与测试。

// Plan 步骤执行时使用的工具子集：剔除 agent_* 委派类工具，避免 LLM 在步骤内
// 递归把任务委派回外部 CLI agent（正是全自动 Phase 1 要绕开的路径）；其余本地
// 动作/文件/终端工具全保留 → 100% 复用 AI 助手管线。
const AGENT_DELEGATE_TOOLS = new Set([
  'agent_delegate', 'agent_start', 'agent_poll', 'agent_send', 'agent_cancel', 'agent_list', 'agent_callbacks',
]);
let _planStepToolsCache = null;
function planStepTools() {
  if (!_planStepToolsCache) {
    const { QCLI_TOOLS } = require('../chat/tools');
    _planStepToolsCache = QCLI_TOOLS.filter((t) => !AGENT_DELEGATE_TOOLS.has(t && t.function && t.function.name));
  }
  return _planStepToolsCache;
}

// Plan 步骤的 AI 助手系统提示：把自然语言步骤变成「用工具完成」的 agent 任务。
const PLAN_STEP_SYSTEM_PROMPT = `你正在执行一个自动化计划（Plan）中的某一个步骤。你拥有与「AI 助手」完全相同的工具能力（执行终端命令、读写文件、搜索代码等）。
要求：
1. 聚焦完成「步骤目标」，不要做与目标无关的事。
2. 优先用工具（exec_terminal / write_file / read_file 等）真实完成工作，而不是只描述方案。
3. 严格遵守给定的 scope_paths（仅可在白名单路径内操作）与 forbidden（禁止执行的命令/模式）；越界或命中黑名单会导致步骤失败。
4. 完成后，用简体中文一句话说明你做了什么、结果如何。不要输出多余的前言或总结。`;

// ── 工具 ──

/** 从圆桌 summary 文本里抽取 {kind,command,expect} JSON（容错：宽松匹配首个 JSON 块） */
function parseVerifyFromSummary(text) {
  if (!text) return null;
  const s = String(text);
  // 先尝试整段 JSON
  try {
    const o = JSON.parse(s.trim());
    if (o && o.kind) return normalizeVerify(o);
  } catch { /* not a bare JSON */ }
  // 再尝试抠出 ```json ... ``` 或 { ... }
  const m = s.match(/\{[\s\S]*?"kind"[\s\S]*?\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (o && o.kind) return normalizeVerify(o);
    } catch { /* ignore */ }
  }
  return null;
}

function normalizeVerify(o) {
  return {
    kind: String(o.kind),
    command: typeof o.command === 'string' ? o.command : '',
    expect: typeof o.expect === 'string' ? o.expect : '',
  };
}

/** 抽出文本里疑似文件路径的 token（含 '/'，用于 scope 校验）；排除 shell 重定向、相对路径与 HTTP URL 路径 */
function _pathTokens(text) {
  if (!text) return [];
  const tokens = String(text).split(/[\s"'`|;]+/);
  const REDIR_RE = /^(?:[0-9&]?>+|<?&|>\||<)$/;
  // 合并型重定向：N>/path、>>/path、>/path 等（split 未在 > 处切开）
  const COMBINED_REDIR = new RegExp('^[0-9&]?>+[\\/]|^>>?[\\/]|^<[\\/]');
  // HTTP URL 路由前缀：/api/*、/static/*、/v1/*、/ws/* 等是 Web 端点路径，不是文件系统路径
  const WEB_ROUTE_RE = /^\/(api|static|assets|public|ws|socket\.io|v\d+|health|status|metrics|ready|live|js|css|img|fonts|media|_next|_nuxt|graphql|rest|rpc|admin|dashboard|auth|login|logout|register|signup|user|users|settings|config|version|docs|help|faq|search|upload|download|export|import|webhook|callback|oauth|token|pay|payment|order|cart|checkout|notification|mail|log|logs|debug|test|tests|dev|staging|prod)(\/|$)/i;
  const result = [];
  let prevWasRedir = false;
  for (const t of tokens) {
    if (!t) { prevWasRedir = false; continue; }
    // 跳过重定向操作符本身
    if (REDIR_RE.test(t)) { prevWasRedir = true; continue; }
    // 跳过合并型重定向（2>/dev/null, >/tmp/out 等）
    if (COMBINED_REDIR.test(t)) { prevWasRedir = false; continue; }
    // 跳过重定向目标文件
    if (prevWasRedir) { prevWasRedir = false; continue; }
    prevWasRedir = false;
    if (!t.includes('/')) continue;
    // 排除纯符号 token（/> </ /* */ // 等 JSX/注释语法，不可能是路径）
    if (!/[A-Za-z0-9]/.test(t)) continue;
    // 排除 HTML/JSX/XML 标签片段（/<div, /<span, /<p 等——来自 echo 写入模板的命令）
    if (/^<\/?[a-zA-Z][\w.-]*>?$/.test(t)) continue;
    // 排除完整 URL（http(s)、ws(s) 等 → 非 filesystem path）
    if (/^(?:https?|wss?):\/\//i.test(t)) continue;
    // 排除 HTTP URL 路由路径（/api/registers、/static/bundle.js 等 → 非 filesystem path）
    if (WEB_ROUTE_RE.test(t)) continue;
    // 排除相对路径 — 天然在 cwd 内，不存在越界风险
    // ./ ../ 开头 → 显式相对
    if (/^\.\.[\\/]/.test(t) || /^\.[\\/]/.test(t)) continue;
    // 裸路径（无前导 /、无 Windows 盘符）→ 项目相对路径（如 src/components/Gallery）
    if (!/^[\\/]/.test(t) && !/^[A-Za-z]:[\\/]/.test(t)) continue;
    // 排除 /dev/null 等系统设备
    if (/^\/dev\/(null|stdout|stderr)$/.test(t)) continue;
    result.push(t);
  }
  return result;
}

/**
 * #34 真实前置拦截：scope_paths / forbidden。
 * 返回 reason（被拦）或 null（放行）。
 * @param {object} plan
 * @param {object} step 含 action / verify
 * @param {string} [cwd] 工作目录（用于解析项目相对路径）
 */
function checkInterception(plan, step, cwd) {
  const candidate = [step.action, step.verify && step.verify.command]
    .filter(Boolean)
    .join(' ');
  if (isForbidden(plan, candidate)) {
    return { reason: `命中 forbidden 黑名单: ${candidate.slice(0, 100)}` };
  }
  const scopes = Array.isArray(plan.scope_paths) ? plan.scope_paths : [];
  if (scopes.length) {
    const baseDir = cwd || process.cwd();
    for (const tok of _pathTokens(candidate)) {
      // 将「裸斜杠开头的项目相对路径」解析为基于 cwd 的绝对路径
      // 例如 /utils/registry-safe → {cwd}/utils/registry-safe
      // （LLM 常用 Unix 风格写项目内路径，但 _pathTokens 会把它当绝对路径提取）
      const resolved = resolveProjectRelativePath(tok, baseDir);
      if (!inScope(plan, resolved)) {
        return { reason: `路径越界（不在 scope_paths 内）: ${tok}` };
      }
    }
  }
  return null;
}

/**
 * 解析可能的项目相对路径。
 * 若 tok 以 / 开头但无盘符、且不像系统根目录（/dev/, /proc/ 等），
 * 则视为「项目根相对路径」，去掉前导 / 后 join(cwd)。
 * 否则原样返回。
 *
 * @param {string} tok _pathTokens 提取的路径 token
 * @param {string} baseDir 基准目录（通常是 git 仓库根或 cwd）
 * @returns {string} 解析后的路径
 */
function resolveProjectRelativePath(tok, baseDir) {
  const path = require('path');
  // 仅处理：以 / 或 \ 开头（Unix 风格绝对路径写法）+ 无 Windows 盘符 + 不像 Unix 系统目录
  const startsWithSlash = tok.startsWith('/') || tok.startsWith('\\');
  const noDriveLetter = !/^[A-Za-z]:[\\/]/.test(tok);
  // 常见 Unix 系统根目录前缀（这些不是项目相对路径，不应重写）
  const SYSTEM_ROOTS = /^(\/|\\)(dev|proc|sys|tmp|var|etc|opt|srv|root|run|mnt|usr|sbin|bin|lib|home)(\/|\\|$)/i;
  const notSystemDir = !SYSTEM_ROOTS.test(tok);
  if (startsWithSlash && noDriveLetter && notSystemDir) {
    const stripped = tok.replace(/^[\\/]+/, ''); // 去掉前导 / 或 \
    if (stripped) {
      const joined = path.join(baseDir, stripped);
      // 统一为正斜杠：inScope 用 s+'/' 做前缀匹配，Windows path.join 产生反斜杠会导致匹配失败
      const normalized = joined.replace(/\\/g, '/');
      console.log(`[resolveProjectPath] ${tok} → ${normalized}（项目相对路径解析）`);
      return normalized;
    }
  }
  return tok;
}

/**
 * P2.6 审批闸：判断某步是否需要人工审批。
 * @param {object} plan
 * @param {object} step
 * @returns {boolean}
 */
function stepRequiresApproval(plan, step) {
  if (step && step.requireApproval === true) return true;
  if (plan && plan.approvalPolicy === 'all') return true;
  return false;
}

// ── 单步工作流执行 + 轮询 ──

const POLL_MS = 1000;
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 解析当前平台可用的 POSIX 兼容 shell（bash/sh）。
 * Windows 下按优先级探测：
 *   1. PATH 中查找（where/which）
 *   2. 常见安装路径直接探测（Git for Windows / MSYS2 / WSL / Cygwin / PortableGit）
 *   3. 运行时验证（spawn --version）
 *   4. 最终降级 cmd.exe（会自动重写 heredoc 等不兼容语法）
 *
 * @returns {{ shell: string, foundVia?: string }}
 */
function resolveShell() {
  if (process.platform !== 'win32') return { shell: '/bin/sh', foundVia: 'posix-default' };

  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const existsSync = fs.existsSync;

  // ── 候选路径：全部由环境变量动态构造，绝不写死盘符/安装目录 ──
  // 注意：WSL bash（System32\bash.exe）是 Windows「应用执行别名」，不是真正的 .exe 文件。
  // Node.js 直接 spawn 它会 ENOENT，必须通过 cmd.exe 中转。因此放在最后。
  const env = process.env;
  const REAL_BASH_PATHS = [
    // Git for Windows — 用环境变量动态定位（ProgramFiles/ProgramFiles(x86)/LOCALAPPDATA）
    path.join(env.ProgramFiles || '', 'Git', 'bin', 'bash.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'bash.exe'),
    path.join(env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    // WorkBuddy 内嵌 PortableGit（路径相对 USERPROFILE，跨机器一致，非用户环境特定）
    path.join(env.USERPROFILE || '', '.workbuddy', 'vendor', 'PortableGit', 'usr', 'bin', 'bash.exe'),
    path.join(env.USERPROFILE || '', '.workbuddy', 'vendor', 'PortableGit', 'bin', 'bash.exe'),
    // Scoop（默认在 USERPROFILE/scoop，也支持 SCOOP 环境变量覆盖）
    path.join(env.SCOOP || env.USERPROFILE || '', 'scoop', 'shims', 'bash.exe'),
    // MSYS2 / Cygwin — 可选环境变量（用户自行设置，避免写死 C:\\msys64 等）
    path.join(env.MSYS2_ROOT || '', 'usr', 'bin', 'bash.exe'),
    path.join(env.CYGWIN_ROOT || '', 'bin', 'bash.exe'),
  ].filter(Boolean);

  // WSL bash 放在最后（仅当没有真实 bash 可用时才考虑）
  const WSL_BASH_PATH = path.join(
    env.SystemRoot || env.WINDIR || 'C:\\Windows', 'System32', 'bash.exe'
  );

  // 去重
  const uniquePaths = [...new Set(REAL_BASH_PATHS)];

  /** 尝试运行一个 shell 验证其可用性（包括直接 spawn 能力） */
  function tryShell(shellCmd) {
    try {
      // 1. 基本验证：能执行命令（通过 cmd.exe 中转也行）
      execSync(`${shellCmd} --version`, { encoding: 'utf8', timeout: 5000, stdio: 'ignore' });
      // 2. 直接 spawn 验证：Node.js 必须能直接 spawn 该路径（排除 WSL 等别名）
      if (shellCmd.includes('/') || shellCmd.includes('\\')) {
        // 绝对路径 → 检查是否为真实文件且可直接 spawn
        const fs2 = require('fs');
        if (!fs2.existsSync(shellCmd)) return false;
        try {
          const { execSync: es } = require('child_process');
          // 用数组形式测试直接 spawn（不经过 cmd.exe）
          es(shellCmd, ['--version'], { encoding: 'utf8', timeout: 3000, stdio: 'ignore' });
        } catch {
          console.log(`[resolveShell] ${shellCmd} --version 通过中转但直接 spawn 失败（可能是 WSL 别名），跳过`);
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 用 where 查找（纯动态，依赖用户 PATH），自动跳过 WSL bash（非真实 .exe） */
  function findInPath(name) {
    try {
      const out = execSync(`where ${name}`, { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
      const candidates = out.trim().split(/\r?\n/);
      // 过滤掉 WSL bash（应用执行别名，Node.js 无法直接 spawn）
      const real = candidates.filter((c) => !isWslBashPath(c));
      return real[0] || null; // 返回第一个非 WSL 匹配
    } catch {
      return null;
    }
  }

  // 策略 1：PATH 中找 bash → sh（最优先，完全动态）
  for (const name of ['bash', 'sh']) {
    const found = findInPath(name);
    if (found && existsSync(found)) {
      if (tryShell(found)) {
        console.log(`[resolveShell] 找到 ${name}: ${found} (via PATH)`);
        return { shell: found, foundVia: 'PATH' };
      }
    }
  }

  // 策略 2：从环境变量动态构造的候选路径逐个探测（无写死盘符，仅真实 bash）
  for (const p of uniquePaths) {
    if (existsSync(p)) {
      if (tryShell(p)) {
        console.log(`[resolveShell] 找到 bash: ${p} (env-derived path)`);
        return { shell: p, foundVia: 'env-path', isWsl: false };
      }
    }
  }

  // 策略 3：纯命令名再试一次（可能 PATH 在不同上下文有差异）
  for (const name of ['bash', 'sh']) {
    if (tryShell(name)) {
      // 验证找到的是否为 WSL bash（通过 where 查看实际路径）
      const where = findInPath(name);
      if (where && isWslBashPath(where)) {
        console.log(`[resolveShell] ${name} 解析为 WSL bash (${where})，标记为 WSL`);
        return { shell: name, foundVia: 'bare-name-wsl', isWsl: true };
      }
      console.log(`[resolveShell] 找到 ${name}: via bare name fallback`);
      return { shell: name, foundVia: 'bare-name', isWsl: false };
    }
  }

  // 策略 4：WSL bash 兜底（仅当没有真实 bash 可用时）
  // WSL bash 是「应用执行别名」，不是真正的 .exe，Node.js 直接 spawn 会 ENOENT
  // 必须通过 cmd.exe 中转执行
  if (existsSync(WSL_BASH_PATH)) {
    console.log(`[resolveShell] 仅找到 WSL bash: ${WSL_BASH_PATH}（将通过 cmd.exe 中转）`);
    return { shell: WSL_BASH_PATH, foundVia: 'wsl-fallback', isWsl: true };
  }

  console.warn('[resolveShell] 未找到 bash/sh，将使用 cmd.exe（heredoc 等语法将被自动重写）');
  return { shell: 'cmd.exe', foundVia: 'cmd-fallback', isWsl: false };
}

/**
 * 检测给定路径是否为 WSL bash（应用执行别名，非真实 .exe）。
 * WSL bash 不能被 Node.js 直接 spawn（ENOENT），必须通过 cmd.exe 中转。
 *
 * @param {string} shellPath
 * @returns {boolean}
 */
function isWslBashPath(shellPath) {
  const normalized = shellPath.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/system32/') && (normalized.includes('bash.exe') || normalized.endsWith('/bash'));
}

/**
 * 检测 shell 是否为 WSL bash（C:\Windows\System32\bash.exe），
 * 若是，将 Windows 路径转换为 /mnt/c/... 格式供 WSL 使用。
 *
 * @param {string} shellPath resolveShell 返回的 shell 路径
 * @param {string} winPath 需要转换的 Windows 风格路径
 * @returns {string} 转换后的路径（非 WSL bash 原样返回）
 */
function maybeConvertToWslPath(shellPath, winPath) {
  // WSL bash 特征：安装在 System32 目录下（Git Bash 在 ProgramFiles/AppData 等）
  const normalizedShell = shellPath.replace(/\\/g, '/').toLowerCase();
  if (normalizedShell.includes('/system32/') && normalizedShell.includes('bash')) {
    // C:\Users\xxx → /mnt/c/Users/xxx
    // D:\Projects\xxx → /mnt/d/Projects/xxx
    let wsl = winPath.replace(/\\/g, '/');
    const driveMatch = wsl.match(/^([a-z]):\//i);
    if (driveMatch) {
      wsl = `/mnt/${driveMatch[1].toLowerCase()}/${wsl.slice(driveMatch[0].length)}`;
      console.log(`[WSL Path] ${winPath} → ${wsl}`);
      return wsl;
    }
  }
  return winPath;
}

/**
 * 检测命令是否包含 cmd.exe 不支持的 POSIX 语法（heredoc、$(( )) 等）。
 * 若检测到且当前 shell 为 cmd.exe，返回重写后的命令；否则原样返回。
 *
 * @param {string} command 原始命令
 * @param {string} shell 当前使用的 shell
 * @returns {string} 可能被重写的命令
 */
function rewriteForWindows(command, shell) {
  if (shell !== 'cmd.exe') return command;
  // heredoc 检测: cat << 'EOF' 或 cat << EOF 或 cat >file << 'DELIM'
  const HEREDOC_RE = /<<-?\s*['"]?(\w+)['"]?/;
  if (!HEREDOC_RE.test(command)) return command;

  // 简单重写策略：用 PowerShell 替代执行（PowerShell 支持 heredoc 语法 @"..."@）
  // 或者更安全地：提示用户此命令需要 bash
  console.warn('[rewriteForWindows] 命令包含 heredoc 语法，但仅有 cmd.exe 可用，尝试通过 PowerShell 执行');
  return `powershell -NoProfile -Command "${command.replace(/"/g, '\\"')}"`;
}

/**
 * 直执模式：对「命令型」步骤（action 是可执行 shell 命令）绕过 agentPool，
 * 直接用 child_process.execSync 执行，避免无 Agent 时整步 FAILED。
 *
 * 判定标准复用 isPossibleCommand()（已知命令名 / 含 shell 元字符）。
 * 通过 resolveShell() 自动选择最佳 shell（Windows 下优先 bash）。
 *
 * 多行命令（含裸换行但非 heredoc）会自动写入临时脚本执行，避免换行被当命令分隔符。
 *
 * @param {object} step  plan.steps[i]（含 action）
 * @param {string} [cwd] 工作目录
 * @returns {{ status: string, output: string }}
 */
function execStepDirectly(step, cwd) {
  const action = String(step.action || '').trim();
  if (!action) return { status: 'error', output: '步骤 action 为空' };
  // 占位符步骤 → 返回 error（LLM 未能生成有效内容，不应静默通过）
  if (step.type === 'skip' || step._isPlaceholder) {
    console.log('[execStepDirectly] 占位符步骤（LLM 输出为空）:', (step.goal || '').slice(0, 60));
    return {
      status: 'error',
      output: `⚠️ LLM 未能为此步骤生成可执行内容（goal/action 均为占位符「${step.goal || '?'}」）。` +
        `这通常意味着模型输出不稳定或 API 配置有误。请检查模型设置后重试，或尝试切换更强大的模型。`,
    };
  }
  try {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { shell, isWsl } = resolveShell();
    const effectiveCwd = cwd || process.cwd();

    // ── 构建执行选项（含 WSL 路径转换）──
    const baseOpts = {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: STEP_TIMEOUT_MS,
    };
    let execOpts = { ...baseOpts, cwd: effectiveCwd };

    // PATH 丰富：确保 shell 自身的 bin 目录在 PATH 中
    // （服务进程的 PATH 可能缺少 PortableGit/Git 的 /usr/bin 等目录，
    //  导致 mkdir/cp/mv 等 coreutils 命令找不到 → exit code 127）
    if (shell !== 'cmd.exe' && (shell.includes('/') || shell.includes('\\'))) {
      const enrichedEnv = { ...process.env };
      const shellDir = path.dirname(shell);           // e.g., .../usr/bin
      const shellParent = path.dirname(shellDir);       // e.g., .../usr
      const shellRoot = path.dirname(shellParent);      // e.g., .../PortableGit

      // 收集 shell 相关的 bin 目录（按优先级排序）
      const extraPaths = [shellDir]; // shell 所在目录

      // 常见布局：Git/PortableGit 有 mingw64/bin（含 coreutils）
      const candidates = [
        path.join(shellRoot, 'mingw64', 'bin'),
        path.join(shellRoot, 'mingw32', 'bin'),
        path.join(shellRoot, 'bin'),
      ];
      for (const c of candidates) {
        if (!extraPaths.includes(c) && fs.existsSync(c)) {
          extraPaths.push(c);
        }
      }

      // 去重后 prepend 到 PATH
      const currentPath = enrichedEnv.PATH || '';
      const existing = new Set(currentPath.split(';').map((p) => p.toLowerCase().replace(/\\/g, '/')));
      const toAdd = extraPaths.filter((p) => !existing.has(p.toLowerCase().replace(/\\/g, '/')));
      if (toAdd.length > 0) {
        enrichedEnv.PATH = toAdd.join(';') + ';' + currentPath;
        execOpts.env = enrichedEnv;
        console.log('[execStepDirectly] PATH 已丰富 (+', toAdd.length, '个目录):', toAdd.join(', '));
      }
    }

    if (isWsl) {
      const wslCwd = maybeConvertToWslPath(shell, effectiveCwd);
      if (wslCwd !== effectiveCwd) {
        execOpts.cwd = wslCwd;
        console.log('[execStepDirectly] WSL cwd 转换:', effectiveCwd, '��', wslCwd);
      }
    }
    // 诊断日志：输出实际执行的命令、shell 和工作目录（排查 LLM 生成命令问题）
      const heredocMatch = action.match(/<<-?\s*['"]?(\w+)['"]?/);
      console.log('[execStepDirectly]', JSON.stringify({
        shell,
        isWsl,
        cwd: effectiveCwd,
        actionPreview: action.slice(0, 200),
        actionLength: action.length,
        hasNewline: action.includes('\n'),
        hasHeredoc: !!heredocMatch,
        heredocDelim: heredocMatch ? heredocMatch[1] : null,
        isMultiline: action.includes('\n'),
        execViaTempScript: action.includes('\n'),
      }));

    // ── 多行命令检测与处理 ──
    // heredoc（<< EOF）、裸换行、以及其他无法通过单行 execSync -c 传递的命令，
    // 统一写入临时脚本文件后执行，保留完整 shell 语义。
    //
    // 为什么 heredoc 也走临时脚本？
    //   execSync(command, { shell }) 内部等价于 spawn(shell, ['-c', command])，
    //   即把整个命令塞进一行 -c 参数。heredoc 的多行体（含 import/export 等代码）
    //   在 -c 引号嵌套下必然断裂（无论 bash/cmd 均如此）。
    //   因此只要命令含 \n，一律写临时脚本——这是唯一可靠的多行传递方式。
    const isMultiline = action.includes('\n');
    let tmpFile = null;
    let out;

    // ── heredoc 文件写入：直接用 Node.js fs API 写入（绕过 cat 依赖）──
    // LLM 生成的 `cat > file << 'EOF' ... EOF` 模式在最小化 Git 环境中
    // 可能因缺 coreutils（cat/mkdir）而 exit code 127。
    // 检测到此模式时，直接用 fs.writeFileSync 写文件，零外部命令依赖。
    //
    // 匹配: cat > path/to/file << 'DELIM'\ncontent\nDELIM     （标准多行格式）
    //       cat > "path/to/file" << "DELIM"contentDELIM        （LLM 单行输出格式，无换行）
    // LLM（尤其是 flash 模型）经常将 heredoc 内容紧贴在分隔符后，不换行
    const heredocWriteMatch = action.match(
      /^cat\s+>\s*['"]?([^'"\s]+)['"]?\s*<<\s*['"]?(\w+)['"]?\s*([\s\S]*?)\s*\2\s*$/
    );
    if (heredocWriteMatch) {
      const heredocTarget = heredocWriteMatch[1].trim();
      const heredocContent = heredocWriteMatch[3];
      // 跳过 /dev/null 等特殊路径
      if (heredocTarget && !heredocTarget.startsWith('/dev/') && heredocTarget !== 'NUL') {
        const targetFullPath = path.resolve(effectiveCwd, heredocTarget);
        const targetDir = path.dirname(targetFullPath);
        console.log('[execStepDirectly] heredoc 文件写入（Node.js 原生）:', heredocTarget);
        try {
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(targetFullPath, heredocContent, 'utf8');
          const size = Buffer.byteLength(heredocContent, 'utf8');
          console.log('[execStepDirectly] 文件写入成功:', heredocTarget, `(${size} bytes)`);
          return { status: 'done', output: `已写入 ${heredocTarget}（${size} bytes）` };
        } catch (writeErr) {
          console.warn('[execStepDirectly] Node.js 文件写入失败，回退到 shell 执行:', writeErr.message);
          // 不 return，继续走下面的 shell 执行路径作为兜底
        }
      }
    }

    // ── 文件写入预检：自动创建目标文件的父目录 ──
    // LLM 生成的 plan 经常遗漏「写文件前先 mkdir -p」的步骤，
    // 导致 cat > path/to/file.ts 因父目录不存在而 exit code 1。
    // 此处作为执行层安全网，检测到文件写入命令时自动 mkdir -p。
    //
    // 匹配模式：
    //   cat > "file" << 'EOF'    cat > file << EOF
    //   echo "..." > file        tee file
    //   cp source dest           mv source dest
    const fileWriteMatch = action.match(/(?:cat|echo|tee|cp|mv)\s+(?:['"]?[^>'"`\s]+['"]?\s*)*(?:>|>>)\s*['"]?([^'"\s]+)['"]?/i)
      || action.match(/cat\s+['"]?([^'"\s]+)['"]?\s*<<\s*/i);
    if (fileWriteMatch && fileWriteMatch[1]) {
      let targetPath = fileWriteMatch[1].trim();
      // 去掉可能的行号后缀（heredoc 后续内容干扰）
      targetPath = targetPath.split(/\s/)[0];
      // 跳过 /dev/null 等特殊路径
      if (targetPath && !targetPath.startsWith('/dev/') && targetPath !== 'NUL') {
        const targetFullPath = path.resolve(effectiveCwd, targetPath);
        const targetDir = path.dirname(targetFullPath);
        if (!fs.existsSync(targetDir)) {
          console.log('[execStepDirectly] 自动创建父目录:', targetDir, '(目标文件:', targetPath, ')');
          try {
            fs.mkdirSync(targetDir, { recursive: true });
            console.log('[execStepDirectly] 父目录创建成功');
          } catch (mkdirErr) {
            console.warn('[execStepDirectly] 父目录创建失败（继续执行原命令）:', mkdirErr.message);
          }
        }
      }
    }

    try {
      if (isMultiline) {
        // 多行命令：写入临时脚本执行，避免换行被当命令分隔符
        //
        // 关键实现细节：
        //   用 execFileSync(shell, [tmpFile], opts) 而非 execSync(cmdStr, {shell:true})
        //   原因：
        //   ① shell:true 会先经 cmd.exe 中转 → 路径引号嵌套易乱（WSL bash 不认 C:/ 路径）
        //   ② execSync 只接受字符串命令，传数组会导致输出被静默吞掉
        //   ③ execFileSync 是 Node.js 官方推荐的「执行文件 + 参数数组」API，
        //      路径不经中间 shell 解析，Git Bash / WSL bash / PowerShell 均可正确处理
        if (shell === 'cmd.exe') {
          // 无 bash 可用 → PowerShell 执行 .ps1
          tmpFile = path.join(os.tmpdir(), `hesi-step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.ps1`);
          fs.writeFileSync(tmpFile, action, 'utf8');
          console.log('[execStepDirectly] 多行命令已写入 PowerShell 临时脚本:', tmpFile);
          out = execFileSync('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile,
          ], execOpts);
        } else if (isWsl) {
          // WSL bash：通过 cmd.exe 中转 + /mnt/... 路径（WSL bash 不是真正的 .exe，不能直接 spawn）
          tmpFile = path.join(os.tmpdir(), `hesi-step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sh`);
          fs.writeFileSync(tmpFile, action, 'utf8');
          const wslScript = maybeConvertToWslPath(shell, tmpFile);
          console.log('[execStepDirectly] WSL 多行临时脚本:', tmpFile, '→', wslScript);
          console.log('[execStepDirectly] 执行方式: cmd.exe /c bash', wslScript);
          out = execSync('cmd.exe', ['/c', 'bash', wslScript], execOpts);
        } else {
          // 真实 Git Bash / MSYS2 等：直接 execFileSync
          tmpFile = path.join(os.tmpdir(), `hesi-step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sh`);
          fs.writeFileSync(tmpFile, action, 'utf8');
          console.log('[execStepDirectly] 多行命令已写入临时脚本:', tmpFile);
          console.log('[execStepDirectly] 执行方式: execFileSync(', shell, ',', tmpFile, ')');
          out = execFileSync(shell, [tmpFile], execOpts);
        }
      } else {
        // 单行命令直执
        if (shell === 'cmd.exe') {
          const finalAction = rewriteForWindows(action, shell);
          out = execSync(finalAction, { ...execOpts, shell });
        } else if (isWsl) {
          // WSL bash：写入临时脚本 + cmd.exe 中转执行
          // （不能直接 spawn WSL bash → ENOENT；cmd.exe /c bash -c 有引号嵌套问题）
          tmpFile = path.join(os.tmpdir(), `hesi-step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sh`);
          fs.writeFileSync(tmpFile, action + '\n', 'utf8');
          const wslScript = maybeConvertToWslPath(shell, tmpFile);
          console.log('[execStepDirectly] WSL 单行→临时脚本:', tmpFile, '→', wslScript);
          out = execSync('cmd.exe', ['/c', 'bash', wslScript], execOpts);
        } else {
          // 真实 bash/sh：正常 execSync
          out = execSync(`set -e; ${action}`, { ...execOpts, shell });
        }
      }
    } catch (execErr) {
      return {
        status: 'error',
        output: [
          `命令执行失败（exit code ${execErr.status || '?'}，shell=${shell}${isMultiline ? ', via-temp-script' : ''}）`,
          `cwd: ${effectiveCwd}`,
          `命令: ${action.slice(0, 300)}`,
          String(execErr.stderr || '').slice(0, 500) ? `stderr: ${String(execErr.stderr || '').slice(0, 500)}` : null,
          execErr.message,
        ].filter(Boolean).join('\n'),
      };
    } finally {
      // 清理临时脚本
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }
    return { status: 'done', output: String(out).slice(0, 5000) };
  } catch (e) {
    return { status: 'error', output: `直执异常: ${e.message}` };
  }
}

/**
 * 判断任务是否应走「直执模式」（绕过 agentPool）。
 * 条件：task.task（即 step.action）是可执行命令 OR 步骤显式声明 type:'command'。
 */
function shouldExecDirectly(task, step) {
  // type:'command' 只是 LLM 的"建议标签"，不能盲信——LLM 可能给自然语言步骤误标 command。
  // 因此即使 type=command，仍需验证 action 内容确实像可执行命令（含 shell 元字符或已知命令名）。
  // 真正的 shell 命令走轨道 A（execSync 直执）；自然语言/模糊指令走轨道 B（AI LLM 管线）。
  const action = String(task && task.task || '').trim();
  const typeTag = step && step.type;
  const result = (typeTag === 'command' && isPossibleCommand(action)) || isPossibleCommand(action);
  // 诊断日志：确认判定结果与输入（稳定后可移除）
  console.log('[shouldExecDirectly]', JSON.stringify({ action: action.slice(0, 120), typeTag, result }));
  return result;
}

async function runSingleTask(wf, task) {
  let startJson;
  try {
    startJson = JSON.parse(await wf.start(`plan-step-${task.id}`, [task], { maxConcurrency: 1 }));
  } catch (e) {
    return { status: 'error', output: `workflow start 异常: ${e.message}` };
  }
  if (!startJson.ok) return { status: 'error', output: startJson.error || 'start failed' };
  const wfId = startJson.workflowId;
  const t0 = Date.now();
  while (Date.now() - t0 < STEP_TIMEOUT_MS) {
    let st;
    try {
      st = JSON.parse(await wf.status(wfId));
    } catch (e) {
      return { status: 'error', output: `workflow status 异常: ${e.message}` };
    }
    if (!st.ok) return { status: 'error', output: st.error || 'status failed' };
    const t = (st.tasks || []).find((x) => x.id === task.id);
    if (t && ['completed', 'failed', 'skipped'].includes(t.status)) {
      return { status: t.status, output: t.output || '', error: t.error || '' };
    }
    await new Promise((r) => { setTimeout(r, POLL_MS); });
  }
  return { status: 'timeout', output: '' };
}

/**
 * 轨道 B（Agent 型步骤）：复用 AI 助手已调好的 LLM 工具环执行。
 * 不重新实现流式/工具调用——直接调 nonStreamingChat（QCLI_TOOLS + executeToolCall
 * + 3min 熔断 + pruneToolContext），仅剔除 agent_* 委派工具避免递归回外部 agent。
 *
 * @param {object} task   planToWorkflowTasks 产出的 task
 * @param {object} step   plan.steps[i]
 * @param {object} plan   原始 plan（取 scope_paths/forbidden 作约束提示）
 * @param {object} runtime { apiKey, provider, baseUrl, model }
 * @param {{ broadcastFn?: Function, sessionId?: string }} [extra]
 * @returns {Promise<{ status: string, output: string }>}
 */
async function runStepViaChatLLM(task, step, plan, runtime, extra = {}) {
  const goal = step.goal || task.label || task.id || '未命名步骤';
  const actionHint = step.action || '';
  const scope = Array.isArray(plan && plan.scope_paths) ? plan.scope_paths : [];
  const forbidden = Array.isArray(plan && plan.forbidden) ? plan.forbidden : [];
  const user = [
    `步骤目标：${goal}`,
    actionHint ? `参考动作/指令：${actionHint}` : '',
    `计划约束：scope_paths=${JSON.stringify(scope)}，forbidden=${JSON.stringify(forbidden)}`,
    `请用可用工具完成该目标，完成后用中文简述你做了什么。`,
  ].filter(Boolean).join('\n');
  const messages = [
    { role: 'system', content: PLAN_STEP_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
  try {
    // 延迟加载 chat 管线（避免拖慢 plan 模块与测试）
    const { nonStreamingChat } = require('../chat');
    const result = await nonStreamingChat(
      messages,
      runtime.apiKey,
      runtime.model,
      runtime.provider,
      runtime.baseUrl,
      extra.broadcastFn || null,
      extra.sessionId || '',
      planStepTools(),
    );
    const output = String((result && result.content) ? result.content : '').slice(0, 5000);
    if (result && result.timedout && !output) {
      return { status: 'error', output: 'AI 助手执行超时（3 分钟），未产出结果' };
    }
    if (!output) {
      return { status: 'error', output: 'AI 助手未产出任何结果（可能工具调用未达成目标）' };
    }
    return { status: 'done', output };
  } catch (e) {
    return { status: 'error', output: `AI 助手执行异常: ${e.message}` };
  }
}

// ── 验收执行（机器可验证闭环） ──

/**
 * 跑 plan.acceptance 里的机器可验证项，返回通过情况。
 * command/script 走 child_process；http 走原生 fetch（node18+）。
 * @param {object} plan
 * @param {{ cwd?: string }} [opts]
 */
function runAcceptance(plan, opts = {}) {
  const acc = Array.isArray(plan && plan.acceptance) ? plan.acceptance : [];
  const cwd = opts.cwd || process.cwd();
  const results = acc.map(async (a) => {
    const base = { id: a.id || '?', kind: a.kind, command: a.command || a.expect || '' };
    if ((a.kind === 'command' || a.kind === 'script') && typeof opts.securityCheck === 'function') {
      if (!opts.securityCheck(a.command)) {
        return { ...base, pass: false, error: '被运行时策略拦截（HESI_PLAN_RUNTIME_INTERCEPT）', blocked: true };
      }
    }
    try {
      if (a.kind === 'command' || a.kind === 'script') {
        const { shell: accShell } = resolveShell();
        const isCmd = accShell === 'cmd.exe';
        const finalCmd = isCmd ? rewriteForWindows(a.command, accShell) : a.command;

        // PATH 丰富（与 execStepDirectly 一致）
        const accOpts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
        if (!isCmd && (accShell.includes('/') || accShell.includes('\\'))) {
          const fs2 = require('fs');
          const path2 = require('path');
          const shellDir = path2.dirname(accShell);
          const shellParent = path2.dirname(shellDir);
          const shellRoot = path2.dirname(shellParent);
          const extraPaths = [shellDir];
          [path2.join(shellRoot, 'mingw64', 'bin'), path2.join(shellRoot, 'bin')].forEach(c => {
            if (fs2.existsSync(c) && !extraPaths.includes(c)) extraPaths.push(c);
          });
          const existing = new Set((process.env.PATH || '').split(';').map(p => p.toLowerCase().replace(/\\/g, '/')));
          const toAdd = extraPaths.filter(p => !existing.has(p.toLowerCase().replace(/\\/g, '/')));
          if (toAdd.length > 0) {
            accOpts.env = { ...process.env, PATH: toAdd.join(';') + ';' + (process.env.PATH || '') };
          }
        }

        const out = execFileSync(isCmd ? 'cmd.exe' : accShell, isCmd ? ['/c', finalCmd] : ['-c', finalCmd], accOpts);
        const pass = !a.expect || out.includes(a.expect);
        return { ...base, pass, output: String(out).slice(0, 500) };
      }
      if (a.kind === 'http') {
        // 简易 GET + expect 命中（AbortController 做超时）
        const url = String(a.command || '').trim();
        if (!/^https?:\/\//.test(url)) return { ...base, pass: false, error: 'http 验收需合法 URL' };
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(url, { signal: controller.signal });
          const body = await res.text();
          clearTimeout(timer);
          const pass = res.ok && (!a.expect || body.includes(a.expect));
          return { ...base, pass, output: body.slice(0, 500) };
        } catch (e) {
          return { ...base, pass: false, error: e.message };
        }
      }
      if (a.kind === 'manual') {
        // 人工验收无法自动判定 → 默认通过（用户可在 UI 上手动确认/拒绝）
        return { ...base, pass: true, output: `(人工验收: ${a.description || a.command || '待确认'})`, manual: true };
      }
      // 兜底：未知 kind（含 undefined/null/空）→ 视为 manual 默认通过
      // LLM 常遗漏 kind 字段，sanitizePlan 应已修复，但运行时再兜底一次
      console.warn(`[runAcceptance] 未知 kind="${a.kind}"，按 manual 处理: ${a.description || a.command || '?'}`);
      return { ...base, pass: true, output: `(人工验收: ${a.description || a.command || '待确认'})`, manual: true };
    } catch (e) {
      return { ...base, pass: false, error: e.message };
    }
  });
  // 同步/异步归一
  return Promise.all(results).then((rs) => {
    // 空验收列表 → 视为全部通过（无验收项不构成失败理由）
    const allPass = rs.length === 0 || rs.every((r) => r.pass);
    return { results: rs, allPass };
  });
}

// ── 反思残差（#36） ──

/**
 * 根据逐步结果与验收，判定闭环状态。
 * @returns {{ status: 'done'|'partial'|'diverged', reason?: string, stepsDone: number, stepsTotal: number, acceptancePassRate: number|null, budget?: object }}
 */
function reflectPlan(plan, stepResults, budget, acceptance, opts) {
  const total = stepResults.length;
  const done = stepResults.filter((s) => s.status === 'done').length;
  const blocked = stepResults.filter((s) => s.status === 'blocked');
  const fatal = stepResults.filter((s) =>
    ['loop', 'budget', 'timeout', 'rejected'].includes(s.status)
  );
  const diverged =
    blocked.some((b) => b.needsAcceptance) || fatal.length > 0;

  let status;
  let reason;
  if (total === 0) {
    status = 'rejected';
    reason = '无步骤被执行（plan 为空或被闸门拒收）';
  } else if (diverged) {
    status = 'diverged';
    reason = fatal.length
      ? `执行异常需人工干预: ${fatal[0].reason || fatal[0].status}`
      : '存在需人工补充 acceptance 的 checkpoint 断点';
  } else if (done === total) {
    status = 'done';
  } else {
    status = 'partial';
    reason = `部分步骤未完成（done=${done}/${total}）`;
  }

  let acceptancePassRate = null;
  if (acceptance) {
    const n = acceptance.results.length;
    acceptancePassRate = n ? acceptance.results.filter((r) => r.pass).length / n : null;
    // 验收结果仅作为信息展示，不阻塞最终状态
    // （LLM 生成的验收命令常依赖用户环境不一定有的工具如 tsc，
    //   真实失败不应将 done 降级为 partial）
    // 若需严格验收模式，可通过 opts.strictAcceptance 开启
    if (opts && opts.strictAcceptance && status === 'done' && !acceptance.allPass) {
      status = 'partial';
      reason = '步骤全部完成，但机器验收未全部通过（严格模式）';
    }
  }

  const out = { status, reason, stepsDone: done, stepsTotal: total, acceptancePassRate };
  if (budget) out.budget = { rounds: budget.rounds, tokens: budget.tokens };
  return out;
}

// ── 主入口 ──

/**
 * 执行一个通过合约的 plan。
 * @param {object} plan
 * @param {object} opts
 * @param {string} [opts.cwd]                 git 仓库根（无则降级为无快照执行）
 * @param {Function} [opts.roundtableFn]      async ({question,transcript,rounds}) => ({kind,command,expect}|null)
 * @param {object} [opts.workflowManager]     workflow-manager 实例（start/status）
 * @param {object} [opts.budget]              覆盖 plan.budget（测试注入）
 * @param {boolean} [opts.dryRun]             不真正跑 workflow（仅校验/快照演示）
 * @param {boolean} [opts.runAcceptance]      结束后跑验收（默认 true；dryRun 时强制 false）
 * @param {Function} [opts.onStep]            async (ev) => {} 逐步事件（UI 流式）
 * @param {Function} [opts.shouldAbort]       () => boolean 人工中止
 * @param {string} [opts.execId]              执行实例 ID（审批闸关联用）
 * @param {Function} [opts.requestApproval]   async (req)=>boolean 审批闸：暂停等待人工决议（true=通过 / false=驳回）
 * @param {string} [opts.executorAgentId]     步骤默认执行方：'ai'（默认，复用 AI 助手 LLM 工具环）或外部 CLI agent id（走旧 agentPool 回退）。每步可用 step.agentId 覆盖。
 * @param {object} [opts.permissions]         个性化「权限设置」下钻：
 *        { mode?: 'ask'|'auto'|'strict', autoReview?: boolean, fullAuto?: boolean }
 *        - autoReview=false → 跳过 gatePlan 可验证性闸门（危险，默认开启）
 *        - fullAuto=true     → 置 plan.allow_external=true（开启外部副作用，Phase 1 运行时拦截消费）
 *        - mode 当前仅落库，chat Agent HITL 留 Phase 1
 * @returns {Promise<{ ok: boolean, status: string, branch: string|null, steps: object[], reflection: object }>}
 */
/**
 * M4/C1：失败分类——区分「可重试」与「致命（重试无意义）」。
 * @param {object} body  runOneAttempt 返回（含 results / reflection）
 * @returns {'retryable'|'fatal'}
 */
function classifyFailure(body) {
  const results = (body && body.results) || [];
  for (const r of results) {
    const st = r.status;
    const err = String(r.error || r.output || '');
    // 注意：'blocked'（运行时拦截 / forbidden / scope 越界）不归入 fatal——
    // 它是「可被 autoReplan 修订修复」的（如 LLM 修正 scope_paths / 去掉危险命令），
    // 故视为 retryable，由 maxRetries + 无进展早停防止死循环。fatal 仅保留给真正的
    // 执行层致命错误（权限 / 语法 / 逻辑），避免「假装修好」式无限重试。
    if (/permission denied|EACCES|EPERM/i.test(err)) return 'fatal';
    if (/syntax error|SyntaxError|TypeError|ReferenceError|Unexpected token/i.test(err)) return 'fatal';
    if (/command not found|not recognized as|ENOENT|No such file/i.test(err)) return 'retryable';
    if (/timeout|ETIMEDOUT|timed out|aborted/i.test(err)) return 'retryable';
    if (st === 'error' || st === 'failed') return 'retryable';
  }
  return 'retryable';
}

/** M4/C2：构造精简失败上下文（失败步骤 id + 错误 + 输出末尾），供 revisePlan 精准修复。 */
function buildFailureContext(body) {
  const results = (body && body.results) || [];
  const lines = [];
  for (const r of results) {
    if (r.status === 'error' || r.status === 'blocked' || r.status === 'failed') {
      const tail = String(r.output || r.error || '').trim().split('\n').slice(-8).join('\n');
      lines.push(`- 步骤 ${r.id || '?'} [${r.status}]: ${r.goal || ''}\n  错误/输出末尾: ${tail}`);
    }
  }
  return lines.join('\n') || '(无明确失败步骤，但整体未达 done)';
}

/** M4/C5：为「重试时间线」生成一句话失败摘要（供前端展示，不堆砌原始输出）。 */
function summarizeAttemptReason(body) {
  const results = (body && body.results) || [];
  for (const r of results) {
    if (r.status === 'error' || r.status === 'blocked' || r.status === 'failed') {
      const tail = String(r.output || r.error || '').trim().split('\n').slice(-3).join(' ');
      const head = `步骤 ${r.id || '?'}（${r.goal || ''}）${r.status}`;
      return tail ? `${head}：${tail.slice(0, 160)}` : head;
    }
  }
  return '整体未达 done（未识别到明确失败步骤）';
}

/** M4/C4：Plan 步骤结构签名，用于「无进展早停」判定（防修订死循环烧 token）。 */
function planStepSig(plan) {
  const steps = (plan && plan.steps) || [];
  return JSON.stringify(steps.map((s) => ({ goal: s.goal, action: s.action, type: s.type })));
}

async function runPlan(plan, opts = {}) {
  const cwd = opts.cwd;
  const wf = opts.workflowManager;
  const roundtableFn = opts.roundtableFn;
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : () => {};
  const dryRun = !!opts.dryRun;
  const runAcc = opts.runAcceptance !== false && !dryRun;

  // 个性化权限下钻（来自 /api/plan/execute 的 body.permissions）
  const perms = opts.permissions || null;
  if (perms && perms.fullAuto) plan.allow_external = true; // 开启外部副作用（Phase 1 运行时拦截消费）
  const skipGate = !!(perms && perms.autoReview === false);

  // 决策①：可验证性闸门
  const gate = skipGate ? { ok: true } : gatePlan(plan);
  if (!gate.ok) {
    const ev = { status: 'rejected', reason: gate.reason, missing: gate.missing };
    await onStep(ev);
    return {
      ok: false,
      status: 'rejected',
      branch: null,
      missing: gate.missing,
      steps: [ev],
      reflection: reflectPlan(plan, [ev], null, null),
    };
  }

  // ── ② 反思重规划环：熔断/diverged 时自动修订重跑，上限 maxRetries ──
  const maxRetries = Number.isFinite(Number(opts.maxRetries)) && opts.maxRetries >= 0 ? opts.maxRetries : 0;
  const plannerRuntime = opts.plannerRuntime || null;
  const reviseFn = typeof opts.revisePlanFn === 'function' ? opts.revisePlanFn : defaultRevisePlan;

  let currentPlan = plan;
  let lastBody = null;
  const attempts = [];
  let fatalReason = null;
  let noProgress = false;
  let lastPlanSig = null;
  let reviseFailed = false; // autoReplan 修订抛异常 → 终止且明确标记 rejected
  let reviseErrMsg = ''; // 修订异常原文，用于区分「LLM 超时」与「Plan 真的没救」
  // C6：同一 runPlan（同 execId）内，首次已审批的步骤在重试时复用审批结论，不再重复弹窗打扰。
  const runOpts = Object.assign({}, opts, { approvedSteps: new Set() });
  for (let attempt = 0; ; attempt++) {
    const body = await runOneAttempt(currentPlan, { cwd, wf, roundtableFn, onStep, dryRun, runAcc, skipGate, opts: runOpts });
    lastBody = body;
    const st = body.reflection.status;
    const terminal = st === 'done' || st === 'rejected';
    const failureKind = terminal ? 'terminal' : classifyFailure(body);
    // C5：记录每轮轨迹（轮次 / 状态 / 失败原因），供前端「重试时间线」展示
    attempts.push({
      n: attempt + 1,
      planId: currentPlan.id,
      status: st,
      kind: failureKind,
      reason: terminal ? '' : summarizeAttemptReason(body).slice(0, 300),
    });
    if (terminal) break;
    // C1：致命性失败（权限/语法/逻辑）→ 重试无意义，直接失败（避免「假装修好」）
    if (failureKind === 'fatal') {
      fatalReason = '检测到致命性失败（权限不足 / 语法错误 / 逻辑错误），自动重试无意义，请手动修正 Plan';
      break;
    }
    if (attempt >= maxRetries) break;
    let revised = null;
    try { revised = await reviseFn(currentPlan, body, plannerRuntime, buildFailureContext(body)); }
    catch (e) {
      revised = null;
      reviseFailed = true;
      reviseErrMsg = (e && e.message) ? String(e.message) : '';
      console.warn('[runPlan] autoReplan 修订失败:', reviseErrMsg);
    }
    if (!revised) break;
    // 标记上一轮已触发修订（供前端展示「已修订」）
    attempts[attempts.length - 1].revised = true;
    // C4：无进展早停——连续修订产出的 Plan 结构完全相同则判定死循环，停止以避免烧 token
    const sig = planStepSig(revised);
    if (lastPlanSig !== null && sig === lastPlanSig) {
      noProgress = true;
      break;
    }
    lastPlanSig = sig;
    currentPlan = revised;
  }

  // 若因 autoReplan 修订失败（而非正常收敛/达上限）终止且未完成 → 明确标记 rejected，
  // 避免前端把「修订异常中断」误显示为 partial（部分成功）误导用户。
  let finalStatus = lastBody.reflection.status;
  let finalReason = undefined;
  if (reviseFailed && finalStatus !== 'done' && finalStatus !== 'rejected') {
    finalStatus = 'rejected';
    // 区分「LLM 超时/不可达」与「Plan 真的没救」：前者笼统报「无法自动优化」会误导用户
    // 去改本来没问题的 Plan（实测本地小模型改写 Plan 常超过默认 5 分钟）。
    if (/timeout|abort|超时|ECONNREFUSED|fetch failed/i.test(reviseErrMsg)) {
      const { LLM_BRIDGE_TIMEOUT_MS } = require('../../lib/memory/llm-bridge');
      finalReason = `autoReplan 修订未完成：调用大模型超时或不可达（当前上限 ${Math.round(LLM_BRIDGE_TIMEOUT_MS / 1000)}s）。`
        + 'Plan 本身未必有问题——请调大环境变量 HESI_LLM_API_TIMEOUT_MS，或改用更快的模型后重试。'
        + `原始错误：${reviseErrMsg}`;
    } else {
      finalReason = `autoReplan 修订失败：Plan 无法自动优化，请手动调整 Plan 或重试${reviseErrMsg ? `（${reviseErrMsg}）` : ''}`;
    }
  }
  if (fatalReason && finalStatus !== 'done' && finalStatus !== 'rejected') {
    finalStatus = 'rejected';
    finalReason = fatalReason;
  }
  if (noProgress && finalStatus !== 'done' && finalStatus !== 'rejected') {
    finalStatus = 'rejected';
    finalReason = '自动重试未产生新方案（连续修订无进展），已停止以避免死循环';
  }
  return {
    // 保持原语义：done / partial 视为 ok=true；仅当 autoReplan 修订失败被明确升级为 rejected 时 ok=false
    ok: finalStatus === 'done' || (finalStatus === 'partial' && !reviseFailed),
    status: finalStatus,
    reason: finalReason,
    branch: lastBody.branch,
    steps: lastBody.results,
    reflection: lastBody.reflection,
    attempts,
    revised: attempts.length > 1,
  };
}

// ── 单次尝试：开分支 → 逐步执行 → 验收 → 反思 ──
async function runOneAttempt(plan, ctx) {
  const { cwd, wf, roundtableFn, onStep, dryRun, runAcc, opts } = ctx;
  const haveGit = !!cwd && isRepo(cwd);
  let branch = null;
  const interceptEnabled = !!(plan.runtimeIntercept || (opts && opts.runtimeIntercept) || process.env.HESI_PLAN_RUNTIME_INTERCEPT === '1');
  const evalCmd = interceptEnabled ? makeEvalCmd() : null;
  if (haveGit) {
    try {
      branch = openPlanBranch(cwd);
    } catch {
      branch = null; // 降级：无快照
    }
  }

  const budget = new PlanBudget(opts.budget || plan.budget || {});
  const tasks = planToWorkflowTasks(plan, { defaultAgentId: opts && opts.defaultAgentId });
  const results = [];
  const rounds = (plan.budget && plan.budget.maxRounds) || 3;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const step = plan.steps[i] || {};
    const ev = { index: i, id: task.id, goal: task.label, status: 'start' };

    // 人工中止
    if (typeof opts.shouldAbort === 'function' && opts.shouldAbort()) {
      ev.status = 'aborted';
      ev.reason = '人工中止';
      results.push(ev);
      await onStep(ev);
      break;
    }

    // 预算轮数
    const tick = budget.tickRound();
    if (!tick.ok) {
      ev.status = 'budget';
      ev.reason = tick.reason;
      results.push(ev);
      await onStep(ev);
      break;
    }

    // #34 真实前置拦截
    const intercept = checkInterception(plan, step, cwd);
    if (intercept) {
      ev.status = 'blocked';
      ev.reason = intercept.reason;
      results.push(ev);
      await onStep(ev);
      if (!step.on_fail || step.on_fail === 'stop') break;
      continue;
    }

    // ④ 运行时逐工具强制拦截（接 mcp/security/policy.evaluateAiExec）
    // 注意：仅对「直执模式」（轨道 A）生效——AI 聊天管线（轨道 B）内部已有
    // executeToolCall 工具级安全检查，不需要双重拦截。
    const stepAgent = step.agentId || (opts && opts.executorAgentId) || null;
    const useAi = !stepAgent || stepAgent === 'ai';
    const runtime = (opts && opts.plannerRuntime) || null;
    const hasLLM = !!(runtime && runtime.apiKey);
    const willUseChatPipeline = useAi && hasLLM;
    if (evalCmd && !willUseChatPipeline) {
      const secReason = evaluateStepSecurity(step, evalCmd);
      if (secReason) {
        ev.status = 'blocked';
        ev.reason = secReason;
        results.push(ev);
        await onStep(ev);
        if (!step.on_fail || step.on_fail === 'stop') break;
        continue;
      }
    }

    // 步前快照（失败可 rollback）
    let snapSha = null;
    if (haveGit) {
      try {
        snapSha = snapshotStep(cwd, `plan: step ${i + 1} ${task.label}`, plan.scope_paths);
      } catch { /* 忽略 */ }
    }
    ev.snapshot = snapSha;

    // 决策②：checkpoint 软断点 → 圆桌推导验收
    let effectiveStep = step;
    if (step.checkpoint) {
      const cp = await resolveCheckpoint(plan, step, { rounds, roundtableFn });
      ev.checkpoint = cp;
      if (!cp.ok) {
        ev.status = 'blocked';
        ev.reason = cp.reason;
        ev.needsAcceptance = cp.needsAcceptance;
        results.push(ev);
        await onStep(ev);
        if (!step.on_fail || step.on_fail === 'stop') break;
        continue;
      }
      if (cp.derivedVerify) effectiveStep = { ...step, verify: cp.derivedVerify };
    }

    // 决策③（P2.6 审批闸）：需人工审批的步 → 暂停等待决议
    if (stepRequiresApproval(plan, step)) {
      ev.status = 'await-approval';
      ev.requiresApproval = true;
      await onStep(ev); // 通知前端出闸门卡片
      let approved = true;
      const approvedSteps = opts && opts.approvedSteps;
      // C6：同一 runPlan 内重试时，复用首次审批结论，不再重复打扰
      if (approvedSteps && approvedSteps.has(task.id)) {
        approved = true;
      } else if (typeof opts.requestApproval === 'function') {
        approved = await opts.requestApproval({
          execId: opts.execId,
          index: i,
          id: task.id,
          goal: task.label,
          action: step.action,
          risk: step.risk || null,
        });
      }
      if (approved && approvedSteps) approvedSteps.add(task.id);
      if (!approved) {
        ev.status = 'rejected';
        ev.reason = '人工驳回（审批闸）';
        ev.requiresApproval = false;
        results.push(ev);
        await onStep(ev);
        break;
      }
      ev.status = 'start'; // 审批通过，继续
      ev.requiresApproval = false;
    }

    // 真正执行（双轨：命令型直执 / Agent 型走 workflow / skip 占位符）
    let exec;
    if (dryRun) {
      exec = { status: 'skipped', output: '(dryRun)' };
    } else if (step.type === 'skip' || step._isPlaceholder) {
      // 占位符步骤（LLM 输出为空，sanitizePlan 填充的假数据）→ 标记 error 而非静默 done
      console.log(`[runPlan] 占位符步骤 ${step.id}（LLM 输出为空）: "${(step.goal || '').slice(0, 60)}"`);
      exec = {
        status: 'error',
        output: `⚠️ LLM 未能为此步骤生成可执行内容（goal/action 均为占位符「${step.goal || '?'}」）。` +
          `这通常意味着模型输出不稳定或 API 配置有误。请检查模型设置后重试，或尝试切换更强大的模型。`,
      };
    } else if (shouldExecDirectly(task, step)) {
      // 轨道 A：直执模式 — action 是 shell 命令，绕过 agentPool
      exec = execStepDirectly(step, cwd);
    } else {
      // 轨道 B：Agent 型步骤（自然语言指令）
      // useAi / hasLLM / runtime / stepAgent 已在上方安全检查处计算，直接复用
      if (willUseChatPipeline) {
        // 默认（圆桌式）：复用 AI 助手 LLM 工具环——AI 助手为本地推理方，
        // 通过已调好的 nonStreamingChat（QCLI_TOOLS+executeToolCall+熔断）完成步骤。
        exec = await runStepViaChatLLM(task, step, plan, runtime, {
          broadcastFn: undefined,
          sessionId: opts && opts.execId,
        });
      } else if (stepAgent && stepAgent !== 'ai' && wf) {
        // 显式选中外部 CLI agent → 走旧 agentPool 回退路径
        exec = await runSingleTask(wf, { ...task, verify: effectiveStep.verify, checkpoint: !!effectiveStep.checkpoint });
      } else {
        exec = { status: 'skipped', output: '(no LLM runtime / no workflowManager)' };
      }
    }
    ev.status = exec.status === 'completed' ? 'done' : exec.status;
    ev.output = exec.output || '';

    // 连续重复熔断
    const loop = budget.checkLoop(`${task.id}:${ev.status}`);
    if (!loop.ok) {
      ev.status = 'loop';
      ev.reason = loop.reason;
    }

    results.push(ev);
    await onStep(ev);

    // 失败 → 回滚到本步快照（仅撤销本步改动）
    if (ev.status === 'failed' || ev.status === 'error') {
      if (haveGit && snapSha) {
        try { rollbackTo(cwd, snapSha); } catch { /* 忽略 */ }
      }
      if (!step.on_fail || step.on_fail === 'stop') break;
    }
    if (['loop', 'budget', 'timeout'].includes(ev.status)) break;
  }

  // 闭环：最终快照 + 切回原分支（保留 auto 分支供审计）
  if (haveGit) {
    try { snapshotStep(cwd, 'plan: final', plan.scope_paths); } catch { /* 忽略 */ }
    try { closeBranch(cwd); } catch { /* 忽略 */ }
  }

  // 验收（机器可验证闭环）
  let acceptance = null;
  if (runAcc) {
    try {
      const accOpts = { cwd: cwd || process.cwd() };
      if (evalCmd) accOpts.securityCheck = (c) => evalCmd(c);
      acceptance = await runAcceptance(plan, accOpts);
    } catch {
      acceptance = null;
    }
  }

  const reflection = reflectPlan(plan, results, budget, acceptance);
  return { branch, results, reflection };
}

// ── ④ 运行时策略评估（懒加载 policy，避免耦合与测试污染） ──
let _policyMod = undefined;
function makeEvalCmd() {
  if (_policyMod === undefined) {
    try { _policyMod = require('../../mcp/security/policy'); } catch { _policyMod = null; }
  }
  if (!_policyMod || typeof _policyMod.evaluateAiExec !== 'function') return () => true; // 降级放行
  return (cmd) => { try { return _policyMod.evaluateAiExec(cmd).allowed !== false; } catch { return true; } };
}

const SHELL_METACHAR = /[;&|`$()<>#\n\r]/;
const KNOWN_BASE = /^(rm|dd|mkfs|shutdown|reboot|halt|poweroff|chmod|chown|kill|pkill|sudo|su|reg|format|diskpart|fdisk|curl|wget|node|node\.exe|python|python3|npm|npx|sh|bash|cmd|powershell|git|docker|kubectl|ls|cat|echo|cp|mv|mkdir|touch|sed|awk|grep|find|tar|zip|unzip|gh|cargo|go|make|cmake|gcc|clang|ruby|perl|php|java|tsc|eslint|prettier)\b/i;

function isPossibleCommand(s) {
  if (!s) return false;
  if (SHELL_METACHAR.test(s)) return true;
  const base = s.trim().split(/\s+/)[0] || '';
  return KNOWN_BASE.test(base);
}

function evaluateStepSecurity(step, evalCmd) {
  const cand = [];
  const action = step && step.action;
  if (isPossibleCommand(action)) cand.push(action);
  const vcmd = step && step.verify && step.verify.command;
  if (vcmd) cand.push(vcmd);
  for (const c of cand) {
    if (!evalCmd(c)) return `运行时策略拦截（policy.evaluateAiExec 拒绝）: ${String(c).slice(0, 100)}`;
  }
  return null;
}

module.exports = {
  runPlan,
  parseVerifyFromSummary,
  checkInterception,
  runAcceptance,
  reflectPlan,
  stepRequiresApproval,
  evaluateStepSecurity,
  execStepDirectly,
  shouldExecDirectly,
  _pathTokens,
  resolveShell,
  rewriteForWindows,
  resolveProjectRelativePath,
};
