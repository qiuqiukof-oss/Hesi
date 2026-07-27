# Hesi 优化方案（面向个人本地运行定位）

> 依据：上一轮四维评估（综合 5.25/10）。本文回答两个问题：
> 1. 在「个人本地运行」定位下，是否只需补工程健康度 + 关键落差？
> 2. 给出可落地的详尽优化方案。
> 适用前提：单机、单人、仅本机回环使用，**不暴露到非本机网络**。

---

## 一、先回答：定位对齐后的范围判定

**结论：基本是——以「工程健康度 + 关键落差」为绝对主线，但顺带补「一条本地相关的安全项」，放弃「公网部署加固」那一套。**

理由（威胁模型变了）：

| 风险类别 | 公网/多人场景 | 个人本地场景 | 是否纳入本次 |
|------|------|------|------|
| 公网暴露 RCE（HOST=0.0.0.0 误配） | 高危 | 几乎不出现（你不绑 0.0.0.0） | ❌ 不做 |
| 令牌鉴权不一致（tools/exec 未挂 token） | Critical | 本机内仍是隐患（见下） | ⚠️ 做**轻量版** |
| 黑名单命令绕过（bash -c） | 高危 | 你本人就是操作者，非对抗场景 | ❌ 不做 |
| **本地 drive-by（恶意网页打 127.0.0.1:4264）** | 中 | **真实相关**（你会在同机浏览器上网） | ✅ 做（origin 守卫/默认 token） |
| 宣称功能为空壳（圆桌/持久化） | 信任危机 | 信任危机（你也会被自己误导） | ✅ 做 |
| 测试/CI/lint 缺失 | 回归失控 | 回归失控（升级即崩） | ✅ 做 |

> 一句话：**工程健康度 + 关键落差必须补；公网那套加固可以不做；但"本地恶意网页借 localhost 打命令执行"这一条对本地工具同样成立，必须顺手堵上（成本极低）。**

---

## 二、分阶段优化方案

### Phase 0 — 定位与文档对齐（0.5 天，零功能改动）
目标：让 README / 文档与「个人本地工具」定位一致，消除"成熟度错觉"。
- [ ] README "主要功能" 区：把「多 Agent 圆桌」「会话持久化」「headless」标注状态——
  - 圆桌：标注 `（实验性 / 规划中，当前仅角色与状态面板）` 或尽快实现（见 Phase 2.1）。
  - 持久化：改为 `前端 IndexedDB 恢复终端内容；服务端会话内存态，重启即失`。
  - headless：保留现有诚实标注（仅 opencode），并加 `aider/claude/codex 待实测` 注记。
- [ ] SECURE_DEPLOY.md：明确"个人本地场景无需公网加固，但请勿在同机浏览器访问不可信网页时让服务常驻未授权端口"的提示。
- [ ] 删除或实现 README 引用的 `plans/` 回归脚本（当前目录不存在，见 Phase 1.1）。

---

### Phase 1 — 工程健康度（让本地使用可信赖）｜P0

#### 1.1 落地真实测试（最高 ROI）
当前源码 ~60.8K 行仅 1 个测试文件。README 还引用了不存在的 `plans/` 脚本。

- [ ] **创建 `plans/` 回归脚本**（与 README 对应，调用真实模块）：
  - `plans/verify-terminal-clean.js` → 调用 `lib/terminal-clean.js` 的 `createStreamCleaner`，构造跨 chunk 的 CSI/OSC 序列，断言清洗后纯文本正确。
  - `plans/test-discuss.js` → 调用 `routes/chat/discuss.js` 的协调器，验证轮次推进与增量抽取。
  - `plans/test-stability-regression.js` → 覆盖工具链环检测 / 限流 / 流完结（README 称 37 项，按实际能力补）。
- [ ] **给核心模块补单测**（`test/` 下，沿用 `node --test`）：
  - `ws-handler.js`：消息分发 try/catch 不崩服务、断线宽限。
  - `orchestrator.js`：DAG 调度、Kahn 环检测（`isAcyclic`）、失败传播。
  - `lib/access-auth.js`：默认开放 / token 校验 / 回环豁免。
  - `lib/rate-limiter.js`：Token Bucket 限流边界。
- [ ] **前端测试死引用处理**：要么创建 `test/frontend/web-test-runner.config.js`（哪怕只跑 1 个冒烟用例），要么从 `package.json` 的 `scripts.test:frontend` 删除，避免 `npm run test:frontend` 必失败误导。
- [ ] 引入覆盖率基线：`npm i -D c8`，加 `npm run coverage`，CI 卡点 ≥ 某阈值（先不设太高，30% 起步）。

