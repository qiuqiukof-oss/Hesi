# Hesi 玻璃拟态视觉升级方案

> 风格：Nocturne Glassmorphism（StyleKit 规范）
> 范围：所有页面、所有分页、所有独立页面
> 集成方式：融合到主题切换器，作为可切换的视觉风格层
> 纯 CSS + 少量 JS（切换开关），个人版/企业版通用
> 日期：2026-08-28

---

## 零、集成架构：融合主题切换器

### 现有主题系统

```js
document.documentElement.setAttribute('data-theme', 'dark');  // 配色方案
document.documentElement.setAttribute('data-scheme', 'dark'); // 明暗基调
```

支持的配色：dark / light / quiet / xuan / xuanye / cyber（6 套）

### 新增视觉风格层

```js
document.documentElement.setAttribute('data-style', 'glass'); // 视觉风格
```

| 值 | 效果 |
|----|------|
| `default` | 当前风格（无玻璃效果） |
| `glass` | Nocturne Glassmorphism |

### CSS 选择器作用域

```css
/* 默认风格 — 现有样式不变 */
#sidebar { background: var(--bg-elevated); }

/* 玻璃风格 — 只在 data-style="glass" 时覆盖 */
[data-style="glass"] #sidebar {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur-heavy)) saturate(var(--glass-saturate));
}
```

### 用户体验

用户可以自由组合任意 配色 × 风格：

| 配色 | 风格 | 效果 |
|------|------|------|
| dark | default | 现有暗黑主题（不变） |
| dark | glass | 暗黑 + 玻璃拟态 ✨ |
| light | default | 现有亮色主题（不变） |
| light | glass | 亮色 + 玻璃拟态 ✨ |
| quiet | glass | 静谧 + 玻璃拟态 |
| xuan | glass | 宣纸 + 玻璃拟态 |
| cyber | glass | 深空 + 玻璃拟态 |

### 切换入口

在现有主题切换器中新增「视觉风格」下拉：

```
┌─ 主题设置 ─────────────────────┐
│ 配色方案：[暗黑 ▾]              │
│ 视觉风格：[玻璃拟态 ▾]          │  ← 新增
│ 字体大小：[标准 ▾]              │
└──────────────────────────────────┘
```

### 持久化

```js
// 存储到 localStorage
localStorage.setItem('qcli-ui-style', 'glass');

// 页面加载时恢复
const style = localStorage.getItem('qcli-ui-style') || 'default';
document.documentElement.setAttribute('data-style', style);
```

---

## 一、StyleKit Glassmorphism 核心规范摘要

### 设计哲学

> 玻璃拟态的本质是光学，不是配色。真实的玻璃没有颜色——它只是借用、弯曲、柔化背后的光。

**五条铁律：**
1. **玻璃无色** — 面板只用白色低透明度（5%-12%），所有颜色来自背景场景
2. **深色夜景** — 背景是接近黑的深墨蓝，配少量柔和光源光斑
3. **光有方向** — 顶边受光（inset 高光）、底边背光（inset 暗缘）
4. **唯一强调色** — 香槟金 #E4B863 只出现在主 CTA 和高亮文字
5. **颗粒质感** — 2.5% 噪点叠加消除塑料感

### 核心 CSS 变量

```css
:root {
  /* 玻璃属性 */
  --glass-blur: 40px;
  --glass-blur-heavy: 60px;
  --glass-saturate: 180%;
  --glass-bg: rgba(255, 255, 255, 0.08);
  --glass-bg-hover: rgba(255, 255, 255, 0.14);
  --glass-border: rgba(255, 255, 255, 0.15);
  --glass-border-hover: rgba(255, 255, 255, 0.30);
  --glass-shadow: 0 16px 40px rgba(3,7,18,0.5),
                  inset 0 1px 0 rgba(255,255,255,0.22),
                  inset 0 -1px 0 rgba(2,6,16,0.35);
  --glass-shadow-hover: 0 24px 64px rgba(3,7,18,0.6),
                        inset 0 1px 0 rgba(255,255,255,0.32),
                        inset 0 -1px 0 rgba(2,6,16,0.35);
  --glass-spring: cubic-bezier(0.16, 1, 0.3, 1);

  /* 夜景场景 */
  --night-deep: #060A13;
  --night: #0B1322;
  --night-steel: #16233A;
  --moon-steel: #33517A;
  --moonlight: #7C9CC4;

  /* 强调色 */
  --champagne: #E4B863;
  --champagne-bright: #F3DCA8;
}
```

