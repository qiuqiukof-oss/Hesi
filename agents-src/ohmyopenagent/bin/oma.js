#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
'use strict';
// OhMyOpenAgent CLI — 多 Agent 编排入口（U 盘智能体内置框架）
// 这是一个最小可用骨架：oma init / list / run。可替换为你的真实实现，
// 只要保持 `oma` 这个 bin 名与 --version 输出即可被一键安装识别。
const fs = require('fs');
const path = require('path');

const VERSION = require('../package.json').version;

function log(...a) { console.log(...a); }
function err(...a) { console.error(...a); }

function help() {
  log(`OhMyOpenAgent (oma) v${VERSION} — 多 Agent 编排平台

用法:
  oma --version              显示版本
  oma init [dir]             在当前/指定目录初始化 .oma/ 配置
  oma list                   列出已注册的智能体
  oma run <agent> [prompt]   运行某个智能体（演示编排）
  oma --help                 显示本帮助

说明:
  这是 Hesi U盘智能体 内置的多 Agent 编排骨架。你可以把自己的编排逻辑
  替换进 bin/oma.js 与 index.js，保持 bin 名 oma 不变即可被欢迎页一键安装识别。
`);
}

function cmdVersion() { log(VERSION); }

function cmdInit(dir) {
  const target = path.resolve(dir || '.');
  const omaDir = path.join(target, '.oma');
  fs.mkdirSync(omaDir, { recursive: true });
  const cfg = {
    name: path.basename(target),
    agents: [
      { id: 'opencode', runtime: 'opencode', role: '编码智能体' },
      { id: 'codex', runtime: 'codex', role: '代码生成/审查' },
    ],
  };
  fs.writeFileSync(path.join(omaDir, 'agents.json'), JSON.stringify(cfg, null, 2));
  log(`已初始化 OhMyOpenAgent 配置 -> ${path.join(omaDir, 'agents.json')}`);
}

function cmdList() {
  log('已注册智能体（内置骨架）:');
  log('  - opencode   终端 AI 编码智能体');
  log('  - codex      OpenAI Codex CLI');
  log('  - oma        本编排平台自身');
}

function cmdRun(agent, prompt) {
  if (!agent) { err('缺少参数: oma run <agent> [prompt]'); process.exit(2); }
  log(`[Oma] 编排智能体: ${agent}`);
  log(`[Oma] 提示词: ${prompt || '(空)'}`);
  log(`[Oma] (骨架演示) 这里应委派给 ${agent} 并执行多 Agent 协作流程。`);
  log(`[Oma] 替换为你的真实编排逻辑即可。`);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  switch (cmd) {
    case '--version':
    case '-v':
      cmdVersion();
      break;
    case '--help':
    case '-h':
    case undefined:
      help();
      break;
    case 'init':
      cmdInit(args[1]);
      break;
    case 'list':
      cmdList();
      break;
    case 'run':
      cmdRun(args[1], args.slice(2).join(' '));
      break;
    default:
      err(`未知命令: ${cmd}`);
      help();
      process.exit(2);
  }
}

main();