#### 1.2 改革 CI（当前只跑 build + 语法检查，等于没门禁）
修改 `.github/workflows/ci.yml`（当前 35 行，仅 build + check:server）：
- [ ] 增加步骤 `npm test`（在 build 之后、check:server 之后都跑）。
- [ ] 增加步骤 `npm run lint`（fail-fast；lint 当前 2092 问题会先卡住，需先完成 1.3 修配置）。
- [ ] 去掉 `npm ci --ignore-scripts` 的"完全跳过"，至少在一个 matrix（如 node 22）加 `npm rebuild node-pty` 验证原生模块能编译、运行时可用。
- [ ] 加 `npm run coverage` 并上传 artifact。

#### 1.3 修 Lint 配置（当前 `npm run lint` exit 1，2092 问题）
- [ ] `eslint.config.js`：为前端文件补 `languageOptions.globals`（browser 环境的 `document`/`window`/`XMLHttpRequest`/`CSS`/`fetch`），消除大量 `no-undef`。
- [ ] 移除/正确配置未知规则：`@typescript-eslint/no-unnecessary-condition`、`node/no-unsupported-features/es-builtins`（要么装对应插件，要么删规则）。
- [ ] 关键规则升 `error`（如 `no-undef`、`no-unused-vars`）；其余保持 `warn`。目标：CI 里 lint 能干净通过。

#### 1.4 husky 真正生效
- [ ] 执行 `husky init` 生成 `.husky/pre-commit` 调用 `npx lint-staged`（当前 `postinstall` 静默吞错，`.husky/` 不存在，`lint-staged` 从未运行）。
- [ ] 确认 `package.json` 的 `lint-staged` 配置覆盖 server.js / routes / ws / mcp（已配，但 hooks 没装）。

---

### Phase 2 — 关键落差（让宣称与代码一致）｜P0/P1

#### 2.1 数字员工圆桌：实现真正的任务执行（核心卖点，建议真做）
现状：`ws/digital-employee.js:100-105` 的 `assignTask` 只 `taskQueue.push`+改状态，**无 worker 消费**；`dispatchTask` 也只调这个空壳。团队从不"干活"。

最小可行实现（在 `createDigitalEmployeeTeam` 内加一个队列处理器，复用现有 agent 执行路径）：

```js
// ws/digital-employee.js — 在 team 内新增
let processing = false;
async function pump() {
  if (processing) return;
  processing = true;
  try {
    for (const e of team.values()) {
      while (e.taskQueue.length) {
        const task = e.taskQueue.shift();
        e.status = 'working'; e.currentTask = task;
        try {
          // 复用现有 agent 执行链路（按 agentId 路由到 ws/agent 或 routes/chat）
          const result = await runAgentTask(e.agentId, task, {
            onToken: (t) => contextStore?.set(`task:stream:${task.id}`, t, {ttl:0}),
            signal: ...,
          });
          e.stats.tasksCompleted++;
          contextStore?.set(`task:result:${task.id}`, result, {ttl:0});
          e.currentTask = null; e.status = 'idle';
        } catch (err) {
          e.stats.tasksFailed++; e.status = 'error';
          contextStore?.set(`task:result:${task.id}`, {error:String(err)}, {ttl:0});
        }
      }
    }
  } finally { processing = false; }
}
// assignTask 内：this.taskQueue.push(task); ... ; pump();  // 触发处理
```

要点：
- `runAgentTask` 应复用项目已有的 agent 运行入口（先确认 `ws/agent.js` 或 `routes/ai-tools/agent-pool.js` 暴露的 `run(agentId, prompt, opts)`），不要另起一套。
- 多员工并发：`pump` 用 `for...of` 串行各员工队列即可避免 `activeRuns` 覆盖问题（见 2.4）。
- 提供 `stop()`/`pause()` 以便前端"停止任务"。
- 若短期内不实现：务必在 README 与圆桌 UI 明确标注"规划中"，**不要保留"多 Agent 圆桌讨论"的完成态表述**。

#### 2.2 headless 映射补全
- [ ] `lib/cli-headless.js:25-32` 的 `HEADLESS` 仅含 opencode。实测后补充 `aider`/`claude`/`codex` 的 headless 子命令（如 `aider --message`、`claude -p`、`codex` 的非 TTY 模式），让"headless 杜绝 TUI 污染"对更多 Agent 成立。

#### 2.3 会话持久化：老实说
- [ ] 现状即合理（前端 IndexedDB 恢复 + 后端内存会话）。只需**改文档措辞**，不必为本地工具做后端持久化（投入产出比低）。若想要"重启不丢"，可加一个轻量磁盘快照（JSON 落 `data/sessions/`），作为可选 P2。

#### 2.4 单 WS 多 workflow 互斥
- [ ] `orchestrator.js:622` 的 `activeRuns.set(ws, rs)` 覆盖式写入。改为 `Map<ws, Set<runId>>`（或 `Map<ws, Map<runId, rs>>`），支持同 WS 并发 workflow；并在 `run()` 完成时从集合移除，避免 2.1 的 `run()` Promise 永久挂起泄漏（见评估风险 6）。

