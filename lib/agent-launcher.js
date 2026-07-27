'use strict';
// ============================================================
// 智能体启动器生成（共享给构建脚本与后端安装逻辑）
//
// 关键问题：不同智能体的 bin 入口可能是
//   - 原生可执行文件（Windows PE = MZ 头 / Linux = ELF 头）→ 直接运行，不能前缀 node
//   - Node 脚本（如 codex.js / oma.js）→ 用 node 运行
// 本模块统一检测并写出正确的 .cmd（Windows）与无扩展名 shell（POSIX）启动器。
//
// 启动器通过 $QCLI_PORTABLE 定位便携 Node（U 盘场景），否则回退系统 node。
// ============================================================
const fs = require('fs');
const path = require('path');

/** 判断文件是否为原生可执行文件（PE/ELF）。 */
function isNativeFile(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // MZ (Windows PE) 或 0x7F 'ELF' (Linux/macOS)
    return (buf[0] === 0x4d && buf[1] === 0x5a) ||
           (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46);
  } catch {
    return false;
  }
}

/**
 * 写出启动器。
 * @param {object} o
 * @param {string} o.binDir        启动器输出目录
 * @param {string} o.binName       命令名（如 opencode）
 * @param {string} o.pkgName       已安装包名（用于定位 node_modules/<pkg>/bin/...）
 * @param {string} o.binRel        bin 入口相对包根的路径（如 bin/opencode.exe / bin/codex.js）
 * @param {boolean} o.isNative     是否原生二进制
 * @param {string} [o.portableEnv] 便携根目录环境变量名，默认 QCLI_PORTABLE
 */
function writeAgentLauncher({ binDir, binName, pkgName, binRel, isNative, portableEnv }) {
  fs.mkdirSync(binDir, { recursive: true });
  const entryRel = `../node_modules/${pkgName}/${binRel}`;
  const P = portableEnv || 'QCLI_PORTABLE';

  if (isNative) {
    // 原生可执行文件：直接运行；便携 node 仅加入 PATH 备用。
    fs.writeFileSync(
      path.join(binDir, `${binName  }.cmd`),
      `@echo off\r\n` +
        `set "SELF=%~dp0"\r\n` +
        `if defined ${P} ( set "PATH=%${P}%\\node;%PATH%" )\r\n` +
        `"%SELF%${entryRel}" %*\r\n`,
      'utf8'
    );
    const sh =
      `#!/usr/bin/env bash\n` +
      `DIR="$(cd "$(dirname "$0")" && pwd)"\n` +
      `[ -n "$${P}" ] && export PATH="$${P}/bin:$PATH"\n` +
      `exec "$DIR/${entryRel}" "$@"\n`;
    fs.writeFileSync(path.join(binDir, binName), sh, 'utf8');
    try { fs.chmodSync(path.join(binDir, binName), 0o755); } catch { /* no-op */ }
    return;
  }

  // Node 脚本：优先便携 Node，否则系统 node。
  fs.writeFileSync(
    path.join(binDir, `${binName  }.cmd`),
    `@echo off\r\n` +
      `set "SELF=%~dp0"\r\n` +
      `if defined ${P} (\r\n` +
      `  "%${P}%\\node\\node.exe" "%SELF%${entryRel}" %*\r\n` +
      `) else (\r\n` +
      `  node "%SELF%${entryRel}" %*\r\n` +
      `)\r\n`,
    'utf8'
  );
  const sh =
    `#!/usr/bin/env bash\n` +
    `DIR="$(cd "$(dirname "$0")" && pwd)"\n` +
    `if [ -n "$${P}" ]; then NODE="$${P}/bin/node"; else NODE=node; fi\n` +
    `exec "$NODE" "$DIR/${entryRel}" "$@"\n`;
  fs.writeFileSync(path.join(binDir, binName), sh, 'utf8');
  try { fs.chmodSync(path.join(binDir, binName), 0o755); } catch { /* no-op */ }
}

module.exports = { isNativeFile, writeAgentLauncher };
