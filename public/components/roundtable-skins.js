// @ts-check
// ============================================================
// Phase 2 皮肤系统 — 圆桌可视化装饰层注册表（懒加载，进 lazy bundle）
//
// 把「麻将皮肤」彩蛋升级为圆桌可视化的一等「皮肤」概念：内置
// 围炉(hearth,默认) / 麻将(mahjong) 两款，架构上可无限扩展。
// 皮肤只定义「装饰层」（桌布/座位装饰/发言 glow/气泡图标/出牌动画），
// 角色主题色仍取自 agent-avatars.js，禁止平行复制 AGENT_THEMES。
// 纯逻辑、零 DOM 副作用（applySkin 的样式注入在浏览器环境才执行），
// 便于前端纯逻辑单测。
// ============================================================
'use strict';

/** 麻将牌 Unicode（按席位分配，制造「出牌」既视感）。 */
const TILE_BY_SEAT = {
  host: '🀏',
  fox: '🀄',
  panda: '🀅',
  owl: '🀆',
  bunny: '🀇',
};

/** #RRGGBB → rgba()，供发言 glow 用。 */
function hexToRgba(hex, a) {
  if (!hex) return `rgba(0,0,0,${a})`;
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 皮肤注册表。每肤字段：
 *  - id / label
 *  - activeGlow(color): 发言席发光 box-shadow（color=角色主题色 hex）
 *  - messageIcon(seatId, agent): 闲谈记录旁图标
 *  - tileAnim: 是否启用「出牌」动画（仅 mahjong）
 *  - css: 该肤专属样式（applySkin 注入 <style id="rt-skin-style">；切肤先移除旧 style）
 */
export const SKINS = {
  hearth: {
    id: 'hearth',
    label: '🔥 围炉',
    activeGlow: (color) => `0 0 18px ${hexToRgba(color, 0.55)}`,
    messageIcon: () => '🔥',
    tileAnim: false,
    css: `
#mahjong-embed .rt.skin-hearth{
  width:min(736px,100%);
  height:560px;
  margin:6px auto;
  border-radius:18px;
  background:radial-gradient(circle at center,#a9713f 0%,#7d4f29 60%,#5e3a1f 100%);
  border:6px solid #4a2f18;
  box-shadow:inset 0 0 40px rgba(0,0,0,.45);
  overflow:hidden;
}
#mahjong-embed .rt.skin-hearth::before{
  content:'🔥';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  font-size:140px;opacity:.05;pointer-events:none;
}
#mahjong-embed .rt.skin-hearth .center{border-radius:50%;background:rgba(255,255,255,.96);width:150px;height:150px}
#mahjong-embed .rt.skin-hearth .rt-av{border-color:#caa06b;background:#fbf3ea}
#mahjong-embed .rt.skin-hearth .rtst{background:#caa06b!important}
`,
  },
  mahjong: {
    id: 'mahjong',
    label: '🀄 麻将闲谈',
    activeGlow: (color) => `0 0 18px ${hexToRgba(color, 0.55)}`,
    messageIcon: (seatId) => TILE_BY_SEAT[seatId] || '🀄',
    tileAnim: true,
    css: `
#mahjong-embed .rt.skin-mahjong{
  width:min(736px,100%);
  height:560px;
  margin:6px auto;
  border-radius:18px;
  background:radial-gradient(circle at center,#2f6b34 0%,#1c3f20 70%,#15301a 100%);
  border:6px solid #6b4a2b;
  box-shadow:inset 0 0 40px rgba(0,0,0,.45);
  overflow:hidden;
}
#mahjong-embed .rt.skin-mahjong::before{
  content:'🀄';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  font-size:140px;opacity:.06;pointer-events:none;
}
#mahjong-embed .rt.skin-mahjong .center{border-radius:0;background:rgba(255,255,255,.92);width:150px;height:150px}
#mahjong-embed .rt.skin-mahjong .rt-av{border-color:#3B6D11;background:#f3f7ee}
#mahjong-embed .rt.skin-mahjong .rtst{background:#3B6D11!important}
@media (prefers-reduced-motion:no-preference){
  #mahjong-embed .rt.skin-mahjong .rtseat.tile-out .rt-av{animation:rt-tile-throw .5s var(--ease-out,ease-out)}
}
@keyframes rt-tile-throw{
  0%{transform:scale(.7) translateY(8px);opacity:0}
  50%{transform:scale(1.15) translateY(-4px);opacity:1}
  100%{transform:scale(1) translateY(0);opacity:1}
}`,
  },
};

/** 取皮肤（缺省回落 hearth）。 */
export function getSkin(name) {
  return SKINS[name] || SKINS.hearth;
}

/**
 * 把皮肤应用到圆桌容器（#rt，同时带 .rt 类）。
 * - 先移除所有旧 skin-* 类（按注册表枚举，避免依赖 classList 迭代）
 * - 加 skin-<id> 类（CSS 用 .rt.skin-<id> 选中选择）
 * - 浏览器环境下注入/替换 <style id="rt-skin-style">
 * @param {any} container 带 classList 的 DOM 元素
 * @param {string} name
 * @returns {object} 生效的皮肤对象
 */
export function applySkin(container, name) {
  const skin = getSkin(name);
  if (!container || !container.classList) return skin;
  for (const key of Object.keys(SKINS)) container.classList.remove('skin-' + key);
  container.classList.add('skin-' + skin.id);
  if (typeof document !== 'undefined' && document.head) {
    const old = document.getElementById('rt-skin-style');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (skin.css) {
      const st = document.createElement('style');
      st.id = 'rt-skin-style';
      st.textContent = skin.css;
      document.head.appendChild(st);
    }
  }
  return skin;
}
