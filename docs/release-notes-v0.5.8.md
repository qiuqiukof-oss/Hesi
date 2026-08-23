# Hesi v0.5.8

> 圆桌模板 + Plan 执行审批闸 + 阶段审查机制 + 产权就绪。全量 **138** 测试绿、lint 0 error。

## 🗣️ P2.2 圆桌模板（Roundtable Presets）

预置 4 套协作模板，一键注入圆桌，省去每次手工搭席位 / 写协议：

- **hearth**（围炉闲聊）：轻松多人自由讨论，host 引导收束。
- **pair**（双人辩论）：正反两方固定席位，host 控制轮次与总结。
- **review**（代码 / 方案评审）：评审者 + 作者 + 观察员，结构化给结论。
- **debate**（正式辩论）：立论 → 质询 → 结辩，host 按赛制推进。

实现：模板含 `personas` + `protocol`，经 `runDiscussion → runRoundtable → runCliTurn → buildCliTask` 注入 CLI 任务提示词；前端 `roundtable-view.js` 新增模板下拉，异步拉取详情后填充席位与协议。新增 `GET /api/roundtable/templates` 与 `GET /api/roundtable/templates/:id`。

## 🚦 P2.6 Plan 执行审批闸（Approval Gate）

关键步骤可设 `requireApproval: true`，执行器遇到即**暂停**并广播 WebSocket 事件 `plan:await-approval`，前端弹出闸门卡片，人工 **Approve / Reject** 后才继续；30 分钟超时自动驳回进入回滚反思。

- 后端：`run-plan` 闭环在审批步挂起轮询；`POST /api/plan/:execId/approve`、`/reject` 端点驱动恢复。
- 前端：plan 查看器内闸门卡片 + 状态联动。
- 无浏览器也能验：新增 `scripts/smoke-plan-approval.mjs`（连 `ws://127.0.0.1:3000`，可选 `HESI_SMOKE_URL` 覆盖），自动跑「触发 → 等审批 → 批准 → 校验」全流程。

## 📊 P0.5 阶段审查机制（Audit Acceptance）

新增 plan 验收清单对账脚本 `plans/audit-acceptance.js` + 命令 `plans:audit`，把「计划承诺」与「实际落地」逐条对账，输出已落实 / 未落实 / 待核 / ✅ / 排除目录等结论，支持 `--strict` 模式。配套 6 个单测（用 `PLAN_AUDIT_DIR` 隔离）。

## 🪟 P0.1 应用层 P3（首屏可观测 + 错误边界）

- 首屏 `first-paint` 埋点，量化启动到可交互耗时。
- 全局 UI 错误边界（error-boundary），单点组件崩溃不再拖垮整页。
- onboarding 引导逻辑抽出纯函数，配套 8 个单测。

## 🧭 新手指南：接入你的大模型（气泡）

在「新手指南」coachmark 流程中新增一步，指向右上角 🤖 **AI 设置**，引导新人：
- 粘贴云端 API Key，或填本地 `Base URL`（Ollama 用 `http://localhost:11434/v1`）；
- 也可直接设环境变量 `OPENAI_API_KEY`。

（早期误放到 AI 设置弹窗内、又误做成欢迎幻灯片整页，均已撤回，最终落在「新手指南」气泡，符合引导新人「如何加自己的大模型」的初衷。）

## 🔌 Agnes 插件设置持久化修复

修复 Agnes 插件 API Key / 模型 / 温度等设置**重启即丢失**：
- `GET /api/plugins/agnes-ai/config` 原只回打码 key → 现回真实 key + 6 个偏好字段；
- `POST` 原只存 key + base_url → 现全量持久化到 `data/plugin-data/agnes-ai/config.json`；
- 新增 `DELETE /api/plugins/agnes-ai/config` 一键清空。配套 5 个单测（`AGNES_CONFIG_DIR` 隔离）。

## ⚖️ 商业化产权就绪（IP-audit）

- 为约 588 个原创源文件幂等加入 `Copyright (c) 2026 qiuqiukof-oss / MIT` 标准版权头（保留 shebang；排除 node_modules / 生成产物 / data / .workbuddy 及第三方派生连接器）。
- `LICENSE` 版权署名由 `Hesi Contributors` 改为 **qiuqiukof-oss**（MIT 不变）。
- 新增三份法务文档（公开透明，如实披露残留风险）：
  - `AUDIT-REPORT.md`：全仓侵权 / 产权审计结论与局限；
  - `DEVELOPMENT-PROVENANCE.md`：权属主张 + 「人类主导 + AI 辅助」著作权依据 + git 证据；
  - `THIRD-PARTY-LICENSES.md`：依赖与 vendor 第三方许可索引。
- ⚠️ 审计如实标注两项需人工 / 法务决策的残留风险：**edge-tts-universal（AGPL-3.0，运行时硬依赖）** 与 **awesun/coordinates.py（Oray 专有，疑似未授权）**。商业化前须处置（替换 / 获权），详见上述文档「商业化前清单」。

## 🗑️ 顺延 / 放弃

- ❌ **P2.3 拖拽编排**：放弃——最重，撞「反臃肿」红线（DAG 看板 / 运行能力已在 `orchestrator.js` 具备，仅缺拖拽编辑器）。
- ❌ **P2.4 离线 LLM 向导**：放弃——`base_url` 自定义已可用，缺的只是 ollama 一键安装向导（非阻塞）。
- ⏭️ **ai-collab-cli Phase 0**：顺延 0.6.x。
- ⏭️ **全自动 Phase 1（auto-Planner / 反思重规划环 / RAG 快照回流 / 运行时逐工具拦截）**：顺延 0.6.x。

## ✅ 质量

- 全量测试 **138** 绿（服务端 + 前端 ESM），0 失败
- `eslint` 0 error
- 新增 / 修正单测：P0.5 审计 6 例、Agnes 配置 5 例、P2.6 冒烟脚本、onboarding 8 例

## 自测要点

1. 圆桌：选模板下拉 → 一键注入席位 + 协议 → 开聊。
2. Plan 审批闸：写含 `requireApproval:true` 步的 plan → 执行到该步停 → 前端闸门 Approve → 继续；或跑 `node scripts/smoke-plan-approval.mjs` 免浏览器验证。
3. 新手指南：左栏 🚀 → 找到「接入你的大模型」气泡 → 按提示开 🤖 设置填 key / base_url。
4. Agnes：填 API Key + 模型 + 温度 → 保存 → 重启 Hesi → 设置仍在；「清空」可一键抹除。
5. 产权：仓库根目录新增 `AUDIT-REPORT.md` / `DEVELOPMENT-PROVENANCE.md` / `THIRD-PARTY-LICENSES.md`，源文件头部见版权声明。
