// @ts-check
// ============================================================
// Digital Employees — 数字员工管理面板
//
// 注册为右侧栏 Tab（通过 UIRegistry）。
// 支持：查看团队状态、注册/注销数字员工、人机协作请求响应。
// ============================================================
'use strict';

import { escapeHtml } from './escape.js';

/** @typedef {import('./types').QCLI} QCLI */
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/**
 * 数字员工前端状态。
 */
const DigitalEmployees = {
  team: { totalMembers: 0, idleCount: 0, workingCount: 0, waitingHumanCount: 0, errorCount: 0, members: [] },
  availableRoles: [],
  ws: null,
};

/**
 * 加载团队状态（GET /api/digital-employees）。
 */
async function loadTeamStatus() {
  try {
    const resp = await fetch('/api/digital-employees');
    if (!resp.ok) return null;
    const data = await resp.json();
    DigitalEmployees.team = data.team || DigitalEmployees.team;
    DigitalEmployees.availableRoles = data.availableRoles || [];
    renderTeamPanel();
    return data;
  } catch (err) {
    console.warn('[DigitalEmployees] Failed to load team status:', err);
    return null;
  }
}

/**
 * 渲染数字员工团队面板。
 */
function renderTeamPanel() {
  const panel = document.getElementById('rp-digital-employees');
  if (!panel) return;

  const { team, availableRoles } = DigitalEmployees;

  panel.innerHTML = [
    '<div style="padding:16px;">',
    // ── 标题 ──
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">',
    '<div style="font-size:14px;font-weight:600;color:var(--text-primary);">👥 数字员工团队</div>',
    '<button id="de-refresh-btn" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-tertiary);cursor:pointer;font-size:11px;transition:all 0.15s;" onmouseover="this.style.color=\'var(--text-primary)\'" onmouseout="this.style.color=\'var(--text-tertiary)\'">🔄 刷新</button>',
    '</div>',

    // ── 统计概览 ──
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;">',
    '<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">',
    '<div style="font-size:18px;font-weight:700;color:var(--text-primary);">', String(team.totalMembers), '</div>',
    '<div style="font-size:10px;color:var(--text-tertiary);">总人数</div></div>',
    '<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">',
    '<div style="font-size:18px;font-weight:700;color:#22c55e;">', String(team.idleCount), '</div>',
    '<div style="font-size:10px;color:var(--text-tertiary);">空闲</div></div>',
    '<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">',
    '<div style="font-size:18px;font-weight:700;color:#3b82f6;">', String(team.workingCount), '</div>',
    '<div style="font-size:10px;color:var(--text-tertiary);">工作中</div></div>',
    '<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">',
    '<div style="font-size:18px;font-weight:700;color:', team.waitingHumanCount > 0 ? '#f59e0b' : 'var(--text-tertiary)', ';">', String(team.waitingHumanCount), '</div>',
    '<div style="font-size:10px;color:var(--text-tertiary);">等待人工</div></div>',
    '</div>',

    // ── 注册新员工按钮 ──
    '<button id="de-register-btn" style="width:100%;padding:10px;border-radius:8px;border:1px dashed var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;margin-bottom:12px;transition:all 0.15s;" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'transparent\'">＋ 注册数字员工</button>',

    // ── 团队成员列表 ──
    '<div style="font-size:12px;font-weight:500;margin-bottom:8px;color:var(--text-tertiary);">团队成员</div>',
    '<div id="de-member-list">',
    team.members.length === 0
      ? '<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:12px;">暂无已注册的数字员工<br>点击上方按钮注册</div>'
      : team.members.map(function(m) {
          const statusDot = m.status === 'idle' ? '#22c55e' : (m.status === 'working' ? '#3b82f6' : (m.status === 'waiting_human' ? '#f59e0b' : '#ef4444'));
          const statusText = m.status === 'idle' ? '空闲' : (m.status === 'working' ? '工作中' : (m.status === 'waiting_human' ? '等待人工' : '错误'));
          return [
            '<div class="de-member-item" data-id="', escapeHtml(m.id), '" style="display:flex;align-items:center;padding:10px 12px;background:var(--bg-card);border-radius:8px;margin-bottom:6px;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'var(--bg-card)\'">',
            '<div style="width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;margin-right:10px;background:', escapeHtml(m.color), '20;">', escapeHtml(m.icon), '</div>',
            '<div style="flex:1;min-width:0;">',
            '<div style="font-size:13px;font-weight:500;color:var(--text-primary);">', escapeHtml(m.name), '</div>',
            '<div style="font-size:11px;color:var(--text-tertiary);">', escapeHtml(m.role), ' · ', escapeHtml(m.agentId), '</div>',
            '</div>',
            '<div style="display:flex;align-items:center;gap:4px;">',
            '<div style="width:8px;height:8px;border-radius:50%;background:', statusDot, ';"></div>',
            '<span style="font-size:11px;color:var(--text-tertiary);">', statusText, '</span>',
            '</div>',
            '</div>',
          ].join('');
        }).join(''),
    '</div>',
    '</div>',
  ].join('');

  // ── 绑定事件 ──

  // 刷新按钮
  const refreshBtn = document.getElementById('de-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      loadTeamStatus();
    });
  }

  // 注册按钮：弹出模态框
  const registerBtn = document.getElementById('de-register-btn');
  if (registerBtn) {
    registerBtn.addEventListener('click', function() {
      showRegisterModal();
    });
  }

  // 点击成员展开详情（显示任务统计等）
  panel.querySelectorAll('.de-member-item').forEach(function(el) {
    el.addEventListener('click', function() {
      const id = this.dataset.id;
      const member = DigitalEmployees.team.members.find(function(m) { return m.id === id; });
      if (member) {
        showMemberDetail(member);
      }
    });
  });
}

