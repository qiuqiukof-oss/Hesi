# Hesi v0.7.6 发布说明

> 发布日期：2026-08-03
> 标签：`v0.7.6`（Latest 候选）
> 仓库：qiuqiukof-oss/Hesi

## 核心变更

### 1. Qwen 推理强度双拓扑修复
**问题**：Agnes / 主应用里把 Qwen3 系列设为「深度」推理档时，旧实现向请求体塞了 `reasoning_effort`——该参数对 Qwen 系列**非法**，被 OpenAI 兼容后端（DashScope / vLLM / LM Studio）直接忽略，结果是「深度」档**伪生效**，本地部署甚至连思考都开不起来。

**修复**：
- 云端 Qwen（`dashscope.aliyuncs.com` 等）：请求体顶层注入 `enable_thinking: true/false` + `thinking_budget: N`。
- 本地 Qwen（`localhost` / `127.0.0.1` / `192.168.*` / `10.*` / `172.16-31.*` / `[::1]`）：用 `chat_template_kwargs` 包裹（llama.cpp / vLLM / LM Studio 的 OpenAI 兼容接口认的位置）。
- `thinking_budget` 受 `max_tokens - 1024` 夹断，本地默认 **8192** / 云端默认 **16000**，env `HESI_QWEN_THINKING_BUDGET_DEEP` 可覆盖。
- 修补 IPv6 回环边界：`http://[::1]:1234` 形式正确识别为本地，避免本地服务误走云端顶层格式而 400。
- 非 Qwen 推理模型（o-series / Claude / deepseek）逻辑**不受影响**。

### 2. Agnes 设置持久化三处修复（均为真实 bug）
- **B（致命）**：「清除所有数据」按钮原用 `localStorage.clear()` 清空整个 origin，会误删主应用主题 `qcli-theme`、侧栏、隐藏 tab 等所有设置。改为仅定向删除 `agnes_*` 前缀的 5 个 key。
- **C（致命）**：后端 `saveConfig` 写盘失败被空 catch 吞掉、POST 仍返 `{ok:true}`。现改为写入失败回 500 并带错误体；前端保存失败弹「设置保存失败」toast。
- **A（体验）**：改了设置没点「保存设置」就刷新 / 关窗，之前毫无提示，易误以为不持久。新增脏标记 + `beforeunload` 弹「离开此页？」确认。

### 3. Agnes 工作台丝滑
**根因**：Agnes 是 `window.open` 弹出的独立窗口，拖拽窗口边缘是浏览器原生行为、**不向页面派发 `pointer` 事件**，上一轮加的 `is-interacting` 守卫因此完全失效；真正卡的是 `.sidebar` 的 `backdrop-filter` 每帧重绘背后的 logo 脉冲 / spinner / 进度条 / 打字机动画。

**修复**（纯 CSS，不依赖 JS）：
- 彻底删除 Agnes 内全部 `backdrop-filter`（侧边栏 + toast + 设置/预览/提示词浮层），保留半透明实色玻璃底 + 边框。
- 新增 hover 抽屉：默认 72px 图标栏，鼠标移入 `width` + ease 平滑展开到 224px 显示文字标签；图标横排左对齐、文字淡入。去模糊后 width 动画成本极低、跟手。
- 侧边栏 `user-select: none` + `touch-action: none`，拖动不再误选中文字出现选择框。
- 清理失效的 `body.is-interacting` 守卫 CSS 段与 index.html 注入脚本（反臃肿）。
- 移动端 `@media (hover:none)` 禁用 hover 展开。

### 4. Agnes 入口收敛（规避窄列冲突）
- Agnes 创作在「Tab 管理」中**默认隐藏**（`UIRegistry` 新增 `defaultHidden` 支持；用户仍可手动打开）。
- **工具箱新增「🎬 Agnes 创作台」独立页面卡片**，点击即全屏独立窗口打开 `/plugin-assets/agnes-ai/web/index.html`——从源头消除「窄右侧栏里嵌 Agnes 触发 hover 抽屉自动弹出」的冲突。

## 验证情况
- `npm run check:server` 242 文件全部通过；改动文件 eslint **0 error**。
- `buildReasoningParams` Node 直测 19 项全 PASS（Qwen 云/本地 deep→各自形态、off→各自形态、standard→null、o3/deepseek 不受影响、各网段/IPv6 判定）。
- 用户实测：Agnes 设置刷新不丢（此前为未点保存）、侧边栏拖拽不再黏滞、拖动无选择框。

## 升级后建议实测
1. 云端 Qwen 设「深度」/「关闭」档，确认思考真正生效 / 关闭。
2. 本地 Qwen（LM Studio / vLLM）设两档，确认生效且不 400（老版本后端若不支持 `chat_template_kwargs` 需反馈）。
3. 点「清除所有数据」后主应用主题保持、Agnes 历史清空。
4. 改设置不保存刷新 → 弹「离开此页？」。
5. 工具箱「Agnes 创作台」卡片打开独立窗口；右栏 Tab 管理默认不含 Agnes（手动可恢复）。

## 风险提示
- 本地老版本推理后端若不支持 `chat_template_kwargs`（如极旧的 vLLM / LM Studio），Qwen 深度档可能返回 400；如遇请反馈后端版本，可降级为顶层 `enable_thinking`。
- `data/plugin-data/agnes-ai/config.json` 含 Agnes API Key 明文，属 `.gitignore` 已忽略的 `data/` 目录，不会随本仓库推送泄露，但本机磁盘可读，注意本机安全。
