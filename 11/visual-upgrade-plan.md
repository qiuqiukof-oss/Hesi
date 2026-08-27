# Hesi 全局视觉升级方案

> 纯 CSS 改动，不涉及 JS 逻辑，个人版和企业版通用
> 日期：2026-08-28

---

## 一、现状分析

### 已有的好基础

Hesi 的 `theme.css` 已经定义了完整的 CSS 变量体系（6 套主题）：

```
--bg-ground / --bg-surface / --bg-elevated / --bg-overlay    → 背景层次
--text-primary / --text-secondary / --text-tertiary          → 文字层次
--accent / --accent-hover / --accent-glow                    → 强调色
--border-subtle / --border-default / --border-strong         → 边框层次
--success / --warning / --danger / --info                    → 语义色
--space-1~6 / --radius-sm~xl / --font-ui / --font-mono      → 间距/圆角/字体
```

### 缺少的视觉层

| 缺失项 | 说明 |
|--------|------|
| **Glassmorphism** | 没有组件使用 `backdrop-filter: blur()` |
| **状态光晕** | 没有 `box-shadow` 彩色发光效果 |
| **微交互动画** | 按钮/卡片缺少 hover 过渡、点击反馈 |
| **背景装饰** | 没有网格/渐变等科技感背景 |
| **层级阴影** | 大部分组件用硬编码 `rgba(0,0,0,0.5)` |
| **字体层次** | 缺少 `--font-display`（大标题用）|

---

## 二、视觉风格选项

### 方案 A：Cyber Glass（推荐）科幻玻璃

> 参考：dsh-worktable、Linear、Vercel Dashboard

| 特征 | 实现 |
|------|------|
| 毛玻璃面板 | `backdrop-filter: blur(16px) saturate(120%)` + 半透明背景 |
| 彩色状态光晕 | `box-shadow: 0 0 20px rgba(accent, 0.3)` |
| 微妙渐变 | `background: linear-gradient(135deg, surface, elevated)` |
| 悬停提升 | `transform: translateY(-1px)` + 阴影加深 |
| 细线边框 | `border: 1px solid rgba(255,255,255,0.06)` |
| **适合** | 深色主题为主，科技感强 |

### 方案 B：Soft Depth（柔和层次）

> 参考：Arc Browser、Raycast、Things 3

| 特征 | 实现 |
|------|------|
| 多层阴影 | `box-shadow: 0 1px 2px shadow-ambient, 0 4px 16px shadow-penumbra` |
| 圆润卡片 | `border-radius: 14px` + 内部留白充足 |
| 柔和高亮 | `background: var(--bg-hover)` 替代硬边框 |
| 渐变按钮 | `background: linear-gradient(accent, accent-hover)` |
| **适合** | 亮色/暗色都自然，偏 macOS 风格 |

### 方案 C：Neon Tech（霓虹科技）

> 参考：dsh-worktable 的 neon status glows、Figma 的深色模式

| 特征 | 实现 |
|------|------|
| 霓虹发光 | `box-shadow: 0 0 8px color, 0 0 24px rgba(color, 0.3)` |
| 深色背景 | `background: #0a0a0f`（接近纯黑） |
| 高对比边框 | `border: 1px solid rgba(accent, 0.4)` |
| 旋转动画 | `conic-gradient` 旋转边框（忙碌态） |
| **适合** | 极客风，暗黑场景 |

---

## 三、统一新增 CSS 变量

在 `theme.css` 中新增以下变量（所有主题共用）：

```css
/* ── Glassmorphism ── */
--glass-bg:         rgba(255, 255, 255, 0.03);
--glass-blur:       16px;
--glass-saturate:   120%;

/* ── 层级阴影（替换硬编码 rgba）── */
--shadow-sm:   0 1px 2px var(--shadow-ambient);
--shadow-md:   0 2px 8px var(--shadow-penumbra), 0 1px 2px var(--shadow-ambient);
--shadow-lg:   0 8px 32px var(--shadow-umbra), 0 2px 8px var(--shadow-penumbra);
--shadow-xl:   0 16px 48px var(--shadow-umbra), 0 4px 16px var(--shadow-penumbra);

/* ── 状态光晕 ── */
--glow-accent: 0 0 16px rgba(99, 102, 241, 0.25);
--glow-success: 0 0 12px rgba(34, 197, 94, 0.2);
--glow-warning: 0 0 12px rgba(245, 158, 11, 0.2);
--glow-danger:  0 0 12px rgba(239, 68, 68, 0.2);

/* ── 字体层次 ── */
--font-display: "Inter", var(--font-ui);
--font-mono: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;

/* ── 过渡 ── */
--transition-fast: 0.12s ease;
--transition-base: 0.2s ease;
--transition-slow: 0.3s ease;
```

> 注意：`--shadow-umbra`、`--shadow-penumbra`、`--shadow-ambient` 已在 dark 主题中定义，只需在其他主题补齐即可。

---

## 四、逐组件升级计划

### Phase 1：全局基础（影响所有界面）

| 文件 | 改动 | 效果 |
|------|------|------|
| `theme.css` | 新增上述 CSS 变量 | 所有组件可直接使用 |
| `theme.css` | 补齐亮色/特殊主题的 shadow 变量 | 一致性 |

### Phase 2：侧边栏

