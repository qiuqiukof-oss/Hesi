#!/usr/bin/env bash

# Copyright (c) 2026 qiuqiukof-oss
# Licensed under the MIT License. See LICENSE for details.
# ============================================================
# Hesi USB Agent Packager (macOS / Linux)
# Build a portable, offline-capable USB edition ONCE on a machine
# with internet access. Copy the resulting 'hesi' folder to a USB stick
# and run on air-gapped / GFW-affected machines.
#
# Strategy: download portable Node.js + pre-install agents into
# offline-cache/ so the end user's one-click install needs NO network.
#
# Usage:
#   ./package-usb.sh            # 默认：捆绑便携 Node（最省事）
#   ./package-usb.sh --no-node  # 不下载/捆绑 Node，仅写出 README 节点说明 +
#                               #   get-node 脚本；放置 Node 后 start.sh 才能启动
#
# S1 依赖审计（server.js / mcp-server.js / routes 的 require）：
#   运行必需目录 = routes public lib scripts ws mcp plugins cli-presets
#                  workflows agents-src packaging vendor
#   （vendor/connectors 为离线连接器市场主源，routes/workbuddy-hub.js 直接 require）
# ============================================================
set -euo pipefail

NODE_VER="22.14.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/hesi"
NODE_DIR="$OUT/node"
CACHE="$OUT/offline-cache"

# --no-node 开关
NO_NODE=0
if [ "${1:-}" = "--no-node" ]; then NO_NODE=1; fi

echo "[1/8] Preparing output directory: $OUT"
[ -d "$OUT" ] && { echo "  - existing hesi detected, removing stale build..."; rm -rf "$OUT"; }
mkdir -p "$OUT" "$NODE_DIR" "$CACHE"

echo "[2/8] Copying app source into $OUT ..."
# S2 补齐运行必需目录（旧脚本漏 ws/mcp/plugins/cli-presets/workflows/vendor → 包起不来）
for d in routes public lib scripts ws mcp plugins cli-presets workflows agents-src packaging vendor; do
  [ -d "$ROOT/$d" ] && cp -R "$ROOT/$d" "$OUT/"
done
for f in server.js package.json package-lock.json .env.example README.md; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$OUT/"
done
# get-node 脚本放到产物根目录（README 引用 ./get-node.sh）
[ -f "$ROOT/scripts/get-node.sh" ] && cp "$ROOT/scripts/get-node.sh" "$OUT/" && chmod +x "$OUT/get-node.sh"
[ -f "$ROOT/scripts/get-node.bat" ] && cp "$ROOT/scripts/get-node.bat" "$OUT/"
# 排除项（防御性清理，避免误带运行态/密钥/缓存）
rm -rf "$OUT/.workbuddy" "$OUT/data" "$OUT/uploads" "$OUT/backups" "$OUT/.env" "$OUT/.mcp.json" 2>/dev/null || true

echo "[3/8] Portable Node.js (${NODE_VER}) ..."
if [ "$NO_NODE" = "1" ]; then
  echo "  - --no-node 模式：跳过 Node 下载（请运行 ./get-node.sh 或见 README 节点节）"
else
  case "$(uname)" in
    Darwin) NODE_TAR="node-v${NODE_VER}-darwin-x64.tar.gz" ;;
    Linux)  NODE_TAR="node-v${NODE_VER}-linux-x64.tar.xz" ;;
    *) echo "Unsupported platform: $(uname)"; exit 1 ;;
  esac
  NODE_URL="https://nodejs.org/dist/v${NODE_VER}/${NODE_TAR}"
  if [ -x "$NODE_DIR/bin/node" ]; then
    echo "  - already present, skip download"
  else
    echo "  - downloading $NODE_URL"
    TMP="$(mktemp -d)"
    curl -fSL "$NODE_URL" -o "$TMP/$NODE_TAR"
    echo "  - extracting to $NODE_DIR"
    mkdir -p "$TMP/extract"
    tar -xf "$TMP/$NODE_TAR" -C "$TMP/extract" --strip-components=1
    cp -R "$TMP/extract/." "$NODE_DIR/"
    rm -rf "$TMP"
    chmod +x "$NODE_DIR/bin/node" 2>/dev/null || true
  fi
fi

# 选择可用的 npm（捆绑 Node 优先，否则本机 system node）
NPM=""
if [ -x "$NODE_DIR/bin/npm" ]; then
  NPM="$NODE_DIR/bin/npm"
elif command -v npm >/dev/null 2>&1; then
  NPM="npm"
fi

if [ "$NO_NODE" = "1" ] && [ -z "$NPM" ]; then
  echo "[4-5/8] 跳过依赖安装与前端构建（--no-node 且本机无 Node）。"
  echo "        放置 Node 后请执行：cd hesi && ./get-node.sh && npm ci && npm run build"