### 与 Hesi 现有变量的映射

| StyleKit Token | Hesi 现有 | 映射策略 |
|----------------|-----------|---------|
| `--night-deep` #060A13 | `--bg-ground` #0a0a0b | **不动**（glass 下覆盖） |
| `--night` #0B1322 | `--bg-surface` #121214 | **不动** |
| `--night-steel` #16233A | `--bg-elevated` #18181b | **不动** |
| `--champagne` #E4B863 | `--accent` #6366f1 | **glass 下覆盖** accent |
| `--glass-*` | 无 | **新增**（glass 作用域下） |
| `--moon-steel/moonlight` | 无 | **新增**光源色 |

> **关键**：所有 glass 变量和样式都在 `[data-style="glass"]` 作用域下，不影响默认风格。

---

## 二、Hesi 全部页面/分页清单

### 主界面（SPA 内）

| 界面 | 入口 | 当前 CSS |
|------|------|---------|
| 侧边栏 | `#sidebar` | `sidebar.css` |
| 聊天面板 | `chat-panel` | `chat.css` |
| 终端区 | `#terminal-container` | `terminal.css` |
| 右侧面板（Dashboard） | `#right-panel` | `right-panel.css` |
| 右侧面板（系统资源） | System Resources tab | `dashboard.css` |
| 右侧面板（财务） | Finance tab | `finance.css` |
| 右侧面板（图表） | Charts tab | `charts.css` |
| 右侧面板（网络监控） | Network Monitor | `network-monitor.css` |
| 右侧面板（插件管理） | Plugin Manager | `plugin-manager-panel.js` |
| 右侧面板（全局搜索） | Cmd+K | `modal.css` (command palette) |
| 黑板面板 | `#blackboard-embed` | `chat.css` |
| 圆桌面板 | `#mahjong-embed` | `roundtable-view.css` |
| DSH 面板 | `#dsh-embed` | `chat.css` |
| 工作台面板 | `#worktable-container` | `worktable-panel.css` |
| 记忆面板 | Memory tab | `memory-sessions.css` |
| 设置弹窗 | Settings modal | `modal.css` |

### 独立页面

| 页面 | 文件 | 当前 CSS |
|------|------|---------|
| 预算管理 | `/budget.html` | `finance.css` |
| 黑板独立页 | `/blackboard.html` | inline |
| 圆桌独立页 | `/roundtable.html` | inline |

---

## 三、逐 Phase 实施计划

### Phase 0：全局基础（theme.css）

**改动文件：** `public/css/theme.css`

**核心思路：** 所有 glass 变量和样式都在 `[data-style="glass"]` 作用域下，默认风格零影响。

**新增 CSS 变量（dark + glass）：**

