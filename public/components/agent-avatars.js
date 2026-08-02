/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Phase 2 S1 — 圆桌 Agent 头像组件（纯逻辑，可单测）
//
// 4 个内联 SVG 萌物（小狐/胖达/博士/查查）+ 状态机渲染。
// 零依赖、零 DOM 副作用（仅返回 HTML 字符串），便于前端纯逻辑单测与
// 圆桌页 / 闲谈气泡复用。自定义覆盖层（名字/角色/主题色/头像来源）由
// 调用方传入 agent 对象，本模块只负责渲染。
// ============================================================
'use strict';

import { escapeHtml } from '../escape.js';

/**
 * 默认 4 席角色花名册（圆桌 ≥4）。
 * avatar 字段约定：{ type:'svg'|'emoji'|'img', value }
 *  - svg：内置萌物库 key（见 SVG_INNER）
 *  - emoji：任意 emoji 字符
 *  - img：base64 dataURL 或 /uploads 路径
 * 缺省时回退到 svg 字段（内置 key）。
 */
export const AGENT_ROSTER = [
  { id: 'fox',   name: '小狐 Foxy', roleLabel: '前端 Frontend', themeColor: '#BA7517', svg: 'fox' },
  { id: 'panda', name: '胖达 Panda', roleLabel: '后端 Backend', themeColor: '#2C2C2A', svg: 'panda' },
  { id: 'owl',   name: '博士 Owl',  roleLabel: '架构师 Architect', themeColor: '#534AB7', svg: 'owl' },
  { id: 'bunny', name: '查查 Bunny', roleLabel: '测试 QA', themeColor: '#3B6D11', svg: 'bunny' },
];

/** 内置萌物 SVG 内部图形（viewBox 0 0 56 56）。主题色由外层边框体现，内部用固定配色保证辨识度。 */
const SVG_INNER = {
  fox: `
    <polygon points="14,8 23,27 7,27" fill="#BA7517"/>
    <polygon points="42,8 49,27 33,27" fill="#BA7517"/>
    <circle cx="28" cy="33" r="20" fill="#EF9F27"/>
    <ellipse cx="28" cy="41" rx="11" ry="9" fill="#FAEEDA"/>
    <circle cx="21" cy="31" r="3" fill="#412402"/>
    <circle cx="35" cy="31" r="3" fill="#412402"/>
    <polygon points="28,36 25,40 31,40" fill="#412402"/>
    <circle cx="15" cy="37" r="2.5" fill="#F09595"/>
    <circle cx="41" cy="37" r="2.5" fill="#F09595"/>`,
  panda: `
    <circle cx="16" cy="14" r="7" fill="#2C2C2A"/>
    <circle cx="40" cy="14" r="7" fill="#2C2C2A"/>
    <circle cx="28" cy="33" r="20" fill="#FFFFFF" stroke="#B4B2A9" stroke-width="1"/>
    <ellipse cx="21" cy="31" rx="5" ry="7" fill="#2C2C2A"/>
    <ellipse cx="35" cy="31" rx="5" ry="7" fill="#2C2C2A"/>
    <circle cx="21" cy="32" r="2" fill="#FFFFFF"/>
    <circle cx="35" cy="32" r="2" fill="#FFFFFF"/>
    <ellipse cx="28" cy="41" rx="3" ry="2" fill="#2C2C2A"/>`,
  owl: `
    <polygon points="18,9 23,25 13,25" fill="#534AB7"/>
    <polygon points="38,9 43,25 33,25" fill="#534AB7"/>
    <circle cx="28" cy="33" r="20" fill="#7F77DD"/>
    <circle cx="21" cy="31" r="8" fill="#FFFFFF"/>
    <circle cx="35" cy="31" r="8" fill="#FFFFFF"/>
    <circle cx="21" cy="32" r="3.5" fill="#26215C"/>
    <circle cx="35" cy="32" r="3.5" fill="#26215C"/>
    <polygon points="28,35 25,41 31,41" fill="#BA7517"/>
    <circle cx="16" cy="39" r="2.5" fill="#ED93B1"/>
    <circle cx="40" cy="39" r="2.5" fill="#ED93B1"/>
    <circle cx="21" cy="31" r="9" fill="none" stroke="#26215C" stroke-width="1"/>
    <circle cx="35" cy="31" r="9" fill="none" stroke="#26215C" stroke-width="1"/>
    <line x1="30" y1="31" x2="26" y2="31" stroke="#26215C" stroke-width="1"/>`,
  bunny: `
    <ellipse cx="21" cy="9" rx="4" ry="11" fill="#97C459"/>
    <ellipse cx="35" cy="9" rx="4" ry="11" fill="#97C459"/>
    <ellipse cx="21" cy="9" rx="2" ry="6" fill="#ED93B1"/>
    <ellipse cx="35" cy="9" rx="2" ry="6" fill="#ED93B1"/>
    <circle cx="28" cy="35" r="18" fill="#C0DD97"/>
    <circle cx="22" cy="33" r="3" fill="#173404"/>
    <circle cx="34" cy="33" r="3" fill="#173404"/>
    <ellipse cx="28" cy="41" rx="2.5" ry="1.8" fill="#D4537E"/>
    <circle cx="17" cy="39" r="2.5" fill="#F09595"/>
    <circle cx="39" cy="39" r="2.5" fill="#F09595"/>
    <circle cx="43" cy="45" r="6" fill="none" stroke="#3B6D11" stroke-width="2"/>
    <line x1="47" y1="49" x2="51" y2="53" stroke="#3B6D11" stroke-width="2"/>`,
};

