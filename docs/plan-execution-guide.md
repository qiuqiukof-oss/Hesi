# 全自动 Plan 执行器 · 使用说明（Phase 0）

> 适用版本：**v0.5.2+**（commit `b5c62c1` 起，未推送前为本地 `main` HEAD）。
> 定位：把"结构化 Plan → 多 Agent 执行 → 机器验收 → 反思"串成闭环，且每一步都在 git 分支快照保护下可回滚。
> 本文是**用户手册**，不是架构文档。架构动机见 `.workbuddy/全自动-架构思考.md`、实施级方案见 `.workbuddy/全自动-mvp-plan.md`。

---

## 0. 一句话理解

你写一个 **Plan（目标 + 机器可验证的验收 + 有序步骤）**，Hesi 在一条独立的 `auto-<id>` git 分支上**逐步执行**：每步前自动快照、越权/黑名单命令被拦、失败回滚、最后跑验收命令给出 `done / partial / diverged` 结论。

> 它和"大号 workflow"的区别：workflow 的图是预先写死的；本执行器复用同款 DAG 引擎，但**目标可验证性闸门 + 每步快照回滚 + 反思判定**是其新增的治理层。
> **Phase 0 边界**：Plan 由你（人或圆桌产出后粘贴）提供，执行器**不自动出图、也不读结果改图**（这两项是 Phase 1）。见文末 §9。

---

## 1. 快速开始

```bash
cd /h/Hesi
node server.js            # 默认端口 4264；占用则 PORT=5000 node server.js
```

- 浏览器打开 **http://localhost:4264/plan.html**（左侧栏「📋全自动」也可进）。
- 点「**载入示例**」填入一个示例 Plan → 点「**执行**」。
- 页面下方实时显示每步状态（start/done/blocked/failed/…）、快照 SHA、软断点结论，以及顶部反思卡片（`done / partial / diverged` + 验收通过率）。

> 不想开浏览器？所有能力都能用 `curl` 调 `POST /api/plan/execute` 完成（见 §7 + §8）。

---

## 2. Plan 协议（必读）

Plan 是一个 JSON 对象。字段表：

| 字段 | 必填 | 说明 |
|---|---|---|
| `objective` | ✅ | 一句话目标，必须能被映射为机器可验证的 `acceptance`，否则被闸门拒收。 |
| `acceptance` | ✅ | 顶层验收数组，每项 `{ id?, kind, command?, expect? }`。**至少一项必须是机器可验证的**（`command`/`script`/`http`），纯 `manual` 会被拒收。 |
| `steps` | ✅ | 有序步骤数组，每项见下表。 |
| `allow_external` | ❌ | 默认 `false`：禁止发邮件/付费 API/生产写等外部副作用。 |
| `forbidden` | ❌ | 命令黑名单（子串匹配），命中即拦截，不执行。 |
| `scope_paths` | ❌ | 路径白名单；步骤文本里出现的带 `/` 路径若不在其中 → 越界拦截。为空 = 不限制路径。 |
| `budget` | ❌ | `{ maxRounds, maxTokens, maxMinutes }`；`0` = 不限制。超限熔断。 |

**步骤 `steps[i]` 字段**：

| 字段 | 说明 |
|---|---|
| `id` | 步骤标识。 |
| `goal` | 这一步要达成什么（给人看）。 |
| `action` | 这一步要做什么（交给 Agent 执行的自然语言指令）。 |
| `type` | 可选，`exec` / `verify`。 |
| `verify` | 可选，`{ kind, command, expect }`：本步完成前的机器验证。 |
| `on_fail` | 可选，`stop`（默认，失败即停）/ `retry` / 其他 → 失败即停并回滚本步。 |
| `checkpoint` | 可选，`true` = 软断点：若本步无机器可验证 `verify`，转圆桌讨论推导，仍不行则退回要人补 acceptance。 |
| `dependsOn` | 预留（Phase 0 顺序执行，忽略）。 |

**`acceptance` / `verify` 的 `kind`**：

- `command` / `script`：在服务端用 `sh -c "<command>"` 执行，`expect`（可选）为输出需包含的字符串；命令退出码非 0 或不含 `expect` → 不通过。
- `http`：对 `command` 里的 URL 发 `GET`，要求 `res.ok` 且（若有 `expect`）响应体包含它。
- `manual`：**不可机器验证** → 含它的 `acceptance` 会导致整个 plan 被闸门拒收（要求你补机器可验证项）。

### 2.1 最小可跑 Plan 示例

```json
{
  "objective": "在仓库根新增 PLAN_DEMO.md，内容为 # Demo",
  "acceptance": [
    { "id": "a1", "kind": "command", "command": "test -f PLAN_DEMO.md && grep -q Demo PLAN_DEMO.md" }
  ],
  "steps": [
    { "id": "s1", "goal": "写文件", "action": "用终端执行：printf '# Demo\\n' > PLAN_DEMO.md" },
    { "id": "s2", "goal": "校验", "action": "确认文件含 Demo", "checkpoint": true }
  ],
  "allow_external": false,
  "forbidden": ["rm -rf"],
  "scope_paths": [],
  "budget": { "maxRounds": 0, "maxTokens": 0, "maxMinutes": 0 }
}
```

