/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// WebSocket Message Router — Q.onWSMessage
//
// 原 app.js §5 (Lines 237-388)
// ============================================================

/** @typedef {import('../types').QCLI} QCLI */

import { state, dom } from '../state.js';
import { termRef, pendingInit } from './shared.js';
import { __ as _i18n__ } from '../i18n.js';

const __ = _i18n__ || function(k) { return k; };
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});
const wsSend = (...args) => Q.wsSend(...args);

Q.onWSMessage = function(msg) {
  switch (msg.type) {
    case 'output':
      if (Q.Tabs) {
        Q.Tabs.appendOutput(msg.data, msg.tabId);
      } else if (termRef.current) {
        termRef.current.write(msg.data);
      }
      break;

    case 'launched':
      state.launched = true;
      state.launching = false;
      if (dom.activeLabel) dom.activeLabel.className = '';
      if (dom.welcomeOverlay) dom.welcomeOverlay.classList.add('hidden');
      if (dom.activeLabel) dom.activeLabel.textContent = msg.cli?.name || '';
      const rawVer = msg.cli?.version;
      const versionOk = rawVer && rawVer !== 'unknown' && !Q.isGarbledVersion?.(rawVer);
      if (dom.activeVersion) dom.activeVersion.textContent = versionOk ? rawVer : '';
      Q.updateCLIState?.(msg.cli?.id, 'running');
      Q.updateTerminalDims?.();
      const termContainer = document.getElementById('terminal-container');
      if (termContainer) {
        termContainer.classList.remove('terminal-power-on');
        void termContainer.offsetWidth;
        termContainer.classList.add('terminal-power-on');
        setTimeout(() => termContainer.classList.remove('terminal-power-on'), 1000);
      }
      if (Q.Tabs && msg.tabId) {
        const existing = Q.Tabs.getTab(msg.tabId);
        if (existing) {
          // Tab already exists (reconnect re-attach, or a fresh PTY after a
          // drop): re-bind to it and resume — do NOT recreate the terminal.
          Q.Tabs.switch(msg.tabId);
          if (!msg.reattached) {
            // Fresh PTY (old one died) — re-run the CLI init command.
            const cliObj = state.clis?.find(c => c.id === msg.cli?.id);
            const pending = pendingInit.get(msg.cli?.id);
            const initCmd = pending || cliObj?.init || '';
            if (pending) pendingInit.delete(msg.cli?.id);
            if (initCmd) {
              setTimeout(() => wsSend({ type: 'input', data: initCmd + '\n' }), 100);
            }
          }
        } else {
          const cliObj = state.clis?.find(c => c.id === msg.cli?.id);
          const pending = pendingInit.get(msg.cli?.id);
          const initCmd = pending || cliObj?.init || '';
          Q.Tabs.create(msg.tabId, msg.cli?.id, msg.cli?.name,
            Q.Tabs.getCLIIcon ? Q.Tabs.getCLIIcon(msg.cli?.name || '') : '\u25b6',
            initCmd);
          if (pending) pendingInit.delete(msg.cli?.id);
          if (initCmd) {
            setTimeout(() => wsSend({ type: 'input', data: initCmd + '\n' }), 100);
          }
        }
      }
      break;

    case 'exit':
      state.launched = false;
      state.launching = false;
      if (msg.tabId && Q.Tabs) {
        const tab = Q.Tabs.getTab(msg.tabId);
        const t = tab?.term || termRef.current;
        if (msg.code === 0) {
          if (t) t.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
        } else if (msg.code !== null) {
          if (t) t.write(`\r\n\x1b[31m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
        } else if (msg.signal) {
          if (t) t.write(`\r\n\x1b[33m[Process killed by signal ${msg.signal}]\x1b[0m\r\n`);
        }
        state.activeCliId = null;
        Q.updateTerminalDims?.();
        setTimeout(() => { if (Q.Tabs) Q.Tabs.close(msg.tabId); }, 2000);
        break;
      }
      if (msg.code === 0) {
        if (termRef.current) termRef.current.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
      } else if (msg.code !== null) {
        if (termRef.current) termRef.current.write(`\r\n\x1b[31m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
      } else if (msg.signal) {
        if (termRef.current) termRef.current.write(`\r\n\x1b[33m[Process killed by signal ${msg.signal}]\x1b[0m\r\n`);
      }
      if (dom.activeLabel) dom.activeLabel.className = '';
      if (dom.activeLabel) dom.activeLabel.textContent = __('cli.notRunning');
      if (dom.activeVersion) dom.activeVersion.textContent = '';
      Q.updateCLIState?.(msg.cli || state.activeCliId, null);
      state.activeCliId = null;
      Q.updateTerminalDims?.();
      break;

    case 'error':
      state.launching = false;
      if (dom.activeLabel) dom.activeLabel.className = '';
      const errTerm = Q.Tabs?.term || termRef.current;
      if (errTerm) errTerm.write(`\r\n\x1b[31m[Error] ${msg.message}\x1b[0m\r\n`);
      break;

    case 'killed':
      state.launched = false;
      state.launching = false;
      if (msg.tabId && Q.Tabs) {
        state.activeCliId = null;
        Q.updateTerminalDims?.();
        break;
      }
      if (dom.activeLabel) dom.activeLabel.className = '';
      if (dom.activeLabel) dom.activeLabel.textContent = __('cli.notRunning');
      if (dom.activeVersion) dom.activeVersion.textContent = '';
      if (state.activeCliId) {
        Q.updateCLIState?.(state.activeCliId, null);
        state.activeCliId = null;
      }
      Q.updateTerminalDims?.();
      break;

    case 'command:complete':
      if ('Notification' in window && Notification.permission === 'granted') {
        const dur = msg.duration > 60
          ? Math.round(msg.duration / 60) + 'm ' + (msg.duration % 60) + 's'
          : msg.duration + 's';
        const title = msg.isError ? 'Command failed' : 'Command completed';
        const body = msg.cliName
          ? `[${msg.cliName}] ${msg.duration}s, exit code ${msg.exitCode}`
          : `${msg.duration}s, exit code ${msg.exitCode}`;          try { new Notification(title, { body, tag: 'cmd-complete' }); } catch (e) {
            console.warn('[WS] Notification failed:', e?.message);
          }
      }
      const notifMsg = msg.isError
        ? `[${msg.cliName || 'CLI'}] exit ${msg.exitCode} (${msg.duration}s)`
        : `[${msg.cliName || 'CLI'}] done (${msg.duration}s)`;
      Q.showToast?.(notifMsg, msg.isError ? 'error' : 'success');
      break;

    case 'pong':
      break;

    case 'plugin_installed':
      // 插件安装成功后自动刷新 CLI 和工作流，无需手动刷新页面
      if (msg.success) {
        const pluginName = msg.plugin?.name || '';
        Q.showToast?.(`✅ 插件 "${pluginName}" 已安装，刷新 CLI/工作流...`, 'success');

        // 刷新 CLI 列表（自动重新渲染）
        if (Q.loadCLIs) {
          Q.loadCLIs().catch(err => console.warn('[plugin_installed] loadCLIs failed:', err));
        }

        // 刷新工作流列表
        if (Q.Workflows?.loadWorkflows) {
          Q.Workflows.loadWorkflows().catch(err => console.warn('[plugin_installed] loadWorkflows failed:', err));
        }
      }
      break;

    case 'mcp_metric':
      if (Q.Dashboard?.mcpPush) {
        Q.Dashboard.mcpPush(msg.data || msg);
      }
      // 同时转发给 OPC Dashboard 进行成本/效益追踪
      if (Q.OPCDashboard?.recordMetric) {
        Q.OPCDashboard.recordMetric(msg.data || msg);
      }
      // Agent 实时输出事件转发到聊天面板
      const metricData = msg.data || msg;
      if (metricData.ev && metricData.ev.startsWith('agent_')) {
        if (Q.ChatUI?.onAgentMetric) {
          Q.ChatUI.onAgentMetric(metricData);
        }
      }
      break;

    default:
      // 数字员工 / 人机协作消息路由
      if (msg.type && (msg.type.startsWith('de:') || msg.type === 'human:request')) {
        if (Q.DigitalEmployees?.handleWSMessage) Q.DigitalEmployees.handleWSMessage(msg);
        if (Q.Orchestrator?.handleWSMessage) Q.Orchestrator.handleWSMessage(msg);
        return;
      }
      if (Q.Agents?.handleWSMessage) Q.Agents.handleWSMessage(msg);
      if (Q.Workflows?.handleWSMessage) Q.Workflows.handleWSMessage(msg);
      if (Q.Orchestrator?.handleWSMessage) Q.Orchestrator.handleWSMessage(msg);
      break;
  }
};
