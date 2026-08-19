#!/usr/bin/env bash

# Copyright (c) 2026 qiuqiukof-oss
# Licensed under the MIT License. See LICENSE for details.
# 把 tray/tray.js 编译为单文件可执行（macOS / Linux），纯 Node 注入、无需 postject
# 用法：bash scripts/build-tray-exe.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$ROOT/node/node"
SEA_CONFIG="$ROOT/sea-config.json"
BLOB="$ROOT/tray/sea-prep.blob"
OUT="$ROOT/tray/tray"
INJECT="$ROOT/scripts/inject-sea.js"

[ -x "$NODE" ] || { echo "[错误] 未找到可执行 $NODE"; exit 1; }

echo "[1/4] 生成 SEA blob..."
"$NODE" --experimental-sea-config "$SEA_CONFIG"
echo "[2/4] 复制便携 Node 作为基底..."
cp "$NODE" "$OUT"
echo "[3/4] 纯 Node 注入 blob..."
"$NODE" "$INJECT" "$OUT" "$BLOB"
echo "[4/4] 复制 traybin..."
mkdir -p "$ROOT/tray/traybin"
cp "$ROOT/tray/node_modules/systray2/traybin/"* "$ROOT/tray/traybin/"
rm -f "$BLOB"
echo "完成：$OUT 已就绪"