| 文件 | 改动 | 效果 |
|------|------|------|
| `sidebar.css` | 按钮加 `transition` + hover 背景 | 悬停反馈 |
| `sidebar.css` | 会话项加 `border-radius: 8px` + hover 光晕 | 圆润 + 活跃感 |
| `sidebar.css` | 折叠/展开动画平滑化 | 流畅过渡 |

### Phase 3：聊天面板

| 文件 | 改动 | 效果 |
|------|------|------|
| `chat.css` | 输入框加 `backdrop-filter: blur(8px)` | 毛玻璃输入区 |
| `chat.css` | 消息气泡加 `box-shadow: var(--shadow-sm)` | 层次感 |
| `chat.css` | 用户气泡用 `accent-gradient` 背景 | 品牌色气泡 |
| `chat.css` | 工具栏按钮加 hover/active 过渡 | 交互反馈 |
| `chat-bubble.css` | 代码块加 `background: var(--bg-inset)` + 圆角 | 代码区更清晰 |
| `chat-bubble.css` | 引用块加左边框 accent 色 | 引用更醒目 |

### Phase 4：弹窗/Modal

| 文件 | 改动 | 效果 |
|------|------|------|
| `modal.css` | overlay 已有 `backdrop-filter: blur(8px)` ✅ | 已完成 |
| `modal.css` | 面板加 `box-shadow: var(--shadow-xl)` | 深度感 |
| `modal.css` | 按钮加渐变背景 + hover 亮度变化 | 按钮更生动 |

### Phase 5：工作台卡片（worktable）

| 文件 | 改动 | 效果 |
|------|------|------|
| `worktable-panel.css` | 卡片用 `--glass-bg` + `backdrop-filter` | 毛玻璃卡片 |
| `worktable-panel.css` | 状态光晕用 `--glow-*` 变量 | 统一发光 |
| `worktable-panel.css` | Blueprint 网格用 `--accent` 低透明度 | 品牌色网格 |

### Phase 6：终端/编辑器区

| 文件 | 改动 | 效果 |
|------|------|------|
| `terminal.css` | xterm 容器加 `border-radius` + 微阴影 | 终端区更精致 |
| `terminal.css` | 标签栏加 `backdrop-filter` | 毛玻璃标签 |

---

## 五、实施优先级

```
Phase 1（1 小时）：CSS 变量补齐
  └── theme.css 新增 glass/shadow/glow/font 变量

Phase 2（2 小时）：侧边栏 + 聊天面板（用户最高频界面）
  ├── sidebar.css：按钮过渡 + 会话项圆角
  ├── chat.css：输入框毛玻璃 + 消息气泡阴影
  └── chat-bubble.css：代码块 + 引用块美化

Phase 3（1 小时）：弹窗 + 工具栏
  ├── modal.css：面板阴影
  └── 各工具栏按钮 hover 过渡

Phase 4（1 小时）：终端 + 工作台
  ├── terminal.css：容器圆角
  └── worktable-panel.css：卡片毛玻璃

总计：~5 小时，纯 CSS 改动，~300 行代码
```

---

## 六、视觉对比示例

### 侧边栏按钮（升级前 → 升级后）

```
升级前：
┌──────────────────┐
│ 📟 终端上下文     │  ← 无过渡，点击无反馈
└──────────────────┘

升级后：
┌──────────────────┐
│ 📟 终端上下文     │  ← hover: 背景渐亮 + 微上浮
└──────────────────┘    active: 缩小 0.98 + 背景加深
```

### 聊天消息气泡（升级前 → 升级后）

```
升级前：
┌─────────────────────────┐
│ 你好！我是 Hesi 的 AI   │  ← 纯色背景，无层次
│ 助手。                   │
└─────────────────────────┘

升级后：
╭─────────────────────────╮
│ 你好！我是 Hesi 的 AI   │  ← 微阴影 + 圆角加大
│ 助手。                   │    用户气泡: accent 渐变
╰─────────────────────────╯
```

### 卡片/面板（升级前 → 升级后）

```
升级前：               升级后：
┌──────────┐          ╭──────────╮
│ 项目 A   │          │ 项目 A   │  ← backdrop-filter
│ 📁 path  │          │ 📁 path  │    + 彩色光晕
└──────────┘          ╰──────────╯    + 悬停提升
```

---

## 七、注意事项

1. **性能**：`backdrop-filter` 在大面积使用时可能影响性能，建议限制在小区域（工具栏、弹窗、卡片）
2. **兼容性**：`backdrop-filter` 需要 `-webkit-` 前缀（Safari）
3. **亮色主题**：Glassmorphism 在亮色下效果较弱，需要调整 `--glass-bg` 透明度
4. **无障碍**：悬停效果不能替代 focus 样式，确保键盘导航可见
5. **渐进式**：可以一个 Phase 一个 Phase 地做，每个 Phase 独立可测试

---

## 八、总结

| 维度 | 评估 |
|------|------|
| **改动范围** | 纯 CSS，~300 行 |
| **文件数** | ~8 个 CSS 文件 |
| **JS 改动** | 零 |
| **依赖变化** | 零 |
| **风险** | 极低（样式改动不影响逻辑） |
| **个人版/企业版** | 通用 |
| **实施周期** | ~5 小时 |
| **核心价值** | 统一视觉语言，提升产品质感 |
