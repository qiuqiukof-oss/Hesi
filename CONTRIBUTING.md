# 贡献指南 · Contributing

欢迎贡献！本文写给**想改 Hesi 代码的你**。README 的「贡献指南」段是精简版，这里讲**真正会让你踩坑的仓库特有细节**——这些在通用教程里找不到。

---

## 一、开发环境

```bash
git clone https://github.com/<your-id>/Hesi.git
cd Hesi
npm install
npm run build          # 必须！产出 public/bundle.js
npm run dev            # 开发模式（前端 esbuild --watch + 后端 node --watch 热重载）
```

- 最低 Node >= 18（推荐 22 LTS）
- 浏览器控制可选：`npx playwright install chromium`
- 后端改动**无需手动重启**——`npm run dev` 已用 `node --watch server.js` 热重载

---

## ⚠️ 二、头号地雷：前端 bundle 双轨（必读）

Hesi 前端**不是**直接加载源文件，而是经 esbuild 打包成两个产物：

| 产物 | 来源入口 | 构建命令 | 何时用 |
|------|----------|----------|--------|
| `public/bundle.js` | `public/main.js` | `npm run build:main` | 主包：sidebar / workflows / agents / onboarding / chat-panel 等 |
| `public/lazy-bundle.js` | `public/lazy.js` | `npm run build:lazy` | 懒加载包：right-panel 等 |

**致命陷阱**：你改了 `public/` 下的源文件，**必须跑对应的 build 命令**，`bundle.js` 才会更新。否则浏览器加载的还是旧产物，你会"改了代码却看不到效果"——白验证一轮。

**怎么判断改的文件进哪个包？**

```bash
# 在 public/ 里查该文件被谁 import
grep -rn "import './<file>.js'" public/
# 命中 main.js  → build:main
# 命中 lazy.js  → build:lazy
```

常见易错点：
- `workflows.js` 属**主包** → 改它必须 `npm run build:main`（**不是** `build:lazy`！曾有人误用导致改动没打进运行代码）
- `onboarding.js`、`chat-panel.js`、`sidebar.js` 都进主包
- `right-panel.js` 经 `lazy.js` 进懒包

**一条命令全量重建**：`npm run build`（= check:server + build:main + build:lazy）。

CSS 文件（`workflow.css` / `sidebar.css` 等）和 `index.html` 是**直接生效**的，**不需要构建**。

---

## 三、提交前钩子（husky + lint-staged）

仓库启用了 husky，`git commit` 会触发：

- `eslint --fix`（自动修可修复的 lint 问题）
- `node --check`（服务端模块语法检查）

所以提交前请确保：

```bash
npm run lint          # 应 0 error（允许 warning）
npm run check:server  # 全部 node --check 通过
npm test              # 回归套件通过
```

> ⚠️ 若 lint 报 `document is not defined` / `window is not defined` 这类浏览器全局错误，说明文件被误判为 Node 后端。eslint 配置里浏览器全局已覆盖 `public/**` 和 `plugins/**/ui/**`；**新增的浏览器端代码若放在 `plugins/<x>/web/**` 等路径，需要在 `eslint.config.js` 补该目录的 `globals.browser`**，否则会凭空多出 200+ 个 error。

---

## 四、测试体系

```bash
npm test                          # node --test（test/ 14 文件）+ plans/ 回归套件
node plans/verify-terminal-clean.js      # 终端转义清洗（9 项）
node plans/test-discuss.js              # 讨论协调器契约（7 项）
node plans/test-stability-regression.js # 稳定性（37 项）
```

- 新功能请附带回归测试，放 `plans/`（纯 Node 脚本，无需框架）或 `test/`（node --test）
- **核心路径一定要有集成测试**：启动 → WS 连接 → 发消息 → 校验响应，尤其是**注册/接线路径**（历史上 `generate_video` 漏注册、`#discuss-switch` 漏 id 都是这类漏出）

---

## 五、提交规范（重要）

```bash
# ❌ 绝对不要
git add -A
git add .

# ✅ 只 add 你改的文件
git add <具体文件>
git commit -m "type(scope): 简述"
```

- 当前仓库 `.gitignore` 已忽略 `data/` `.workbuddy/` `uploads/` `.env` 等，**但 `git add -A` 仍可能把敏感/产物带进去**。务必手动指定文件。
- 不要提交 `data/`（记忆与运行数据）、`uploads/`、`.workbuddy/`（项目记忆，含未公开信息）。
- PR 标题遵循 `type(scope): 简述`（如 `feat(pty): 增加会话回收`）。

---

## 六、发布流程（维护者）

1. 改 `package.json` 的 `version`
2. 在 `CHANGELOG.md` 顶部加版本条目
3. `npm run build` 确保产物最新
4. 提交 → 打 tag → push：

   ```bash
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z: ..."
   git push origin main --tags
   ```

5. 在 GitHub 创建 Release（tag 同名，正文写变更要点）
6. **落地页（GitHub Pages）** 用 worktree 推 `gh-pages` 分支，不要在主分支里改：

   ```bash
   git worktree add H:/Hesi-ghpages gh-pages
   # 改 H:/Hesi-ghpages/index.html 后
   cd H:/Hesi-ghpages && git add -A && git commit && git push origin gh-pages
   git worktree remove H:/Hesi-ghpages --force
   ```

---

## 七、代码风格

- 后端：CommonJS（`require` / `module.exports`）
- 前端：ESM（`import` / `export`），经 esbuild 打包
- 提交前 Prettier + ESLint 自动格式化
- 不引入 TypeScript（当前架构为纯 JS；加类型请用 JSDoc + `// @ts-check`，不要推翻 CommonJS）

---

## 八、常见"我改了没反应"排查清单

1. 改了 `public/*.js` 源文件 → 跑 `npm run build:main` 或 `npm run build`
2. 浏览器看到旧界面 → `Ctrl+Shift+R` 强刷清缓存
3. lint 爆 `document is not defined` → 见第三节 eslint 配置
4. 端口被占用 → `PORT=xxxx npm start` 换端口；或释放 4264
5. AI 没反应 → 检查设置里是否填了 LLM Key

---

## 九、架构入口（从哪看起）

| 我想改… | 看这些文件 |
|----------|-----------|
| 终端行为 | `ws-handler.js` / `ws/pty.js` / `ws/agent.js` |
| AI 聊天 | `routes/chat/` / `public/chat-panel.js` |
| CLI 发现 | `cli-discovery.js` / `cli-registry.json` |
| 圆桌讨论 | `routes/chat/discuss.js` / `ws/digital-employee*.js` |
| MCP | `mcp/` / `routes/mcp*.js` |
| 前端 UI | `public/index.html` + `public/*.js`（改后必 build） |
| 安全 | `lib/access-auth.js` / `routes/index.js` / `rate-limiter.js` |

更完整的架构图见 [docs/architecture.md](./docs/architecture.md)。
