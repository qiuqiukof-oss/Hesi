# v0.7.1 — 协作流终止机制 P0 + 界面修复包

## 🛑 协作工作流终止机制（P0 三件套，根治"循环停不下来"）

依据《协作工作流终止机制-实施计划》实施。核心洞察：**让干活的那个 LLM 同时当裁判，循环是必然的**——本次切断"自证"回路。

- **PlanBudget 冻结比对**：gatePlan 通过后冻结 acceptance hash + 预算副本，修订产出篡改验收/预算 → 判定篡改（ESCALATE 依据）
- **ReplanController 确定性收敛判断器**（新，纯函数零 LLM）：五信号 DONE / STALL（原地重复）/ OSCILL（A→B→A 震荡）/ DRIFT（计划漂移）/ ESCALATE（篡改或预算耗尽），滑动窗口 8 检测历史签名重现
- **run-plan 接入**：反思重规划环每轮调用 `decide()`，非 CONTINUE 即终止并记录 stopKind/stopReason（不再无限重试）
- **阶段分离**：执行失败不再回讨论（DISCUSS→EXECUTE→REPORT 单向不可逆），改输出确定性终止结论
- **测试**：replan-controller 12 fixture 必停断言（AAA→STALL / A→B→A→OSCILL / 漂移→DRIFT / 预算耗尽→ESCALATE / acceptance 篡改→ESCALATE 等）

实现中测试抓出 3 个真 bug 并修复（lastSig 一字段两用致 STALL 永不命中 / acceptancePassRate 单值误判 DONE / checkLoop 震荡破坏既有契约）。

## 🎨 界面修复

- **圆桌皮肤无法显示**：lazy-chunks/lazy-bundle.js 的 basename 恰为 `lazy-bundle.js` ∈ HASHED_BUNDLES → immutable 1 年缓存且 URL 无 hash → 浏览器永用旧版 → 皮肤修复全部失效。修复：HASHED_BUNDLES 改用完整相对路径，lazy-chunks/* 走 no-cache + 注入 ?v=hash
- **P2-6 批判者模板下拉显示 undefined**：safety/critic 模板误用 `name` 字段（其他模板用 `title`），listPresets 读 `p.title` → undefined。已统一为 title，模板下拉正常显示「红队安全审查（3 席）」「批判性审视（2 席）」

## 验证

- 全量测试 333 pass / 4 fail（4 个均为环境既有问题：msys 回收 6.6s / plan-git stash / roundtable-skins window，非本次引入）
- ESLint 0 error · 服务 HTTP 200
