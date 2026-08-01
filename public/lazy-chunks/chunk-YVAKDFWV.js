var h={host:"\u{1F00F}",fox:"\u{1F004}",panda:"\u{1F005}",owl:"\u{1F006}",bunny:"\u{1F007}"};function i(e,a){if(!e)return`rgba(0,0,0,${a})`;let n=String(e).replace("#",""),t=n.length===3?n.split("").map(s=>s+s).join(""):n,r=parseInt(t.slice(0,2),16)||0,d=parseInt(t.slice(2,4),16)||0,c=parseInt(t.slice(4,6),16)||0;return`rgba(${r},${d},${c},${a})`}var o={hearth:{id:"hearth",label:"\u{1F525} \u56F4\u7089",activeGlow:e=>`0 0 18px ${i(e,.55)}`,messageIcon:()=>"\u{1F525}",tileAnim:!1,css:`
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
  content:'\u{1F525}';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  font-size:140px;opacity:.05;pointer-events:none;
}
#mahjong-embed .rt.skin-hearth .center{border-radius:50%;background:rgba(255,255,255,.96);width:150px;height:150px}
#mahjong-embed .rt.skin-hearth .rt-av{border-color:#caa06b;background:#fbf3ea}
#mahjong-embed .rt.skin-hearth .rtst{background:#caa06b!important}
`},mahjong:{id:"mahjong",label:"\u{1F004} \u9EBB\u5C06\u95F2\u8C08",activeGlow:e=>`0 0 18px ${i(e,.55)}`,messageIcon:e=>h[e]||"\u{1F004}",tileAnim:!0,css:`
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
  content:'\u{1F004}';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
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
}`}};function m(e){return o[e]||o.hearth}function l(e,a){let n=m(a);if(!e||!e.classList)return n;for(let t of Object.keys(o))e.classList.remove("skin-"+t);if(e.classList.add("skin-"+n.id),typeof document<"u"&&document.head){let t=document.getElementById("rt-skin-style");if(t&&t.parentNode&&t.parentNode.removeChild(t),n.css){let r=document.createElement("style");r.id="rt-skin-style",r.textContent=n.css,document.head.appendChild(r)}}return n}export{o as a,m as b,l as c};
