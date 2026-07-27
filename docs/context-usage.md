# 单会话上下文窗口占用率显示（P0.6）

> 立项：0.4 路线图 Phase 0 §1.6（用量可见化补全）。
> 目标：把 v0.3.1 P1「幽灵截断治理」已落地的后端数据，变成 chat 头部**用户可见**的实时窗口占用率视图。
> 代码完成于 2026-07-27（commit 链 a9bf859 → ba5da35 → 26cf099，本地未推），全量测试 207/207 绿。

## 1. 三种「用量」的区别（避免混淆）

| 概念 | 含义 | 现状 |
|---|---|---|
| 节省率 % | 省了多少 / 总消耗（缓存命中 + 工具复用 + 经验命中） | 已有 `savings-icon.js` 圆环（M5 收益条） |
| 本会话消耗 tokens | 实际消耗 token 数 | `benefit-bar.js` 收益条已显示 |
| **窗口占用率 %** ← 本方案 | `contextEstimate / 窗口上限 × 100%` | **此前无 UI** |

讨论文件里「管理界面没有显示**当前上下文占用率**」即指第三种。

## 2. 数据闭环（后端）

新增**轻量只读端点**（挂在 chat router，复用既有鉴权中间件）：

```
GET /api/chat/context-usage?sessionId=xxx[&model=yyy]
```

返回结构：

```json
{
  "model": "local-model",
  "contextEstimate": 12300,
  "windowTokens": 32000,
  "pct": 38.4,
  "compactThreshold": 16000,
  "maxOutputTokens": 25600,
  "source": "effective-context | model-map | fallback"
}
```

实现要点（零新依赖、零新存储、只读不改写入）：

- `contextEstimate` ← `MemoryStore.getContextInfo(sessionId)`（读 `session.contextEstimate` 字段，回落 `tokenEstimate`）。
- `windowTokens` ← `new ContextWindowManager().effectiveContext(model)` —— **直接复用 v0.3.1 已落地的三层策略**：
  - Layer① `HESI_EFFECTIVE_CONTEXT` 手动覆盖（最高优先级）；
  - Layer② 模型名映射表（如 `qwen2.5-3b` → 32k）；
  - Layer③ 默认回落大窗口（200k）。
- `pct` ← `contextEstimate / windowTokens × 100`。
- `model` 优先取请求参数，回落 session 存储的模型；找不到 session 返回 404。
- 缺 `sessionId` → 400。

## 3. 前端组件（纯函数模式，与 savings-icon 同款）

`public/components/context-usage.js`（**进 main bundle**，与 savings-icon 同属 main 链）：

- `computeContextUsage({ contextEstimate, windowTokens, compactThreshold, model, source })`
  → `{ pct, strokeDasharray, strokeDashoffset, color, level, title, active }`
- **色阶**（占用率越高越警示，是「健康度」语义，**非**涨跌色）：

  | 区间 | 颜色 | level |
  |---|---|---|
  | `<60%` | 绿 `#2e7d32` | normal |
  | `60–85%` | 黄 `#f9a825` | warn |
  | `85–95%` | 橙 `#ef6c00` | danger |
  | `≥95%` | 红 `#c62828` | critical |

- `level`：normal / warn / danger / critical（供前端加样式 / 呼吸动画）。
- `title` 示例：`上下文占用 31.0k / 窗口 32.0k（96.9%）· 压缩阈值 16.0k（已达标，将触发压缩）· 模型 local-model · 窗口来源：模型映射表 · ⚠ 接近窗口上限，建议开新会话或等待自动压缩`。
- 复用 `savings-icon.js` 的 `RING_RADIUS` / `RING_CIRCUMFERENCE` 常量，保证两个圆环视觉一致。

## 4. UI 形态（双指标，零新面板）

- chat 头部现有**节省率圆环旁，并列第二个圆环 = 占用率**（`#chat-context-btn`），色阶随百分比变化。
- 悬浮 tooltip 显示完整明细（占用 / 窗口 / 阈值 / 模型 / 来源）。
- 不引入新面板 / 弹窗（防膨胀）。

> ⚠️ 中国习惯红涨绿跌仅用于涨跌；此处是「健康度」，用绿黄橙红色阶。

## 5. 更新机制（轻量）

- **主路径**：前端在「一轮对话完整回复收到后」（`chat-panel._recordTurnMetrics`）调用一次 `GET /api/chat/context-usage`。此时 `MemoryStore.setContextEstimate` 已写回最新值，拉取即准。
- **兜底**：`chat-panel` 切换会话 / 种子加载（`_seedSavingsFromTurnMetrics`）时也触发一次，确保切会话即时归位。
- 默认**不常驻轮询**，只在对话活跃或切换时更新（省资源、防膨胀）。

## 6. 防膨胀清单

- 复用：`ContextWindowManager`（v0.3.1）、`MemoryStore`、`savings-icon.js` 几何、chat 头部圆环 DOM。
- 零新 npm 依赖、零新存储、零新运行时。
- 仅新增 1 端点 + 1 纯函数组件 + header 接入。

## 7. 相关文件

| 文件 | 作用 |
|---|---|
| `routes/chat/index.js` | `GET /api/chat/context-usage` 端点 |
| `lib/memory/index.js` | `MemoryStore.getContextInfo`（readonly 获取 contextEstimate/model） |
| `lib/context-window.js` | `ContextWindowManager.effectiveContext(model)` 三层窗口策略 |
| `public/components/context-usage.js` | 纯函数 `computeContextUsage` |
| `public/components/chat-panel.js` | 头部按钮 `#chat-context-btn` + `updateContextUsage` 拉取/渲染 |
| `public/index.html` | 第二个圆环按钮 DOM |
| `test/context-usage.test.mjs` | 纯函数单测（色阶边界 / pct / 几何 / 文案） |
| `test/context-usage-route.test.js` | 端点单测（400/404/模型映射/回退） |

## 8. 验收

- 开会话多发几轮 → 头部占用率圆环随 `contextEstimate` 增长而填满、变色。
- ≥95% 变红且 tooltip 提示「接近压缩阈值」。
- 设 `HESI_EFFECTIVE_CONTEXT=32000` 重启 → 占用率按 32k 窗口计算（验证 Layer①）。
- 切换会话即时归位。
- 单测：色阶边界（59/60/84/85/94/95/96）、pct 1 位小数、超窗截断、tooltip 文案、端点结构。
