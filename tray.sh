#!/usr/bin/env bash

# Copyright (c) 2026 qiuqiukof-oss
# Licensed under the MIT License. See LICENSE for details.
DIR="$(cd "$(dirname "$0")" && pwd)"

# === 便携 Node（主目录必须带 node/bin/node；缺失则回退系统 node）===
NODE="$DIR/node/bin/node"
if [ ! -x "$NODE" ]; then
  echo "[tray] 未找到便携 Node：$NODE，回退系统 node"
  NODE="node"
fi

# === 依赖自检：缺失则分别自动 npm install（主目录 + tray 目录）===
if [ ! -d "$DIR/node_modules" ]; then
  echo "[tray] 主目录依赖缺失，正在 npm install ..."
  if [ -x "$DIR/node/bin/npm" ]; then (cd "$DIR" && "$DIR/node/bin/npm" install); else (cd "$DIR" && npm install); fi
fi
if [ ! -d "$DIR/tray/node_modules/systray2" ]; then
  echo "[tray] tray 依赖缺失，正在 npm install ..."
  if [ -x "$DIR/node/bin/npm" ]; then (cd "$DIR/tray" && "$DIR/node/bin/npm" install); else (cd "$DIR/tray" && npm install); fi
fi

# === 环境变量：便携 Node 注入 PATH，QCLI_PORTABLE 指向主目录 ===
export QCLI_PORTABLE="$DIR"
export PATH="$DIR/node/bin:$PATH"
export PORT="${PORT:-4264}"

cd "$DIR"
exec "$NODE" "$DIR/tray/tray.js"
