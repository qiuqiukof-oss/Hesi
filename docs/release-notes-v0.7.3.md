# v0.7.3 — Plan 步骤气泡化 + 思考状态流光 + 滚动小贴士

> 基于 `v0.7.2`，共 8 个 commit。全部经球总宿主机实测通过。
> 关联设计文档：`.workbuddy/深度思考检测+透传-设计方案.md`（下个版本处理）

## 🫧 Plan 步骤并入对话时间线（P1 + P2）

- **P2 气泡视觉统一**（`4d71265`）：新增独立 `chat-bubble.css` 语义色条层，统一左右/系统气泡；
  去 3 处 JS 硬编码颜色（审批锁/错误头像/cwd chip）。
- **P1 步骤气泡化**（`e192ee4`）：「⚡ 自动执行」聚合卡片拆分为**顶部总览条**（i/N 进度 + 完成度填充）
  + **每步独立气泡**，与讨论/审批气泡共享同一时间线，消除"钉在原地/弹浮窗"的割裂感；
  拆出 `plan-step-bubble.js` 步骤状态机，autoReplan 追加步自动入列。

## 🐢 脚本路径误判修复（P3）

- **`2194057`**：`isPossibleCommand()` 现识别 `.sh/.bash/.bat/.cmd/.ps1` 裸路径 → 走 Track A 真执行
  （0 token、不进 LLM 工具循环）。实测 `/tmp/jwt-demo-verify/test.sh` 因无 shell 元字符且未命中
  `KNOWN_BASE`，原被误判为自然语言、走 Track B「Maximum tool call rounds reached」卡 279s；现已秒级完成。
  `plan-from-nl.js` 追加规则：调用脚本须写 `bash <path>`/`node <path>`，禁止裸路径。

## ✨ 思考/处理态观感

- **字幕流光**（`90f157c`）：`.thinking-title`/`.thinking-status`/运行步骤态加 text-clip 扫光
  （复用项目既有 og-shimmer 手法），不套流式正文；`prefers-reduced-motion` 下自动关闭。
- **状态条沉底 + 去冗余 Token 行**（`fc201a4`）：「深度思考中/生成回复中/✅ 完成」状态条从气泡顶部
  移到**底部**，流式内容增长时始终可见；移除每条消息末尾冗余的「— Tokens: …」行（会话级信息已由提示环统一展示）。
- **滚动小贴士**（`95e08f0` + `9f2873f` + `c437240`）：生成回复时底部状态条循环展示短提示，
  从 12 条扩到 31 条（功能用法 / 提示词技巧 / 注意要点三类）；并改为紧跟状态文字、不独占一行。

## 验证

- ESLint 改动文件 0 error（仅既有 warning）
- `npm run check:server` 241 文件语法通过
- `build:main` bundle 重建（~1005kb）
- 球总宿主机实测：P1/P2/P3 三项功能 + 字幕流光 + 状态条沉底 + 滚动小贴士均通过

## 待下版本

- **深度思考（推理模型）检测 + 透传**：当前主聊链路丢弃 `reasoning_content`，推理模型思考流不可见；
  设计方案见 `.workbuddy/深度思考检测+透传-设计方案.md`（L1 透传 thinking 流 → L2 真标签 → L3 强度调节）。
- 整体美化版本（气泡再设计：头像圆圈 / 状态 pill / 审批闸内联按钮）待立项。
