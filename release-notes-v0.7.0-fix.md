# v0.7.0-fix — 修复 & 优化包

v0.7.0 发布后的首个修复包：恢复 7 项被搁置的优化 + 修复一批实际使用中发现的问题。

## ✨ 恢复 7 项优化（此前暂存，现随本版重放）

- **P1-3 Scheduler**：常驻调度器，轮询 `data/pending-plans/` 自动执行排队 Plan
- **P1-4 数据膨胀治理**：plan-outputs 7 天 TTL 自动清理 + 步骤级断点续跑状态
- **P1-5 收敛度分数**：讨论收敛度纯计算指标（Jaccard 相似度 + CONVERGE 早停）
- **P2-6 批判者角色**：圆桌 preset 增加批判者视角
- **P2-7 浏览器隔离**：`withBrowserTask` 生命周期包装器
- **P2-8 集成测试**：HTTP 集成测试（含 WS 故障注入）
- **P2-9 前端 chunk**：lazy bundle ESM 代码分割（圆桌视图按需加载，~26KB chunk）

## 🐛 修复

- **CLI Agent 真实工作目录**：headless 路径（opencode `run`）此前默认落到用户目录
  （`HOME/USERPROFILE`）而非项目目录 —— 已通过进程 spawn cwd 注入根治，删除无效的 prompt cd 提示词
- **附件中文文件名乱码**：busboy 按 latin1 解码 multipart filename → UTF-8 无损转回
- **协作流"停不下来"前置修复**：业务级 error 事件不再触发 reader.cancel（独立页缓存问题一并解决）
- **预算管理独立页无法加载**：lazy-bundle 路径修正（`lazy-chunks/`）+ `type=module`
- **记忆面板误挂独立页**：mount 加宿主守卫（仅主应用页挂载）
- **记忆抽取静默失败**：extractFacts/compactIfNeeded 缺 baseUrl → 本地 LLM 用户 facts/画像永远为空 —— 已加 `HESI_LLM_BASE_URL` 兜底 + 显式传参
- **独立页 bundle 缓存**：budget.html 也走内容 hash 注入（此前 immutable 1 年缓存挡住所有前端修复）

## 🚀 增强

- **缓存命中 / 上下文占用圆环**：放大到 28px，并对 AI 讨论、自动执行生效（此前仅普通回复更新）
- **AI 讨论轮数**：新增「1 轮」选项；`[CONVERGE]` 早停门槛放宽到任何轮次（第 1 轮收敛即停）
- **圆桌皮肤 + CLI Agent 工作目录**：围炉圆桌皮肤修复、`_skins` 全局单例

## 验证

- 测试：discuss / plan-turn / 集成 全部通过（32+ 用例）
- ESLint 0 error
- 服务 HTTP 200，36 CLI 注册，Scheduler 已启用
