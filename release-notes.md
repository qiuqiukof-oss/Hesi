## Hesi v0.5.1

**语音输出 / 工具调用稳定性修复**——上一轮 v0.5.0 实测发现的四个问题，全部修复。

### Bug 修复

#### 1. TTS 只读最后一句（致命）
- 根因：Web Speech `_state.speaking` 只在异步 `onstart` 回调里置位，流式多句几乎同时判定「空闲」→ `synth.cancel()` 把前句全部掐断，只剩末句出声。
- 修复：**`synth.speak()` 同步置忙** + 新增 `isTtsBusy()` 队列守卫，逐句串行合成；Edge TTS 串流队列不受影响。

#### 2. Emoji 被读出来（体验）
- 修复：TTS 文本统一经 `stripEmoji()` 过滤（`\u{1F000}–\u{1FAFF}` 等 7 段 emoji 区间），**无条件关闭** emoji 朗读，保留箭头 `→`、项目符号 `•`、中英文标点。

#### 3. 工具调用状态只显示裸工具名（体验）
- 新增 `routes/chat/tool-labels.js`：映射 31 个内置工具 + MCP/未知回退「工具」。
- 状态文案改为中文「使用「读取工具」「编辑工具」「写入工具」…」，已接入 `stream-openai.js` / `stream-anthropic.js`。

#### 4. 早期对话「幽灵中断」（致命）
- 根因：本地模型（gamma4 / qwen3 等）常「同工具不同参数」循环，旧守卫只去重精确签名 / 8 轮窗口，最终撞 50 轮硬上限静默中断。
- 修复：新增 `TOOL_LOOP_GUARD`（默认 15，env `HESI_LLM_TOOL_LOOP_GUARD`，0=关）连续重复守卫，超阈优雅停止并提示「疑似循环，已停止」。

### 验证
- `npm test` **全绿（300 用例）**
- `npm run lint` **0 error**
- `npm run build:main` ✅ **969.1kb**；`npm run build:lazy` ✅ **263.1kb**
- 涉及文件：voice-output.js / stream-openai.js / stream-anthropic.js / tool-labels.js（新）+ bundle.js（重建）

### 升级注意
- 纯前端 / 路由修复，无新增依赖、无数据迁移；建议浏览器 **Ctrl+Shift+R** 硬刷新加载新 bundle。
- 跨平台说明见仓库 README：服务端与 Web 界面全平台通用（Windows / Linux / macOS 均可 `node server.js` 运行）；仅「离线单文件 SEA 二进制」为 Windows 专用，原生依赖 `node-pty` / `playwright` 为可选，缺失时终端 / 浏览器自动化优雅降级。