---

## 3. 三项已锁定决策（行为边界）

1. **可验证性闸门（拒收 + 要人补）**：`gatePlan` 在开跑前检查——若 `acceptance` 无法映射为机器可检查项（如含 `manual` 或纯主观），**直接拒收**并返回缺失项 `missing`，不进入执行、不静默降级、不逐步问人。
2. **checkpoint 软断点（转圆桌，不阻塞人）**：`checkpoint:true` 的步骤若自身没有机器可验证 `verify`，触发 `resolveCheckpoint`：用注入的 `roundtableFn` 跑最多 N 轮（默认 3）圆桌讨论，尝试推导一个 `{kind, command}` 验收；仍推导不出 → 兜底回决策①（拒收并要人补）。若本步已有 `verify` → 直接通过。
3. **外部副作用默认全禁**：`allow_external` 默认 `false`；`forbidden` 黑名单硬挡（如 `rm -rf` / `git push --force`）。真要允许必须显式开启 + 该步前自动快照。

---

## 4. 安全模型（爆震半径可控）

| 机制 | 行为 |
|---|---|
| **git 分支快照** | 每次执行开独立 `auto-<id>` 分支；每步前 `git commit`（scope_paths 空则 `git add -A`，否则只加白名单路径）；失败 `git reset --hard` 回退**本步**快照。`main` 不受影响。 |
| **scope / forbidden 拦截** | 每步执行前扫描 `action` + `verify.command`：命中 `forbidden` 子串 → 拦；带 `/` 的路径不在 `scope_paths` → 越界拦。被拦步骤不执行、不调 LLM。 |
| **预算熔断** | `PlanBudget` 累计轮数/Token/时间；连续重复 N 次无进展（复用 `TOOL_LOOP_GUARD` 思路）→ 熔断，绝不烧满撞墙。 |
| **人工中止** | 预留 `shouldAbort` 钩子（API 调用时可传），可随时叫停。 |

> ⚠️ **已知局限（Phase 0）**：`scope`/`forbidden` 是**步前静态扫描**（看步骤文本里的命令/路径 token），**不是每次工具调用的运行时强制**。运行时逐工具拦截列入 Phase 1。结论：不要把 `auto-<id>` 分支当沙箱——它防的是"明显越权/危险命令"，不是 Agent 在白名单内做任何事。

---

## 5. 执行流程（逐步）

```
gatePlan ──拒收──▶ rejected（返回 missing）
   │ 通过
openPlanBranch(auto-<id>)
   └─ 逐 step：
        budget.tickRound ──超限──▶ budget 熔断，停
        checkInterception ──命中──▶ blocked，停（不调 LLM）
        snapshotStep（步前快照）
        checkpoint? ──是──▶ resolveCheckpoint（圆桌推导 verify，失败则 blocked）
        workflowManager 单步执行（复用 DAG 引擎 → Agent）
        ├─ 完成 → done
        ├─ 失败/错误 → rollbackTo(本步快照) → 停
        └─ 连续重复 → loop 熔断，停
closeBranch（git checkout -，保留 auto 分支供审计）
runAcceptance（跑验收命令）
reflectPlan → done / partial / diverged
```

---

## 6. 反思结果

| 状态 | 含义 |
|---|---|
| `done` | 所有步骤完成且机器验收全过。 |
| `partial` | 步骤部分完成，或步骤全过但验收未全过。 |
| `diverged` | 出现需人补 acceptance 的 checkpoint 断点，或执行异常（timeout/loop/budget）。 |
| `rejected` | 被闸门拒收（无步骤执行）。 |

页面顶部状态条与反思卡片显示：状态、步完成数 `done/total`、验收通过率、预算（轮数/Token）、说明。

---

## 7. API 参考

`POST /api/plan/execute`

请求体：
```json
{
  "plan": { "...Plan 协议..." },
  "apiKey": "可选，覆盖 checkpoint 圆桌的密钥",
  "provider": "可选，如 openai",
  "baseUrl": "可选，OpenAI 兼容端点",
  "model": "可选，模型名",
  "partners": "可选，逗号分隔的圆桌席位"
}
```

响应（`application/json`）：
```json
{
  "ok": true,
  "status": "done",
  "branch": "auto-<id>",
  "steps": [ { "index":0, "id":"s1", "status":"done", "snapshot":"<sha>", "output":"..." } ],
  "reflection": { "status":"done", "stepsDone":2, "stepsTotal":2, "acceptancePassRate":1, "budget": {"rounds":0,"tokens":0} },
  "missing": ["a1"]   // 仅 rejected 时出现
}
```

> **LLM 配置说明**：步骤执行走服务端全局 Agent 配置（和聊天用同一套，由 `ensureAgentConfig` 注入），**不受请求体里的 `apiKey/provider/...` 影响**；请求体里的这些字段**只作用于 checkpoint 圆桌讨论**。所以真实执行能否跑起来，取决于你的 Hesi 服务端 LLM 是否已配好（同聊天）。

