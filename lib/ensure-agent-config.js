/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// ensure-agent-config.js
//
// 在 Hesi 启动时（幂等）于项目根生成/更新供「终端智能体」
// （opencode / Claude Code / Codex 等）使用的配置文件：
//
//   1. .mcp.json  — 注册 Hesi 自身的 MCP 服务器（node mcp-server.js），
//                   使 agent 能自动连上 Hesi 的浏览器自动化 / 会话工具。
//   2. CLAUDE.md  — Claude Code / Codex 的上下文：告知 agent 它正运行在
//                   Hesi 中，以及 MCP / 浏览器 CDP 的用法。
//   3. AGENTS.md  — 通用智能体（Codex 等）的同类上下文。
//
// 设计原则（对用户文件友好、保守）：
//   - .mcp.json：合并写入，仅添加/刷新 `cli-q` 条目，保留用户其它服务器。
//   - CLAUDE.md / AGENTS.md：用起始/结束标记包裹 Hesi 段落；已存在则替换，
//     不存在则追加；绝不删除用户已有内容。
//   - 任何写入失败都只告警、不阻断服务启动。
// ============================================================
const fs = require('fs');
const path = require('path');

const MARK_START = '<!-- Hesi context start -->';
const MARK_END = '<!-- Hesi context end -->';

// 改名前（CLI-Q → Hesi）遗留的旧标记。历史上由旧版本写入，改名后已无活写入者，
// 但旧项目根里可能仍残留该段，与 Hesi 段并存造成 token 重复且信息自相矛盾。
// 写 Hesi 段时顺带幂等清理（只删本标记包裹的部分，绝不碰用户内容）。
const LEGACY_MARK_START = '<!-- CLI-Q context start -->';
const LEGACY_MARK_END = '<!-- CLI-Q context end -->';

function isWin() {
  return process.platform === 'win32';
}

/** 解析用于 MCP 配置的 node 可执行文件（优先便携 Node）。 */
function resolveNodeBin(root) {
  const portable = process.env.QCLI_PORTABLE;
  if (portable) {
    const p = isWin()
      ? path.join(portable, 'node', 'node.exe')
      : path.join(portable, 'bin', 'node');
    if (fs.existsSync(p)) return p;
  }
  return 'node';
}

/** 构建 Hesi 上下文段落（Markdown）。 */
function buildContextMarkdown(root, port) {
  const url = `http://127.0.0.1:${port}`;
  return `${MARK_START}
# Hesi 运行上下文（由 Hesi 自动生成，请勿手动修改本段）

你正在 **Hesi** 中运行 —— 这是一个「浏览器里的终端 + AI 智能体中枢」。
Hesi 的 Web 控制台地址是 ${url}，服务端口为 **${port}**。

## 你能使用的 MCP 工具
Hesi 已在 \`.mcp.json\` 中注册了名为 **\`cli-q\`** 的 MCP 服务器，提供两大类工具：

- **浏览器自动化（CDP）**：\`browser_connect\` / \`browser_navigate\` / \`browser_screenshot\`
  / \`browser_click\` / \`browser_type\` / \`browser_evaluate\` / \`browser_console\`
  / \`browser_list_tabs\` / \`browser_info\` / \`browser_network\`，以及浏览器农场
  \`browser_farm_create\` / \`browser_farm_switch\` 等（隔离会话，适合多账号测试）。
- **会话 / 终端**：\`session_create\` / \`session_write\` / \`session_read\` / \`session_list\`
  等，用于操作 Hesi 托管的持久终端会话。

## 使用浏览器自动化的前提
要使用上述浏览器工具，需先有一个开启了远程调试端口的浏览器实例：
- 端口固定为 **9222**（\`http://127.0.0.1:9222\`）。
- 最简单方式：在 Hesi 系统托盘菜单里选择「打开（CDP 模式）」，它会用独立
  user-data-dir 启动一个 Chrome/Edge 实例并开启 9222 端口；找不到浏览器时回退默认浏览器。
- 之后调用 \`browser_connect\`（可省略参数，默认即 9222）即可接管该浏览器。

## 安全约束（务必遵守）
- 浏览器工具只允许连接 \`127.0.0.1\` / \`localhost\`，禁止连接其它主机。
- 默认浏览器上下文（context 0）是 Hesi 管理页面本身，**对其进行导航/点击会导致
  CDP 断开**；需要浏览外部网站时，务必先 \`browser_farm_create\` 新建隔离会话再操作。
- 这些工具返回结构化 JSON；调用失败时也会返回 \`{ "error": "..." }\` 形式的 JSON，
  请直接读取其中的 \`error\` 字段，不要对整个结果做无差别 JSON.parse。
${MARK_END}`;
}

