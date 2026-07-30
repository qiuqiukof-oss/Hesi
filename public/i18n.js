/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi i18n Module — extracted from app.js
// ============================================================
'use strict';

import { safeStorage } from './lib/storage.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ============================================================
  // Internationalisation (i18n) — 中文 / English
  // ============================================================
  export const _locale = {
    current: 'zh',
    _data: {
      zh: {
        'app.title': 'Hesi',
        'sidebar.toggle.expand': '展开侧边栏',
        'sidebar.toggle.collapse': '折叠侧边栏',
        'sidebar.resize': '拖动调整侧边栏宽度',
        'chat.resize': '拖动调整聊天面板高度',
        'chat.title': 'AI 对话',
        'chat.subtitle': '与 AI 助手交流',
        'chat.clear': '清空对话',
        'chat.close': '关闭聊天面板',
        'chat.sender.ai': 'AI 助手',
        'chat.sender.you': 'You',
        'chat.welcome': '你好！我是 Hesi 的 AI 助手。你可以问我关于 CLI 工具的问题，或者让我帮你分析终端输出。😊',
        'chat.input.placeholder': '输入消息… (Enter 发送, Shift+Enter 换行)',
        'chat.send': '发送消息',
        'chat.clearConfirm': '确定清空所有对话记录？',
        'welcome.title': 'Hesi',
        'welcome.subtitle': '让多个 AI 合在一起思考的地方<br>运行任何 CLI，连接任何 Agent，控制任何浏览器',
        'footer.title': 'Hesi v1.0.0',
        'carousel.prev': '上一个',
        'carousel.next': '下一个',
        'carousel.dot0': '快速开始 + CLI 分类',
        'carousel.dot1': '快捷键 + 使用技巧',
        'carousel.dot2': '安装指南',
        'carousel.dot3': 'LLM 大模型配置',
        'media.prev': '上一个',
        'media.next': '下一个',
        'media.download': '下载',
        'media.close': '关闭 (Esc)',
        'upload.drop': 'Drop files to upload',
        'palette.shortcutHint': 'Search commands and CLIs…',
        'status.connected': '已连接',
        'status.disconnected': '未连接',
        'status.reconnecting': '重新连接中…',
        'status.error': '连接错误',
        'cli.notRunning': '没有运行的 CLI',
        'cli.starting': '正在启动 %s…',
        'cli.noResults': '没有匹配 "%s" 的 CLI',
        'cli.empty': '没有找到 CLI，点击 + 添加',
        'cli.removed': '已删除 %s',
        'cli.moved': 'CLI 已移动',
        'cli.deleteConfirm': '删除文件夹 "%s"？CLI 不会被删除。',
        'cli.createdFolder': '已创建文件夹 "%s"',
        'cli.folderDeleted': '文件夹已删除',
        'cli.discovered': '发现了 %d 个新 CLI',
        'cli.discovered.one': '发现了 1 个新 CLI',
        'cli.added': '已添加 %s',
        'cli.addError': '添加 CLI 失败',
        'connLost.title': '连接断开 — 点击重新连接',
        'connLost.hint': '将自动重试 10 次（指数退避）',
        'theme.light': '切换到亮色主题',
        'theme.dark': '切换到深色主题',
        'lang.switch': '切换语言',
        'voice.title': '语音输入 — 说话转文字，自动路由到聊天或终端',
        'voice.inputSettings': '语音输入设置',
        'voice.defaultTargetLabel': '默认发送目标',
        'voice.effectiveTarget': '当前生效',
        'voice.notSupported': '当前浏览器不支持语音识别，请使用 Chrome 或 Edge。',
        'voice.active': '语音输入已启用 — 说出你的命令',
        'voice.microphoneError': '无法启动麦克风，请检查权限。',
        'voice.listening': '正在聆听…',
        'voice.error': '语音识别错误: %s',
        'voice.tts.enabled': '语音输出已开启',
        'voice.tts.disabled': '语音输出已关闭',
        'voice.tts.speaking': '正在朗读...',
        'voice.tts.autoRead': 'AI 回复自动朗读',
        'voice.tts.settings': '语音输出设置',
        'voice.tts.rate': '语速',
        'voice.tts.pitch': '音高',
        'voice.tts.volume': '音量',
        'voice.tts.language': '朗读语言',
        'voice.tts.voice': '发音人',
        'voice.tts.test': '测试语音',
        'voice.tts.auto': '自动检测',
        'voice.tts.zh': '中文',
        'voice.tts.en': 'English',
        'voice.tts.longContent': 'AI 回复内容较长，请在聊天面板中阅读',
        'upload.uploading': '正在上传 %d 个文件…',
        'upload.uploading.one': '正在上传 1 个文件…',
        'upload.failed': '上传失败: %s',
        'upload.success': '已上传 %d 个文件',
        'upload.success.one': '已上传 1 个文件',
        'upload.clickPreview': '📷 %d 个文件已上传 — 点击预览',
        'upload.clickPreview.one': '📷 1 个文件已上传 — 点击预览',
        'upload.clickHint': '[点击上方路径或通知预览]',
        'upload.terminalPrefix': '[已上传: %s]',
        'upload.fileNotFound': '文件未找到: %s',
        'upload.notPreviewable': '不是可预览的文件: %s',
        'upload.couldNotOpen': '无法打开: %s',
        'exit.code': '[进程已退出，状态码 %d]',
        'exit.signal': '[进程被信号 %s 终止]',
        'palette.actionsLabel': '操作',
        'palette.footerHint': '↑↓ 导航 · ↵ 确认 · Esc 关闭',
        'palette.searchEmpty': '输入进行搜索…',
        'palette.noResults': '没有找到 "%s" 的结果',
        'palette.clisLabel': 'CLIs (%d)',
        'chat.response1': '这是一个很好的问题！让我想想… 🤔\n\n根据我的分析，您可能有以下选择：\n\n1. **使用 grep** — `grep -r "pattern" .` 可以递归搜索文件内容\n2. **使用 find** — `find . -name "*.js"` 可以按文件名查找\n3. **使用 ag (Silver Searcher)** — 比 grep 更快，语法类似',
        'chat.response2': '明白了！我来帮您梳理一下思路：\n\n- ✅ 方案 A：直接使用现有 CLI 工具\n- 🔄 方案 B：编写自定义脚本\n- 🚀 方案 C：结合多个工具形成工作流\n\n您倾向于哪种方案？我可以提供更具体的指导。',
        'chat.response3': '好的，让我查看一下当前终端的上下文环境…\n\n您当前连接到了 **Hesi**，这是一个浏览器的 CLI 管理平台。您可以：\n\n1. 点击左侧 CLI 列表启动任意工具\n2. 使用 **Ctrl+K** 打开命令面板\n3. 拖拽文件到终端区域上传文件\n4. 点击 **🎤** 按钮使用语音输入\n\n有什么具体需要帮助的吗？',
        'chat.response4': '我来帮您分析一下这个命令的效果：\n\n```\n$ your-command --option value\n```\n\n这个命令会：\n1. 加载配置文件\n2. 处理输入数据\n3. 输出结果到终端\n\n建议添加 `--help` 参数查看完整的选项列表。还有别的需要了解的吗？ 😊',
        'ai.needsKey': '请先在 AI 设置中配置 API Key',
        'ai.saved': '✅ AI 配置已保存',
        'modal.addTitle': '添加 CLI',
        'modal.nameLabel': '名称',
        'modal.execLabel': '可执行文件',
        'modal.browseBtn': '浏览…',
        'modal.pathLabel': '完整路径（留空则根据名称自动查找）',
        'modal.argsLabel': '参数（可选，空格分隔）',
        'modal.cancelBtn': '取消',
        'modal.submitBtn': '添加',
        'modal.adding': '添加中…',
        'modal.noFile': '未选择文件',
        'quickstart.title': '🚀 快速开始',
        'quickstart.step1': '选择 CLI',
        'quickstart.step1.desc': '点击左侧 CLIs 列表中的任意工具',
        'quickstart.step2': '开始使用',
        'quickstart.step2.desc': '终端自动启动，直接输入命令操作',
        'quickstart.step3': '随时切换',
        'quickstart.step3.desc': '点击其他 CLI 即可切换，运行状态互不干扰',
        'categories.title': '📊 CLI 分类',
        'categories.agent': '🤖 Agent',
        'categories.agent.desc': 'AI 编程助手 — OpenCode、Codebuff、CODEX 等',
        'categories.env': '📂 Env',
        'categories.env.desc': '开发环境 — Shell、编程语言运行时、WSL 等',
        'categories.tool': '🔧 Tool',
        'categories.tool.desc': '工具类 — Git、编辑器、数据库客户端、网络工具等',
        'shortcuts.title': '⌨️ 快捷键',
        'install.title': '📦 安装指南',
        'install.npm': 'npm 安装',
        'install.usage': '使用',
        'install.projectUrl': '项目地址',
        'install.note.codebuff': '💡 Codebuff 在您的本地机器上名为 %s（免费版），已自动注册。',
        'install.note.codex': '💡 安装后点击侧边栏 %s 刷新即可自动发现。也可通过 %s 手动添加。',
        // ── Welcome page: section headings ──
        'install.ai': '🤖 AI 智能体（一键安装）',
        'install.manual': '🛠️ 其他Agent CLI（手动安装）',
        'welcome.sec.features': '⭐ 特色功能',
        'welcome.sec.usb': '🚀 U 盘智能体 使用指南',
        // ── Welcome page: manual install cards ──
        'install.claude.desc': 'Anthropic 终端代理',
        'install.codebuff.desc': '自动化代码编写',
        'install.codex.desc': 'OpenAI Codex CLI',
        'install.mimocode.desc': 'mimocode 终端智能体',
        'install.claude.note': '需 Anthropic API Key',
        'install.codex.note': '需 OpenAI API Key',
        'install.mimocode.note': '需 mimocode 账号 Token',
        'install.ai.note': '点击 <strong>⚡ 一键安装</strong> 即可集成智能体；U 盘版已随附离线包，插上即用、无需联网。开发版也可在左侧 <strong>Agent 面板</strong> 查看与管理。',
        // ── Agent install UI (one-click) ──
        'agent.empty': '暂无可安装的智能体。',
        'agent.loadfail': '加载安装列表失败：',
        'agent.status.notinstalled': '未安装',
        'agent.status.installing': '安装中…',
        'agent.status.installed': '已安装',
        'agent.status.failed': '安装失败',
        'agent.btn.install': '⚡ 一键安装',
        'agent.btn.cancel': '取消',
        'agent.btn.retry': '重试',
        'agent.btn.reinstall': '重新安装',
        'agent.offline': '🟢 离线包可用',
        // ── Welcome page: tip chips (slide 1) ──
        'tip.search': '<strong>搜索框</strong> 过滤 CLI 列表',
        'tip.folder': '<strong>文件夹</strong> 分组管理工具',
        'tip.drag': '拖拽文件 <strong>上传</strong>',
        'tip.discover': '<strong>⟳</strong> 自动发现 CLI',
        'tip.ai': 'AI 助手感知终端上下文',
        'tip.url': 'URL/路径自动可点击',
        // ── Welcome page: USB guide (slide 2) ──
        'usb.card1.title': '插上即用',
        'usb.card1.desc': 'U 盘版集成 OpenCode 与 OhMyOpenAgent，无需联网安装',
        'usb.card2.title': '启动 OpenCode',
        'usb.card2.desc': '终端输入 <code>opencode</code> 进入 AI 编程模式',
        'usb.card3.title': '多 Agent 编排',
        'usb.card3.desc': '用 OhMyOpenAgent 组合多个智能体工作流',
        'usb.tip1': '<code>opencode "写个组件"</code> 直接传参',
        'usb.tip2': '<code>--model claude-sonnet-4</code> 指定模型',
        'usb.tip3': '<strong>OMA</strong> 用 YAML/JSON 定义 Agent 流水线',
        'usb.tip4': '<strong>文件操作</strong> AI 读写 + diff 展示',
        'usb.tip5': '<strong>Git 集成</strong> 建议 feature 分支使用',
        'usb.tip6': '<strong>搭配 Hesi</strong> 管理多 Agent 会话',
        'usb.warn.title': '⚠️ 使用前必读',
        'usb.warn1': 'AI 生成代码务必 <strong>审查后再提交</strong>',
        'usb.warn2': '不要包含 API Key 等 <strong>敏感信息</strong>',
        'usb.warn3': '离线版模型需本地 / 私有部署支持',
        'usb.warn4': '大型重构分步骤进行',
        'tips.title': '💡 使用技巧',
        'tips.1': '使用 **搜索框** 快速过滤 CLI 列表',
        'tips.2': '点击顶部分类标签切换 **Agent / Env / Tool** 视图',
        'tips.3': '创建 **文件夹** 分组管理你的 CLI 工具',
        'tips.4': '**拖拽** CLI 到文件夹中进行归类',
        'tips.5': '拖拽文件到终端区域可快速 **上传文件**',
        'tips.6': '点击 **⟳** 按钮从 PATH 自动发现新 CLI',
      },
      en: {
        'app.title': 'Hesi',
        'sidebar.toggle.expand': 'Expand sidebar',
        'sidebar.toggle.collapse': 'Collapse sidebar',
        'sidebar.resize': 'Drag to resize sidebar',
        'chat.resize': 'Drag to resize chat panel',
        'chat.title': 'AI Chat',
        'chat.subtitle': 'Chat with AI Assistant',
        'chat.clear': 'Clear chat',
        'chat.close': 'Close chat',
        'chat.sender.ai': 'AI Assistant',
        'chat.sender.you': 'You',
        'chat.welcome': 'Hello! I\'m the Hesi AI assistant. Ask me about CLI tools or let me help analyze terminal output. 😊',
        'chat.input.placeholder': 'Type a message… (Enter to send, Shift+Enter new line)',
        'chat.send': 'Send message',
        'chat.clearConfirm': 'Clear all chat history?',
        'welcome.title': 'Hesi',
        'welcome.subtitle': 'Where Multiple AI Agents Think Together<br>Run any CLI, connect any Agent, control any browser',
        'footer.title': 'Hesi v1.0.0',
        'carousel.prev': 'Previous',
        'carousel.next': 'Next',
        'carousel.dot0': 'Quick Start + CLI Categories',
        'carousel.dot1': 'Keyboard Shortcuts + Tips',
        'carousel.dot2': 'Installation Guide',
        'carousel.dot3': 'LLM Model Setup',
        'media.prev': 'Previous',
        'media.next': 'Next',
        'media.download': 'Download',
        'media.close': 'Close (Esc)',
        'upload.drop': 'Drop files to upload',
        'palette.shortcutHint': 'Search commands and CLIs…',
        'status.connected': 'Connected',
        'status.disconnected': 'Disconnected',
        'status.reconnecting': 'Reconnecting…',
        'status.error': 'Connection error',
        'cli.notRunning': 'No CLI running',
        'cli.starting': 'Starting %s…',
        'cli.noResults': 'No CLIs match "%s"',
        'cli.empty': 'No CLIs found. Click + to add.',
        'cli.removed': 'Removed %s',
        'cli.moved': 'CLI moved',
        'cli.deleteConfirm': 'Delete folder "%s"? CLIs will not be removed.',
        'cli.createdFolder': 'Created folder "%s"',
        'cli.folderDeleted': 'Folder deleted',
        'cli.discovered': 'Found %d new CLIs',
        'cli.discovered.one': 'Found 1 new CLI',
        'cli.added': 'Added %s',
        'cli.addError': 'Failed to add CLI',
        'connLost.title': 'Connection lost — click to reconnect',
        'connLost.hint': 'Auto-reconnect will attempt 10 times with exponential backoff',
        'theme.light': 'Switch to light theme',
        'theme.dark': 'Switch to dark theme',
        'lang.switch': 'Switch language',
        'voice.title': 'Voice Input — speak to text, auto-route to chat or terminal',
        'voice.inputSettings': 'Voice Input Settings',
        'voice.defaultTargetLabel': 'Default Target',
        'voice.effectiveTarget': 'Effective',
        'voice.notSupported': 'Speech recognition not available in this browser. Try Chrome or Edge.',
        'voice.active': 'Voice input active — speak your command',
        'voice.microphoneError': 'Could not start microphone. Check permissions.',
        'voice.listening': 'Listening…',
        'voice.error': 'Voice error: %s',
        'voice.tts.enabled': 'Voice output enabled',
        'voice.tts.disabled': 'Voice output disabled',
        'voice.tts.speaking': 'Speaking...',
        'voice.tts.autoRead': 'Auto-read AI responses',
        'voice.tts.settings': 'Voice Output Settings',
        'voice.tts.rate': 'Speed',
        'voice.tts.pitch': 'Pitch',
        'voice.tts.volume': 'Volume',
        'voice.tts.language': 'Language',
        'voice.tts.voice': 'Voice',
        'voice.tts.test': 'Test Voice',
        'voice.tts.auto': 'Auto Detect',
        'voice.tts.zh': '中文',
        'voice.tts.en': 'English',
        'voice.tts.longContent': 'Response is too long, please read in chat panel',
        'upload.uploading': 'Uploading %d files…',
        'upload.uploading.one': 'Uploading 1 file…',
        'upload.failed': 'Upload failed: %s',
        'upload.success': 'Uploaded %d files',
        'upload.success.one': 'Uploaded 1 file',
        'upload.clickPreview': '📷 %d files uploaded — click to preview',
        'upload.clickPreview.one': '📷 1 file uploaded — click to preview',
        'upload.clickHint': '[Click paths above or toast to preview]',
        'upload.terminalPrefix': '[Uploaded: %s]',
        'upload.fileNotFound': 'File not found: %s',
        'upload.notPreviewable': 'Not a previewable file: %s',
        'upload.couldNotOpen': 'Could not open: %s',
        'exit.code': '[Process exited with code %d]',
        'exit.signal': '[Process killed by signal %s]',
        'palette.actionsLabel': 'Actions',
        'palette.footerHint': '↑↓ navigate · ↵ select · Esc close',
        'palette.searchEmpty': 'Type to search…',
        'palette.noResults': 'No results for "%s"',
        'palette.clisLabel': 'CLIs (%d)',
        'chat.response1': 'Great question! Let me think… 🤔\n\nBased on my analysis, you have several options:\n\n1. **Use grep** — `grep -r "pattern" .` recursively searches file content\n2. **Use find** — `find . -name "*.js"` finds files by name\n3. **Use ag (Silver Searcher)** — faster than grep, similar syntax',
        'chat.response2': 'Understood! Let me break it down:\n\n- ✅ Option A: Use existing CLI tools directly\n- 🔄 Option B: Write a custom script\n- 🚀 Option C: Combine multiple tools into a workflow\n\nWhich approach do you prefer? I can provide more specific guidance.',
        'chat.response3': 'Let me check the current terminal context…\n\nYou\'re connected to **Hesi**, a browser-based CLI management platform. You can:\n\n1. Click any CLI in the left sidebar to launch it\n2. Press **Ctrl+K** to open the command palette\n3. Drag files onto the terminal area to upload\n4. Click the **🎤** button to use voice input\n\nWhat would you like help with?',
        'chat.response4': 'Let me analyze this command for you:\n\n```\n$ your-command --option value\n```\n\nThis command will:\n1. Load configuration file\n2. Process input data\n3. Output results to terminal\n\nTry adding `--help` to see the full list of options. Anything else you\'d like to know? 😊',
        'ai.needsKey': 'Please configure an API Key in AI Settings',
        'ai.saved': '✅ AI configuration saved',
        'modal.addTitle': 'Add CLI',
        'modal.nameLabel': 'Name',
        'modal.execLabel': 'Executable',
        'modal.browseBtn': 'Browse…',
        'modal.pathLabel': 'Full path (or leave blank to auto-resolve from name)',
        'modal.argsLabel': 'Arguments (optional, space-separated)',
        'modal.cancelBtn': 'Cancel',
        'modal.submitBtn': 'Add',
        'modal.adding': 'Adding…',
        'modal.noFile': 'No file selected',
        'quickstart.title': '🚀 Quick Start',
        'quickstart.step1': 'Select CLI',
        'quickstart.step1.desc': 'Click any CLI in the left sidebar',
        'quickstart.step2': 'Start Using',
        'quickstart.step2.desc': 'Terminal starts automatically, type commands to operate',
        'quickstart.step3': 'Switch Anytime',
        'quickstart.step3.desc': 'Click another CLI to switch, sessions run independently',
        'categories.title': '📊 CLI Categories',
        'categories.agent': '🤖 Agent',
        'categories.agent.desc': 'AI Coding Assistants — OpenCode, Codebuff, CODEX',
        'categories.env': '📂 Env',
        'categories.env.desc': 'Development Environment — Shell, Runtimes, WSL',
        'categories.tool': '🔧 Tool',
        'categories.tool.desc': 'Tools — Git, Editors, Database Clients, Network Tools',
        'shortcuts.title': '⌨️ Keyboard Shortcuts',
        'install.title': '📦 Installation Guide',
        'install.npm': 'npm install',
        'install.usage': 'Usage',
        'install.projectUrl': 'Project URL',
        'install.note.codebuff': '💡 Codebuff is called %s on your machine (free version), already registered.',
        'install.note.codex': '💡 After installation, click %s in the sidebar to auto-discover. You can also add it via %s.',
        // ── Welcome page: section headings ──
        'install.ai': '🤖 AI Agents (One-click Install)',
        'install.manual': '🛠️ Other Agent CLIs (Manual Install)',
        'welcome.sec.features': '⭐ Features',
        'welcome.sec.usb': '🚀 USB Agent User Guide',
        // ── Welcome page: manual install cards ──
        'install.claude.desc': 'Anthropic terminal agent',
        'install.codebuff.desc': 'Automated code writing',
        'install.codex.desc': 'OpenAI Codex CLI',
        'install.mimocode.desc': 'mimocode terminal agent',
        'install.claude.note': 'Requires Anthropic API Key',
        'install.codex.note': 'Requires OpenAI API Key',
        'install.mimocode.note': 'Requires mimocode account Token',
        'install.ai.note': 'Click <strong>⚡ Install</strong> to integrate the agent. The USB edition ships an offline bundle — plug in and use, no internet needed. In dev builds you can also manage it from the left <strong>Agent panel</strong>.',
        // ── Agent install UI (one-click) ──
        'agent.empty': 'No installable agents available.',
        'agent.loadfail': 'Failed to load install list: ',
        'agent.status.notinstalled': 'Not installed',
        'agent.status.installing': 'Installing…',
        'agent.status.installed': 'Installed',
        'agent.status.failed': 'Install failed',
        'agent.btn.install': '⚡ Install',
        'agent.btn.cancel': 'Cancel',
        'agent.btn.retry': 'Retry',
        'agent.btn.reinstall': 'Reinstall',
        'agent.offline': '🟢 Offline bundle available',
        // ── Welcome page: tip chips (slide 1) ──
        'tip.search': '<strong>Search box</strong> filter CLI list',
        'tip.folder': '<strong>Folders</strong> group your tools',
        'tip.drag': 'Drag files to <strong>upload</strong>',
        'tip.discover': '<strong>⟳</strong> auto-discover CLIs',
        'tip.ai': 'AI assistant aware of terminal context',
        'tip.url': 'URLs/paths auto-clickable',
        // ── Welcome page: USB guide (slide 2) ──
        'usb.card1.title': 'Plug & play',
        'usb.card1.desc': 'USB edition bundles OpenCode & OhMyOpenAgent, no internet needed',
        'usb.card2.title': 'Launch OpenCode',
        'usb.card2.desc': 'Type <code>opencode</code> in terminal to enter AI coding mode',
        'usb.card3.title': 'Multi-Agent orchestration',
        'usb.card3.desc': 'Compose multi-agent workflows with OhMyOpenAgent',
        'usb.tip1': '<code>opencode "write a component"</code> pass args directly',
        'usb.tip2': '<code>--model claude-sonnet-4</code> specify model',
        'usb.tip3': '<strong>OMA</strong> define agent pipelines in YAML/JSON',
        'usb.tip4': '<strong>File ops</strong> AI read/write + diff view',
        'usb.tip5': '<strong>Git integration</strong> use a feature branch',
        'usb.tip6': '<strong>With Hesi</strong> manage multi-agent sessions',
        'usb.warn.title': '⚠️ Read before use',
        'usb.warn1': 'Always <strong>review AI-generated code</strong> before committing',
        'usb.warn2': 'Do not include <strong>sensitive info</strong> like API keys',
        'usb.warn3': 'Offline models need local/private deployment',
        'usb.warn4': 'Break large refactors into steps',
        'tips.title': '💡 Tips & Tricks',
        'tips.1': 'Use the **search bar** to quickly filter CLIs',
        'tips.2': 'Click category chips to switch **Agent / Env / Tool** view',
        'tips.3': 'Create **folders** to organize your CLI tools',
        'tips.4': '**Drag** CLIs into folders to categorize them',
        'tips.5': 'Drag files onto the terminal area to **upload**',
        'tips.6': 'Click **⟳** to auto-discover new CLIs from PATH',
      }
    },
  };

  /** Translate key to current language, with optional printf-style arguments */
  export function __(key) {
    const lang = _locale.current;
    const dict = _locale._data[lang] || _locale._data.zh;
    let str = dict[key];
    if (str === undefined) {
      // Fallback to zh
      str = _locale._data.zh[key];
    }
    if (str === undefined) return key;

    // Handle %d and %s arguments
    const args = Array.prototype.slice.call(arguments, 1);
    if (args.length) {
      args.forEach(function(arg) {
        str = str.replace(/%[sd]/, String(arg));
      });
    }
    return str;
  }

  /** Plural helper: pick singular or plural key based on count */
  export function __n(singularKey, pluralKey, count) {
    const key = count === 1 ? singularKey : pluralKey;
    const args = Array.prototype.slice.call(arguments, 3);
    args.unshift(key);
    return __.apply(null, args);
  }

  export function getCurrentLang() {
    return _locale.current;
  }

  export function setLanguage(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    _locale.current = lang;
    safeStorage.set('qcli-lang', lang);
    applyLanguage();
    // Update toggle button text
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) btn.textContent = lang === 'zh' ? '中' : 'EN';
  }

  /** Apply current language to all elements with data-i18n attributes */
  export function applyLanguage() {
    // Update doc title
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const key = titleEl.getAttribute('data-i18n');
      if (key) titleEl.textContent = __(key);
    }

    // data-i18n: sets textContent
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = __(key);
    });

    // data-i18n-title: sets title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = __(key);
    });

    // data-i18n-placeholder: sets placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = __(key);
    });

    // data-i18n-html: sets innerHTML (for strings containing markup)
    document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = __(key);
    });

    // Update sidebar toggle button title based on collapsed state
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (sidebar && toggleBtn) {
      const isCollapsed = sidebar.classList.contains('collapsed');
      toggleBtn.title = isCollapsed ? __('sidebar.toggle.expand') : __('sidebar.toggle.collapse');
    }

    // Update connection lost text (generated in JS, not static HTML)
    const clBody = document.querySelector('#connection-lost .cl-body p');
    if (clBody) {
      // Only update if it's the default text (not a custom message)
      // The connection lost text is set by setConnectionStatus, skip here
    }

    // Update greeting in chat welcome message
    const welcomeMsg = document.querySelector('.welcome-msg .msg-sender');
    if (welcomeMsg && welcomeMsg.getAttribute('data-i18n') === 'chat.sender.ai') {
      welcomeMsg.textContent = __('chat.sender.ai');
    }
    const welcomeBubble = document.querySelector('.welcome-msg .msg-bubble');
    if (welcomeBubble && welcomeBubble.getAttribute('data-i18n') === 'chat.welcome') {
      welcomeBubble.textContent = __('chat.welcome');
    }

    // Re-render chat messages if any exist (to update sender names)
    const chatMsgs = document.querySelectorAll('#chat-messages .chat-message:not(.welcome-msg)');
    chatMsgs.forEach(function(msgEl) {
      const senderEl = msgEl.querySelector('.msg-sender');
      if (senderEl && !senderEl.getAttribute('data-i18n')) {
        // Update user/assistant labels based on message class
        if (msgEl.classList.contains('user-message')) {
          senderEl.textContent = __('chat.sender.you');
        } else {
          senderEl.textContent = __('chat.sender.ai');
        }
      }
    });

    // Update greeting text in the cached welcome HTML used by clearChatHistory
    // This is handled by re-applying on next render

    // Update theme toggle tooltip
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      themeBtn.title = isDark ? __('theme.dark') : __('theme.light');
    }

    // Update carousel dot titles
    document.querySelectorAll('.carousel-dot').forEach(function(dot) {
      const slideIdx = parseInt(dot.getAttribute('data-slide'), 10);
      const key = 'carousel.dot' + slideIdx;
      const t = __(key);
      if (t !== key) dot.title = t;
    });

    // Notify dynamic renderers (welcome carousel, agent-install UI) so they
    // can re-render their content in the new language.
    try {
      window.dispatchEvent(new CustomEvent('qcli:langchange'));
    } catch (e) { /* ignore */ }
  }

  // ============================================================

  // Expose helpers on QCLI namespace
  Q.__ = __;
  Q.__n = __n;
  Q.getCurrentLang = getCurrentLang;
  Q.setLanguage = setLanguage;
  Q.applyLanguage = applyLanguage;
  Q._locale = _locale;