/**
 * 显示注册数字员工的模态框。
 */
function showRegisterModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.id = 'de-register-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';

  const roles = DigitalEmployees.availableRoles;
  const roleOptions = roles.map(function(r) {
    const registered = r.registered ? ' (已注册)' : '';
    return '<option value="' + escapeHtml(r.role) + '"' + (r.registered ? ' disabled' : '') + '>' + escapeHtml(r.icon) + ' ' + escapeHtml(r.name) + registered + '</option>';
  }).join('');

  overlay.innerHTML = [
    '<div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">',
    '<div style="font-size:16px;font-weight:600;margin-bottom:16px;color:var(--text-primary);">注册数字员工</div>',
    '<label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">选择角色</label>',
    '<select id="de-role-select" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;margin-bottom:12px;">',
    roleOptions,
    '</select>',
    '<label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">自定义名称（可选）</label>',
    '<input id="de-name-input" type="text" placeholder="留空使用默认名称" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;margin-bottom:12px;box-sizing:border-box;">',
    '<label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">关联 AI Agent</label>',
    '<input id="de-agent-input" type="text" value="opencode" placeholder="agentId" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;margin-bottom:16px;box-sizing:border-box;">',
    '<div style="display:flex;gap:8px;justify-content:flex-end;">',
    '<button id="de-modal-cancel" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">取消</button>',
    '<button id="de-modal-confirm" style="padding:10px 20px;border-radius:8px;border:none;background:#4f46e5;color:white;cursor:pointer;font-size:13px;font-weight:500;">确认注册</button>',
    '</div>',
    '</div>',
  ].join('');

  document.body.appendChild(overlay);

  requestAnimationFrame(function() { overlay.classList.remove('hidden'); });

  // ── 绑定事件 ──
  function closeModal() {
    overlay.classList.add('hidden');
    setTimeout(function() { overlay.remove(); }, 250);
  }

  overlay.querySelector('#de-modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelector('#de-modal-confirm').addEventListener('click', function() {
    const roleSelect = document.getElementById('de-role-select');
    const nameInput = document.getElementById('de-name-input');
    const agentInput = document.getElementById('de-agent-input');

    const role = roleSelect ? roleSelect.value : '';
    const name = nameInput ? nameInput.value.trim() : '';
    const agentId = agentInput ? agentInput.value.trim() : 'opencode';

    if (!role) return;

    // 发送 WebSocket 注册消息
    if (DigitalEmployees.ws && DigitalEmployees.ws.readyState === WebSocket.OPEN) {
      DigitalEmployees.ws.send(JSON.stringify({
        type: 'de:register',
        role: role,
        name: name || undefined,
        agentId: agentId,
      }));
    } else {
      Q.showToast?.('WebSocket 未连接，无法注册', 'error');
    }

    closeModal();
  });
}

