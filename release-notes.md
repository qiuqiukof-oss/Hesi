# Hesi v0.6.1

## 全自动 Phase 1 · auto-Planner（自然语言驱动）
- **自然语言 → Plan**：`plan.html` 新增「自然语言目标」输入框；`POST /api/plan/execute` 支持 `body.objective`，由 `routes/ai-tools/plan-from-nl.js` 调用 LLM 把目标拆解成结构化、机器可验证的 Plan，再复用既有 gate→budget→圆桌→过闸流水线。
- 模型返回非法 JSON 或校验失败时自动修复重试一次；缺 API Key / 模型失败时返回友好错误（含 `code`）。
- 手写 Plan JSON 方式保留（目标留空即走原路径）。

# Hesi v0.5.8

## 核心修复：聊天体验大幅提升

### 多模型兼容（system 消息合并）
修复了 vLLM/SGLang 部署的 qwen/llama 等模型报 `System message must be at the beginning` 400 错误。
- 根因：Hesi 将 SELF_AWARE_PROMPT / memoryBlocks / skillBlocks / 终端上下文展开为多条 role=system 消息
- 修复：展开后合并所有前导 system 为单条（`---` 分隔），标准 OpenAI/Anthropic 行为不变

### 安全熔断从「硬停」改为「降级继续」
参考 WorkBuddy 的上下文压缩不中断模式，将 6 个安全熔断器从 `res.end()` 硬停改为「警告 + 最后一次机会」：

| 熔断器 | 旧行为 | 新行为 |
|---|---|---|
| 总超时（15分钟） | 立即硬停 | 警告 + 继续 1 轮 |
| 工具调用安全上限 | 立即硬停 | 警告 + 继续 1 轮 |
| 精确重复工具调用 | 立即硬停 | 警告 + 继续 1 轮 |
| 窗口重复模式 | 立即硬停 | 警告 + 继续 1 轮 |
| 连续同工具集 | 立即硬停 | 警告 + 重置计数器 |
| 达到最大轮次 | 立即硬停 | 1 次无工具最终回答 |

> 首次触发 → 注入系统警告 → LLM 有一次补救机会 → 二次触发才真正硬停

### 重复工具调用检测放宽
- 窗口从 8 轮 → **16 轮**（可配置：`HESI_DUP_SIG_WINDOW`）
- 阈值从 1 次重复 → **4 次重复**（可配置：`HESI_DUP_SIG_THRESHOLD`）
- 修复了代码探索场景（多次 read_file 同一文件）被误杀的问题

### TTS 停顿缩短
- 句末标点 `。？！` 替换为 `，`（~500ms → ~150ms 停顿）
- 换行 `\n` 同样替换为 `，`
- Edge TTS + Web Speech 双路径覆盖
- **需重启 server + 刷新页面后生效**

---

## 变更文件（6 files, +221/-67）
- `lib/tts/edge-tts.js` — TTS 标点/换行 → 逗号
- `public/voice-output.js` + `bundle.js` — Web Speech TTS 同步修改
- `routes/chat/index.js` — system 消息合并
- `routes/chat/stream-openai.js` — 降级继续 + 放宽重复检测
- `routes/chat/stream-anthropic.js` — 降级继续 + 放宽重复检测（Anthropic 路径）

## 环境变量（可选）
```
HESI_DUP_SIG_WINDOW=16      # 重复签名窗口大小
HESI_DUP_SIG_THRESHOLD=4    # 窗口内重复次数阈值
HESI_LLM_TOOL_LOOP_GUARD=15 # 连续同工具集轮次阈值
```