/** 状态机元数据：标签 + CSS class + 主题色。 */
export const STATUS_META = {
  thinking: { label: '思考中', cls: 'rt-st-thinking', color: '#BA7517' },
  speaking: { label: '发言中', cls: 'rt-st-speaking', color: '#3b7dd8' },
  working:  { label: '工作中', cls: 'rt-st-working',  color: '#534AB7' },
  done:     { label: '完成',   cls: 'rt-st-done',     color: '#2e9e5b' },
  error:    { label: '报错',   cls: 'rt-st-error',    color: '#d23b3b' },
  idle:     { label: '待命',   cls: 'rt-st-idle',     color: '#9aa1a9' },
};

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 取内置萌物 SVG 内部图形；未知 key 回退 fox。 */
export function avatarInnerSVG(svgId) {
  return SVG_INNER[svgId] || SVG_INNER.fox;
}

/** 状态 → CSS class（圆桌控制器更新头像边框态用）。 */
export function statusClass(state) {
  return (STATUS_META[state] || STATUS_META.idle).cls;
}

/**
 * 渲染单个头像（含状态边框色）。
 * @param {object} agent { themeColor, svg, avatar? }
 * @param {{size?:number, state?:string}} [opts]
 */
export function renderAvatar(agent, { size = 56, state = 'idle' } = {}) {
  const color = (agent && agent.themeColor) || '#c9ced4';
  const meta = STATUS_META[state] || STATUS_META.idle;
  let inner;
  const av = agent && agent.avatar;
  if (av && av.type === 'emoji') {
    const em = escapeHtml(av.value || '🤖');
    inner = `<div class="rt-emoji" style="font-size:${Math.round(size * 0.5)}px;line-height:${size}px">${em}</div>`;
  } else if (av && av.type === 'img' && av.value) {
    inner = `<img src="${escapeAttr(av.value)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    const key = (av && av.type === 'svg' && av.value) ? av.value : (agent && agent.svg);
    inner = `<svg width="${size}" height="${size}" viewBox="0 0 56 56">${avatarInnerSVG(key)}</svg>`;
  }
  return `<div class="rt-av ${meta.cls}" style="width:${size}px;height:${size}px;border-color:${color}">${inner}</div>`;
}

/**
 * 渲染一个完整座位（头像 + 名字 + 角色 + 状态徽章 + 可选气泡）。
 * @param {object} agent 含 id/name/roleLabel/themeColor/svg/avatar
 * @param {{state?:string, bubble?:string|null, empty?:boolean, host?:boolean}} [opts]
 */
export function renderSeat(agent, { state = 'idle', bubble = null, empty = false, host = false } = {}) {
  if (!agent) return '';
  const meta = STATUS_META[state] || STATUS_META.idle;
  const cls = ['rtseat'];
  if (empty) cls.push('empty');
  if (host) cls.push('host');
  const name = escapeHtml(agent.name || '');
  const role = escapeHtml(agent.roleLabel || '');
  const badge = empty
    ? `<div class="seatchair">空座</div>`
    : `<div class="rtst" style="background:${meta.color}">${escapeHtml(meta.label)}</div>`;
  const bub = (bubble && !empty)
    ? `<div class="bub">${escapeHtml(bubble)}</div>` : '';
  const ring = empty ? 'border-style:dashed;border-color:#b9c0c8;background:#f3f4f6' : '';
  return `<div class="${cls.join(' ')}" data-seat="${escapeAttr(agent.id)}">
    <div class="rt-av ${meta.cls}" style="width:56px;height:56px;border-color:${agent.themeColor || '#c9ced4'};${ring}">
      ${empty ? '' : renderAvatarInner(agent)}
    </div>
    <div class="rtname">${name}</div>
    <div class="rtrole">${role}</div>
    ${badge}
    ${bub}
  </div>`;
}

/** 仅头像内部（供 renderSeat / 圆桌控制器复用，避免重复 SVG 字符串拼装）。 */
export function renderAvatarInner(agent) {
  const av = agent.avatar;
  if (av && av.type === 'emoji') {
    return `<div class="rt-emoji" style="font-size:28px;line-height:56px">${escapeHtml(av.value || '🤖')}</div>`;
  }
  if (av && av.type === 'img' && av.value) {
    return `<img src="${escapeAttr(av.value)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  const key = (av && av.type === 'svg' && av.value) || agent.svg;
  return `<svg width="56" height="56" viewBox="0 0 56 56">${avatarInnerSVG(key)}</svg>`;
}

/** 把覆盖层合并进花名册，返回新数组（不修改入参）。 */
export function applyOverrides(roster, overrides) {
  if (!overrides || typeof overrides !== 'object') return roster.slice();
  return roster.map((a) => {
    const o = overrides[a.id];
    if (!o) return a;
    return Object.assign({}, a, o);
  });
}