/** 合并写入 .mcp.json（仅添加/刷新 cli-q 条目，保留其它）。 */
function ensureMcpJson(root, nodeBin) {
  const file = path.join(root, '.mcp.json');
  const mcpServerPath = path.join(root, 'mcp-server.js');
  const cliQEntry = {
    command: nodeBin,
    args: [mcpServerPath],
    env: {},
  };

  let obj = { mcpServers: {} };
  if (fs.existsSync(file)) {
    try {
      obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!obj.mcpServers || typeof obj.mcpServers !== 'object') obj.mcpServers = {};
    } catch (e) {
      console.warn('[AgentConfig] .mcp.json 解析失败，将重建:', e.message);
      obj = { mcpServers: {} };
    }
  }

  // 仅当条目不存在或指向不同路径时才写入，避免无意义的文件改动。
  const existing = obj.mcpServers.cli_q;
  const changed =
    !existing ||
    existing.args?.[0] !== mcpServerPath ||
    existing.command !== nodeBin;
  if (!changed) return false;

  obj.mcpServers.cli_q = cliQEntry;
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)  }\n`, 'utf8');
  return true;
}

/** 移除改名前遗留的 CLI-Q 上下文段（连同其后的空行），只删标记包裹部分，保留用户其余内容。 */
function stripLegacyBlock(content) {
  if (!content.includes(LEGACY_MARK_START) || !content.includes(LEGACY_MARK_END)) return content;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(LEGACY_MARK_START)}[\\s\\S]*?${esc(LEGACY_MARK_END)}\\n*`);
  return content.replace(re, '');
}

/** 写入/刷新带标记的 Markdown 上下文段落（CLAUDE.md / AGENTS.md）。 */
function ensureMarkdownContext(root, fileName, port) {
  const file = path.join(root, fileName);
  const block = buildContextMarkdown(root, port);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${block  }\n`, 'utf8');
    return true;
  }

  const original = fs.readFileSync(file, 'utf8');
  // 先幂等清理 CLI-Q 遗留段（无活写入者，不会拉锯）。
  let content = stripLegacyBlock(original);

  if (content.includes(MARK_START) && content.includes(MARK_END)) {
    // 替换已有 Hesi 段落
    const re = new RegExp(
      `${MARK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    );
    content = content.replace(re, block);
  } else {
    // 用户已有文件但无 Hesi 段落：追加（不破坏用户内容）
    const sep = content.endsWith('\n') ? '\n' : '\n\n';
    content = content + sep + block;
  }

  // 规整连续空行 + 确保单个结尾换行（清理遗留段后可能留下多余空行）。
  content = content.replace(/\n{3,}/g, '\n\n');
  if (!content.endsWith('\n')) content += '\n';

  if (content === original) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

/**
 * 确保 agent 配置就位。失败时仅告警，绝不抛错阻断启动。
 * @param {object} [opts]
 * @param {string} [opts.root] 项目根（默认 process.cwd()）
 * @param {number} [opts.port] 服务端口（默认 process.env.PORT || 4264）
 */
function ensureAgentConfig(opts = {}) {
  const root = opts.root || process.cwd();
  const port = opts.port || parseInt(process.env.PORT, 10) || 4264;
  try {
    // 确保根目录存在（正常部署时 root 即项目目录，必然存在；此处仅防御性）。
    fs.mkdirSync(root, { recursive: true });
    const nodeBin = resolveNodeBin(root);
    const changed = [];
    if (ensureMcpJson(root, nodeBin)) changed.push('.mcp.json');
    if (ensureMarkdownContext(root, 'CLAUDE.md', port)) changed.push('CLAUDE.md');
    if (ensureMarkdownContext(root, 'AGENTS.md', port)) changed.push('AGENTS.md');
    if (changed.length) {
      console.log(`[AgentConfig] 已生成/更新 agent 配置: ${changed.join(', ')} (root=${root})`);
    } else {
      console.log('[AgentConfig] agent 配置已是最新，跳过写入');
    }
  } catch (e) {
    console.warn('[AgentConfig] 生成 agent 配置失败（不影响服务启动）:', e.message);
  }
}

module.exports = { ensureAgentConfig };