/**
 * 显示数字员工详细信息模态框。
 * @param {object} member
 */
function showMemberDetail(member) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.id = 'de-detail-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';

  overlay.innerHTML = [
    '<div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:360px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">',
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">',
    '<div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;background:', escapeHtml(member.color), '20;">', escapeHtml(member.icon), '</div>',
    '<div>',
    '<div style="font-size:16px;font-weight:600;color:var(--text-primary);">', escapeHtml(member.name), '</div>',
    '<div style="font-size:12px;color:var(--text-tertiary);">', escapeHtml(member.role), ' · ', escapeHtml(member.agentId), '</div>',
    '</div></div>',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">',
    '<div style="background:var(--bg-card);padding:10px;border-radius:8px;text-align:center;">',
    '<div style="font-size:16px;font-weight:600;color:var(--text-primary);">', String(member.stats?.tasksCompleted || 0), '</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);">已完成任务</div></div>',
    '<div style="background:var(--bg-card);padding:10px;border-radius:8px;text-align:center;">',
    '<div style="font-size:16px;font-weight:600;color:#ef4444;">', String(member.stats?.tasksFailed || 0), '</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);">失败任务</div></div>',
    '<div style="background:var(--bg-card);padding:10px;border-radius:8px;text-align:center;grid-column:span 2;">',
    '<div style="font-size:16px;font-weight:600;color:#f59e0b;">', String(member.stats?.humanRequests || 0), '</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);">人机协作请求次数</div></div>',
    '</div>',
    '<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px;">',
    '当前状态: ', member.status === 'idle' ? '空闲' : (member.status === 'working' ? '工作中' : (member.status === 'waiting_human' ? '等待人工回复' : '错误')),
    '</div>',
    '<div style="display:flex;gap:8px;justify-content:flex-end;">',
    '<button id="de-detail-close" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">关闭</button>',
    '<button id="de-detail-unregister" style="padding:10px 20px;border-radius:8px;border:none;background:#ef4444;color:white;cursor:pointer;font-size:13px;font-weight:500;">注销员工</button>',
    '</div></div>',
  ].join('');

  document.body.appendChild(overlay);
  requestAnimationFrame(function() { overlay.classList.remove('hidden'); });

  function closeModal() {
    overlay.classList.add('hidden');
    setTimeout(function() { overlay.remove(); }, 250);
  }

  overlay.querySelector('#de-detail-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });

  // 注销按钮
  overlay.querySelector('#de-detail-unregister').addEventListener('click', function() {
    if (DigitalEmployees.ws && DigitalEmployees.ws.readyState === WebSocket.OPEN) {
      DigitalEmployees.ws.send(JSON.stringify({
        type: 'de:unregister',
        employeeId: member.id,
      }));
    }
    closeModal();
  });
}

/**
 * 处理人机协作请求弹窗。
 * @param {object} msg — { taskId, employeeName, question, expectedFormat, workflowId, stepIndex }
 */