```css
/* 变量定义在 :root 下（所有主题共享） */
:root {
  --glass-blur: 40px;
  --glass-blur-heavy: 60px;
  --glass-saturate: 180%;
  --glass-bg: rgba(255, 255, 255, 0.08);
  --glass-bg-subtle: rgba(255, 255, 255, 0.05);
  --glass-bg-hover: rgba(255, 255, 255, 0.14);
  --glass-border: rgba(255, 255, 255, 0.15);
  --glass-border-hover: rgba(255, 255, 255, 0.30);
  --glass-shadow: 0 16px 40px rgba(3,7,18,0.5),
                  inset 0 1px 0 rgba(255,255,255,0.22),
                  inset 0 -1px 0 rgba(2,6,16,0.35);
  --glass-shadow-sm: 0 4px 16px rgba(3,7,18,0.45),
                     inset 0 1px 0 rgba(255,255,255,0.18),
                     inset 0 -1px 0 rgba(2,6,16,0.3);
  --glass-shadow-hover: 0 24px 64px rgba(3,7,18,0.6),
                        inset 0 1px 0 rgba(255,255,255,0.32),
                        inset 0 -1px 0 rgba(2,6,16,0.35);
  --night-deep: #060A13;
  --night: #0B1322;
  --night-steel: #16233A;
  --moon-steel: #33517A;
  --moonlight: #7C9CC4;
  --champagne: #E4B863;
  --champagne-bright: #F3DCA8;
  --champagne-glow: rgba(228, 184, 99, 0.15);
  --glass-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --transition-glass: 500ms var(--glass-spring);
}
```

**glass 激活时覆盖 accent 色：**

```css
[data-style="glass"] {
  --accent: #E4B863;        /* 香槟金 */
  --accent-hover: #F3DCA8;
  --accent-glow: rgba(228, 184, 99, 0.15);
  --accent-sub: #7C9CC4;    /* 月光色 */
}
```

**亮色 + glass 适配：**

```css
[data-theme="light"][data-style="glass"] {
  --glass-bg: rgba(255, 255, 255, 0.7);
  --glass-bg-hover: rgba(255, 255, 255, 0.85);
  --glass-border: rgba(0, 0, 0, 0.08);
  --glass-border-hover: rgba(0, 0, 0, 0.15);
  --glass-shadow: 0 8px 32px rgba(0,0,0,0.08),
                  inset 0 1px 0 rgba(255,255,255,0.8),
                  inset 0 -1px 0 rgba(0,0,0,0.04);
  --glass-blur: 20px;
  --glass-saturate: 120%;
}
```

**glass 激活时的全局样式：**

```css
/* 噪点纹理 — 只在 glass 模式下叠加 */
[data-style="glass"]::after {
  content: "";
  position: fixed;
  inset: 0;
  opacity: 0.025;
  pointer-events: none;
  z-index: 9999;
  background-image: url("data:image/svg+xml,...feTurbulence...");
}

/* body 光源光斑 — 只在 glass 模式下 */
[data-style="glass"] body {
  background:
    radial-gradient(640px circle at 85% 12%, rgba(124,156,196,0.15), transparent 60%),
    radial-gradient(560px circle at 8% 85%, rgba(51,81,122,0.2), transparent 60%),
    radial-gradient(420px circle at 30% 40%, rgba(228,184,99,0.06), transparent 55%),
    linear-gradient(165deg, #060A13 0%, #0B1322 55%, #16233A 100%);
}

/* Glass 通用类 */
[data-style="glass"] .glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  transition: all var(--transition-glass);
}
```

**预估：** ~90 行

---

### Phase 1：主背景 + 光源光斑（已在 Phase 0 中包含）

Phase 0 中已定义 `[data-style="glass"] body` 的背景和噪点纹理，Phase 1 无需额外改动。

**预估：** 0 行（已合并到 Phase 0）

---

### Phase 2：侧边栏

**改动文件：** `public/css/sidebar.css`

| 元素 | 改动 |
|------|------|
| `#sidebar` | 背景 → `var(--glass-bg)` + `backdrop-filter` + 光源边框 |
| 会话项 | 圆角 10px → 12px + hover 光晕 + active 缩放 |
| 工具按钮 | hover 背景 → `var(--glass-bg-hover)` + 过渡 spring |
| 折叠态 | 背景同 glass |
| 分隔线 | `border-color: var(--glass-border)` |

**关键 CSS：**

```css
#sidebar {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur-heavy)) saturate(var(--glass-saturate));
  border-right: 1px solid var(--glass-border);
}

.sidebar-item {
  border-radius: 12px;
  transition: all var(--transition-glass);
}
.sidebar-item:hover {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-hover);
}
.sidebar-item:active {
  transform: scale(0.98);
}
```

