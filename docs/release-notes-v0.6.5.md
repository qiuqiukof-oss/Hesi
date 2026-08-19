# Hesi v0.6.5

聚焦「历史 Plan 面板可见性根因修复」与「CLI Agent 上下文注入的硬编码清除 + 遗留段清理」，均为低风险、高确定性的打磨。

## 🐞 修复

### 历史 Plan 面板「点击无反应」——命中 flexbox 根因
- **现象**：点「📚 历史 Plan」滚动条动一下，但面板空白、列表不可见。
- **根因**：`.plan-embed-body` 是 `display:flex; flex-direction:column; overflow-y:auto` 的滚动容器；历史面板 `.pd-history` 带 `overflow:hidden` 且默认 `flex-shrink:1`。按 CSS 规范，flex 子项 `overflow!=visible` 时其 `min-height:auto` 解析为 **0**，内容溢出时被收缩算法压扁到 0 高度（实测 clientH:0、208px 内容被裁、仅剩 1px 边框）；此时 `scrollIntoView` 认为元素顶边已在视口内 → 拒绝滚动 → 表现为「滚动条到底了但什么都没有」。
- **修复**：`public/css/plan-drawer.css` 给 `.pd-history` 加 `flex-shrink:0`，面板恢复自然内容高（实测 210px），列表完整可见。
- 辅助：`_openHistory` 增加按钮 `.active` 高亮；`_openHistory` + `_loadHistory`（异步渲染后）双次 `scrollIntoView`，确保面板完整进入视口。

## 🔧 改进

### 消除 CLI Agent 注入提示词的硬编码端口
- `lib/hesi-capabilities.js` 移除写死的 `url: 'http://127.0.0.1:4264'`，改为 `resolveHesiUrl()` 运行时读取 `process.env.PORT`（兜底 4264），与 `ensure-agent-config.js` / `server.js` 端口口径一致。修复了「用户改 PORT 后注入给 CLI Agent 的 URL 仍是错端口」的问题。

### 清理 AGENTS.md 中 CLI-Q → Hesi 改名遗留段
- `lib/ensure-agent-config.js` 在写 Hesi 上下文段时，幂等移除改名前遗留的 `<!-- CLI-Q context ... -->` 段（无活写入者，不会拉锯；只删标记包裹部分，绝不碰用户内容）。消除每次会话约 1.5KB 的重复 token 与「你正运行在 X 中」自相矛盾。

## 📦 依赖
- 同步 `package-lock.json` 版本元数据；传递依赖 `@hono/node-server` 解析为 `2.0.12`（父包范围 `^1.19.9 || ^2.0.5`，语义化版本合法，即当前已运行/验证的状态）。

## ✅ 验证
- Plan B dry-run：`PORT=5000` 注入含 5000、无 4264 残留；无 PORT 兜底 4264。
- Plan A：生成器清理后 AGENTS.md 仅剩 Hesi 单段，CLAUDE.md 未受影响，二次运行幂等（「已是最新，跳过写入」）。
- 历史面板：浏览器（CDP）实测 `flex-shrink:0` 后面板 h:210、完全在视口内、列表正常渲染。
- ESLint 改动文件 0 error。
