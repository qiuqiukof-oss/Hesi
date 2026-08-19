# Hesi U盘智能体 · 打包与分发说明

把 **Hesi + OpenCode + OhMyOpenAgent** 做成一个「插上即用」的 U 盘智能体：
新手和开发者都能在**不联网、不被墙**的情况下，直接上手 AI 智能体。

---

## 1. 核心思路：构建一次，离线分发

U 盘智能体的关键是**在联网机器上构建一次**，把运行所需的一切（便携 Node.js + 依赖 + 智能体安装包）全部塞进一个目录，然后整目录拷到 U 盘。最终用户拿到 U 盘后**全程离线**即可使用。

| 阶段 | 在哪运行 | 是否需要网络 |
|------|----------|--------------|
| 打包（`scripts/package-usb.*`） | 一台能联网的机器 | **需要**（下载 Node 与 npm 包） |
| 使用（双击 `start.*`） | 任意目标机（含离线 / 被墙环境） | **不需要** |

这正是规避 GFW 的办法：墙只在「构建 U 盘」这一步起作用，且可在一台通畅的机器上完成；分发后的 U 盘本身零网络依赖。

---

## 2. 一键安装如何离线工作

欢迎页的「AI 智能体（一键安装）」调用后端 `POST /api/agents/install/:agentId`。
安装逻辑按优先级自动选择（见 `routes/agent-install.js`）：

1. **离线缓存优先**：若 `offline-cache/<agentId>/` 存在 → 直接复制到 `agents/<agentId>/`，**零网络**。
2. **便携 Node**：若 `node/npm.*` 存在 → 用便携 npm 安装（离线环境仍可工作）。
3. **系统 npm**：否则用 PATH 中的 npm 安装（需要网络）。
4. **演示模式**：`QCLI_INSTALL_DRYRUN=1` 或 `spec.simulate` → 仅走进度管线，不触发任何下载（用于验证 UI / 无网环境演示）。

打包脚本第 5 步（`build-offline-cache.js`）把三个智能体预装进 `offline-cache/`：

| 智能体 | 安装方式 | 来源 | bin |
|--------|----------|------|-----|
| OpenCode | npm 包 | `opencode-ai`（原生 `.exe`，**直接运行，不套 node**） | `opencode` |
| OhMyOpenAgent | 本地源码 | `agents-src/ohmyopenagent`（无需 npm registry） | `oma` |
| Codex | npm 包 | `@openai/codex` | `codex` |

> 注意：启动器生成逻辑（`lib/agent-launcher.js`）会**自动检测原生二进制（PE/ELF）与 Node 脚本**，
> 原生二进制直接执行、Node 脚本才用便携/系统 `node` 运行——避免把 `opencode.exe` 当 Node 脚本跑而报错。
> 本地源码类智能体（`method: 'copy'`）通过 `npm install <本地路径>` 安装，npm 会建立
> junction/软链，`copyDir` 已处理跟随符号链接（`fs.statSync` 跟随）。

因此最终用户点「⚡ 一键安装」时走的是第 1 条（离线缓存复制），完全离线。

---

## 3. 打包步骤

### Windows
```bat
scripts\package-usb.bat
```
产物在 `hesi\`：含便携 Node（`hesi\node\`）、依赖（`hesi\node_modules\`）、前端 `public\bundle.js`、
`offline-cache\`（三个智能体已预装）、以及 `start.bat` / `opencode.bat` / `oma.bat` / `codex.bat` 启动器。

### macOS / Linux
```bash
bash scripts/package-usb.sh
```
产物同样在 `hesi/`，提供 `start.sh` / `opencode.sh` / `oma.sh` / `codex.sh`（并下载对应平台的便携 Node）。

打包完成后，把 `hesi\` 整个目录复制到 U 盘根目录即可。

---

## 4. 目标机使用

1. 插入 U 盘，进入 `hesi\` 目录。
2. 双击 `start.bat`（Windows）或运行 `./start.sh`（macOS/Linux）。**无需管理员权限**。
3. 浏览器打开 `http://127.0.0.1:4264`。
4. 欢迎页 Slide 0 的「AI 智能体（一键安装）」：
   - 已离线预装的智能体直接显示 ✅ 版本号；
   - 未安装的点击「⚡ 一键安装」，从 `offline-cache` 复制，进度实时可见；
   - 安装完成后即可在左侧 **Agent 面板** 启动 OpenCode / OhMyOpenAgent 进行多 Agent 编排。

> ⚠️ **杀软提示**：首次运行 `start.bat` 可能被 Windows Defender 报「未签名脚本」。
> 这是正常的——脚本仅启动本地 Node 服务。如被拦截，请将 `hesi\` 目录加入 Defender 白名单。

---

## 5. 自定义：增加更多可安装智能体

编辑 `routes/agent-install.js` 的 `INSTALL_REGISTRY`：

```js
myagent: {
  displayName: 'MyAgent',
  icon: '🛠️',
  category: 'agent',
  desc: '说明',
  method: 'npm-global',          // npm 包：npm-global / npm-local
  npmPackage: 'my-agent-cli',    // npm 包名（opencode 实际是 opencode-ai）
  binName: 'myagent',
  targetDir: 'agents/myagent',
  offlineCache: 'offline-cache/myagent',
  pinnedVersion: '1.2.3',
  featured: true,               // true = 在欢迎页展示
}
```

自有框架（无 npm 包，从本地源码装）用 `method: 'copy'` + `sourceDir`：

```js
myframework: {
  displayName: 'MyFramework',
  icon: '🧩',
  category: 'agent',
  desc: '我的多 Agent 框架',
  method: 'copy',                // 从本地源码安装，无需 npm registry
  sourceDir: 'agents-src/myframework',
  binName: 'mf',
  targetDir: 'agents/myframework',
  offlineCache: 'offline-cache/myframework',
  pinnedVersion: '0.1.0',
  featured: true,
}
```

然后运行 `node scripts/build-offline-cache.js myframework`（或重新执行 `package-usb.*`）把它预装进 `offline-cache/`。

---

## 6. 安全说明

- 服务器默认仅绑定回环地址（`127.0.0.1` + `::1`），不暴露到局域网。
- 一键安装端点只接受 `INSTALL_REGISTRY` 白名单内的 `agentId`，**杜绝任意命令执行**。
- 如需在局域网共享，设置 `QCLI_ACCESS_TOKEN` 并配合 `HOST=0.0.0.0`（仅限可信网络）。