**预估：** ~50 行

---

### Phase 3：聊天面板

**改动文件：** `public/css/chat.css` + `public/css/chat-bubble.css`

| 元素 | 改动 |
|------|------|
| 聊天抽屉 | 背景 → glass + 毛玻璃 |
| 工具栏 | 背景 → `glass-bg-subtle` + 底部 border |
| 输入框 | 背景 → `glass-bg` + inset 阴影 + focus 香槟光晕 |
| 发送按钮 | 香槟金样式（唯一强调色位置）|
| 消息气泡（AI）| 背景 → `glass-bg` + 方向性阴影 |
| 消息气泡（用户）| 香槟色渐变背景 `rgba(228,184,99,0.12)` |
| 代码块 | `bg-inset` + 圆角 12px |
| 引用块 | 左边框 → 香槟金色 |
| 附件区域 | glass 背景 |

**关键 CSS：**

```css
/* 聊天抽屉 */
chat-panel {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur-heavy)) saturate(var(--glass-saturate));
}

/* 消息气泡 */
.msg-bubble.ai-bubble {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  box-shadow: var(--glass-shadow-sm);
}
.msg-bubble.user-bubble {
  background: rgba(228, 184, 99, 0.12);
  border: 1px solid rgba(228, 184, 99, 0.25);
  border-radius: 16px;
}

/* 输入框 */
#chat-input {
  background: var(--glass-bg-subtle);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  backdrop-filter: blur(20px);
}
#chat-input:focus {
  border-color: var(--champagne);
  box-shadow: 0 0 0 3px var(--champagne-glow);
}

/* 发送按钮（香槟金） */
#chat-send-btn {
  background: rgba(228, 184, 99, 0.15);
  border: 1px solid rgba(228, 184, 99, 0.4);
  color: var(--champagne-bright);
  border-radius: 12px;
}
#chat-send-btn:hover {
  background: rgba(228, 184, 99, 0.22);
  border-color: rgba(228, 184, 99, 0.55);
}
```

**预估：** ~100 行

---

### Phase 4：终端区

**改动文件：** `public/css/terminal.css`

| 元素 | 改动 |
|------|------|
| 终端容器 | 圆角 12px + 微阴影 |
| 终端标签栏 | glass 背景 + 毛玻璃 |
| 标签项 | hover 光晕 + active 缩放 |
| xterm 视口 | 保持深色底（代码可读性优先） |

**预估：** ~30 行

---

### Phase 5：右侧面板（Dashboard / 财务 / 图表）

**改动文件：** `public/css/right-panel.css` + `public/css/dashboard.css` + `public/css/finance.css` + `public/css/charts.css`

| 元素 | 改动 |
|------|------|
| 面板容器 | glass 背景 + 毛玻璃 |
| Tab 栏 | glass-subtle 背景 |
| Tab 项 | hover 光晕 + active 香槟下划线 |
| 卡片 | glass + 方向性阴影 + hover 上浮 |
| 数据表格 | 行 hover → glass-bg-hover |
| 按钮 | 默认 glass，主操作 → 香槟金 |
| 图表背景 | glass 面板 |

**预估：** ~80 行

---

### Phase 6：弹窗 / Modal / 命令面板

**改动文件：** `public/css/modal.css`

| 元素 | 改动 |
|------|------|
| overlay | 保持 `backdrop-filter: blur(8px)` ✅ |
| modal 面板 | `glass` 类 + 方向性阴影 + 圆角 24px |
| 输入框 | glass + focus 香槟光晕 |
| 按钮 | 主操作 → 香槟金，次操作 → glass |
| 命令面板 | glass 背景 + 毛玻璃 |

**预估：** ~40 行

---

### Phase 7：侧边抽屉（黑板 / 圆桌 / DSH / 工作台）

