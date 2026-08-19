# v0.7.1-fix — 协作流收尾修复包

## 🛡️ 安全加固

- **审批闸确定性兜底**（不再依赖 LLM 自觉）：`plan-from-nl.js` 新增 DANGER_RE 危险操作检测（rm -r/-f / sed|perl -i / sort -o / curl|wget / git push|reset --hard|rebase / 写系统路径 / chmod 777|sudo / mkfs|format），sanitizePlan 命中即强制 requireApproval——修复 LLM 对复合命令（如 `if [ -f x ]; then sed -i ...`）漏标导致危险操作绕过审批
- **自动执行锁死 AI 助手**：执行方下拉不再加载外部 CLI Agent；后端外部 CLI 分支默认返回 skipped（仅 `HESI_PLAN_ALLOW_CLI_EXECUTOR=1` 显式放行）——opencode 等外部 agent 自主执行不受 Hesi 运行时拦截/审批闸约束，且每步启动 23-35s
- **讨论阶段 CLI Agent 禁止执行**：buildCliTask 提示词新增【重要约束】——讨论阶段不得执行任何修改文件系统的命令，只给观点与建议（实测 opencode 已遵守，只做只读检查）

## 🐛 循环与交互修复

- **移除协作流第 2 段「方案审查讨论」**：目标分析讨论收敛后不再强制再弹一轮（AI 自审方案 = 自证循环温床 + 每次再启动 opencode 23-35s）。链路收敛为 讨论→方案→执行→终止结论（单向不可逆）
- **审批气泡不渲染**：后端 sseEventName 把连字符转下划线（await-approval→await_approval），前端匹配连字符版本永不命中 → 气泡被丢弃。修复前端兼容两种写法
- **diverged → terminal**：需人工审批的 checkpoint / fatal 步骤不再 autoReplan 反复修订，直接终止并给明确原因

## 🏗️ P2 确定性模块（纯函数，零 LLM，独立可测）

- **Verifier 盲审节点**（lib/verifier.js）：输入白名单剥离 executorSummary/selfReport（盲审铁律），functional/semantic/quality 三层二值判定 + delta list + verdict，17 测试
- **探索型双轨收敛**（lib/exploration-verdict.js）：「下游可决策」判据，新问题只进 future-work 永不阻塞，答案必须带 source，7 测试
- **Reviewer**（lib/reviewer.js）：STALLED 时触发，质量门 + 漂移门 → CONTINUE/STOP/ESCALATE，8 测试
- **DoD 模板库**（docs/dod-templates/）：web-api / backend-service / cli-tool / refactor / exploration 5 个领域模板

> 注：P2 三个模块为独立纯函数库，尚未接入 run-plan 主流程（接线需扩展 plan schema 的 dod/questions 字段，下一步）。

## 验证

- 全量测试 369+（含新增 36 个 P1/P2 测试）· ESLint 0 error · 服务 HTTP 200
- 球总实测确认：讨论阶段 opencode 只读不写、审批气泡正常弹出、命令真实生效（README 第一行替换成功，换行符保留，git diff 仅 1 行）
