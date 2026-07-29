/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Workflow Engine — multi-step agent orchestration UI
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

  // ── State ──
  const workflows = {
    list: [],           // available workflow definitions from API
    active: null,       // { id, name, steps, currentStep, status, results: [] }
    ws: null,
  };

  // ── Load workflow definitions from API ──
  async function loadWorkflows() {
    try {
      const resp = await fetch('/api/workflows');
      if (!resp.ok) return [];
      const data = await resp.json();
      workflows.list = data.workflows || [];
      renderWorkflowList();
      return workflows.list;
    } catch (err) {
      console.warn('[Workflows] Load failed:', err);
      return [];
    }
  }

  // ── Render workflow list in right-panel container ──
  let rpContainer = null; // right-panel render target

  function renderWorkflowList() {
    const container = rpContainer || document.getElementById('workflow-list');
    if (!container) return;

    container.innerHTML = '';

    if (workflows.list.length === 0) {
      container.innerHTML = '<div class="agent-empty">No workflows available</div>';
      return;
    }

    // Header card
    const header = document.createElement('div');
    header.className = 'wfp-header';
    header.innerHTML = `
      <span class="wfp-header-icon">⚡</span>
      <span class="wfp-header-title">工作流</span>
      <span class="wfp-header-count">${workflows.list.length}</span>
    `;
    container.appendChild(header);

    // List container
    const list = document.createElement('div');
    list.className = 'wfp-list';
    container.appendChild(list);

    for (const wf of workflows.list) {
      const el = document.createElement('div');
      el.className = 'wfp-item';
      el.dataset.wfId = wf.id;

      // Strip leading emoji from display name
      const displayName = (wf.name || '').replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/u, '').trim() || wf.name;

      // Hover tooltip
      el.title = wf.description || displayName;

      // Left: icon + name
      const left = document.createElement('div');
      left.className = 'wfp-left';
      left.innerHTML = `<span class="wfp-icon">${wf.icon || '⚡'}</span><span class="wfp-name">${displayName}</span>`;
      el.appendChild(left);

      // Right: badges
      const right = document.createElement('div');
      right.className = 'wfp-badges';

      // Steps / DAG badge
      const stepBadge = document.createElement('span');
      stepBadge.className = 'wfp-badge steps';
      if (wf.tasks && Array.isArray(wf.tasks) && wf.tasks.length > 0) {
        stepBadge.textContent = 'DAG';
        stepBadge.classList.add('dag');
        el.dataset.dag = '1';
      } else {
        stepBadge.textContent = `${wf.steps.length} 步`;
      }
      right.appendChild(stepBadge);

      // Category-style badge (sequential vs parallel)
      const catBadge = document.createElement('span');
      catBadge.className = 'wfp-badge cat';
      if (wf.tasks && Array.isArray(wf.tasks) && wf.tasks.length > 0) {
        catBadge.textContent = '并行';
        catBadge.classList.add('parallel');
      } else {
        catBadge.textContent = '顺序';
        catBadge.classList.add('sequential');
      }
      right.appendChild(catBadge);

      el.appendChild(right);

      // Running indicator
      const isActive = workflows.active && workflows.active.id === wf.id && workflows.active.status === 'running';
      if (isActive) el.classList.add('running');

      // Click to run
      el.addEventListener('click', () => { handleWorkflowClick(wf); });

      list.appendChild(el);
    }
  }

  // ── Handle workflow click (show variable modal if needed) ──
  function handleWorkflowClick(wfDef) {
    // DAG 工作流 → 路由到 WorkBuddy 风格编排看板
    if (wfDef.tasks && Array.isArray(wfDef.tasks) && wfDef.tasks.length > 0) {
      if (Q.Orchestrator?.runDAG) {
        Q.Orchestrator.runDAG(wfDef);
        if (Q.RightPanel?.switchTab) Q.RightPanel.switchTab('orchestrator');
      } else {
        showWfToast('编排模块未就绪', 'error');
      }
      return;
    }
    const vars = wfDef.variables;
    if (vars && Object.keys(vars).length > 0) {
      showWorkflowVariableModal(wfDef);
      return;
    }
    // No variables → run directly
    startWorkflow(wfDef);
  }

  // ── Variable input modal ──
  function showWorkflowVariableModal(wfDef) {
    const vars = wfDef.variables || {};
    const keys = Object.keys(vars);
    if (keys.length === 0) { startWorkflow(wfDef); return; }

    // Build form HTML
    let formHtml = '';
    for (const key of keys) {
      const v = vars[key];
      const label = v.label || key;
      const required = v.required ? 'required' : '';
      const val = v.default || '';

      formHtml += `<label>${label}`;

      if (v.type === 'select' && v.options) {
        formHtml += `<select id="wf-var-${key}" class="wf-var-input" ${required}>`;
        for (const opt of v.options) {
          const sel = opt === val ? ' selected' : '';
          formHtml += `<option value="${opt}"${sel}>${opt}</option>`;
        }
        formHtml += '</select>';
      } else if (v.type === 'number') {
        const minAttr = v.min != null ? ` min="${v.min}"` : '';
        const maxAttr = v.max != null ? ` max="${v.max}"` : '';
        formHtml += `<input type="number" id="wf-var-${key}" class="wf-var-input" value="${val}" ${required}${minAttr}${maxAttr}>`;
      } else {
        formHtml += `<input type="text" id="wf-var-${key}" class="wf-var-input" value="${val}" placeholder="${v.placeholder || ''}" ${required}>`;
      }

      if (v.description) {
        formHtml += `<small>${v.description}</small>`;
      }
      formHtml += '</label>';
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden';
    overlay.id = 'wf-variable-modal';
    overlay.innerHTML = `
      <div class="modal wf-var-modal">
        <h2>${wfDef.icon || '⚡'} ${wfDef.name}</h2>
        <div class="wf-var-form">
          ${formHtml}
        </div>
        <div class="modal-actions">
          <button id="wf-var-cancel" class="secondary-btn">Cancel</button>
          <button id="wf-var-start" class="primary-btn">▶ Start</button>
        </div>
        <div id="wf-var-error" class="form-error hidden"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Show with animation
    requestAnimationFrame(() => overlay.classList.remove('hidden'));

    // ── Wire up ──
    const errorEl = overlay.querySelector('#wf-var-error');

    function closeModal() {
      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 250);
    }

    overlay.querySelector('#wf-var-cancel').addEventListener('click', closeModal);

    // Click backdrop to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelector('#wf-var-start').addEventListener('click', () => {
      // Collect values
      const values = {};
      let hasError = false;
      for (const key of keys) {
        const v = vars[key];
        const el = document.getElementById(`wf-var-${key}`);
        const val = el ? el.value.trim() : '';
        if (v.required && !val) {
          hasError = true;
          el?.focus();
          errorEl.textContent = `"${v.label || key}" is required`;
          errorEl.classList.remove('hidden');
          break;
        }
        values[key] = val || v.default || '';
      }
      if (hasError) return;

      errorEl.classList.add('hidden');

      // Substitute variables into steps
      const substitutedDef = {
        ...wfDef,
        steps: wfDef.steps.map(step => ({
          ...step,
          task: substituteVariables(step.task, values),
        })),
      };

      closeModal();
      startWorkflow(substitutedDef);
    });

    // Enter key to submit
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('wf-var-input')) {
        overlay.querySelector('#wf-var-start').click();
      }
    });

    // Focus first input
    const firstInput = overlay.querySelector('.wf-var-input');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }

  // ── Substitute variables in task strings ──
  // Supports:
  //   {{KEY}} / {{ key }} / {{UPPER_KEY}}  — explicit mustache syntax
  //   TOKEN="old" / TOKEN=old  — assignment-value replacement (uppercase token)
  function substituteVariables(task, values) {
    let result = task;

    for (const [key, val] of Object.entries(values)) {
      // 1. {{KEY}} and {{ key }} (case-insensitive)
      result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), val);

      // 2. {UPPER_KEY} (explicit uppercase variant, if key differs)
      const upperKey = key.toUpperCase();
      if (upperKey !== key) {
        result = result.replace(new RegExp(`\\{\\{\\s*${upperKey}\\s*\\}\\}`, 'g'), val);
      }

      // 3. Token alias map for names that don't match between JSON and tasks
      const ALIAS_MAP = {
        audio_bitrate: ['AUDIO_BITRATE'],
        output_suffix: ['OUTPUT_SUFFIX'],
        language: ['LANG'],
        output_format: ['FMT'],
      };
      const tokens = [upperKey, ...(ALIAS_MAP[key] || [])];
      for (const token of [...new Set(tokens)]) {
        // 3a. Replace TOKEN="old value" → TOKEN="new value" (quoted)
        result = result.replace(
          new RegExp(`(?<=\\b${token}\\s*=\\s*)"([^"]*)"`, 'g'),
          `"${val}"`
        );
        // 3b. Replace TOKEN=oldvalue (unquoted, word-boundary) → TOKEN=newvalue
        result = result.replace(
          new RegExp(`\\b(${token}=)(\\S+)`, 'g'),
          (m, prefix, oldVal) => {
            if (/[\$`]/.test(oldVal)) return m; // skip shell expressions
            return prefix + val;
          }
        );
      }
    }
    return result;
  }

  // ── Start a workflow ──
  function startWorkflow(wfDef) {
    if (workflows.active && workflows.active.status === 'running') {
      showWfToast('A workflow is already running. Cancel it first.', 'error');
      return;
    }

    const ws = workflows.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showWfToast('WebSocket not connected', 'error');
      return;
    }

    // Create active workflow state
    workflows.active = {
      id: wfDef.id,
      name: wfDef.name,
      icon: wfDef.icon,
      steps: wfDef.steps.map(s => ({ ...s, status: 'pending', output: '' })),
      currentStep: -1,
      status: 'running',
      results: [],
      wfId: null,
    };

    // Send to server
    ws.send(JSON.stringify({
      type: 'workflow:start',
      workflowId: wfDef.id,
      name: wfDef.name,
      steps: wfDef.steps,
    }));

    showWfToast(`▶ Started: ${wfDef.name}`, 'info');
    renderWorkflowList();
    showWorkflowProgress();
  }

  // ── Cancel the active workflow ──
  function cancelWorkflow() {
    if (!workflows.active || workflows.active.status !== 'running') return;
    const ws = workflows.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'workflow:cancel',
        wfId: workflows.active.wfId,
      }));
    }
    workflows.active.status = 'cancelled';
    showWfToast('⏹ Workflow cancelled', 'info');
    renderWorkflowList();
    updateProgressDisplay();
  }

  // ── Show workflow progress overlay ──
  function showWorkflowProgress() {
    let overlay = document.getElementById('wf-progress-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wf-progress-overlay';
      overlay.className = 'wf-progress-overlay';
      overlay.innerHTML = `
        <div class="wf-progress-panel">
          <div class="wf-progress-header">
            <span class="wf-progress-title"></span>
            <button class="wf-progress-close" id="wf-progress-close" title="Close">✕</button>
          </div>
          <div class="wf-progress-steps" id="wf-progress-steps"></div>
          <div class="wf-progress-footer">
            <button id="wf-cancel-btn" class="wf-cancel-btn">Cancel Workflow</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Close button
      overlay.querySelector('#wf-progress-close').addEventListener('click', () => {
        overlay.classList.add('hidden');
      });

      // Cancel button
      overlay.querySelector('#wf-cancel-btn').addEventListener('click', () => {
        cancelWorkflow();
      });

      // Click backdrop to close
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    }

    overlay.classList.remove('hidden');
    updateProgressDisplay();
  }

  // ── Update the progress overlay ──
  function updateProgressDisplay() {
    const overlay = document.getElementById('wf-progress-overlay');
    if (!overlay) return;

    if (!workflows.active) {
      overlay.classList.add('hidden');
      return;
    }

    const active = workflows.active;
    overlay.querySelector('.wf-progress-title').textContent =
      `${active.icon || '⚡'} ${active.name}`;

    const stepsContainer = document.getElementById('wf-progress-steps');
    stepsContainer.innerHTML = '';

    for (let i = 0; i < active.steps.length; i++) {
      const step = active.steps[i];
      const isParallel = step.mode === 'parallel' && step.agents;

      const stepEl = document.createElement('div');
      stepEl.className = 'wf-step-item ' + step.status;

      // Status indicator
      const statusEl = document.createElement('span');
      statusEl.className = 'wf-step-status';
      switch (step.status) {
        case 'running':
          statusEl.textContent = '⟳';
          statusEl.style.animation = 'spin 1s linear infinite';
          break;
        case 'completed':
          statusEl.textContent = '✅';
          break;
        case 'error':
          statusEl.textContent = '❌';
          break;
        case 'cancelled':
          statusEl.textContent = '⏹';
          break;
        default:
          statusEl.textContent = '○';
      }
      stepEl.appendChild(statusEl);

      // Step info
      const infoEl = document.createElement('div');
      infoEl.className = 'wf-step-info';

      const labelEl = document.createElement('div');
      labelEl.className = 'wf-step-label';
      labelEl.textContent = `Step ${i + 1}: ${step.label}`;
      infoEl.appendChild(labelEl);

      // For parallel steps, show expandable agent output panels
      if (isParallel && step.agentOutputs) {
        const agentsWrap = document.createElement('div');
        agentsWrap.className = 'wf-parallel-agents';
        for (let ai = 0; ai < step.agentOutputs.length; ai++) {
          const agentOut = step.agentOutputs[ai];
          const agentCard = document.createElement('div');
          agentCard.className = 'wf-parallel-agent-card ' + (agentOut.status || 'pending');
          
          // Collapsible header
          const agentHeader = document.createElement('div');
          agentHeader.className = 'wf-parallel-agent-header';
          
          const statusIcon = document.createElement('span');
          statusIcon.className = 'wf-parallel-agent-icon';
          if (agentOut.status === 'running') {
            statusIcon.textContent = '\u27f3';
            statusIcon.style.animation = 'spin 1s linear infinite';
          } else if (agentOut.status === 'completed') {
            statusIcon.textContent = '\u2705';
          } else if (agentOut.status === 'error') {
            statusIcon.textContent = '\u274c';
          } else {
            statusIcon.textContent = '\u25cb';
          }
          agentHeader.appendChild(statusIcon);
          
          const agentName = document.createElement('span');
          agentName.className = 'wf-parallel-agent-name';
          const agentLabels = { opencode: '\u26a1 OpenCode', codebuff: '\u{1F9CA} Codebuff', freebuff: '\u{1F9CA} Freebuff' };
          agentName.textContent = agentLabels[agentOut.agentId] || agentOut.agentId;
          agentHeader.appendChild(agentName);
          
          // Expand/collapse toggle
          const toggleIcon = document.createElement('span');
          toggleIcon.className = 'wf-parallel-agent-toggle';
          toggleIcon.textContent = '\u25bc';
          toggleIcon.style.marginLeft = 'auto';
          toggleIcon.style.fontSize = '8px';
          toggleIcon.style.color = 'var(--text-tertiary)';
          agentHeader.appendChild(toggleIcon);
          
          agentCard.appendChild(agentHeader);
          
          // Collapsible output panel
          const outputPanel = document.createElement('pre');
          outputPanel.className = 'wf-parallel-agent-output';
          outputPanel.textContent = agentOut.output ? agentOut.output.slice(-1000) : '(awaiting output...)';
          
          let expanded = false;
          agentHeader.addEventListener('click', function() {
            expanded = !expanded;
            outputPanel.classList.toggle('expanded', expanded);
            toggleIcon.textContent = expanded ? '\u25b2' : '\u25bc';
          });
          
          agentCard.appendChild(outputPanel);
          agentsWrap.appendChild(agentCard);
        }
        infoEl.appendChild(agentsWrap);
      }
      
      // Show merge/comparison result for completed parallel steps
      if (isParallel && step.status === 'completed' && step.output) {
        const mergeResult = document.createElement('div');
        mergeResult.className = 'wf-merge-result';
        
        const mergeLabel = document.createElement('div');
        mergeLabel.className = 'wf-merge-label';
        mergeLabel.textContent = '\u{1F500} Merged Result';
        mergeResult.appendChild(mergeLabel);
        
        const mergeOutput = document.createElement('pre');
        mergeOutput.className = 'wf-merge-output';
        mergeOutput.textContent = step.output.slice(-500);
        mergeResult.appendChild(mergeOutput);
        
        infoEl.appendChild(mergeResult);
      }

      // For await_human steps, show the human request badge
      if (step.type === 'await_human') {
        const badge = document.createElement('div');
        badge.style.cssText = 'font-size:11px;color:#f59e0b;margin-top:4px;font-weight:500;display:flex;align-items:center;gap:4px;';
        badge.innerHTML = '🙋 等待人工输入';
        if (step.humanRequest) {
          const reqPreview = document.createElement('div');
          reqPreview.style.cssText = 'font-size:11px;color:var(--text-tertiary);margin-top:2px;padding:6px 8px;background:var(--bg-card);border-radius:4px;border-left:2px solid #f59e0b;';
          reqPreview.textContent = step.humanRequest.slice(0, 100) + (step.humanRequest.length > 100 ? '...' : '');
          badge.appendChild(reqPreview);
        }
        infoEl.appendChild(badge);
      }

      if (step.output) {
        const outputEl = document.createElement('pre');
        outputEl.className = 'wf-step-output';
        outputEl.textContent = step.output.slice(-300);
        infoEl.appendChild(outputEl);
      }

      stepEl.appendChild(infoEl);

      stepsContainer.appendChild(stepEl);
    }

    // Auto-scroll to the latest step
    requestAnimationFrame(() => {
      stepsContainer.scrollTop = stepsContainer.scrollHeight;
    });
  }

  // ── Handle parallel agent progress messages ──
  function handleParallelOutput(msg) {
    if (!workflows.active) return;
    const step = workflows.active.steps[msg.stepIndex];
    if (!step || step.mode !== 'parallel') return;

    // Initialize agentOutputs tracking
    if (!step.agentOutputs) {
      step.agentOutputs = (step.agents || []).map(a => ({
        agentId: a.agentId,
        output: '',
        status: 'pending',
      }));
    }

    const agentOut = step.agentOutputs[msg.agentIndex];
    if (agentOut) {
      if (msg.type === 'workflow:step:output') {
        agentOut.status = 'running';
        agentOut.output += msg.data || '';
        if (agentOut.output.length > 3000) {
          agentOut.output = '...' + agentOut.output.slice(-2970);
        }
      } else if (msg.type === 'workflow:step:agent:complete') {
        agentOut.status = msg.exitCode === 0 ? 'completed' : 'error';
        if (!agentOut.output && msg.output) {
          agentOut.output = msg.output;
        }
      }
    }
    updateProgressDisplay();
  }

  // ── Handle WebSocket messages for workflows ──
  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'workflow:started': {
        if (workflows.active && workflows.active.status === 'running') {
          workflows.active.wfId = msg.workflowId;
          workflows.active.totalSteps = msg.totalSteps;
        }
        break;
      }

      case 'workflow:step:start': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          step.status = 'running';
          workflows.active.currentStep = msg.stepIndex;
        }
        updateProgressDisplay();
        break;
      }

      case 'workflow:step:output': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          // Parallel step: route to agent-level tracking
          if (step.mode === 'parallel' && msg.agentIndex !== undefined) {
            handleParallelOutput(msg);
            break;
          }
          step.output += msg.data;
          if (step.output.length > 5000) {
            step.output = '...' + step.output.slice(-4970);
          }
          // Update progress overlay if visible
          updateProgressDisplay();
        }
        break;
      }

      case 'workflow:step:agent:complete': {
        if (!workflows.active) break;
        handleParallelOutput(msg);
        break;
      }

      case 'workflow:step:complete': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          step.status = msg.exitCode === 0 ? 'completed' : 'error';
          if (!step.output && msg.output) {
            step.output = msg.output;
          }
        }
        updateProgressDisplay();
        break;
      }

      case 'workflow:step:error': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          step.status = 'error';
          step.output = (step.output || '') + '\n[Error] ' + (msg.error || 'Unknown error');
        }
        updateProgressDisplay();
        break;
      }

      case 'workflow:progress': {
        if (workflows.active) {
          workflows.active.currentStep = msg.currentStep;
        }
        break;
      }

      case 'workflow:completed': {
        if (workflows.active) {
          workflows.active.status = 'completed';
          const successCount = workflows.active.steps.filter(s => s.status === 'completed').length;
          showWfToast(
            `✅ ${workflows.active.name} completed (${successCount}/${workflows.active.steps.length} steps)`,
            'success'
          );
          renderWorkflowList();
          updateProgressDisplay();
        }
        break;
      }

      case 'workflow:cancelled': {
        if (workflows.active) {
          workflows.active.status = 'cancelled';
          showWfToast('⏹ Workflow cancelled', 'info');
          renderWorkflowList();
          updateProgressDisplay();
        }
        break;
      }

      case 'human:request': {
        // 转发到数字员工面板弹出人机协作输入框
        if (Q.DigitalEmployees?.handleWSMessage) {
          Q.DigitalEmployees.handleWSMessage(msg);
        }
        // 在工作流进度面板中标记该步骤为等待人类输入
        if (workflows.active && msg.stepIndex !== undefined) {
          const step = workflows.active.steps[msg.stepIndex];
          if (step) {
            step.status = 'await_human';
            step.humanRequest = msg.question;
          }
          updateProgressDisplay();
        }
        break;
      }

      case 'workflow:error': {
        showWfToast('Workflow error: ' + (msg.message || 'unknown'), 'error');
        break;
      }
    }
  }

  // ── Handle WebSocket disconnect — mark active workflow as failed ──
  function handleDisconnect() {
    if (workflows.active && workflows.active.status === 'running') {
      workflows.active.status = 'error';
      // Mark any pending steps as error
      for (const step of workflows.active.steps) {
        if (step.status === 'pending' || step.status === 'running') {
          step.status = 'error';
          step.output = (step.output || '') + '\n[Disconnected] WebSocket connection lost';
        }
      }
      showWfToast('⏹ Workflow interrupted — connection lost', 'error');
      renderWorkflowList();
      updateProgressDisplay();
    }
  }

  // ── Toast notification ──
  function showWfToast(msg, type) {
    const el = document.getElementById('wf-toast') || (() => {
      const e = document.createElement('div');
      e.id = 'wf-toast';
      e.className = 'wf-toast';
      document.body.appendChild(e);
      return e;
    })();
    el.textContent = msg;
    el.className = 'wf-toast ' + (type || 'info');
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  // ── Wire up & Register as Right-Panel Tab ──
  function register() {
    const UIR = Q.UIRegistry;
    if (!UIR) { setTimeout(register, 300); return; }

    UIR.registerTab('workflows', {
      icon: '⚡',
      label: '工作流',
      category: 'digital',
      order: 6,
      render: (container) => {
        rpContainer = container;
        loadWorkflows();
      },
    });

    console.log('[Workflows] Panel registered as right-panel tab');
  }
  register();

  export const Workflows = {
    loadWorkflows,
    renderWorkflowList,
    startWorkflow,
    cancelWorkflow,
    handleWSMessage,
    handleDisconnect,
    showWorkflowProgress,
    updateProgressDisplay,
    workflows,
    showWfToast,
  };
  Q.Workflows = Workflows;
