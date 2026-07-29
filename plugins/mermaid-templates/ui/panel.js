/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MermaidTemplates Plugin — Frontend Panel
//
// Registers a right panel tab via UIRegistry:
//   - 按分类浏览模板（流程图、时序图、类图、状态图、甘特图、饼图）
//   - 自定义模板（保存到 localStorage，支持新建/编辑/删除）
//   - 每个模板实时渲染预览
//   - 一键复制源代码
//   - 发送到聊天面板
//
// This module is loaded from the plugin's "ui" manifest entry.
// It runs as an IIFE and registers itself with window.QCLI.UIRegistry.
// ============================================================
(function registerMermaidTemplates() {
  'use strict';

  const Q = window.QCLI || {};

  // ──────────────────────────────────────────────
  // 自定义模板 localStorage CRUD
  // ──────────────────────────────────────────────
  const STORAGE_KEY = 'qcli-custom-templates';

  let _customTemplates = [];

  function loadCustomTemplates() {
    _customTemplates = (Q.safeStorage && Q.safeStorage.getJSON(STORAGE_KEY, [])) || [];
    if (!Array.isArray(_customTemplates)) _customTemplates = [];
    return _customTemplates;
  }

  function saveCustomTemplates() {
    if (Q.safeStorage) {
      Q.safeStorage.setJSON(STORAGE_KEY, _customTemplates);
    }
  }

  function addCustomTemplate({ name, desc, source }) {
    const tpl = {
      id: `cst_${  Date.now()  }_${  Math.random().toString(36).slice(2, 8)}`,
      name: name || '未命名模板',
      desc: desc || '',
      source: source || '',
      createdAt: Date.now(),
    };
    _customTemplates.unshift(tpl);
    saveCustomTemplates();
    return tpl.id;
  }

  function updateCustomTemplate(id, updates) {
    const idx = _customTemplates.findIndex(t => t.id === id);
    if (idx === -1) return false;
    Object.assign(_customTemplates[idx], updates);
    saveCustomTemplates();
    return true;
  }

  function deleteCustomTemplate(id) {
    const idx = _customTemplates.findIndex(t => t.id === id);
    if (idx === -1) return false;
    _customTemplates.splice(idx, 1);
    saveCustomTemplates();
    return true;
  }

  // ──────────────────────────────────────────────
  // 模态框反重复状态
  // ──────────────────────────────────────────────
  let _modalActive = false;

  // ──────────────────────────────────────────────
  // 内置图表示例模板数据集
  // ──────────────────────────────────────────────
  const TEMPLATES_BUILTIN = {
    flowchart: {
      label: '流程图',
      icon: '🔀',
      items: [
        { name: '基本流程', desc: '开始 → 判断 → 分支 → 结束', source: `graph TD\n    A([开始]) --> B{条件判断}\n    B -->|是| C[处理逻辑]\n    B -->|否| D[备选路径]\n    C --> E([结束])\n    D --> E` },
        { name: '业务流程', desc: '订单从创建到完成的完整流程', source: `graph LR\n    A[创建订单] --> B{支付成功?}\n    B -->|是| C[确认订单]\n    B -->|否| D[取消订单]\n    C --> E[仓库发货]\n    E --> F[物流配送]\n    F --> G[客户签收]\n    G --> H[交易完成]` },
        { name: '系统架构', desc: '前端 → API → 微服务 → 数据库', source: `graph TB\n    subgraph 前端\n        A[Web App]\n        B[Mobile App]\n    end\n    subgraph 网关\n        C[API Gateway]\n    end\n    subgraph 微服务\n        D[用户服务]\n        E[订单服务]\n        F[支付服务]\n    end\n    subgraph 存储\n        G[(MySQL)]\n        H[(Redis)]\n        I[(MongoDB)]\n    end\n    A --> C\n    B --> C\n    C --> D & E & F\n    D --> G & H\n    E --> G\n    F --> G & I` },
        { name: 'CI/CD 流水线', desc: '代码提交到部署的自动化流程', source: `graph LR\n    A[Git Push] --> B[代码检查]\n    B --> C{测试通过?}\n    C -->|是| D[构建镜像]\n    C -->|否| E[通知失败]\n    D --> F[部署到 Staging]\n    F --> G{验收测试?}\n    G -->|是| H[生产部署]\n    G -->|否| I[回滚]\n    H --> J[监控告警]` },
      ],
    },
    sequence: {
      label: '时序图',
      icon: '⏱️',
      items: [
        { name: '用户登录', desc: '客户端 ↔ 服务端认证过程', source: `sequenceDiagram\n    participant U as 用户\n    participant C as 客户端\n    participant S as 服务端\n    participant DB as 数据库\n    U->>C: 输入用户名密码\n    C->>S: POST /api/login\n    S->>DB: 查询用户\n    DB-->>S: 返回用户信息\n    S->>S: 验证密码\n    S-->>C: 返回 JWT Token\n    C-->>U: 登录成功\n    Note over C,U: Token 存储在 localStorage` },
        { name: 'API 调用链', desc: '服务间调用关系追踪', source: `sequenceDiagram\n    participant App as App\n    participant GW as API Gateway\n    participant Auth as Auth Service\n    participant User as User Service\n    participant Order as Order Service\n    App->>GW: GET /api/orders\n    GW->>Auth: 验证 Token\n    Auth-->>GW: user_id: 123\n    GW->>User: 获取用户信息\n    User-->>GW: user data\n    GW->>Order: 查询订单列表\n    Order-->>GW: order list\n    GW-->>App: 200 OK + data` },
        { name: 'WebSocket 握手', desc: '建立 WebSocket 连接的完整过程', source: `sequenceDiagram\n    participant C as Client\n    participant S as Server\n    participant W as WSServer\n    C->>S: HTTP Upgrade Request\n    S->>S: 验证 Sec-WebSocket-Key\n    S-->>C: 101 Switching Protocols\n    Note over C,W: WebSocket 连接已建立\n    C->>W: { type: "ping" }\n    W-->>C: { type: "pong" }\n    C->>W: { type: "message", data }\n    W-->>C: { type: "ack" }\n    C->>W: Close Frame\n    W-->>C: Close Frame` },
      ],
    },
    classDiagram: {
      label: '类图', icon: '🏗️',
      items: [
        { name: '设计模式 — 观察者', desc: 'Observer 模式类结构', source: `classDiagram\n    class Subject { +attach(observer) +detach(observer) +notify() -observers: List }\n    class ConcreteSubject { +getState() +setState(state) -state: State }\n    class Observer { +update(subject) }\n    class ConcreteObserver { +update(subject) -observerState: State }\n    Subject <|-- ConcreteSubject\n    Observer <|-- ConcreteObserver\n    Subject o--> Observer` },
        { name: '实体关系 — 电商', desc: '电商系统核心实体关系', source: `classDiagram\n    class User { +id: UUID +name: string +email: string +createOrder() }\n    class Order { +id: UUID +total: Money +status: OrderStatus +addItem() +pay() }\n    class OrderItem { +productId: UUID +quantity: int +price: Money }\n    class Product { +id: UUID +name: string +price: Money +stock: int }\n    class Payment { +id: UUID +method: PaymentMethod +amount: Money +status: PaymentStatus }\n    User "1" --> "*" Order\n    Order "1" --> "*" OrderItem\n    OrderItem "1" --> "1" Product\n    Order "1" --> "1" Payment` },
      ],
    },
    stateDiagram: {
      label: '状态图', icon: '🔄',
      items: [
        { name: '订单状态机', desc: '订单从创建到完成的状态流转', source: `stateDiagram-v2\n    [*] --> 待支付\n    待支付 --> 已取消: 用户取消\n    待支付 --> 已支付: 支付成功\n    已支付 --> 已发货: 商家发货\n    已发货 --> 配送中: 快递揽收\n    配送中 --> 已签收: 客户签收\n    已签收 --> 已完成: 自动确认\n    已签收 --> 退货中: 申请退款\n    退货中 --> 已退款: 退款完成\n    已退款 --> [*]\n    已完成 --> [*]` },
        { name: 'TCP 连接状态', desc: 'TCP 三次握手与四次挥手', source: `stateDiagram-v2\n    [*] --> CLOSED\n    CLOSED --> SYN_SENT: 主动打开\n    CLOSED --> LISTEN: 被动打开\n    LISTEN --> SYN_RCVD: 收到 SYN\n    SYN_SENT --> ESTABLISHED: 收到 SYN+ACK\n    SYN_RCVD --> ESTABLISHED: 发送 ACK\n    ESTABLISHED --> FIN_WAIT_1: 主动关闭\n    ESTABLISHED --> CLOSE_WAIT: 收到 FIN\n    FIN_WAIT_1 --> FIN_WAIT_2: 收到 ACK\n    FIN_WAIT_2 --> TIME_WAIT: 收到 FIN\n    CLOSE_WAIT --> LAST_ACK: 关闭\n    LAST_ACK --> CLOSED: 收到 ACK\n    TIME_WAIT --> CLOSED: 超时` },
      ],
    },
    gantt: {
      label: '甘特图', icon: '📅',
      items: [
        { name: '项目里程碑', desc: '6 个月项目进度规划', source: `gantt\n    title 项目里程碑计划\n    dateFormat  YYYY-MM-DD\n    axisFormat  %m/%d\n    section 需求\n    需求调研      :a1, 2024-01-01, 30d\n    需求评审      :a2, after a1, 14d\n    section 开发\n    架构设计      :b1, after a2, 21d\n    前端开发      :b2, after b1, 60d\n    后端开发      :b3, after b1, 60d\n    联调测试      :b4, after b2, 21d\n    section 测试\n    功能测试      :c1, after b4, 14d\n    性能测试      :c2, after c1, 7d\n    UAT 验收      :c3, after c2, 14d\n    section 上线\n    预发布部署    :d1, after c3, 3d\n    生产发布      :d2, after d1, 2d\n    线上监控      :d3, after d2, 14d` },
      ],
    },
    pie: {
      label: '饼图', icon: '🥧',
      items: [
        { name: '技术栈占比', desc: '项目技术组成分布', source: `pie title 技术栈分布\n    "前端" : 35\n    "后端" : 30\n    "数据库" : 15\n    "基础设施" : 12\n    "测试" : 8` },
        { name: '资源分配', desc: '云资源成本分布', source: `pie title 月度云资源成本\n    "计算实例" : 45\n    "存储服务" : 25\n    "网络流量" : 15\n    "数据库" : 10\n    "其他" : 5` },
      ],
    },
    journey: {
      label: '用户旅程', icon: '🚀',
      items: [
        { name: '用户注册流程', desc: '新用户从了解到注册的体验旅程', source: `journey\n    title 新用户注册体验\n    section 发现\n      看到广告: 5: 用户\n      访问官网: 4: 用户\n      浏览功能: 3: 用户\n    section 注册\n      填写信息: 2: 用户\n      邮箱验证: 1: 用户, 系统\n      设置密码: 3: 用户\n    section 上手\n      引导教程: 4: 用户, 系统\n      首次操作: 5: 用户\n      完成设置: 5: 用户` },
      ],
    },
  };

  // ──────────────────────────────────────────────
  // 工具函数
  // ──────────────────────────────────────────────
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
  }

  // ──────────────────────────────────────────────
  // 渲染函数
  // ──────────────────────────────────────────────
  function renderMermaidTab(container) {
    container.innerHTML = `
      <div class="mt-browser">
        <div class="mt-header">
          <div class="mt-title">📊 Mermaid 图表模板</div>
          <div class="mt-desc">点击预览，一键复制源码</div>
        </div>
        <div class="mt-categories" id="mt-categories"></div>
        <div class="mt-content" id="mt-content">
          <div class="mt-placeholder">选择一个分类查看模板</div>
        </div>
      </div>
    `;

    const catsEl = container.querySelector('#mt-categories');
    const contentEl = container.querySelector('#mt-content');

    function showTemplateModal(mode, existing) {
      if (_modalActive) return;
      _modalActive = true;

      const isEdit = mode === 'edit';
      const title = isEdit ? '✏️ 编辑模板' : '🆕 新建模板';
      const btnLabel = isEdit ? '💾 保存修改' : '✅ 创建模板';
      const nameVal = isEdit ? escapeHtml(existing.name) : '';
      const descVal = isEdit ? escapeHtml(existing.desc) : '';
      const srcVal  = isEdit ? escapeHtml(existing.source) : '';

      const overlay = document.createElement('div');
      overlay.className = 'mt-modal-overlay';
      overlay.innerHTML = `
        <div class="mt-modal">
          <div class="mt-modal-header">
            <span class="mt-modal-title">${title}</span>
            <button class="mt-modal-close" title="关闭">✕</button>
          </div>
          <div class="mt-modal-body">
            <label class="mt-field">
              <span class="mt-field-label">模板名称</span>
              <input class="mt-input" id="mt-modal-name" type="text" placeholder="例如：微服务架构图" value="${nameVal}" autofocus />
            </label>
            <label class="mt-field">
              <span class="mt-field-label">描述（可选）</span>
              <input class="mt-input" id="mt-modal-desc" type="text" placeholder="例如：展示微服务之间的调用关系" value="${descVal}" />
            </label>
            <label class="mt-field">
              <span class="mt-field-label">Mermaid 源码</span>
              <textarea class="mt-textarea" id="mt-modal-source" placeholder="在此粘贴 Mermaid 图表源代码…" rows="10">${srcVal}</textarea>
            </label>
          </div>
          <div class="mt-modal-footer">
            <button class="mt-btn mt-modal-cancel">取消</button>
            <button class="mt-btn mt-modal-submit">${btnLabel}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      requestAnimationFrame(() => overlay.classList.add('mt-modal-open'));

      const close = () => {
        overlay.classList.remove('mt-modal-open');
        setTimeout(() => {
          overlay.remove();
          _modalActive = false;
        }, 200);
      };

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('.mt-modal-close').addEventListener('click', close);
      overlay.querySelector('.mt-modal-cancel').addEventListener('click', close);

      const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
      document.addEventListener('keydown', escHandler);

      overlay.querySelector('.mt-modal-submit').addEventListener('click', () => {
        const name = document.getElementById('mt-modal-name').value.trim();
        const desc = document.getElementById('mt-modal-desc').value.trim();
        const source = document.getElementById('mt-modal-source').value.trim();

        if (!name) {
          document.getElementById('mt-modal-name').focus();
          document.getElementById('mt-modal-name').style.borderColor = 'var(--danger, #ef4444)';
          setTimeout(() => { document.getElementById('mt-modal-name').style.borderColor = ''; }, 1500);
          return;
        }
        if (!source) {
          document.getElementById('mt-modal-source').focus();
          document.getElementById('mt-modal-source').style.borderColor = 'var(--danger, #ef4444)';
          setTimeout(() => { document.getElementById('mt-modal-source').style.borderColor = ''; }, 1500);
          return;
        }

        if (isEdit) {
          updateCustomTemplate(existing.id, { name, desc, source });
          if (Q.showToast) Q.showToast('✅ 模板已更新', 'success');
        } else {
          addCustomTemplate({ name, desc, source });
          if (Q.showToast) Q.showToast('✅ 模板已保存', 'success');
        }

        close();
        activeCategory = 'custom';
        renderCategories();
        renderTemplates();
      });
    }

    function getCategoryKeys() {
      const builtin = Object.keys(TEMPLATES_BUILTIN);
      return ['custom', ...builtin];
    }

    let categoryKeys = getCategoryKeys();
    let activeCategory = categoryKeys[0];

    function getCategory(key) {
      if (key === 'custom') {
        return { label: '自定义', icon: '⭐', items: loadCustomTemplates() };
      }
      return TEMPLATES_BUILTIN[key];
    }

    function renderCategories() {
      catsEl.innerHTML = '';
      for (const key of categoryKeys) {
        const cat = getCategory(key);
        if (!cat) continue;
        const btn = document.createElement('button');
        btn.className = `mt-cat-btn${  key === activeCategory ? ' active' : ''}`;
        btn.innerHTML = `${cat.icon  } ${  cat.label}`;
        btn.dataset.cat = key;
        btn.addEventListener('click', () => {
          activeCategory = key;
          renderCategories();
          renderTemplates();
        });
        catsEl.appendChild(btn);
      }
    }

    function renderTemplates() {
      const cat = getCategory(activeCategory);
      if (!cat) return;

      contentEl.scrollTop = 0;
      const isCustom = activeCategory === 'custom';

      let extraHTML = '';
      if (isCustom) {
        extraHTML = `<div class="mt-custom-header"><button class="mt-btn mt-btn-new" id="mt-btn-new">✨ 新建模板</button><span class="mt-custom-count">共 ${  cat.items.length  } 个模板</span></div>`;
        if (cat.items.length === 0) {
          extraHTML += '<div class="mt-custom-empty"><div class="mt-custom-empty-icon">📭</div><div class="mt-custom-empty-text">还没有自定义模板</div><div class="mt-custom-empty-hint">点击上方「新建模板」创建你的第一个图表模板</div></div>';
        }
      }

      let gridHTML = '<div class="mt-grid">';
      for (let i = 0; i < cat.items.length; i++) {
        const item = cat.items[i];
        const isCustomItem = isCustom && item.id;
        gridHTML += `<div class="mt-card${  isCustomItem ? ' mt-card-custom' : ''  }" draggable="true" data-index="${  i  }">`;
        gridHTML += `<div class="mt-card-header">${  isCustomItem ? '<span class="mt-card-badge">⭐ 自定义</span>' : ''  }<span class="mt-card-name">${  escapeHtml(item.name)  }</span><span class="mt-card-desc">${  escapeHtml(item.desc || '')  }</span></div>`;
        gridHTML += `<div class="mt-card-preview"><div class="mermaid">${  escapeHtml(item.source)  }</div><div class="mt-card-loading">⏳ 渲染中...</div></div>`;
        gridHTML += '<div class="mt-card-actions">';
        gridHTML += '<button class="mt-btn mt-btn-copy" title="复制源代码">📋 复制源码</button>';
        gridHTML += '<button class="mt-btn mt-btn-chat" title="发送到聊天面板">💬 发送到聊天</button>';
        gridHTML += '<button class="mt-btn mt-btn-expand" title="查看源码">📄 源码</button>';
        if (isCustomItem) {
          gridHTML += `<button class="mt-btn mt-btn-edit" data-id="${  item.id  }" title="编辑模板">✏️ 编辑</button>`;
          gridHTML += `<button class="mt-btn mt-btn-delete" data-id="${  item.id  }" title="删除模板">🗑️ 删除</button>`;
        }
        gridHTML += '</div>';
        gridHTML += `<div class="mt-card-source hidden"><pre><code>${  escapeHtml(item.source)  }</code></pre></div>`;
        gridHTML += '</div>';
      }
      gridHTML += '</div>';

      contentEl.innerHTML = extraHTML + gridHTML;

      requestAnimationFrame(() => {
        if (Q.MermaidRenderer) {
          Q.MermaidRenderer.renderAll();
        }
      });

      const newBtn = document.getElementById('mt-btn-new');
      if (newBtn) {
        newBtn.addEventListener('click', () => { showTemplateModal('new'); });
      }

      const cards = contentEl.querySelectorAll('.mt-card');
      for (let j = 0; j < cards.length; j++) {
        (function (card) {
          const idx = parseInt(card.dataset.index, 10);
          const item = cat.items[idx];
          if (!item) return;

          card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.source);
            e.dataTransfer.setData('text/x-mermaid', item.source);
            e.dataTransfer.effectAllowed = 'copy';
            card.classList.add('mt-card-dragging');
          });
          card.addEventListener('dragend', () => {
            card.classList.remove('mt-card-dragging');
          });

          const copyBtn = card.querySelector('.mt-btn-copy');
          if (copyBtn) {
            copyBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(item.source).catch(() => {});
              copyBtn.textContent = '✅ 已复制';
              setTimeout(() => { copyBtn.textContent = '📋 复制源码'; }, 2000);
            });
          }

          const chatBtn = card.querySelector('.mt-btn-chat');
          if (chatBtn) {
            chatBtn.addEventListener('click', () => {
              const chatInput = document.getElementById('chat-input');
              if (chatInput) {
                chatInput.value = `请帮我生成以下 Mermaid 图表：\n\n\`\`\`mermaid\n${  item.source  }\n\`\`\``;
                chatInput.dispatchEvent(new Event('input'));
                if (Q.ChatUI && Q.ChatUI.toggleChat) Q.ChatUI.toggleChat();
                setTimeout(() => { chatInput.focus(); }, 300);
              } else {
                navigator.clipboard.writeText(item.source).catch(() => {});
                if (Q.showToast) Q.showToast('已复制到剪贴板（聊天面板未打开）', 'info');
              }
            });
          }

          const expandBtn = card.querySelector('.mt-btn-expand');
          const sourceBlock = card.querySelector('.mt-card-source');
          if (expandBtn && sourceBlock) {
            expandBtn.addEventListener('click', () => {
              const isHidden = sourceBlock.classList.contains('hidden');
              sourceBlock.classList.toggle('hidden');
              expandBtn.textContent = isHidden ? '🙈 收起' : '📄 源码';
            });
          }

          if (isCustom) {
            const editBtn = card.querySelector('.mt-btn-edit');
            if (editBtn) {
              editBtn.addEventListener('click', () => { showTemplateModal('edit', item); });
            }
            const deleteBtn = card.querySelector('.mt-btn-delete');
            if (deleteBtn) {
              deleteBtn.addEventListener('click', () => {
                if (confirm(`确定要删除模板「${  item.name  }」吗？`)) {
                  deleteCustomTemplate(item.id);
                  if (Q.showToast) Q.showToast(`🗑️ 已删除「${  item.name  }」`, 'info');
                  renderTemplates();
                }
              });
            }
          }
        })(cards[j]);
      }
    }

    loadCustomTemplates();
    categoryKeys = getCategoryKeys();

    if (_customTemplates.length > 0) {
      activeCategory = 'custom';
    } else {
      // Default to the first non-empty builtin category (e.g. 'flowchart')
      const firstBuiltin = categoryKeys.find((k) => { return k !== 'custom'; });
      if (firstBuiltin) activeCategory = firstBuiltin;
    }

    renderCategories();
    renderTemplates();
  }

  // ──────────────────────────────────────────────
  // 插件已从右侧面板移除（精简右侧栏）
  // 通过 window.MermaidTemplatesPlugin.render() 可从工具箱页面调用
  // ──────────────────────────────────────────────
  Q.MermaidTemplatesPlugin = {
    render: renderMermaidTab,
  };
  console.log('[MermaidTemplatesPlugin] Loaded (accessible via Q.MermaidTemplatesPlugin.render())');
})();
