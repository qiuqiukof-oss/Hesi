# DoD 模板库（Definition of Done）

> 依据《协作工作流讨论与试实施方案》2.3/2.4 与 5.2：
> - **谁写 DoD？** Planner（规划者）在计划阶段写好，**执行者不能定义自己的验收标准**
> - **为什么双层？** functional（可执行命令）+ semantic（二值清单）缺一不可——
>   functional 证「命令能跑通」，semantic 证「行为符合语义」，quality 证「硬指标达标」
> - **禁止打分制**：semantic 一律 yes/no + evidence 路径，打分诱导「再努一把」乒乓循环

## 模板结构

```json
{
  "item": "工件条目 ID（如 login-api）",
  "dod": [
    { "type": "functional", "id": "f1", "check": "curl -s -X POST /api/login | grep token", "expect": "token" },
    { "type": "semantic", "id": "s1", "question": "登录态过期后是否返回 401？", "yes": true, "evidence": "tests/auth.spec.ts:42" },
    { "type": "quality", "id": "q1", "check": "npm run lint", "keyword": "0 errors" }
  ]
}
```

| type | 判定 | 字段 |
|------|------|------|
| `functional` | 命令 exit 0 且输出含 expect | `check`（命令原文）、`expect`（可选） |
| `semantic` | yes 与 expected 一致 且 evidence 路径存在 | `question`、`yes`、`expected`、`evidence` |
| `quality` | 输出含 keyword，或数值阈值比较 | `check`、`keyword` 或 `pattern`+`thresholdExpr`（如 `coverage >= 80`） |

## 领域模板

- [web-api.json](./web-api.json) — Web/API 功能开发
- [backend-service.json](./backend-service.json) — 后端服务 / 数据处理
- [cli-tool.json](./cli-tool.json) — CLI 工具 / 脚本
- [refactor.json](./refactor.json) — 重构（回归保护）
- [exploration.json](./exploration.json) — 探索型任务（调研/评估，双轨收敛）

> 使用方式：Planner 新建 plan 时按领域复制模板，填充 `check`/`question`/`evidence`
> 等具体值。执行完成后由 Verifier（`lib/verifier.js`）盲审判定，产出 delta list 按单修复。
