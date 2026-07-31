/**
 * 讨论伙伴共享状态：跨页面 / 跨组件同步 + 本地持久化
 *
 * 设计要点：
 * - 普通脚本（IIFE），挂到 window.PartnerStore，供 plan-view.js（普通脚本）、
 *   discuss-controls.js、plan-drawer.js（lazy-bundle 内）统一使用，避免 ESM/defer 时序问题。
 * - 选中的伙伴存 localStorage('hesi-discuss-partners')；同浏览器多标签通过 'storage' 事件实时同步；
 *   同页通过订阅（subscribe）同步。
 * - 数据源（loadPartnerSource）两边共用：已装 agents + registry agent 类 CLI + 收藏夹排序。
 */
(function () {
  'use strict';

  const KEY = 'hesi-discuss-partners';
  const FAV_KEY = 'qcli-favorites';
  const subs = new Set();

  function safeGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return fallback;
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }

  function getPartners() {
    const raw = safeGet(KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x);
  }

  function setPartners(ids) {
    const next = Array.from(new Set((ids || []).filter((x) => x)));
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
    subs.forEach((cb) => { try { cb(next); } catch { /* ignore */ } });
  }

  function subscribe(cb) {
    if (typeof cb === 'function') subs.add(cb);
    return () => subs.delete(cb);
  }

  // 数据源：已装 agents + registry agent 类 CLI + 收藏夹同步
  function loadPartnerSource() {
    return Promise.all([
      fetch('/api/agents').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/clis').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then((res) => {
      const agentsData = res[0];
      const clisData = res[1];
      const list = [];
      const seen = new Set();
      const push = (id, name, extra) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        const item = { id, name };
        if (extra) Object.keys(extra).forEach((k) => { item[k] = extra[k]; });
        list.push(item);
      };
      const agents = (agentsData && agentsData.agents ? agentsData.agents : []).filter((a) => a.installed);
      agents.forEach((a) => push(a.id, a.displayName || a.name, { version: a.version || '', installed: true }));
      const clis = (clisData && clisData.clis ? clisData.clis : []).filter((c) => (c.category || '') === 'agent');
      clis.forEach((c) => push(c.id || c.name, c.name, { version: c.version || '', fromRegistry: true }));

      let favIds = safeGet(FAV_KEY, []);
      if (!Array.isArray(favIds)) favIds = [];
      const favSet = new Set(favIds);
      list.sort((a, b) => {
        const af = favSet.has(a.id) ? 0 : 1;
        const bf = favSet.has(b.id) ? 0 : 1;
        if (af !== bf) return af - bf;
        return (a.name || '').localeCompare(b.name || '');
      });
      return { list, favSet };
    });
  }

  // 跨标签页同步：其他页面改了 KEY → 通知本页订阅者
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      const next = getPartners();
      subs.forEach((cb) => { try { cb(next); } catch { /* ignore */ } });
    }
  });

  window.PartnerStore = {
    KEY,
    FAV_KEY,
    getPartners,
    setPartners,
    subscribe,
    loadPartnerSource,
  };
})();
