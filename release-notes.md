## Hesi v0.5.0

**验证优先模式 + 语音方案 v1 + 圆桌落座接管（P2.5）+ 记忆时间轴（P2.1）**。
四个新能力 + 一轮系统级 bug 修复 + 体验打磨。

### 新增能力

#### 1. 验证优先模式（Verify-First）
- 聊天面板标题栏新增 🔍 核查开关
- 开启后向系统提示词注入「核查模式已开启」段，强制 AI 先调用工具取证再作答
- 要求 AI 引用具体文件路径:行号，不凭印象回答
- 关闭时零注入、零行为变化

#### 2. 语音方案 v1
**输入侧**
- 麦克风可路由到**聊天输入框**或**终端**（自动判断焦点 / 也可在 🎛️ 设置锁定默认目标）
- 识别后弹**确认条**（可编辑、点重录、切换目标、取消）
- 默认 `autoSend=关` → 确认再发送，保证高识别率（默认 `zh-CN`）

**输出侧（重点优化）**
- AI 回复**边生成边读**（按句末标点增量合成）
- 三档引擎：**Web Speech / Edge TTS / auto（Edge 优先）**
- **Edge TTS**：微软神经语音，通过后端 `edge-tts-universal` 合成（零原生依赖）
- **长文本自动切分**（`splitForSpeech`）解决 Web Speech 长 utterance 截断
- **Edge 流式串行队列**避免多句重叠
- 降级链：Edge → Web Speech → 纯文本

**设置面板**
- 标题栏新增 🎛️ 入口（紧跟麦克风）
- 三项：自动发送 / 识别语言 / 默认发送目标（auto/chat/terminal）

#### 3. 圆桌落座接管（P2.5）
- 圆桌讨论中可**接管**任意 Agent 席位：填「以该 Agent 身份发言」文本，讨论时该席位发言由人工提交代替自动生成
- 内核跳过被接管席位的自动生成，点「归还」恢复自动协作，不影响其他席位
- 纯前端状态 + 内核跳过逻辑，零新依赖

#### 4. 记忆时间轴（P2.1）
- 记忆抽屉（🧠）新增「🕒 时间轴」Tab，纵向时间轴区分消息 / 压缩检查点 / 收益累计节点
- 后端新增只读端点 `GET /api/memory/sessions/:id/timeline`（聚合消息时间戳 + 压缩检查点 + 收益记录）
- 纯函数组件 `memory-timeline.js`，可单测

### Bug 修复
- **致命**：Edge TTS 路由 mount 路径从 `/api` 改为 `/api/tts`（之前整条 Edge 链路静默 404）—— **之前 Edge TTS 一直未生效**
- **致命**：`toEdgeRate` 无效输入 fallback 从 `'+0.00%'` 改为 `'+0%'`，并 clamp 到 `[-90%, +100%]`
- **中度**：语音确认条发送后清空（避免 continuous 重复发送）
- **中度**：`onerror no-speech` 加 `voice.active` 守卫
- **体验**：CSS 变量替换暗色硬编码（亮色主题可读）；i18n 字段补全

### 验证
- `npm test` **全绿（300 用例）**
- `npm run lint` **0 error**（历史遗留警告未引入新增）
- `npm run build:main` ✅ **968.8kb**；`npm run build:lazy` ✅ **263.1kb**
- **Edge TTS 端到端冒烟**：`/api/tts/synthesize` 返回 `200 audio/mpeg`，4 种 rate 边界全测通过；`/api/tts/voices` 返回 322 音色（14 中文）

### 升级注意
- 首次启用 Edge TTS 会联网获取微软音色列表；离线自动降级
- 默认发送目标沿用 localStorage（key: `qcli-voice-input-defaultTarget`），老用户回落到 `auto`

### Commit 范围
本版本累积未推改动共 **10 批**（自 v0.4.5 起）：
1. verify-first（Phase 0 系统提示词 + 🔍 开关）
2. 语音方案 A0+A1+B-core+B-edge（输入泛化 + 流式 TTS）
3. 语音 5 项实测问题修复
4. 语音 2 项体验问题（位置 + 重录）
5. 语音 2 项（Edge null + Web Speech 长文本）
6. 语音目标切换 pin + 默认目标
7. 语音终端路由缺 tabId 修复
8. 本轮审计发现 bug（致命 #1 #2 + 中度 #3 #4 #6）+ 默认目标 UX 反馈
9. P2.5 落座接管（roundtable-view.js 接管/归还控件 + discuss.js 内核跳过 + chat-api/index 透传 takenOver）
10. P2.1 记忆时间轴（sessions.js /timeline 端点 + memory-timeline.js 纯函数组件 + memory-panel.js Tab）
- 冗余清理：移除 discuss.js 两个未使用符号（API_FETCH_TIMEOUT_MS / buildApiUrl）