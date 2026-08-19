# Hesi v0.6.6 Release Notes

## 修复（Regression Fix）
- **AI 讨论面板的 CLI Agent 检测失败**：圆桌/讨论控件在 `bundle.js` 同步升级 `<chat-panel>` 时触发 `connectedCallback`，而 `partner-store.js` 是 `index.html` 中后续的 `<script>` 标签，此刻 `window.PartnerStore` 仍为 `undefined`；原代码直接 `_noAgents = true` 永久退出，导致 AI 讨论面板永远显示「未安装 Agent · 点击安装」，而右侧抽屉（在 defer 的 `lazy-bundle.js` 中）正常。
  - 改为照 `chat-panel._initMemory()` 的成熟模式：用 `getPS()` 动态取 `PartnerStore`、不再捕获可能为 undefined 的闭包值，并以 30ms 短轮询（最多 5s）等待 `PartnerStore` 就绪后再装配渲染 + 订阅。
  - 修复文件：`public/components/chat/discuss-controls.js`，产物 `public/bundle.js`（经 `npm run build:main` 重建）。
  - 验证：`/api/agents` 返回 OpenCode `installed:true` 数据源正常；ESLint 0 error/0 warning。

## 顺带说明（非本次引入）
- v0.6.5 已包含：历史 Plan 面板 `flex-shrink:0` 根因修复、CLI Agent 注入 URL 端口动态化、AGENTS.md CLI-Q 遗留段清理。
- 传递依赖 `@hono/node-server` 解析为 2.0.12（父包范围 `^1.19.9 || ^2.0.5`，semver 合法），如需 pin 回 1.x 另议。

## 升级提示
- 直接拉取 `main` 分支或下载 Release 产物即可；服务默认端口 4264，离线运行。
