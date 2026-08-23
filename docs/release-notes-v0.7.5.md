# Hesi v0.7.5 发布说明

> 发布日期：2026-08-03
> 基础版本：v0.7.4-fix（e28586e）
> 包含提交：单次提交（基于 v0.7.4-fix 之上，push 后于 GitHub 查看）

## 核心功能

### 1. 全站主题跟随（独立页面 + 插件页 + 持久化修复）
- **主题持久化修复（致命）**：`uiStore.getSavedTheme()` 旧实现只认 `light`/`dark`，把 `qcli-theme` 中的自定义主题 id（xuan / quiet / xuanye / cyber）回落成 `dark`；配合 `createStore.subscribe` 订阅即回写，导致**主应用加载瞬间把自定义主题覆盖成 dark** → 表现为主应用「设置主题后刷新即恢复默认」，且所有独立页面永远读不到自定义配色。改为经 `isValidTheme()` 保留完整 id，仅无值时按系统明暗回落。
- **独立页面跟随 6 主题**：新增零依赖注入器 `public/lib/standalone-theme.js`（同步写入 `data-theme`+`data-scheme` 到 `<html>`，并监听跨标签页 `storage` 事件实时跟随）。文档画廊 `gallery.html` 原是自包含配色页（未链 `theme.css`、私有变量只在 light/dark 定义、JS 把自定义 id 回落成明暗），现已补链 `theme.css` 并将私有变量别名映射到 Hesi 令牌、`getTheme()` 跟随完整 id；预算管理 / 图表模板 / 插件广场 / workbuddy 广场 / tools 等 token 驱动页自动跟随。
- **私有配色页（admin / blackboard / onboarding-guide / plugin-market）**：补链 `theme.css`，私有变量别名映射到 Hesi 令牌，删除旧 `light/dark` 覆盖块 → 6 主题全跟随。
- **Agnes 工作台跟随 + 拖拽卡顿修复**：`style.css` 显式映射 6 套 `[data-theme]`（含强调色与渐变，默认 `:root` 即暗色品牌）；`.sidebar`/`.settings-panel` 的 `backdrop-filter: blur(20px)` 降到 `blur(10px)`，并加 `body.is-interacting` 守卫（`pointerdown`/`resize` 期间临时关闭毛玻璃）→ 拖拽 / 缩放迟滞消除（黑板、围炉无 blur 故本就顺滑）。

### 2. 多 Agent 黑板排版协调
- 标题色 `#3a4048`、角色标签 `#eef3fb`、日志分隔线 `#eef0f2` 三处硬编码改为 `var(--text-primary)` / `var(--bg-hover)` / `var(--border-subtle)`，随主题统一，消除「排版不协调」。

### 3. CLI 关闭红字收敛（前序遗留，一并入版）
- `ws-router.js` 将 `[Process exited with code -1073741510]` 等退出红字收敛为中性提示，不再泄漏到其它已打开的 CLI 标签页导致轻微错位。

## 验证状态
- ESLint 改动文件 0 error；`npm run check:server` 242 文件通过；注入器 Node 模拟测试 PASS（`qcli-theme=cyber` → `data-theme=cyber/data-scheme=dark`；主应用切 `xuan` 经 `storage` 事件实时变 `xuan/light`）。
- 宿主机实测：主应用设主题后刷新保留；文档画廊 / 预算管理 / 图表模板 / 多 Agent 黑板 / 插件广场 / workbuddy 广场 / Agnes 均随宣纸·玄夜·深空整套换肤；Agnes 拖拽 / 缩放顺滑。

## 备注
- 本次为 v0.7.4-fix 之上的功能增强 + 致命持久化修复，按 v0.7.5 发布。