#### 2.5 消除 bundle 脱节坑
- [ ] 当前 `index.html` 硬编码 `/bundle.js` 无 hash，改源码忘 `npm run build` 页面仍跑旧代码。
- [ ] 方案：`esbuild` 构建加 `--entry-names=[name].[hash]` 产出带 hash 文件名，或给引用加 `?v=<hash>` 查询串；`index.html` 用构建后注入的引用。低成本的折中：在 `index.html` 给 `<script src="/bundle.js?v=<git-short-hash-or-build-time>">`，并在 README 强调"改前端必须 build"。

---

### Phase 3 — 一条本地相关的安全加固（低成本）｜P1

> 仅做"本地恶意网页借 localhost 打命令执行"这一条。公网加固整套不做。

#### 3.1 默认 origin 守卫（防 drive-by）
- [ ] 对所有 **state-changing / 命令执行类** 接口（`POST /api/tools/exec`、`/tools/write-file`、`/api/plugins/create`、WebSocket 升级），校验 `Origin` 头必须为回环或白名单；非回环 Origin 直接 403。
- [ ] 即使 CORS 阻止读取响应，**POST 副作用仍会执行**（盲 RCE），所以必须靠 origin 校验而非仅靠 CORS。需先核实 `server.js:105` 的 `cors({...})` 是否反射任意 origin——若是，则风险成立，必须加 3.1。

#### 3.2 或：首次启动生成随机 token
- [ ] 若 `QCLI_ACCESS_TOKEN` 未设，启动时可生成一个随机 token 写入 `.env`（或仅内存并打印到控制台），前端自动带 `?token=`/`Authorization`。这样即便同机有恶意页也拿不到 token。比 3.1 更彻底，但改动稍大，二选一即可。

#### 3.3 命令执行接口本地也收窄
- [ ] `/api/tools/exec` 即便本地，也建议加一层 `confirm` 或仅允许 `allowlist`（如 `git`/`npm`/`node` 等），减少误触与盲打面。属可选增强。

---

### Phase 4 — 前端治理（性价比中等，可后置）｜P2

- [ ] 收敛 `window.QCLI` 全局单例（42 处赋值）：改为显式模块 import 或单一 DI 容器，消除初始化顺序耦合。
- [ ] 抽离重复：把在 17 个文件各自定义的 `escapeHtml` 统一到 `public/lib/escape.js` 并 import。
- [ ] API Key 移出 `localStorage`（`chat-api.js`）：改 `sessionStorage` 或纯内存变量，避免持久化泄露。
- [ ] XSS 热点：`multi-media.js` 的 `<img src="${url}">` 加协议校验（仅 `http(s)`/`data:image`）；`orchestrator.js`/`digital-employees.js` 渲染 AI/后端内容统一走转义函数。

---

## 三、优先级与工作量预估

| 项 | 阶段 | 优先级 | 估时 | 影响 |
|------|------|------|------|------|
| 1.1 真实测试 + plans/ 脚本 | P1 | P0 | 2-3 天 | 高（防回归） |
| 1.2 CI 跑 test+lint | P1 | P0 | 0.5 天 | 高 |
| 1.3/1.4 Lint 配置 + husky | P1 | P0 | 0.5 天 | 中 |
| 2.1 圆桌真实执行 | P2 | P0/P1 | 2-4 天 | 高（核心卖点） |
| 2.2 headless 补全 | P2 | P1 | 0.5 天 | 中 |
| 2.4 多 workflow 并发 | P2 | P1 | 0.5 天 | 中 |
| 2.5 bundle hash | P2 | P1 | 0.5 天 | 中（体验） |
| 3.1/3.2 本地 origin 守卫/默认 token | P3 | P1 | 0.5-1 天 | 中（本地安全） |
| 0/2.3 文档对齐 | P0/P2 | P0 | 0.5 天 | 中（信任） |
| 4 前端治理 | P4 | P2 | 2-3 天 | 中（长期可维护） |

**建议执行顺序**：Phase 0（文档对齐，半天）→ Phase 1（健康度，3-4 天）→ Phase 2.1 + 2.4（核心功能，3-5 天）→ Phase 3（本地安全，1 天）→ 其余 P2 视精力。

**总估时**：做到"可信赖的个人本地工具"约 **2-3 周**；只做 P0（健康度 + 文档 + 圆桌空壳转正）约 **1.5 周**。

---

## 四、验收标准（Done 的定义）

- [ ] `npm test` 有 ≥ 30 个真实用例且全绿；`plans/` 三个脚本存在并可运行。
- [ ] CI 在 node 18/20/22 下跑通 build + test + lint（含一次 node-pty 编译验证）。
- [ ] `npm run lint` 在 CI 干净通过（exit 0）。
- [ ] 数字员工分配任务后，能在 UI 看到执行过程与结果（或 README 明确标注为规划中）。
- [ ] 同机打开不可信网页时，无法借 `127.0.0.1:4264` 触发命令执行（origin 守卫/默认 token 生效）。
- [ ] README 不再有"宣称丰满、代码骨感"的条目。
