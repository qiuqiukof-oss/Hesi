# Hesi（合思）3 分钟产品演示分镜

> 目标：向开发者 / 企业客户快速展示「浏览器里运行任何 CLI + AI Agent 协作」的核心价值。
> 时长：约 3 分钟，建议配合本地回环部署（`npm start` → `http://127.0.0.1:4264`）。

---

## 分镜 1 · 开箱即用（0:00–0:30）

- 启动 Hesi，浏览器打开终端界面。
- 展示多标签终端：在标签 A 跑 `git status`、标签 B 跑 `docker ps`、标签 C 跑 `python -c "..."`。
- 要点：**xterm.js + WebGL 渲染**、多会话互不干扰、会话持久化（IndexedDB）。

## 分镜 2 · AI × CLI Agent 圆桌（0:30–1:30）

- 点击聊天面板「讨论」按钮，从已发现 CLI Agent（如 opencode / codex）多选 2 个。
- 输入：「帮我把这个脚本重构得更快，并给出理由」。
- 展示：AI 助手与 CLI Agent **多轮交替发言**、逐轮收敛；终端上下文自动喂给 AI。
- 要点：headless 执行（`opencode run` + stdin）从源头杜绝 TUI 渲染污染；环检测防失控。

## 分镜 3 · 任意 CLI + 浏览器控制（1:30–2:15）

- 演示 CLI 自动发现：扫描 PATH，生成快捷启动列表与预设。
- 打开 CDP 浏览器控制：导航到本地页面、截图、执行 JS、表单填表。
- 要点：一个中枢同时管终端与浏览器。

## 分镜 4 · 安全与审计（2:15–2:45）

- 故意输入危险命令（如 `dd if=... of=/dev/...` 或 `rm -rf /`），展示被 `blocklist` 拦截。
- 打开审计：说明所有 PTY 命令、登录、上传、配置变更落盘 `data/audit.jsonl`。
- 要点：统一审计总线、默认回环、最小暴露面（呼应 `governance/COMPLIANCE.md`）。

## 分镜 5 · 离线便携包（2:45–3:00）

- 展示桌面托盘版：**双击 `tray.exe`**（或 `tray.bat` / `tray.sh`）离线即用，自带便携 Node，默认绑定本机回环。
- 收尾语：「Hesi —— 浏览器中的通用终端中枢，运行任何 CLI，连接任何 Agent，控制任何浏览器。」

---

## 演示前检查清单

- [ ] 已 `npm install && npm run build`
- [ ] 已 `npx playwright install chromium`（浏览器控制分镜需要）
- [ ] 已配置一个 LLM Key（圆桌分镜需要 AI）
- [ ] 端口 `4264` 未被占用（或设置 `PORT`）
