# v0.7.2 — 终止机制方案完整落地 + 全访问开关

## ✅ 终止机制方案（《协作工作流讨论与试实施方案》）五项全部落地并接入主流程

| 方案项 | 状态 | 落地 |
|--------|------|------|
| ① diverged → terminal | ✅ | run-plan 反思环：需人工介入场景不再 autoReplan 反复修订 |
| ② ReplanController 五信号 | ✅ | DONE/STALL/OSCILL/DRIFT/ESCALATE 纯函数，反思环每轮判定 + 12 测试 |
| ③ Verifier 盲审节点 | ✅ **接入** | `runDodVerification`：functional/quality 执行检查命令 + semantic evidence 路径存在性 → 二值判定 → delta list；缺失 → 强制 partial |
| ④ 探索型双轨收敛 | ✅ **接入** | `mode=exploration` → 不跑验收命令，explorationVerdict「下游可决策」判收敛（必需问题答满 + 来源可溯） |
| ⑤ DoD 模板库 | ✅ | docs/dod-templates/ 5 领域模板；plan schema 支持 dod/mode/questions 字段 |

**接线细节**：
- plan-schema `isMachineVerifiable` 允许探索型（questions）与 DoD（functional/quality）——不再被 gatePlan 拒收
- 确定性判定（`__dod__`/`__exploration__` 失败）强制 partial（不依赖 strictAcceptance）
- 新增 test/plan-dod-integration.test.mjs（4 fixture：dod 全过→done / 缺失→partial / quality 阈值 / 探索型答满与缺答）

## 🔓 「允许完全访问」开关（WorkBuddy 式）

- 「⚡ 自动执行」控件区新增显式开关，勾选后所有步骤直接执行、不再逐个弹审批
- 与「⚡ 始终允许」区别：**可随时取消勾选恢复审批**（无锁死隐患）；勾选变红提示高权限
- 后端 `requestApproval` 在 fullAccess=true 时直接通过（不挂起不弹气泡）

## 验证

- 全量测试 373 pass / 4 fail（4 个均为环境既有：msys 回收 / plan-git stash / roundtable-skins window）
- ESLint 0 error · 服务 HTTP 200