---

## 8. 测试方式

### 8.1 不需要 LLM 的冒烟（推荐先做，零成本）

直接在终端 `curl`，验证闸门 / 拦截 / 反思：

```bash
# ① 闸门拒收（纯 manual acceptance）→ rejected，且不产生 git 分支
curl -s -X POST http://localhost:4264/api/plan/execute -H 'Content-Type: application/json' \
 -d '{"plan":{"objective":"把首页做得更好看","acceptance":[{"id":"a1","kind":"manual"}],"steps":[{"id":"s1","goal":"g","action":"echo hi"}]}}'

# ② forbidden 拦截 → steps[0].status:"blocked"
curl -s -X POST http://localhost:4264/api/plan/execute -H 'Content-Type: application/json' \
 -d '{"plan":{"objective":"t","acceptance":[{"id":"a1","kind":"command","command":"echo ok"}],"forbidden":["rm -rf"],"steps":[{"id":"s1","goal":"g","action":"rm -rf /tmp/x"}]}}'

# ③ scope 越界拦截 → steps[0].status:"blocked"
curl -s -X POST http://localhost:4264/api/plan/execute -H 'Content-Type: application/json' \
 -d '{"plan":{"objective":"t","acceptance":[{"id":"a1","kind":"command","command":"echo ok"}],"scope_paths":["public/plan.html"],"steps":[{"id":"s1","goal":"g","action":"edit /etc/hosts"}]}}'
```

> ②③ 会创建本地 `auto-<id>` 分支（未推送、`main` 干净），清理：
> `git for-each-ref --format='%(refname:short)' refs/heads/auto- | xargs -r git branch -D`

### 8.2 真实执行（需要能跑工具调用的 LLM）

页面「载入示例」→「执行」，或 curl 提交 §2.1 的 Plan。**前提**：服务端 LLM 已指向你的本地端点（与聊天一致）。会消耗 token；在 `auto-<id>` 分支上创建 `PLAN_DEMO.md` 并提交快照，`main` 不受影响。

### 8.3 单元/集成测试（最确定性的证明）

```bash
node scripts/test.mjs          # 全量测试（含 test/run-plan.test.mjs、test/plan-routes.test.mjs）
```
执行器逻辑用 mock 的 `workflowManager` + `roundtableFn` 覆盖，不依赖真实 LLM。

---

## 9. Phase 0 已知局限（诚实清单）

| 项 | 现状 |
|---|---|
| **自动出图（Planner）** | 无。Plan 由你粘贴/圆桌产出后粘贴。Phase 1 将做 Seed → 圆桌 → 校验出 Plan。 |
| **反思重规划环** | 无。`reflectPlan` 只判定 `done/partial/diverged`，**不读结果改图重跑**。Phase 1 做。 |
| **RAG 快照回流** | 未接。每步 commit 尚未 upsert 进 `index-store`（复用既有 BM25/经验库，零新增依赖，待接）。 |
| **运行时逐工具拦截** | 仅步前静态扫描（§4 局限）。运行时强制拦截列入 Phase 1（接 `mcp/security/policy.js`）。 |
| **常驻 Scheduler** | 无。Phase 0 手动触发（按钮 / API）。 |

---

## 10. 常见问题

**Q：我的 LLM 是本地模型（如 Ollama），能跑真实执行吗？**
A：取决于它是否支持**多轮工具调用 / 文件写操作**。闸门、拦截、快照、反思这些**不依赖 LLM**，用 §8.1 的 curl 即可验证；真实执行需要模型能听懂 `action` 并通过工具改文件。若本地模型工具调用能力弱，复杂 Plan 会 step 失败并回滚——这本身也是执行器在正常工作（验证优先、失败即停）。

**Q：执行会弄脏我的 main 分支吗？**
A：不会。所有改动提交在 `auto-<id>` 分支，结束时 `git checkout -` 回到 `main`，工作树恢复干净。`main` 历史不变。

**Q：checkpoint 圆桌想用自己的模型/席位？**
A：在页面填 API Key / Provider / Base URL / Model / Partners，或 API 请求体带这些字段——它们只影响 checkpoint 圆桌，不影响步骤执行（步骤用服务端全局配置）。

**Q：怎么看某次执行的决策快照？**
A：`git log auto-<id>` 能看到每步 `plan: step N ...` 与 `plan: final` 提交，可 `git show` 审计；失败步已 `reset --hard` 回退。

---

## 11. 下一步（Phase 1 路线，非本版）

1. **auto-Planner**：Seed/objective → 圆桌 → `gatePlan` 校验出 Plan（复用 discuss + plan-contract）。
2. **反思重规划环**：读结果 → 改 DAG（加步/跳步/换路/回滚）→ 重跑，受 `PlanBudget` 熔断。
3. **RAG 快照回流**：每步 commit upsert 进 `index-store`。
4. **运行时逐工具强制拦截**：接 `mcp/security/policy.js`。