else
  echo "[4/8] Installing Hesi dependencies (portable npm) ..."
  if [ -f "$OUT/package-lock.json" ]; then
    "$NPM" ci --prefix "$OUT" || "$NPM" install --prefix "$OUT"
  else
    "$NPM" install --prefix "$OUT"
  fi

  echo "[5/8] Building frontend bundle (public/bundle.js) ..."
  "$NPM" --prefix "$OUT" run build || echo "  - build failed, check esbuild"
fi

echo "[6/8] Pre-installing agents into offline-cache (offline one-click later) ..."
if [ -n "$NPM" ]; then
  NODE_BIN="$NODE_DIR/bin/node"
  [ -x "$NODE_BIN" ] || NODE_BIN="node"
  "$NODE_BIN" "$OUT/scripts/build-offline-cache.js" --out "$CACHE" --npm "$NPM" || echo "  - offline-cache 构建失败（可选项，不影响 Hesi 本体）"
else
  echo "  - 跳过：无 Node（--no-node 且本机无 node）"
fi

echo "[7/8] Generating launcher scripts ..."
# S5 启动器缺 Node 检测
cat > "$OUT/start.sh" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -x "$DIR/node/bin/node" ] && ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node（hesi/node/ 不存在）。"
  echo "请先运行 ./get-node.sh 获取便携 Node，或见 README.md 节点节手动放置 Node 到 hesi/node/。"
  exit 1
fi
NODE_BIN="$DIR/node/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="node"
export QCLI_PORTABLE="$DIR"
export PATH="$(dirname "$NODE_BIN"):$PATH"
"$NODE_BIN" "$DIR/server.js"
EOF

cat > "$OUT/opencode.sh" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export QCLI_PORTABLE="$DIR"
export PATH="$DIR/node/bin:$PATH"
"$DIR/offline-cache/opencode/bin/opencode" "$@"
EOF

cat > "$OUT/oma.sh" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export QCLI_PORTABLE="$DIR"
export PATH="$DIR/node/bin:$PATH"
"$DIR/offline-cache/ohmyopenagent/bin/oma" "$@"
EOF

cat > "$OUT/codex.sh" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export QCLI_PORTABLE="$DIR"
export PATH="$DIR/node/bin:$PATH"
"$DIR/offline-cache/codex/bin/codex" "$@"
EOF
chmod +x "$OUT/start.sh" "$OUT/opencode.sh" "$OUT/oma.sh" "$OUT/codex.sh"

echo "[8/8] Generating README + config template ..."
# S4 README 节点节
cat > "$OUT/README.md" <<EOF
# Hesi 便携版（离线可用）

本目录是可离线运行的 Hesi。把整个 \`hesi/\` 复制到 U 盘或目标机即可。

## 启动
\`\`\`bash
./start.sh        # macOS / Linux
start.bat         # Windows
\`\`\`
浏览器打开 http://127.0.0.1:4264 。

## 便携 Node 说明
$([ "$NO_NODE" = "1" ] && echo "本包为 **--no-node** 构建，**未捆绑 Node**。请二选一：
1. 运行 \`./get-node.sh\`（Windows: \`get-node.bat\`）自动下载便携 Node 到 \`hesi/node/\`；
2. 或自行下载 Node v${NODE_VER}（见下）解压到 \`hesi/node/\`。" || echo "本包已捆绑便携 Node v${NODE_VER}，开箱即用。如需重装 Node，可运行 \`./get-node.sh\`。")

### 手动获取 Node
- 下载地址：https://nodejs.org/dist/v${NODE_VER}/
  - Windows: \`node-v${NODE_VER}-win-x64.zip\`
  - macOS:   \`node-v${NODE_VER}-darwin-x64.tar.gz\`
  - Linux:   \`node-v${NODE_VER}-linux-x64.tar.xz\`
- 解压后把内容放到 \`hesi/node/\`（使 \`hesi/node/bin/node\` 或 \`hesi/node/node.exe\` 存在）。

## 配置
复制 \`.env.example\` 为 \`.env\` 并填入密钥（可选）。

## 离线连接器
连接器市场主源位于 \`vendor/connectors/\`，离线可直接导入，无需联网。
EOF

[ -f "$OUT/.env" ] || [ -f "$ROOT/.env.example" ] && cp "$ROOT/.env.example" "$OUT/.env" 2>/dev/null || true

echo
echo "Done. Copy the entire '$OUT' folder to a USB stick."
echo "On the target machine, run ./start.sh (no sudo required)."
echo "Open http://127.0.0.1:4264 — the welcome page shows one-click install"
echo "that uses the offline-cache (no internet needed)."
