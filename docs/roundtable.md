# 围炉圆桌 · 多 Agent 可视化协作

> Phase 2 主线 MVP。把 Phase 1 的「共享黑板 / 多 Agent 讨论（discuss.js）」从纯文本 + 看板，
> 升级为有温度的可视化协作空间：4 个可爱 Agent 围坐一张圆桌，中间是共享桌布，人在上首主持。

## 入口
- 工具箱卡片「🍵 围炉圆桌」→ 打开 `/roundtable.html`（独立页面）。
- 圆桌视图走 **lazy bundle**（`public/lazy-bundle.js`），不进主包，符合「防臃肿」硬指标。

## 核心能力
1. **可视化圆桌**：4 个内联 SVG 萌物（小狐/胖达/博士/查查）+ 顶部「你·主持人」座位 + 中心共享桌布（黑板指标）。
2. **状态机动画**：思考 / 发言 / 工作中 / 完成 / 报错 / 待命（头像边框脉冲/高亮）。
3. **实时闲谈气泡**：讨论过程中每位发言者的当前一句话以气泡浮出。
4. **空座（虚位）**：只选 1–2 个 Agent 时，其余席位显示为空座（虚线描边 + 降透明度 +「空座」标注）；
   提供「显示空座 / 隐藏空座」开关。语义：未被邀请 ≠ 离线。
5. **⚙ 自定义**：逐座编辑 名字 / 角色标签 / 主题色 / 头像（内置 SVG 库 / Emoji / 上传图）；
   覆盖层落 `agent-overrides.json`（已加入 `.gitignore`，随离线包带走、不进仓库）。
6. **抛话题 / 开始讨论**：选择参与 Agent（映射到底层 CLI 工具）+ 输入议题 → 发起 discuss，SSE 实时渲染。
7. **点赞 👍**：每席可点赞，纯前端 gamification。
8. **纪要持久化**：讨论结束自动生成结构化纪要，可「保存到对话」（落 `MemoryStore` 指定会话）+「导出纪要 .md」。
9. **🀄 麻将皮肤**：彩蛋，圆桌变绿、呼应「麻将闲谈」。

## 架构（防膨胀）
- 零新运行时、零新依赖。复用：
  - `routes/chat/discuss.js`（圆桌讨论内核，已支持多 CLI Agent，SSE 推流）—— **只读渲染，不改内核**。
  - `lib/agent-roles.js` / `lib/blackboard.js` / `cli-discovery.js`（`loadRegistry`）。
- 新增仅：
  - 前端 `public/components/agent-avatars.js`（纯逻辑 SVG 萌物 + 状态，可单测）。
  - 前端 `public/components/roundtable.js`（懒加载控制器）。
  - 角色/协议 `routes/ai-tools/workflow-templates/roundtable.json`。
  - 覆盖层 `lib/agent-overrides.js` + 路由 `routes/roundtable.js`
    （`GET /api/roundtable/state` 只读聚合、`POST /api/roundtable/overrides` 存自定义、`POST /api/roundtable/summary` 存纪要）。
- 端点只读不落 `data/`；自定义落 `agent-overrides.json`（非 `data/`）。

## 使用前提
- 圆桌实时讨论需要：① 已配置 AI Key（设置 → AI Key）；② 至少安装 1 个 CLI Agent（opencode/codex 等，工具箱可装）。
- 未装 CLI Agent 时，圆桌仍可正常可视化展示（席位渲染、自定义、空座），只是无法发起实时讨论。

## 已交付 / 待办
- ✅ 圆桌可视化 MVP（S1–S4）、自定义（S3 覆盖层 + ⚙ 模态）、空座、点赞、纪要持久化 + 导出（S5）。
- ⏳ 落座接管（人临时以某 Agent 身份发言）、审批闸（Agent 写操作人工审批）—— 较重，留待后续。
- ⏳ 记忆时间轴（session 时间戳 + 压缩检查点）、黑板 DAG 沿圆桌外环「协作流向」弧线重皮肤 —— S6 后续子项。
- ⏳ 可视化编排拖拽（S7，独立 plan）。

## 验证
- `node --test` 全量通过（含 `test/agent-avatars.test.mjs` 10 用例）。
- `npm run build:lazy` 成功，圆桌代码已打入 `public/lazy-bundle.js`。
- `npx eslint` 新文件 0 error。