function showHumanInputDialog(msg) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.id = 'human-input-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;';

  overlay.innerHTML = [
    '<div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">',
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">',
    '<span style="font-size:20px;">🙋</span>',
    '<div style="font-size:15px;font-weight:600;color:var(--text-primary);">人机协作请求</div>',
    '</div>',
    '<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px;">来自：', escapeHtml(msg.employeeName || '工作流引擎'), '</div>',
    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;margin-bottom:12px;font-size:13px;color:var(--text-primary);line-height:1.6;">',
    escapeHtml(msg.question || '请输入所需信息：'),
    '</div>',
    msg.workflowId ? '<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;">工作流: ' + escapeHtml(msg.workflowId) + ' · 步骤: ' + (msg.stepIndex !== undefined ? msg.stepIndex + 1 : '?') + '</div>' : '',
    '<textarea id="human-answer-input" placeholder="请输入回复..." style="width:100%;height:100px;padding:12px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;margin-bottom:12px;"></textarea>',
    '<div style="display:flex;gap:8px;justify-content:flex-end;">',
    '<button id="human-input-skip" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:13px;">跳过</button>',
    '<button id="human-input-submit" style="padding:10px 20px;border-radius:8px;border:none;background:#4f46e5;color:white;cursor:pointer;font-size:13px;font-weight:500;">提交回复</button>',
    '</div></div>',
  ].join('');

  document.body.appendChild(overlay);
  requestAnimationFrame(function() { overlay.classList.remove('hidden'); });

  function closeModal() {
    overlay.classList.add('hidden');
    setTimeout(function() { overlay.remove(); }, 250);
  }

  overlay.querySelector('#human-input-skip').addEventListener('click', function() {
    // 发送空回复（工作流会超时降级）
    if (DigitalEmployees.ws && DigitalEmployees.ws.readyState === WebSocket.OPEN) {
      DigitalEmployees.ws.send(JSON.stringify({
        type: 'human:respond',
        taskId: msg.taskId,
        answer: '[跳过]',
      }));
    }
    closeModal();
  });

  overlay.querySelector('#human-input-submit').addEventListener('click', function() {
    const answer = document.getElementById('human-answer-input');
    const text = answer ? answer.value.trim() : '';
    if (!text) {
      answer?.focus();
      return;
    }
    if (DigitalEmployees.ws && DigitalEmployees.ws.readyState === WebSocket.OPEN) {
      DigitalEmployees.ws.send(JSON.stringify({
        type: 'human:respond',
        taskId: msg.taskId,
        answer: text,
      }));
    }
    Q.showToast?.('🙋 回复已提交', 'success');
    closeModal();
  });

  // 自动聚焦
  setTimeout(function() {
    const ta = document.getElementById('human-answer-input');
    if (ta) ta.focus();
  }, 200);

  // Enter 提交（Shift+Enter 换行）
  overlay.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('human-input-submit')?.click();
    }
  });
}

/**
 * 处理 WebSocket 消息。
 * @param {object} msg
 */
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'de:registered':
      Q.showToast?.('✅ 已注册数字员工: ' + (msg.employee?.name || msg.employee?.role || ''), 'success');
      loadTeamStatus();
      break;

    case 'de:unregistered':
      Q.showToast?.('已注销数字员工', 'info');
      loadTeamStatus();
      break;

    case 'de:error':
      Q.showToast?.('❌ 数字员工错误: ' + (msg.message || '未知错误'), 'error');
      break;

    case 'de:team-status':
      // 刷新状态
      DigitalEmployees.team = msg;
      renderTeamPanel();
      break;

    case 'human:request':
      // 弹出人机协作输入框
      showHumanInputDialog(msg);
      break;

    default:
      break;
  }
}

/**
 * 初始化数字员工面板。
 */
function init() {
  const UIR = Q.UIRegistry;
  if (UIR) {
    const registered = UIR.registerTab('digital-employees', {
      icon: '👥',
      label: '数字员工',
      order: 5,
      category: 'digital',
      render: function(container) {
        container.innerHTML = '<div id="rp-digital-employees"></div>';
        renderTeamPanel();
        // 首次渲染后立即加载状态
        loadTeamStatus();
      },
    });
    if (registered) {
      console.log('[DigitalEmployees] Tab registered in right panel');
    }
  }

  // 绑定 WebSocket
  DigitalEmployees.loadTeamStatus = loadTeamStatus;
  DigitalEmployees.renderTeamPanel = renderTeamPanel;
  DigitalEmployees.handleWSMessage = handleWSMessage;

  // 暴露到 QCLI 命名空间
  Q.DigitalEmployees = DigitalEmployees;
}

// ── 自动初始化 ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