**改动文件：** `public/css/chat.css` + `public/css/roundtable-view.css` + `public/css/worktable-panel.css`

| 元素 | 改动 |
|------|------|
| 抽屉容器 | glass 背景 + 毛玻璃 + 方向性阴影 |
| 工具栏 | glass-subtle + 底部 border |
| 按钮 | glass + hover 光晕 |

**预估：** ~40 行

---

### Phase 8：独立页面

**改动文件：** `budget.html` + `blackboard.html` + `roundtable.html`

每个独立页面：
- body 背景 → 夜景场景 + 光源光斑
- 加 `glass-grain` 噪点
- 所有面板 → glass 类

**预估：** ~30 行

---

## 四、实施顺序与工作量

```
Phase 0（1.5h）：theme.css 变量 + 全局 glass 类   ~90 行
Phase 1（已合并到 Phase 0）                        0 行
Phase 2（1h）：侧边栏                            ~50 行
Phase 3（1.5h）：聊天面板                         ~100 行  ← 最重要
Phase 4（0.5h）：终端区                           ~30 行
Phase 5（1h）：右侧面板                          ~80 行
Phase 6（0.5h）：弹窗 / Modal                     ~40 行
Phase 7（0.5h）：侧边抽屉                        ~40 行
Phase 8（0.5h）：独立页面                        ~30 行
新增：主题切换器 UI + JS 逻辑                     ~30 行

总计：~7 小时，~490 行（CSS + 少量 JS）
```

---

## 五、每个 Phase 的自检清单

每个 Phase 完成后检查：

- [ ] 背景是深墨夜景 + 柔和光源光斑（不是平面渐变）
- [ ] 玻璃面板是 5%-12% 透明度的无色白玻璃
- [ ] 存在 `backdrop-filter: blur(40px) saturate(180%)`
- [ ] 阴影有方向性（外层深度 + 顶边高光 + 底边暗缘）
- [ ] 香槟金 #E4B863 只出现在主操作/高亮位置
- [ ] 边框使用 `rgba(255,255,255,0.15)`
- [ ] 圆角 ≥ 12px
- [ ] 过渡使用 spring easing `cubic-bezier(0.16, 1, 0.3, 1)`
- [ ] 噪点纹理已叠加
- [ ] 亮色主题下 glass 变量已适配

---

## 六、禁止模式（StyleKit 规定）

| 禁止 | 原因 |
|------|------|
| 紫粉渐变 #667eea / #764ba2 | 本风格明确拒绝的通用 AI 配色 |
| 给玻璃面板上色 | 玻璃无色，颜色属于背景 |
| 玻璃透明度 > 15% | 变成实心色块 |
| backdrop-blur < 30px | 模糊不足 |
| 省略 backdrop-saturate | 光源无法透过玻璃发亮 |
| 单层阴影 | 没有光的方向 |
| rounded-none / rounded-sm | 直角破坏玻璃感 |
| transition < 300ms | 过快失去流动感 |
| 多种强调色 | 只允许香槟金一种 |

---

## 七、总结

| 维度 | 评估 |
|------|------|
| **改动范围** | CSS ~490 行 + JS ~30 行 |
| **文件数** | ~12 个 CSS 文件 + 1 个 JS 文件 |
| **JS 改动** | 主题切换器新增「视觉风格」下拉 |
| **依赖变化** | 零 |
| **风险** | 极低（样式改动不影响逻辑，可随时关闭 glass 回到默认） |
| **个人版/企业版** | 通用 |
| **实施周期** | ~7 小时（8 个 Phase） |
| **视觉风格** | Nocturne Glassmorphism（StyleKit 规范） |
| **强调色** | 香槟金 #E4B863（glass 模式下替换原紫色） |
| **集成方式** | `data-style="glass"` 层叠在 `data-theme` 之上，任意配色 × 风格组合 |
| **核心价值** | 统一视觉语言，安静高级的夜航质感，用户可自由切换 |
