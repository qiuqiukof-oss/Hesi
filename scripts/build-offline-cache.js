#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
'use strict';
// ============================================================
// Build offline-cache for Hesi U盘智能体
//
// 对每个 INSTALL_REGISTRY 中的智能体：
//   1) 用 npm 安装到 offline-cache/<id>/（registry 包或本地源码 agents-src）
//   2) 从已安装包的 package.json 解析 bin 入口
//   3) 写出 bin/<binName>.cmd / bin/<binName> 启动器（原生二进制直接运行；Node 脚本用便携/系统 node）
//   4) 写出 version.txt
//
// 用法:
//   node scripts/build-offline-cache.js [--out <dir>] [--npm <npmPath>] [id ...]
// 不传 id 则构建全部 featured 智能体。
// ============================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { INSTALL_REGISTRY } = require('../routes/agent-install');
const { isNativeFile, writeAgentLauncher } = require('../lib/agent-launcher');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const opt = { out: path.join(ROOT, 'offline-cache'), npm: 'npm', ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opt.out = path.resolve(argv[++i]);
    else if (a === '--npm') opt.npm = path.resolve(argv[++i]);
    else if (a.startsWith('--out=')) opt.out = path.resolve(a.slice(6));
    else if (a.startsWith('--npm=')) opt.npm = path.resolve(a.slice(6));
    else opt.ids.push(a);
  }
  return opt;
}

const opt = parseArgs(process.argv.slice(2));
const ids = opt.ids.length
  ? opt.ids
  : Object.entries(INSTALL_REGISTRY).filter(([, s]) => s.featured).map(([id]) => id);

const isWin = process.platform === 'win32';

function runNpm(args, cwd) {
  // shell:true 让 Windows 正确解析 npm.cmd（便携 Node）或 npm（Git Bash 下的 sh 脚本）。
  const r = spawnSync(opt.npm, args, { cwd, stdio: 'inherit', shell: true, env: { ...process.env, npm_config_yes: 'true' } });
  if (r.error) throw new Error(`npm 启动失败: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} 退出码 ${r.status}`);
}

/** 解析已安装包的 bin 入口相对路径（相对包根目录）。 */
function resolveBinEntry(pkgDir, binName) {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const bin = pkgJson.bin;
  let rel = null;
  if (typeof bin === 'string') rel = bin;
  else if (bin && typeof bin === 'object') rel = bin[binName] || Object.values(bin)[0];
  if (!rel) throw new Error(`包 ${pkgJson.name} 未定义 bin "${binName}"`);
  return rel.replace(/^\.\//, '');
}

function buildAgent(id) {
  const spec = INSTALL_REGISTRY[id];
  if (!spec) { console.error(`[skip] 未知 agent: ${id}`); return; }
  console.log(`\n=== 构建 ${id} (${spec.displayName}) ===`);
  const cacheDir = path.join(opt.out, id);
  fs.mkdirSync(cacheDir, { recursive: true });

  let pkgName = spec.npmPackage;
  let installTarget;
  if (spec.method === 'copy' && spec.sourceDir) {
    installTarget = path.resolve(ROOT, spec.sourceDir);
    pkgName = JSON.parse(fs.readFileSync(path.join(installTarget, 'package.json'), 'utf8')).name;
    console.log(`  - 本地源码安装: ${installTarget}`);
  } else if (spec.npmPackage) {
    installTarget = spec.npmPackage;
    console.log(`  - npm 安装: ${installTarget}`);
  } else {
    throw new Error(`${id} 既无 npmPackage 也无 sourceDir，无法构建`);
  }

  runNpm(['install', installTarget, '--prefix', cacheDir, '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], cacheDir);

  const pkgDir = path.join(cacheDir, 'node_modules', pkgName);
  if (!fs.existsSync(pkgDir)) throw new Error(`安装后未找到 ${pkgDir}`);
  const binRel = resolveBinEntry(pkgDir, spec.binName);
  const isNative = isNativeFile(path.join(pkgDir, binRel));
  console.log(`  - bin 入口: node_modules/${pkgName}/${binRel} (${isNative ? '原生二进制' : 'Node 脚本'})`);

  writeAgentLauncher({ binDir: path.join(cacheDir, 'bin'), binName: spec.binName, pkgName, binRel, isNative });

  const ver = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(cacheDir, 'version.txt'), ver, 'utf8');
  console.log(`  - version.txt = ${ver}`);
}

try {
  console.log(`输出目录: ${opt.out}`);
  console.log(`npm: ${opt.npm}`);
  console.log(`构建智能体: ${ids.join(', ')}`);
  for (const id of ids) buildAgent(id);
  console.log(`\n✅ 离线缓存构建完成 -> ${opt.out}`);
} catch (e) {
  console.error(`\n❌ 构建失败: ${e.message}`);
  process.exit(1);
}
