# Hesi v0.7.0 · 全自动协作工作流

> 🎯 核心交付：AI 助手 + CLI Agent 多智能体协作——从讨论到交付，一条指令从头跑到底。

---

## 协作工作流（P6）

💬+⚡ 同时勾选 = 全自动闭环：

```
💬 AI 讨论（目标分析）→ 📋 总结 → 方案制定
→ 💬 AI 讨论（方案审查）→ 📋 总结 → 实施
→ 💬 AI 讨论（结果审核）→ 📋 总结 → 报告
```

- AI 助手与 CLI Agent 按回合讨论，checkpoint 步自动触发局部讨论
- 讨论结论注入 Plan 生成器，方案随讨论上下文动态修正
- 执行成功自动跳过审核；失败时一轮快速复盘
- 讨论轮数可通过 UI 控件自定义
- `plan-turn.js` 内建 2min 超时保护，讨论失败不阻塞 Plan 生成

## 审批闸对话化（P4-2）

- 审批不再弹 modal——改为**聊天线程内联气泡**（✅ 通过 / ⛔ 驳回）
- 共享审批登记表 `lib/plan-approval.js`，SSE 与 WS 两条链路统一
- HTTP 端点 `/api/plan/:execId/approve|reject` 契约不变

## plan-git 彻底去分支（P4-1 · 根治 P0 数据丢失）

- `snapshotStep` 改用 `git stash create`（悬空 commit，不切分支、不 `git add -A`、不碰工作树）
- `rollbackTo` 仅复原被跟踪文件，**未跟踪文件永不删除**
- `gcPlanBranches()` 一次性清理历史 `auto-*` 分支
- 跑 Plan 前不再需要 `git stash`——脏工作树安然无恙

## 命令型步骤真流式（P3）

- `execStepDirectly` 改为 `spawn` 异步 + 增量 `onChunk`
- 断开连接即杀子进程（`AbortSignal` → `SIGKILL`）
- 步骤输出逐字节流式推送到前端

## 错误栈保留 & 红色气泡（P4-3）

- 异常捕获附带 `e.stack`，前端红色错误气泡可展开堆栈
- 步骤卡片内也支持 `📋 查看堆栈` 展开

## 输出落盘（P4-4）

- 步骤产出写入 `data/plan-outputs/<execId>-<stepId>.log`
- plan/result JSON 摘要同目录
- `HESI_PLAN_OUTPUT_DIR` 可覆盖，默认 `data/plan-outputs`

## Plan 抽屉移除（P5/P7）

- 996 行的 `plan-drawer.js` 删除；📋 按钮消失
- 全部功能收敛到聊天对话框：讨论 / 执行 / 协作 / 审批 / 历史

## 新手引导

- 追加 ⚡ 协作工作流引导步骤
- AI 设置气泡重新定位

## 修复

- NL 生成器强制禁止 PowerShell 语法（讨论上下文不再污染 Plan）
- `sed` 定界符陷阱提示（路径含 `/` 时改用 `#` 或 `|`）
- AI讨论 + 自动执行不再互斥（三处互斥逻辑拆除）
- `scope_paths` 守卫正确拦截越界路径
- 历史列表字段映射修正

---

## 变更统计

- **86 文件**，+7.5k / -2.4k 行
- 测试全绿 · ESLint 0 error
