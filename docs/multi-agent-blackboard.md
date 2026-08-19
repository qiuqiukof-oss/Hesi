# 多 Agent 协作：共享黑板 + 角色 + 隔离恢复

> Phase 1（0.4 地基）。零新依赖，全部构建在既有 `workflow_*` / `agent_*` 工具之上。

## 共享黑板（Shared Blackboard）

多个子 Agent / workflow 步骤读写同一份结构化状态，替代"靠聊天记录传关键信息"。

- 存储：`data/blackboard/<projectId>.json`（`data/` 已在 .gitignore，不入库）
- 结构：`{ projectId, version, status, files, tasks, roles, logs }`
- 并发安全：进程内异步锁 + 原子写；**乐观锁**（`expectedVersion` / `expectedChecksums`）冲突显式报错，绝不静默覆盖

### AI 工具

| 工具 | 作用 |
|---|---|
| `blackboard_read` | 读当前状态（动作前先读） |
| `blackboard_patch` | 字段级合并更新（动作后写回；可带乐观锁） |
| `blackboard_write` | 全量初始化/重置 |

协议约定：**动作前 `read`、动作后 `patch`**；冲突时收到 `BlackboardConflict` 提示，重新 read 后合并重试。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HESI_BLACKBOARD_DIR` | `data/blackboard` | 黑板存储目录 |
| `HESI_BLACKBOARD_GIT` | 关 | `=1` 且本机有 git 时，每次 patch 后提交快照（失败静默降级） |

## 角色（Dynamic Roles）

`agent_delegate` / `agent_start` / `workflow_start` 任务定义支持可选 `role`：
`coder` / `debugger` / `reviewer` / `tester` / `deployer`。

- 角色 = system 片段 + 工具引导（软约束），注入子 Agent prompt，不改主聊天
- **失败自动转岗**：workflow 步骤失败且还有重试额度时，有角色的任务自动转岗
  `debugger` 重试（如 coder→debugger）；无角色任务行为完全不变

## Workflow 黑板同步（颗粒度状态同步）

workflow 仅在 **start / done / error** 三个关键节点自动 patch 黑板（事件驱动，防状态爆炸）：

- 开始：task→`in_progress` + 登记 assignee/role，声明的 `files` →`in_progress`
- 完成：task→`done`，`files`→`done` + 产出短哈希
- 失败：重试中→`retrying`（+转岗），耗尽→`failed` + `lastError`，`files`→`failed`

同步是 best-effort：黑板写失败只记日志、绝不阻断工作流。并行任务各自只 patch
自己的 task/files 键（字段级合并），互不覆盖（隔离性）。

`workflow_start` 新增可选参数：
- 任务级：`role`、`files`（该任务负责的文件路径数组）
- 工作流级：`projectId`（黑板 ID，默认 `default`）

## 可视化面板

浏览器打开 `http://127.0.0.1:4264/blackboard.html`（支持 `?projectId=xxx`）：

- 任务看板 / 文件状态网格 / 角色分配 / 依赖 DAG（mermaid）/ 活动日志
- 2.5s 轻量轮询（`?since=version` 未变不重渲染），页面隐藏自动暂停
- 只读观测：后端仅 `GET /api/blackboard/:projectId`，面板不影响协作逻辑
- mermaid 走多 CDN 回退，离线时 DAG 降级为文本依赖列表

## 相关文件

- `lib/blackboard.js` / `lib/agent-roles.js`
- `routes/ai-tools/builtin/blackboard.js`（工具）
- `routes/ai-tools/workflow-manager.js`（步骤钩子）
- `routes/blackboard.js` + `public/blackboard.html`（观测面板）
- 测试：`test/blackboard*.test.js`、`test/agent-roles.test.js`、`test/workflow-blackboard.test.js`
