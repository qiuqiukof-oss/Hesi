#!/usr/bin/env bash
# ============================================================
# get-node.sh — 下载便携 Node.js 到 hesi/node/（供 --no-node 打包使用）
# 用法：在 hesi/ 目录内运行 ./get-node.sh
# ============================================================
set -euo pipefail

NODE_VER="22.14.0"
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_DIR="$DIR/node"
mkdir -p "$NODE_DIR"

case "$(uname)" in
  Darwin) NODE_TAR="node-v${NODE_VER}-darwin-x64.tar.gz" ;;
  Linux)  NODE_TAR="node-v${NODE_VER}-linux-x64.tar.xz" ;;
  *) echo "Unsupported platform: $(uname)"; exit 1 ;;
esac
NODE_URL="https://nodejs.org/dist/v${NODE_VER}/${NODE_TAR}"

if [ -x "$NODE_DIR/bin/node" ]; then
  echo "Node 已存在于 $NODE_DIR，跳过下载"
  exit 0
fi

echo "Downloading $NODE_URL ..."
TMP="$(mktemp -d)"
curl -fSL "$NODE_URL" -o "$TMP/$NODE_TAR"
echo "Extracting to $NODE_DIR ..."
mkdir -p "$TMP/extract"
tar -xf "$TMP/$NODE_TAR" -C "$TMP/extract" --strip-components=1
cp -R "$TMP/extract/." "$NODE_DIR/"
rm -rf "$TMP"
chmod +x "$NODE_DIR/bin/node" 2>/dev/null || true
echo "Node v${NODE_VER} 已安装到 $NODE_DIR"
