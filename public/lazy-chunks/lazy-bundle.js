import{a as h,b as A,c as xs,d as Dt}from"./chunk-MR7TFS5Q.js";import"./chunk-TS733FMF.js";var Ni=window.QCLI=window.QCLI||{},tt=document.getElementById("terminal-search-bar"),Me=document.getElementById("terminal-search-input"),ws=document.getElementById("terminal-search-results"),qi=document.getElementById("terminal-search-prev"),Oi=document.getElementById("terminal-search-next"),ji=document.getElementById("terminal-search-close");function Dn(){return tt&&!tt.classList.contains("hidden")}function Di(){Dn()?Ft():Fn()}function Fn(){tt&&(tt.classList.remove("hidden"),Me.value="",ws.textContent="0/0",Me.focus())}function Ft(){if(!tt)return;tt.classList.add("hidden"),window.QCLI?.searchAddon&&window.QCLI.searchAddon.clearActiveSearch();let e=window.QCLI?.Tabs?.term;e&&e.focus()}function Fi(){let e=Me.value.trim(),t=window.QCLI?.searchAddon;if(!t||!e){ws.textContent="";return}t.clearActiveSearch();let s=t.findNext(e,{incremental:!1});ws.textContent=s?"\u{1F50D} 1+":"\u2717"}function Un(){let e=Me.value.trim(),t=window.QCLI?.searchAddon;!t||!e||t.findNext(e,{incremental:!0})}function Qn(){let e=Me.value.trim(),t=window.QCLI?.searchAddon;!t||!e||t.findPrevious(e,{incremental:!0})}Me&&(Me.addEventListener("input",Fi),Me.addEventListener("keydown",function(e){e.key==="Enter"&&(e.preventDefault(),e.shiftKey?Qn():Un()),e.key==="Escape"&&Ft()}));Oi?.addEventListener("click",Un);qi?.addEventListener("click",Qn);ji?.addEventListener("click",Ft);var Ui={visible:Dn,toggle:Di,show:Fn,hide:Ft};Ni.TerminalSearch=Ui;var st="[Storage]";function Vn(e,t){return{get(s,n=null){try{let a=e().getItem(s);return a!==null?a:n}catch(a){return console.warn(st,`${t}.get("${s}") failed:`,a?.message),n}},set(s,n){try{return e().setItem(s,String(n)),!0}catch(a){return console.warn(st,`${t}.set("${s}") failed:`,a?.message),!1}},remove(s){try{return e().removeItem(s),!0}catch(n){return console.warn(st,`${t}.remove("${s}") failed:`,n?.message),!1}},getJSON(s,n=null){try{let a=e().getItem(s);return a!==null?JSON.parse(a):n}catch(a){return console.warn(st,`${t}.getJSON("${s}") failed:`,a?.message),n}},setJSON(s,n){try{return e().setItem(s,JSON.stringify(n)),!0}catch(a){return console.warn(st,`${t}.setJSON("${s}") failed:`,a?.message),!1}},keys(s=""){try{let n=e(),a=[];for(let o=0;o<n.length;o++){let i=n.key(o);i&&(!s||i.startsWith(s))&&a.push(i)}return a}catch(n){return console.warn(st,`${t}.keys("${s}") failed:`,n?.message),[]}}}}var M=Vn(()=>localStorage,"local"),Ut=Vn(()=>sessionStorage,"session");if(typeof window<"u"){let e=window.QCLI=window.QCLI||{};e.safeStorage=M,e.safeSession=Ut}var j=window.QCLI=window.QCLI||{},I={collapsed:!1,activeTab:"dashboard",width:300},ve={};function Qi(e,t){return ve[e]||(ve[e]=[]),ve[e].push(t),function(){let n=ve[e].indexOf(t);n!==-1&&ve[e].splice(n,1)}}function Vi(e,t){if(!ve[e])return;if(!t){delete ve[e];return}let s=ve[e].indexOf(t);s!==-1&&ve[e].splice(s,1)}function Wi(e){let t=ve[e];if(!t)return;let s=Array.prototype.slice.call(arguments,1);for(let n=0;n<t.length;n++)try{t[n].apply(null,s)}catch(a){console.warn("[RightPanel] Event handler error:",a)}}var Y,de,te,Ae,vt,Vt=!1,nt=null,Ts=200,Cs=800;var Jn="qcli-right-panel-collapsed",Kn="qcli-right-panel-width",Yn="qcli-right-panel-tab",Wn="2";function Gi(){let e=(location.hash||"").replace(/^#/,"").trim();if(!e)return;let t=j.UIRegistry;!t||!t.getTabs||!t.getTabs().find(function(n){return n.id===e})||(I.activeTab=e,I.collapsed&&I.open())}function Ls(){Y=document.getElementById("right-panel"),Y&&(de=document.getElementById("right-panel-toggle"),te=document.getElementById("right-panel-tabs"),Ae=document.getElementById("right-panel-content"),vt=document.getElementById("right-panel-resize-handle"),Ji(),Gi(),de&&de.addEventListener("click",Es),vt&&vt.addEventListener("mousedown",io),to(),j.UIRegistry&&(j.UIRegistry.onTabRegistered=function(e){so();let t=(location.hash||"").replace(/^#/,"").trim();e&&e.id===t&&(I.collapsed&&I.open(),be(t,!0)),console.log("[RightPanel] Late-registered plugin tab:",e.id)}),window.addEventListener("hashchange",function(){let e=(location.hash||"").replace(/^#/,"").trim();if(!e)return;let t=j.UIRegistry;!t||!t.getTabs||!t.getTabs().find(function(n){return n.id===e})||(I.collapsed&&I.open(),I.activeTab!==e&&be(e,!0))}),bt(),j.RightPanel=I,I.init=Ls,I.toggle=Es,I.switchTab=be,I.open=Xi,I.close=Zi,I.on=Qi,I.off=Vi,I.showTabSearch=Ss,I.toggleMoreDropdown=Xn,I.createCollapsibleSection=ao,I.renderAllTabs=bt,console.log("[RightPanel] Initialized v2 \u2014 horizontal tab bar"))}function Ji(){M.get(Jn)==="1"&&(I.collapsed=!0,Y.classList.add("collapsed"),de&&(de.title="\u5C55\u5F00\u53F3\u4FA7\u680F"));let t=M.get(Kn);if(t){let a=parseInt(t,10);a>=Ts&&a<=Cs&&(I.width=a,ta(a))}let s=M.get(Yn),n=M.get("qcli-tab-layout-version");s&&n===Wn&&(I.activeTab=s),M.set("qcli-tab-layout-version",Wn)}function Is(){M.set(Jn,I.collapsed?"1":"0")}function Ki(e){M.set(Kn,String(e))}function Yi(e){M.set(Yn,e)}function Es(){Y&&(I.collapsed=!I.collapsed,Y.classList.toggle("collapsed",I.collapsed),de&&(de.title=I.collapsed?"\u5C55\u5F00\u53F3\u4FA7\u680F":"\u6536\u8D77\u53F3\u4FA7\u680F"),Is(),setTimeout(Wt,280))}function Xi(){Y&&(Y.classList.remove("hidden","collapsed"),I.collapsed=!1,de&&(de.title="\u6536\u8D77\u53F3\u4FA7\u680F"),Is(),setTimeout(Wt,280))}function Zi(){Y&&(Y.classList.add("collapsed"),I.collapsed=!0,de&&(de.title="\u5C55\u5F00\u53F3\u4FA7\u680F"),Is(),setTimeout(Wt,280))}function be(e,t){if(!Ae||!t&&I.activeTab===e)return;let s=I.activeTab;I.activeTab=e,Yi(e),eo(e),Ae.querySelectorAll(".rp-panel").forEach(function(r){r.classList.remove("active")});let a=document.getElementById("rp-"+e);if(a&&(a.classList.add("active"),!j.UIRegistry?.isTabRendered?.(e))){let r=j.UIRegistry?.getTabs().find(function(c){return c.id===e});if(r&&r.render)try{r.render(a),j.UIRegistry?.markTabRendered?.(e)}catch(c){console.error("[RightPanel] Plugin tab render error:",e,c)}}a&&(a.style.animation="none",a.offsetWidth,a.style.animation="");let o=Y.querySelector(".right-panel-header-icon");if(o){let c=j.UIRegistry?.getTabs().find(function(l){return l.id===e});o.textContent=c?c.icon:"\u{1F4CA}"}let i=Y.querySelector(".right-panel-title");if(i){let c=j.UIRegistry?.getTabs().find(function(l){return l.id===e});i.textContent=c?c.label:"\u5DE5\u4F5C\u53F0"}requestAnimationFrame(_s),Wi("tab:switch",e,s)}function eo(e){if(!te)return;te.querySelectorAll(".right-tab").forEach(function(n){n.classList.toggle("active",n.dataset.panel===e)});let s=document.getElementById("rp-tab-more-dropdown");s&&s.querySelectorAll(".rp-tab-more-item").forEach(function(n){n.classList.toggle("active",n.dataset.tabId===e)})}function to(){let e=document.getElementById("right-panel-tabs");e&&e.parentNode&&e.parentNode.removeChild(e);let t=document.createElement("div");t.className="right-panel-tab-bar",t.id="right-panel-tab-bar";let s=document.createElement("nav");s.className="right-panel-tabs",s.id="right-panel-tabs",t.appendChild(s);let n=document.createElement("div");n.className="right-panel-tab-actions",n.innerHTML=['<button class="rp-tab-action-btn" id="rp-tab-search-btn" title="\u641C\u7D22Tab (Ctrl+Shift+T)">\u{1F50D}</button>','<button class="rp-tab-action-btn" id="rp-tab-more-btn" title="\u66F4\u591ATab">\u2630</button>'].join(""),t.appendChild(n);let a=document.getElementById("right-panel-content");a&&a.parentNode&&a.parentNode.insertBefore(t,a),te=s,s.addEventListener("click",function(o){let i=o.target.closest(".right-tab");i&&i.dataset.panel&&(be(i.dataset.panel),I.collapsed&&Es())}),s.addEventListener("scroll",_s),document.getElementById("rp-tab-search-btn").addEventListener("click",function(o){o.stopPropagation(),Qt(),Ss()}),document.getElementById("rp-tab-more-btn").addEventListener("click",function(o){o.stopPropagation(),yt(),Xn()}),document.addEventListener("click",function(o){!o.target.closest(".rp-tab-more-dropdown")&&!o.target.closest("#rp-tab-more-btn")&&Qt(),!o.target.closest(".rp-tab-search-overlay")&&!o.target.closest("#rp-tab-search-btn")&&!o.target.closest("#rp-tab-search-input")&&yt()}),document.addEventListener("keydown",function(o){(o.ctrlKey||o.metaKey)&&o.shiftKey&&o.key==="T"&&(o.preventDefault(),Qt(),Ss())})}var ks=!1;function so(){ks||(ks=!0,Promise.resolve().then(function(){ks=!1,bt()}))}function bt(){if(!te)return;te.innerHTML="";let e=j.UIRegistry;if(!e)return;e.restoreHiddenPrefs();let t=e.getTabsByCategory(),s=!0;for(let n=0;n<t.length;n++){let a=t[n];if(a.tabs.length!==0){if(!s){let o=document.createElement("div");o.className="right-tab-category-gap",te.appendChild(o)}s=!1;for(let o=0;o<a.tabs.length;o++){let i=a.tabs[o],r=oo(i);te.appendChild(r);let c="rp-"+i.id;!document.getElementById(c)&&Ae&&Ae.appendChild(ro(i))}}}requestAnimationFrame(function(){let n=I.activeTab,a=j.UIRegistry;if(a&&a.isTabHidden(n)){let o=(a.getTabs()||[])[0];o&&(n=o.id)}be(n,!0),_s()})}function _s(){if(!te)return;let e=document.getElementById("right-panel-tab-bar");e&&(e.classList.toggle("can-scroll-left",te.scrollLeft>2),e.classList.toggle("can-scroll-right",te.scrollLeft<te.scrollWidth-te.clientWidth-2))}function Ss(){Qt();let e=document.getElementById("rp-tab-search-overlay");if(e){e.remove();return}let t=document.createElement("div");t.className="rp-tab-search-overlay",t.id="rp-tab-search-overlay",t.innerHTML=['<input type="text" class="rp-tab-search-input" id="rp-tab-search-input" placeholder="\u{1F50D} \u641C\u7D22Tab\u540D\u79F0..." autofocus />','<div class="rp-tab-search-results" id="rp-tab-search-results"></div>'].join("");let s=document.getElementById("right-panel-tab-bar");s&&s.appendChild(t);let n=document.getElementById("rp-tab-search-input");n&&(setTimeout(function(){n.focus()},50),n.addEventListener("input",function(){Gn(this.value)}),n.addEventListener("keydown",function(a){if(a.key==="Escape"){yt();return}if(a.key==="Enter"){let o=t.querySelector(".rp-tab-search-item.highlighted");o&&o.dataset.tabId&&(be(o.dataset.tabId),yt());return}if(a.key==="ArrowDown"||a.key==="ArrowUp"){a.preventDefault();let o=t.querySelectorAll(".rp-tab-search-item"),i=-1;o.forEach(function(r,c){r.classList.contains("highlighted")&&(i=c)}),i=a.key==="ArrowDown"?Math.min(i+1,o.length-1):Math.max(i-1,0),o.forEach(function(r){r.classList.remove("highlighted")}),o[i]&&(o[i].classList.add("highlighted"),o[i].scrollIntoView({block:"nearest"}))}})),Gn("")}function yt(){let e=document.getElementById("rp-tab-search-overlay");e&&e.remove()}function Gn(e){let t=document.getElementById("rp-tab-search-results");if(!t)return;let s=(e||"").toLowerCase().trim(),n=j.UIRegistry;if(!n){t.innerHTML='<div class="rp-tab-search-empty">UIRegistry \u672A\u5C31\u7EEA</div>';return}let a=n.getTabs(),o=s?a.filter(function(i){return i.label.toLowerCase().includes(s)||i.id.toLowerCase().includes(s)}):a.slice(0,20);if(o.length===0){t.innerHTML='<div class="rp-tab-search-empty">\u672A\u627E\u5230\u5339\u914D\u7684Tab</div>';return}t.innerHTML=o.map(function(i,r){let c=j.UIRegistry&&j.UIRegistry.getCategoryInfo?j.UIRegistry.getCategoryInfo(i.category):{label:"\u5176\u4ED6"};return'<div class="rp-tab-search-item'+(r===0?" highlighted":"")+'" data-tab-id="'+i.id+'"><span class="rtsi-icon">'+i.icon+"</span><span>"+i.label+'</span><span class="rtsi-category">'+c.label+"</span></div>"}).join(""),t.querySelectorAll(".rp-tab-search-item").forEach(function(i){i.addEventListener("click",function(){be(this.dataset.tabId),yt()})})}function Xn(){let e=document.getElementById("rp-tab-more-dropdown");if(e){e.remove();return}let t=document.createElement("div");t.className="rp-tab-more-dropdown",t.id="rp-tab-more-dropdown";let s=j.UIRegistry;if(!s)return;let n=s.getTabsByCategory(),a="";for(let r=0;r<n.length;r++){let c=n[r];if(c.tabs.length!==0){a+='<div class="rp-tab-more-category">'+c.icon+" "+c.label+"</div>";for(let l=0;l<c.tabs.length;l++){let d=c.tabs[l],p=d.id===I.activeTab;a+='<div class="rp-tab-more-item'+(p?" active":"")+'" data-tab-id="'+d.id+'"><span class="rtmi-icon">'+d.icon+"</span><span>"+d.label+'</span><button class="rtmi-hide" title="\u9690\u85CF\u6B64Tab">\u2715</button></div>'}}}a+='<div style="border-top:1px solid var(--border-subtle);margin-top:4px;padding-top:4px;"><div class="rp-tab-more-item" data-action="tab-manager"><span class="rtmi-icon">\u2699\uFE0F</span><span>\u7BA1\u7406Tab...</span></div></div>',t.innerHTML=a;let o=document.getElementById("rp-tab-more-btn");o&&(o.parentElement.style.position="relative",o.parentElement.appendChild(t)),t.querySelectorAll(".rp-tab-more-item[data-tab-id]").forEach(function(r){r.addEventListener("click",function(c){if(c.target.closest(".rtmi-hide")){let l=this.dataset.tabId;if(s&&s.setTabHidden(l,!0),I.activeTab===l){let d=(s.getTabs()||[])[0];d&&be(d.id)}bt(),t.remove();return}be(this.dataset.tabId),t.remove()})});let i=t.querySelector('[data-action="tab-manager"]');i&&i.addEventListener("click",function(){t.remove(),no()})}function Qt(){let e=document.getElementById("rp-tab-more-dropdown");e&&e.remove()}function no(){let e=document.getElementById("rp-tab-manager");if(e){e.remove();return}let t=document.createElement("div");t.id="rp-tab-manager",t.className="rp-tab-manager",t.style.cssText="position:absolute;top:0;left:0;right:0;bottom:0;z-index:30;background:var(--bg-elevated);overflow-y:auto;";let s=j.UIRegistry,n=s?s.getAllTabs():[],a='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:12px 14px 0;"><h3 style="flex:1;margin:0;font-size:14px;">\u2699\uFE0F Tab \u7BA1\u7406</h3><button id="rp-tm-close" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:16px;padding:4px;">\u2715</button></div><div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px;padding:0 14px;">\u663E\u793A/\u9690\u85CF\u53F3\u4FA7\u680F\u4E2D\u7684Tab\uFF08\u9690\u85CF\u7684Tab\u4ECD\u53EF\u901A\u8FC7\u641C\u7D22\u8BBF\u95EE\uFF09</div>',o={};for(let r=0;r<n.length;r++){let c=n[r],l=c.category||"other";if(!o[l]){let d=j.UIRegistry&&j.UIRegistry.getCategoryInfo?j.UIRegistry.getCategoryInfo(l):{label:"\u5176\u4ED6",icon:"\u{1F4E6}"};o[l]={label:d.label,icon:d.icon,tabs:[]}}o[l].tabs.push(c)}let i=Object.keys(o);for(let r=0;r<i.length;r++){let c=o[i[r]];a+='<div style="font-size:11px;font-weight:600;color:var(--text-tertiary);padding:6px 14px 2px;">'+c.icon+" "+c.label+"</div>";for(let l=0;l<c.tabs.length;l++){let d=c.tabs[l],p=d.hidden;a+='<div class="rp-tm-item" style="padding:4px 14px;"><button class="rp-tm-toggle '+(p?"off":"on")+'" data-tab-id="'+d.id+'"></button><span>'+d.icon+" "+d.label+"</span></div>"}}t.innerHTML=a,Ae&&(Ae.style.position="relative",Ae.appendChild(t)),document.getElementById("rp-tm-close").addEventListener("click",function(){t.remove()}),t.querySelectorAll(".rp-tm-toggle").forEach(function(r){r.addEventListener("click",function(){let c=this.dataset.tabId,l=this.classList.contains("off");if(s&&(s.setTabHidden(c,!l),this.className="rp-tm-toggle "+(l?"on":"off")),bt(),!l&&I.activeTab===c){let d=s?s.getTabs()[0]:null;d&&be(d.id)}})})}function ao(e){return['<div class="rp-collapsible'+(e.defaultOpen!==!1?" open":"")+'">','<div class="rp-collapsible-header">','<span class="rpc-icon">'+(e.icon||"\u{1F4CB}")+"</span>","<span>"+(e.title||"")+"</span>",'<span class="rpc-arrow">\u25B8</span>',"</div>",'<div class="rp-collapsible-body">','<div class="rp-collapsible-body-inner">',e.content||"","</div></div></div>"].join("")}function io(e){e.preventDefault(),Vt=!0,Y.classList.add("dragging"),vt.classList.add("active"),document.body.style.cursor="col-resize",document.body.style.userSelect="none",document.addEventListener("mousemove",Zn),document.addEventListener("mouseup",ea)}function Zn(e){Vt&&(nt||(nt=requestAnimationFrame(function(){nt=null;let s=window.innerWidth-e.clientX;s<Ts&&(s=Ts),s>Cs&&(s=Cs),I.width=s,ta(s)})))}function ea(){Vt&&(Vt=!1,nt&&(cancelAnimationFrame(nt),nt=null),Y.classList.remove("dragging"),vt.classList.remove("active"),document.body.style.cursor="",document.body.style.userSelect="",Ki(I.width),requestAnimationFrame(Wt),document.removeEventListener("mousemove",Zn),document.removeEventListener("mouseup",ea))}function ta(e){document.documentElement.style.setProperty("--right-panel-width",e+"px"),Y.style.width="",Y.style.minWidth=""}function oo(e){let t=document.createElement("button");return t.className="right-tab"+(e.id===I.activeTab?" active":""),t.dataset.panel=e.id,t.title=e.label,t.innerHTML='<span class="right-tab-icon">'+e.icon+'</span><span class="right-tab-label">'+e.label+"</span>",t}function ro(e){let t=document.createElement("div");return t.className="rp-panel",t.id="rp-"+e.id,t}function Wt(){try{let e=window.QCLI?.Tabs?.fitAddon,t=window.QCLI?.state;if(e&&(e.fit(),t&&t.launched)){let s=e.proposeDimensions();if(s){let n=window.QCLI?.wsSend;n&&n({type:"resize",cols:s.cols,rows:s.rows,tabId:window.QCLI?.Tabs?.activeTabId})}}}catch(e){console.debug("[RightPanel] terminal fit error:",e?.message)}}j.RightPanel=I;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Ls):Ls();var Ms=window.QCLI||{},sa=!1;function co(e){if(!e||e<1e3)return"0s";let t=Math.floor(e/1e3);if(t<60)return t+"s";let s=Math.floor(t/60);return s<60?s+"m"+t%60+"s":Math.floor(s/60)+"h"+s%60+"m"}function na(){if(sa)return;sa=!0;let e=async()=>{let t=document.getElementById("mcp-status-badge");if(t)try{let s=await fetch("/api/mcp/status");if(!s.ok)throw new Error("HTTP "+s.status);let n=await s.json();t.classList.remove("is-running","is-enabled","is-off","is-error"),n.running?(t.classList.add("is-running"),t.textContent=`\u8FD0\u884C\u4E2D \xB7 ${co(n.uptimeMs)} \xB7 \u91CD\u542F${n.restartCount}`,t.title=`PID ${n.pid} \xB7 \u6307\u6807 ${n.metricCount} \xB7 \u51FA ${n.stdoutBytes}B / \u9519 ${n.stderrBytes}B`):n.enabled?(t.classList.add("is-enabled"),t.textContent="\u5DF2\u542F\u7528 \xB7 \u672A\u8FD0\u884C",t.title="MCP \u7BA1\u7406\u5668\u5DF2\u521B\u5EFA\u4F46\u5B50\u8FDB\u7A0B\u672A\u8FD0\u884C"):(t.classList.add("is-off"),t.textContent="\u672A\u542F\u7528",t.title=n.message||"\u4F7F\u7528 --with-mcp \u542F\u52A8\u4EE5\u542F\u7528 MCP")}catch(s){let n=document.getElementById("mcp-status-badge");n&&(n.classList.remove("is-running","is-enabled","is-off"),n.classList.add("is-error"),n.textContent="\u72B6\u6001\u83B7\u53D6\u5931\u8D25",n.title=String(s?.message||s))}};e(),setInterval(e,5e3)}var at={events:[],cacheHits:0,cacheMisses:0,tokenSaved:0,callsByTool:{},_timeline:[],_pulse:!1,push(e){let t=Date.now();this._timeline.push({t,ev:e.ev||"unknown"});let s=t-6e4;for(;this._timeline.length>0&&this._timeline[0].t<s;)this._timeline.shift();this.events.push(e),this.events.length>200&&this.events.shift(),e.cached===!0?this.cacheHits++:(e.ev==="tool_call"||e.ev==="resource_read")&&this.cacheMisses++,e.tokenSaved&&(this.tokenSaved+=e.tokenSaved),e.tool&&(this.callsByTool[e.tool]=(this.callsByTool[e.tool]||0)+1),this._pulse=!0,setTimeout(()=>{this._pulse=!1},600),document.getElementById("rp-dashboard")?.classList.contains("active")&&requestAnimationFrame(()=>{po(),uo()})},get hitRate(){let e=this.cacheHits+this.cacheMisses;return e===0?0:this.cacheHits/e},get eventsPerSecond(){return Math.min(this._timeline.length,60)===0?0:(this._timeline.length/60).toFixed(1)},reset(){this.events=[],this.cacheHits=0,this.cacheMisses=0,this.tokenSaved=0,this.callsByTool={},this._timeline=[],this._pulse=!1}},lo={tool_call:"\u5DE5\u5177\u8C03\u7528",resource_read:"\u8D44\u6E90\u8BFB\u53D6",cache_summary:"\u7F13\u5B58\u6C47\u603B"};function Gt(){let e=at,t=e.events.length;A("dash-mcp-count",t),A("dash-mcp-hitrate",(e.hitRate*100).toFixed(1)+"%"),A("dash-mcp-hits",e.cacheHits),A("dash-mcp-misses",e.cacheMisses);let s=e.tokenSaved,n=s===0?"0 B":s<1024?s+" B":s<1048576?(s/1024).toFixed(1)+" KB":(s/1048576).toFixed(1)+" MB";A("dash-mcp-saved",n);let a=document.getElementById("mcp-pulse-dot");a&&(a.classList.toggle("active",e._pulse),e._pulse&&a.offsetWidth),A("mcp-rate-badge",e.eventsPerSecond+" eps");let o=document.getElementById("dash-mcp-empty");o&&(o.style.display=t===0?"":"none");let i=document.getElementById("dash-mcp-log");if(!i||t===0)return;let r=t+"|"+(e.events[t-1]?.ev||"");if(i.dataset.lastSerial===r)return;i.dataset.lastSerial=r;let c=e.events.slice(-15).reverse();i.innerHTML=c.map((l,d)=>{let p=l.cached?"\u2705":l.ev==="tool_call"?"\u{1F527}":l.ev==="resource_read"?"\u{1F4C4}":"\u26A1",u=l.tool||l.resource||lo[l.ev]||"\u672A\u77E5\u4E8B\u4EF6",f=l.tokens?` (${l.tokens} tok)`:"",m=l.tokenSaved?` <span class="mcp-saved">-${l.tokenSaved}tok</span>`:"";return`<div class="mcp-log-entry${d===0&&t>0?" mcp-entry-new":""}">${p} <span class="mcp-entry-name">${h(u)}</span>${f}${m}</div>`}).join("")}function po(){let e=document.getElementById("mcp-sparkline");if(!e)return;e.clientWidth>0&&e.clientWidth!==e.width&&(e.width=e.clientWidth),e.clientHeight>0&&e.clientHeight!==e.height&&(e.height=e.clientHeight);let t=e.getContext("2d"),s=e.width,n=e.height;t.clearRect(0,0,s,n);let a=at._timeline;if(a.length<2){t.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--text-tertiary").trim()||"#71717a",t.font="9px monospace",t.textAlign="center",t.fillText("\u7B49\u5F85\u4E8B\u4EF6...",s/2,n/2+3);return}let o=Date.now(),i=new Array(60).fill(0),r=o-6e4;for(let g of a){if(g.t<r)continue;let b=Math.min(59,Math.floor((g.t-r)/1e3));i[b]++}let c=Math.max(1,...i),l=getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()||"#6366f1",d=s/60;t.beginPath(),t.moveTo(0,n);for(let g=0;g<60;g++){let b=g*d+d/2,x=i[g]/c*(n-4),v=n-2-x;t.lineTo(b,v)}t.lineTo(s,n),t.closePath();let p=Ms.ChartCore&&Ms.ChartCore.parseHexToRgba?Ms.ChartCore.parseHexToRgba:function(){return null},u=t.createLinearGradient(0,0,0,n),f=p(l,.25),m=p(l,.02);f&&m?(u.addColorStop(0,f),u.addColorStop(1,m)):(u.addColorStop(0,"rgba(99,102,241,0.25)"),u.addColorStop(1,"rgba(99,102,241,0.02)")),t.fillStyle=u,t.fill(),t.beginPath(),t.strokeStyle=l,t.lineWidth=1.2;for(let g=0;g<60;g++){let b=g*d+d/2,x=i[g]/c*(n-4),v=n-2-x;g===0?t.moveTo(b,v):t.lineTo(b,v)}if(t.stroke(),i[59]>0){let g=59*d+d/2,b=i[59]/c*(n-4),x=n-2-b;t.beginPath(),t.arc(g,x,2.5,0,Math.PI*2),t.fillStyle=l,t.fill()}}function uo(){let e=document.getElementById("mcp-tool-bars");if(!e)return;let t=document.getElementById("mcp-tools-empty"),s=at.callsByTool,n=Object.entries(s);if(n.length===0){t&&(t.style.display="");return}t&&(t.style.display="none");let a=n.reduce((r,[,c])=>r+c,0),o=n.sort((r,c)=>c[1]-r[1]).slice(0,6),i=o[0][1];e.innerHTML=o.map(([r,c])=>{let l=Math.round(c/a*100),d=c/i*100;return`<div class="mcp-tool-bar-row">
      <span class="mcp-tool-bar-label" title="${h(r)}">${h(r)}</span>
      <div class="mcp-tool-bar-track">
        <div class="mcp-tool-bar-fill" style="width:${d}%"></div>
      </div>
      <span class="mcp-tool-bar-count">${c}</span>
      <span class="mcp-tool-bar-pct">${l}%</span>
    </div>`}).join("")}var C={sys:{rss:0,heap:0,uptime:0,nodeVer:"",platform:"",sessions:0},bytesSent:0,bytesReceived:0,latency:0,_lastPingTime:0,_pingInterval:null,timeline:[],_timelineMax:30,_history:{rss:[],heap:[],latency:[],disk:[],rxRate:[],txRate:[],_maxPoints:60},overview:{disks:[],rxPerSec:0,txPerSec:0,cumulativeRx:0,cumulativeTx:0},_procHistory:{},_procHistoryMax:30,_recordHistory(e,t){let s=this._history[e];s&&(s.push({t:Date.now(),v:t}),s.length>this._history._maxPoints&&s.shift())},addEvent(e,t){this.timeline.push({time:Date.now(),type:e,detail:t}),this.timeline.length>this._timelineMax&&this.timeline.shift()},recordReceived(e){this.bytesReceived+=(typeof e=="string"?e:JSON.stringify(e)).length},resetSys(){this.sys={rss:0,heap:0,uptime:0,nodeVer:"",platform:"",sessions:0}},startPing(){this.stopPing(),this._pingInterval=setInterval(()=>{this._lastPingTime=Date.now();let e=(window.QCLI||{}).wsSend;e&&e({type:"ping",ts:this._lastPingTime,_dashboard:!0})},3e4)},stopPing(){this._pingInterval&&(clearInterval(this._pingInterval),this._pingInterval=null)},handlePong(e){e&&this._lastPingTime>0&&(this.latency=Date.now()-e)},onWSMessage(e){this.recordReceived(e),e&&e.type==="pong"&&this.handlePong(e.ts||e._echo)}},aa=!1;function Rs(){if(aa)return;aa=!0;let e=window.QCLI||{},t=e.wsSend;if(typeof t!="function"){setTimeout(Rs,500);return}e.wsSend=function(s){return C.bytesSent+=(typeof s=="string"?s:JSON.stringify(s)).length,t.call(e,s)},console.log("[Dashboard] Throughput tracking active")}async function fo(){try{let e=await fetch("/health");return e.ok?await e.json():null}catch{return null}}async function mo(){try{let e=await fetch("/api/system/overview");return e.ok?await e.json():null}catch{return null}}var As=0,$s=0;function Bs(){let e=Date.now();e-As<5e3||(As=e,oa())}function Ps(){let e=Date.now();e-$s<1e4||($s=e,ra())}function ia(){As=0,$s=0,oa(),ra()}async function oa(){let e=await fo();if(!e)return;C.sys={rss:e.memory?.rss||0,heap:e.memory?.heap||0,uptime:e.uptime||0,nodeVer:e.node||"",platform:e.platform||"",sessions:e.ws?.activeSessions||0};let t=await import("./chunk-VFN4O3RK.js"),s=C.sys.rss,n=C.sys.heap;t.setText("dash-sys-mem",s+" MB"),t.setText("dash-sys-heap",n+" MB"),t.setText("dash-sys-uptime",t.formatDuration(C.sys.uptime)),t.setText("dash-sys-platform",C.sys.platform),t.setText("dash-sys-node",C.sys.nodeVer),t.setText("dash-sys-sessions",C.sys.sessions);let a=Math.min(100,s/2048*100),o=Math.min(100,n/1024*100),i=document.getElementById("dash-sys-mem-bar");i&&(i.style.width=a+"%");let r=document.getElementById("dash-sys-heap-bar");r&&(r.style.width=o+"%");let c=parseFloat(s),l=parseFloat(n);isNaN(c)||C._recordHistory("rss",c),isNaN(l)||C._recordHistory("heap",l)}async function ra(){let e=await mo();if(!e)return;let t=await import("./chunk-VFN4O3RK.js");C.overview={disks:e.disks||[],rxPerSec:e.rxPerSec||0,txPerSec:e.txPerSec||0,cumulativeRx:e.cumulativeRx||0,cumulativeTx:e.cumulativeTx||0};let s=document.getElementById("dash-disk-gauges");if(s&&e.disks){let o=e.disks.map(i=>i.usedPercent?.toFixed(1)).join(",");if(s.dataset.serial!==o){s.dataset.serial=o;let i=e.disks.filter(r=>r.usedPercent!==void 0);i.length>0&&(C._recordHistory("disk",i.reduce((r,c)=>r+c.usedPercent,0)/i.length),s.innerHTML=i.map(r=>{let c=r.usedPercent.toFixed(1),l=c>90?"var(--danger)":c>75?"var(--warning, #eab308)":"var(--success)";return`<div class="dash-sys-gauge"><div class="dash-sys-gauge-header"><span class="dash-sys-gauge-label">\u{1F4BE} ${r.mountpoint||r.fs||"\u78C1\u76D8"}</span><span class="dash-sys-gauge-value">${c}%</span></div><div class="dash-progress"><div class="dash-progress-bar gauge-bar-disk" style="width:${c}%;background:${l}"></div></div></div>`}).join(""))}}t.setText("dash-net-rx",C.overview.rxPerSec>0?t.formatBytes(C.overview.rxPerSec)+"/s":"\u2014"),t.setText("dash-net-tx",C.overview.txPerSec>0?t.formatBytes(C.overview.txPerSec)+"/s":"\u2014"),t.setText("dash-net-cumulative",C.overview.cumulativeRx>0||C.overview.cumulativeTx>0?"\u{1F4E5} "+t.formatBytes(C.overview.cumulativeRx)+" / \u{1F4E4} "+t.formatBytes(C.overview.cumulativeTx):"\u2014");let n=document.getElementById("dash-net-rx-bar");n&&(n.style.width=Math.min(100,C.overview.rxPerSec/(50*1048576)*100)+"%");let a=document.getElementById("dash-net-tx-bar");a&&(a.style.width=Math.min(100,C.overview.txPerSec/(50*1048576)*100)+"%"),C._recordHistory("rxRate",C.overview.rxPerSec),C._recordHistory("txRate",C.overview.txPerSec)}var xt={_alerts:[],_maxAlerts:5,_lastTriggers:{},_dedupMs:6e4,_thresholds:{memory:{warn:1024,high:1536},heap:{warn:512,high:768},disk:{warn:80,high:90},latency:{warn:500,high:2e3}},_procThresholds:{cpu:{warn:80},mem:{warn:500}},_procStreaks:{},_STREAK_REQUIRED:3,checkThresholds(e,t,s){let n=this._thresholds;e>n.memory.high?this.addAlert("mem_high","\u5185\u5B58\u8D85\u9650",`RSS ${e.toFixed(0)}MB > ${n.memory.high}MB`,"high"):e>n.memory.warn?this.addAlert("mem_warn","\u5185\u5B58\u504F\u9AD8",`RSS ${e.toFixed(0)}MB > ${n.memory.warn}MB`,"warning"):(this._clearAlert("mem_high"),this._clearAlert("mem_warn")),t>n.heap.high?this.addAlert("heap_high","\u5806\u5185\u5B58\u8D85\u9650",`\u5806 ${t.toFixed(0)}MB > ${n.heap.high}MB`,"high"):t>n.heap.warn?this.addAlert("heap_warn","\u5806\u5185\u5B58\u504F\u9AD8",`\u5806 ${t.toFixed(0)}MB > ${n.heap.warn}MB`,"warning"):(this._clearAlert("heap_high"),this._clearAlert("heap_warn")),s>n.latency.high?this.addAlert("latency_high","\u5EF6\u8FDF\u8FC7\u9AD8",`${s}ms > ${n.latency.high}ms`,"high"):s>n.latency.warn?this.addAlert("latency_warn","\u5EF6\u8FDF\u504F\u9AD8",`${s}ms > ${n.latency.warn}ms`,"warning"):(this._clearAlert("latency_high"),this._clearAlert("latency_warn")),this.renderAlerts()},checkProcessThresholds(e){let t=this._procThresholds,s=Date.now();for(let[n,a]of e){if(!a||!a.alive){delete this._procStreaks[n],this._clearAlert("proc_cpu_"+n),this._clearAlert("proc_mem_"+n);continue}this._procStreaks[n]||(this._procStreaks[n]={cpu:0,mem:0}),a.cpu>t.cpu.warn?(this._procStreaks[n].cpu++,this._procStreaks[n].cpu>=this._STREAK_REQUIRED&&this.addAlert("proc_cpu_"+n,"\u8FDB\u7A0B CPU \u8FC7\u9AD8",`${a.name||n}: CPU ${a.cpu}%`,"warning")):(this._procStreaks[n].cpu=0,this._clearAlert("proc_cpu_"+n)),a.memMB>t.mem.warn?(this._procStreaks[n].mem++,this._procStreaks[n].mem>=this._STREAK_REQUIRED&&this.addAlert("proc_mem_"+n,"\u8FDB\u7A0B\u5185\u5B58\u8FC7\u9AD8",`${a.name||n}: ${a.memMB}MB`,"warning")):(this._procStreaks[n].mem=0,this._clearAlert("proc_mem_"+n))}for(let n in this._procStreaks)e.has(n)||(delete this._procStreaks[n],this._clearAlert("proc_cpu_"+n),this._clearAlert("proc_mem_"+n));this.renderAlerts()},addAlert(e,t,s,n){let a=Date.now(),o=this._lastTriggers[e]||0;if(a-o<this._dedupMs)return;this._lastTriggers[e]=a;let i=this._alerts.find(r=>r.key===e);if(i){i.title=t,i.detail=s,i.severity=n,i.ts=a;return}this._alerts.push({key:e,title:t,detail:s,severity:n,ts:a}),this._alerts.length>this._maxAlerts&&this._alerts.shift()},_clearAlert(e){let t=this._alerts.findIndex(s=>s.key===e);t!==-1&&this._alerts.splice(t,1)},dismissAlert(e){this._clearAlert(e),this.renderAlerts()},dismissAll(){this._alerts=[],this._lastTriggers={},this._procStreaks={},this.renderAlerts()},renderAlerts(){let e=document.getElementById("sidebar-alerts");if(!e)return;if(this._alerts.length===0){e.innerHTML="",e.style.display="none";return}e.style.display="";let t={high:{icon:"\u{1F534}",color:"var(--danger)"},warning:{icon:"\u{1F7E1}",color:"var(--warning, #eab308)"},info:{icon:"\u{1F535}",color:"var(--accent)"}};e.innerHTML=this._alerts.map(s=>{let n=t[s.severity]||t.info;return`<div class="alert-item" data-key="${s.key}" style="border-left: 3px solid ${n.color};">
        <div class="alert-item-header">
          <span class="alert-item-icon">${n.icon}</span>
          <span class="alert-item-title">${s.title}</span>
          <span class="alert-item-close" data-dismiss="${s.key}" title="\u5173\u95ED">\u2715</span>
        </div>
        <div class="alert-item-detail">${s.detail}</div>
      </div>`}).join("")+'<button class="sa-dismiss-all" title="\u5168\u90E8\u5FFD\u7565">\u5168\u90E8\u5FFD\u7565</button>',e.onclick=s=>{let n=s.target.closest("[data-dismiss]");n&&this.dismissAlert(n.dataset.dismiss),s.target.closest(".sa-dismiss-all")&&this.dismissAll()}}};(window.QCLI||(window.QCLI={}))._alertManager=xt;var Hs=null,zs=!1;function ca(){zs=!1,Hs=null}async function Ns(){if(zs)return Hs;zs=!0;try{let e=await fetch("/api/project/analyze");if(e.ok){let t=await e.json();if(t.success)return Hs=t,t}}catch(e){console.debug("[Dashboard] load project analysis:",e?.message)}return null}async function qs(){let e=await Ns(),t=document.getElementById("dash-project-badge");if(!t)return;if(!e){t.textContent="\u4E0D\u53EF\u7528",A("dash-project-lang","\u2014"),A("dash-project-files","\u2014"),A("dash-project-loc","\u2014");return}t.textContent=e.stats.totalFiles+" \u6587\u4EF6",t.removeAttribute("style"),A("dash-project-lang",e.mainLanguage.name+(e.mainLanguage.fileCount>0?" ("+e.mainLanguage.fileCount+")":"")),A("dash-project-files",e.stats.totalFiles+" \u6587\u4EF6 / "+e.stats.totalDirs+" \u76EE\u5F55"),e.stats.sourceLOC>0?A("dash-project-loc",e.stats.sourceLOC.toLocaleString()+" \u884C"):A("dash-project-loc","\u2014");let s=document.getElementById("dash-project-types");if(s&&e.categories){let a={source:"\u{1F4EB}",markup:"\u{1F4D1}",style:"\u{1F3B9}",config:"\u2699\uFE0F",data:"\u{1F5C2}\uFE0F",media:"\u{1F3AC}",docs:"\u{1F4C4}",other:"\u{1F4E6}"},o={source:"\u6E90\u7801",markup:"\u6807\u8BB0",style:"\u6837\u5F0F",config:"\u914D\u7F6E",data:"\u6570\u636E",media:"\u5A92\u4F53",docs:"\u6587\u6863",other:"\u5176\u4ED6"},i=e.categories;s.innerHTML=Object.keys(i).filter(r=>i[r]>0).map(r=>`
      <div class="dash-project-type-item">
        <span class="dash-project-type-icon">${a[r]||"\u{1F4E6}"}</span>
        <span class="dash-project-type-value">${i[r]}</span>
        <span class="dash-project-type-label">${o[r]||r}</span>
      </div>
    `).join("")}let n=document.getElementById("dash-project-keyfiles");n&&e.keyFiles&&e.keyFiles.length>0?n.innerHTML='<div class="dash-project-section-label">\u{1F4C1} \u68C0\u6D4B\u5230\u914D\u7F6E\u6587\u4EF6</div>'+e.keyFiles.map(a=>`
        <div class="dash-project-kf-item">
          <span class="dash-project-kf-name">${h(a.name)}</span>
          <span class="dash-project-kf-label">${h(a.label)}</span>
        </div>
      `).join(""):n&&(n.innerHTML="")}var wt=!1;function la(){wt=!wt}var ho={processes:[],ts:0};async function go(){try{let e=await fetch("/api/system/process-stats");if(!e.ok)return null;let t=await e.json();if(t.success)return ho=t,t}catch(e){console.debug("[Dashboard] fetch process stats:",e?.message)}return null}function vo(){let e=getComputedStyle(document.documentElement),t=e.getPropertyValue("--accent").trim()||"#6366f1",s=e.getPropertyValue("--success").trim()||"#22c55e";for(let n in C._procHistory){let a=xs(n),o=C._procHistory[n];if(!o)continue;let i=document.getElementById("ps-cpu-"+a);i&&(window.QCLI||{}).ChartCore?.drawSparkLine&&(window.QCLI||{}).ChartCore.drawSparkLine(i,o.cpu,"#eab308","CPU","%");let r=document.getElementById("ps-mem-"+a);r&&(window.QCLI||{}).ChartCore?.drawSparkLine&&(window.QCLI||{}).ChartCore.drawSparkLine(r,o.mem,s,"\u5185\u5B58","MB")}}async function Os(){let e=document.getElementById("dash-process-list");if(!e)return;let t=(window.QCLI||{}).Tabs?.tabs||[],s=(window.QCLI||{}).Tabs?.activeTabId,n=!!(window.QCLI||{}).state?.launched;if(A("dash-process-count",t.length>0?t.length+" \u8FDB\u7A0B":"0"),t.length===0&&!n){e.innerHTML='<div class="dash-empty">\u6682\u65E0\u8FD0\u884C\u4E2D\u7684 CLI \u8FDB\u7A0B</div>';return}if(t.length===0&&n){e.innerHTML='<div class="dash-empty">CLI \u5DF2\u542F\u52A8\uFF0C\u4F46\u65E0\u6D3B\u52A8\u6807\u7B7E</div>';return}let a=await go(),o=new Map;if(a&&a.processes)for(let d of a.processes)o.set(d.tabId,d);let i=Date.now();for(let[d,p]of o){if(!p||!p.alive)continue;C._procHistory[d]||(C._procHistory[d]={cpu:[],mem:[]});let u=C._procHistory[d];p.cpu!==void 0&&(u.cpu.push({t:i,v:p.cpu}),u.cpu.length>C._procHistoryMax&&u.cpu.shift()),p.memMB!==void 0&&(u.mem.push({t:i,v:p.memMB}),u.mem.length>C._procHistoryMax&&u.mem.shift())}let r=new Set(o.keys());for(let d in C._procHistory)r.has(d)||delete C._procHistory[d];let c=t.map(d=>{let p=d._createdAt?Math.floor((Date.now()-d._createdAt)/1e3):0,u=o.get(d.tabId),f=u?String(u.cpu):"",m=u?String(u.memMB):"";return d.tabId+"|"+(d.tabId===s?"1":"0")+"|"+p+"|"+f+"|"+m}).join(",");if(e.dataset.serialized===c)return;e.dataset.serialized=c,e.innerHTML=t.map(function(d){let p=d.tabId===s,u=d._createdAt?Math.floor((Date.now()-d._createdAt)/1e3):0,f=u>0?Dt(u):"\u521A\u521A",m=d.name||d.cliId||"Terminal",g=d.icon||"\u{1F5A5}\uFE0F",b=p?"online":"offline",x=xs(d.tabId),v=o.get(d.tabId),w=v&&v.alive?v.cpu:null,T=v&&v.alive?v.memMB:null,H=v&&v.alive?v.pid:null,q=w!==null?Math.min(w,100):0,Q=w===null?"":w<30?"var(--success)":w<70?"var(--warning, #eab308)":"var(--danger)",ce=T!==null?Math.min(100,T/500*100):0,J=C._procHistory[d.tabId],jt=wt&&J&&J.cpu&&J.cpu.length>=2?'<div class="dash-proc-sparklines"><canvas class="dash-proc-sparkline" id="ps-cpu-'+x+'" width="1" height="14"></canvas><canvas class="dash-proc-sparkline" id="ps-mem-'+x+'" width="1" height="14"></canvas></div>':"",Ne=w!==null||T!==null?`<div class="dash-process-resources">
          <div class="dash-process-resource-row">
            <span class="dash-process-resource-icon">\u26A1</span>
            <div class="dash-process-resource-track">
              <div class="dash-process-resource-fill" style="width:${q}%;background:${Q}"></div>
            </div>
            <span class="dash-process-resource-value">${w!==null?w+"%":"\u2014"}</span>
          </div>
          <div class="dash-process-resource-row">
            <span class="dash-process-resource-icon">\u{1F4BE}</span>
            <div class="dash-process-resource-track">
              <div class="dash-process-resource-fill mem-fill" style="width:${ce}%"></div>
            </div>
            <span class="dash-process-resource-value">${T!==null?T+" MB":"\u2014"}</span>
          </div>
          ${jt}
          ${H?`<span class="dash-process-pid">PID ${H}</span>`:""}
        </div>`:"";return`<div class="dash-process-item ${p?"active":""}" data-tab-id="${d.tabId}">
      <div class="dash-process-item-main">
        <span class="dash-process-item-icon">${g}</span>
        <div class="dash-process-item-info">
          <span class="dash-process-item-name">${h(m)}</span>
          <span class="dash-process-item-meta">
            <span class="dash-status-dot ${b}"></span>
            ${p?"\u5F53\u524D\u4F1A\u8BDD":""}
            ${p?"\xB7":""}
            \u8FD0\u884C ${f}
          </span>
        </div>
        <span class="dash-process-item-status ${b}">
          ${p?"\u6D3B\u52A8\u4E2D":"\u540E\u53F0"}
        </span>
      </div>
      ${Ne}
    </div>`}).join("");let l=document.getElementById("dash-proc-toggle");if(l&&(l.textContent=wt?"\u{1F4CA} \u6536\u8D77\u8D8B\u52BF":"\u{1F4CA} \u5C55\u5F00\u8D8B\u52BF"),wt&&vo(),a&&a.processes){let d=new Map;for(let p=0;p<a.processes.length;p++){let u=a.processes[p];d.set(u.tabId,u)}xt.checkProcessThresholds(d)}}var bo={_modal:null,open(e,t){this._ensureEl(),this._modal.classList.add("active"),this._modal.querySelector(".dash-modal-title").textContent=`${t} \u8FDB\u7A0B\u8BE6\u60C5`,this._modal.querySelector(".dash-modal-body").innerHTML='<div class="dash-empty">\u52A0\u8F7D\u4E2D...</div>',this._fetchDetail(e)},close(){this._modal&&this._modal.classList.remove("active")},_ensureEl(){this._modal||(this._modal=document.createElement("div"),this._modal.className="dash-modal-overlay",this._modal.innerHTML=`
      <div class="dash-modal">
        <div class="dash-modal-header">
          <span class="dash-modal-title">\u8FDB\u7A0B\u8BE6\u60C5</span>
          <button class="dash-modal-close" title="\u5173\u95ED">\u2715</button>
        </div>
        <div class="dash-modal-body"></div>
      </div>`,document.body.appendChild(this._modal),this._modal.addEventListener("click",e=>{(e.target===this._modal||e.target.closest(".dash-modal-close"))&&this.close()}))},async _fetchDetail(e){try{let t=await fetch("/api/system/process-detail?tabId="+encodeURIComponent(e));if(!t.ok)throw new Error("HTTP "+t.status);let s=await t.json();s.success?this._renderDetail(s):this._modal.querySelector(".dash-modal-body").innerHTML='<div class="dash-empty">\u65E0\u6CD5\u83B7\u53D6\u8FDB\u7A0B\u8BE6\u60C5</div>'}catch(t){this._modal.querySelector(".dash-modal-body").innerHTML=`<div class="dash-empty">\u9519\u8BEF: ${h(t.message)}</div>`}},_renderDetail(e){let t=e.process||e,s=this._modal.querySelector(".dash-modal-body");s.innerHTML=`
      <div class="dash-modal-grid">
        <div class="dash-modal-field">
          <span class="dash-modal-field-label">PID</span>
          <span class="dash-modal-field-value">${t.pid||"\u2014"}</span>
        </div>
        <div class="dash-modal-field">
          <span class="dash-modal-field-label">\u540D\u79F0</span>
          <span class="dash-modal-field-value">${h(t.name||"\u2014")}</span>
        </div>
        <div class="dash-modal-field">
          <span class="dash-modal-field-label">\u72B6\u6001</span>
          <span class="dash-modal-field-value"><span class="dash-status-dot ${t.alive?"online":"offline"}"></span> ${t.alive?"\u8FD0\u884C\u4E2D":"\u5DF2\u9000\u51FA"}</span>
        </div>
        <div class="dash-modal-field">
          <span class="dash-modal-field-label">CPU</span>
          <span class="dash-modal-field-value">${t.cpu!==void 0?t.cpu+"%":"\u2014"}</span>
        </div>
        <div class="dash-modal-field">
          <span class="dash-modal-field-label">\u5185\u5B58</span>
          <span class="dash-modal-field-value">${t.memMB!==void 0?t.memMB+" MB":"\u2014"}</span>
        </div>
        <div class="dash-modal-field">
          <span class="dash-modal-field-label">\u7EBF\u7A0B\u6570</span>
          <span class="dash-modal-field-value">${t.threads!==void 0?t.threads:"\u2014"}</span>
        </div>
        <div class="dash-modal-field" style="grid-column:1/-1;">
          <span class="dash-modal-field-label">\u547D\u4EE4\u884C</span>
          <span class="dash-modal-field-value" style="font-size:10px;word-break:break-all;">${h(t.cmd||"\u2014")}</span>
        </div>
      </div>
      ${t.alive?'<button class="dash-chip-btn" id="dash-kill-btn" style="margin-top:8px;background:var(--danger);color:white;">\u{1F534} \u7EC8\u6B62\u8FDB\u7A0B</button>':""}
    `;let n=document.getElementById("dash-kill-btn");n&&t.pid&&n.addEventListener("click",async()=>{if(confirm(`\u786E\u5B9A\u7EC8\u6B62\u8FDB\u7A0B ${t.pid} (${t.name||""})\uFF1F`)){n.disabled=!0,n.textContent="\u7EC8\u6B62\u4E2D...";try{let o=await(await fetch("/api/system/kill-process",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pid:t.pid})})).json();o.success?(n.textContent="\u2705 \u5DF2\u7EC8\u6B62",setTimeout(()=>this.close(),1e3)):(n.textContent="\u274C \u7EC8\u6B62\u5931\u8D25: "+(o.error||"\u672A\u77E5\u9519\u8BEF"),n.disabled=!1)}catch{n.textContent="\u274C \u8BF7\u6C42\u5931\u8D25",n.disabled=!1}}})}};function yo(e,t){bo.open(e,t)}document.addEventListener("click",e=>{let t=e.target.closest(".dash-process-item");if(t&&!e.target.closest(".dash-process-pid")&&!e.target.closest(".dash-chip-btn")){let s=t.dataset.tabId;if(s){let a=((window.QCLI||{}).Tabs?.tabs||[]).find(o=>o.tabId===s);yo(s,a?.name||a?.cliId||"Terminal")}}});var N=window.QCLI=window.QCLI||{},z={_startTime:Date.now(),_refreshTimer:null,_REFRESH_MS:1e4,_pollTimer:null,_POLL_MS:3e3,_initialized:!1,_prevValues:{clis:0,agent:0,directory:0,tool:0,tabs:0,favorites:0},_clockTimer:null};z.mcpPush=e=>at.push(e);N._dashboardMonitor=C;function Ds(){if(z._initialized)return;z._initialized=!0,na();let e=document.getElementById("right-panel-tabs");e&&e.addEventListener("click",s=>{let n=s.target.closest(".right-tab");n&&n.dataset.panel==="dashboard"&&Ct()}),N.RightPanel&&N.RightPanel.on&&N.RightPanel.on("tab:switch",function(s){s==="dashboard"&&(ia(),Ct())}),pa(),ko(),Co(),Rs(),C.startPing();let t=N.onWSMessage;N.onWSMessage=function(s){C.onWSMessage(s),t&&t(s)},N.RightPanel&&N.RightPanel.on&&N.RightPanel.on("tab:switch",function(s){let a={dashboard:"\u4EEA\u8868\u76D8",media:"\u591A\u5A92\u4F53"}[s]||s;Po("tab","\u5207\u6362\u5230 "+a)}),xo(),window.addEventListener("beforeunload",wo),console.log("[Dashboard] Initialized")}function xo(){typeof N.UIRegistry?.registerTab=="function"&&N.UIRegistry.registerTab("dashboard",{icon:"\u{1F4CA}",label:"\u4EEA\u8868\u76D8",category:"monitor",order:0,render:e=>{e&&(e.style.display="")}})}function wo(){To(),Lo(),C.stopPing(),z._clockTimer&&(clearInterval(z._clockTimer),z._clockTimer=null)}function ko(){z._refreshTimer||(z._refreshTimer=setInterval(()=>{if(!document.getElementById("right-panel-content"))return;let t=document.getElementById("rp-dashboard");if(!t||!t.classList.contains("active"))return;let s=document.getElementById("right-panel");s&&s.classList.contains("collapsed")||Ct()},z._REFRESH_MS))}function To(){z._refreshTimer&&(clearInterval(z._refreshTimer),z._refreshTimer=null)}function Co(){z._pollTimer||(z._pollTimer=setInterval(()=>{try{Bs(),Ps()}catch{}},z._POLL_MS))}function Lo(){z._pollTimer&&(clearInterval(z._pollTimer),z._pollTimer=null)}function Ct(){_o(),Mo(),Ao(),qs(),Gt(),Os(),Bo(),ua(),Bs(),Ps(),$o(),(C.sys.rss>0||C.latency>0)&&xt.checkThresholds(C.sys.rss,C.sys.heap,C.latency)}function pa(){let e=document.getElementById("rp-dashboard");if(!e)return;Ns(),e.innerHTML=`
    <div class="dash-content" id="dash-content">
      <!-- Active Sessions -->
      <div class="dash-section">
        <div class="dash-section-title">\u6D3B\u52A8\u4F1A\u8BDD</div>
        <div class="dash-card" id="dash-session-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F4CB}</span>
            <span class="dash-card-title">\u7EC8\u7AEF\u6807\u7B7E</span>
            <span class="dash-card-badge" id="dash-tab-count">0</span>
          </div>
          <div class="dash-card-body">
            <div id="dash-tab-list" class="dash-tab-list">
              <div class="dash-empty">\u6682\u65E0\u6D3B\u52A8\u4F1A\u8BDD</div>
            </div>
          </div>
        </div>
      </div>

      <!-- MCP Monitor -->
      <div class="dash-section" id="dash-section-mcp" data-collapse="1" data-collapse-icon="\u26A1">
        <div class="dash-section-title">
          <span class="mcp-section-title-row">
            <span>MCP Monitor</span>
            <span class="mcp-pulse-dot" id="mcp-pulse-dot"></span>
            <span class="mcp-rate-badge" id="mcp-rate-badge">0 eps</span>
            <span class="mcp-status-badge" id="mcp-status-badge">\u68C0\u6D4B\u4E2D\u2026</span>
          </span>
        </div>
        <div class="dash-card" id="dash-mcp-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u26A1</span>
            <span class="dash-card-title">MCP \u5DE5\u5177\u8C03\u7528</span>
            <span class="dash-card-badge" id="dash-mcp-count">0</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-chip-group">
              <span class="dash-chip">\u547D\u4E2D\u7387 <span class="dash-chip-value" id="dash-mcp-hitrate">0%</span></span>
              <span class="dash-chip">\u5DF2\u8282\u7701 <span class="dash-chip-value" id="dash-mcp-saved">0 B</span></span>
              <span class="dash-chip">\u547D\u4E2D <span class="dash-chip-value" id="dash-mcp-hits">0</span></span>
              <span class="dash-chip">\u672A\u547D\u4E2D <span class="dash-chip-value" id="dash-mcp-misses">0</span></span>
              <button class="dash-chip-btn" id="dash-mcp-reset" title="\u91CD\u7F6E">\u91CD\u7F6E</button>
            </div>
            <div class="mcp-sparkline-wrap">
              <canvas id="mcp-sparkline" class="mcp-sparkline" width="240" height="36"></canvas>
            </div>
            <div class="mcp-tool-bars" id="mcp-tool-bars">
              <div class="dash-empty" id="mcp-tools-empty">\u7B49\u5F85\u5DE5\u5177\u8C03\u7528...</div>
            </div>
            <div class="dash-mcp-log" id="dash-mcp-log">
              <div class="dash-empty" id="dash-mcp-empty">\u7B49\u5F85 MCP \u4E8B\u4EF6...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Connection Status -->
      <div class="dash-section">
        <div class="dash-section-title">\u8FDE\u63A5\u72B6\u6001</div>
        <div class="dash-card" id="dash-connection-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F50C}</span>
            <span class="dash-card-title">WebSocket</span>
            <span class="dash-card-badge" id="dash-conn-badge">\u68C0\u67E5\u4E2D</span>
          </div>
          <div class="dash-card-body" id="dash-conn-body">
            <div class="dash-chip-group">
              <span class="dash-chip" id="dash-conn-chip">
                <span class="dash-status-dot offline" id="dash-conn-dot"></span>
                <span id="dash-conn-text">\u672A\u8FDE\u63A5</span>
              </span>
              <span class="dash-chip">\u{1F504} <span id="dash-reconn-count">0</span></span>
              <span class="dash-chip">\u23F1 <span id="dash-uptime">0s</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- CLI Statistics -->
      <div class="dash-section">
        <div class="dash-section-title">CLI \u7EDF\u8BA1</div>
        <div class="dash-card" id="dash-cli-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F680}</span>
            <span class="dash-card-title">\u5DF2\u6CE8\u518C CLI</span>
            <span class="dash-card-badge" id="dash-total-clis">0</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-chip-group" id="dash-cli-chip-group">
              <span class="dash-chip">\u{1F916} <span class="dash-chip-value" id="dash-count-agent">0</span><span class="dash-chip-label">Agent</span></span>
              <span class="dash-chip">\u{1F4C2} <span class="dash-chip-value" id="dash-count-dir">0</span><span class="dash-chip-label">Env</span></span>
              <span class="dash-chip">\u{1F527} <span class="dash-chip-value" id="dash-count-tool">0</span><span class="dash-chip-label">Tool</span></span>
              <span class="dash-chip">\u2B50 <span class="dash-chip-value" id="dash-count-fav">0</span><span class="dash-chip-label">\u6536\u85CF</span></span>
              <span class="dash-chip">\u603B\u8BA1 <span class="dash-chip-value" id="dash-total-clis">0</span></span>
            </div>
            <div class="dash-progress" id="dash-cli-progress">
              <div class="dash-progress-bar" id="dash-cli-progress-bar" style="width:0%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Project Analysis -->
      <div class="dash-section" id="dash-section-project" data-collapse="1" data-collapse-icon="\u{1F4C1}">
        <div class="dash-section-title">\u9879\u76EE\u5206\u6790</div>
        <div class="dash-card" id="dash-project-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F4C1}</span>
            <span class="dash-card-title">\u5DE5\u4F5C\u533A\u6587\u4EF6</span>
            <span class="dash-card-badge" id="dash-project-badge">\u626B\u63CF\u4E2D</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-stat"><span class="dash-stat-icon">\u{1F4DC}</span><span class="dash-stat-label">\u4E3B\u8981\u8BED\u8A00</span><span class="dash-stat-value" id="dash-project-lang">\u2014</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">\u{1F4EB}</span><span class="dash-stat-label">\u6587\u4EF6\u603B\u6570</span><span class="dash-stat-value" id="dash-project-files">\u2014</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">\u{1F4F9}</span><span class="dash-stat-label">\u6E90\u4EE3\u7801\u884C\u6570</span><span class="dash-stat-value" id="dash-project-loc">\u2014</span></div>
            <div class="dash-project-type-grid" id="dash-project-types"></div>
            <div class="dash-project-keyfiles" id="dash-project-keyfiles"></div>
            <button class="dash-project-refresh-btn" id="dash-project-refresh" title="\u91CD\u65B0\u626B\u63CF\u9879\u76EE">\u{1F504} \u91CD\u65B0\u626B\u63CF</button>
          </div>
        </div>
      </div>

      <!-- CLI Process Monitor -->
      <div class="dash-section" id="dash-section-process" data-collapse="1" data-collapse-icon="\u{1F5A5}\uFE0F">
        <div class="dash-section-title">CLI \u8FDB\u7A0B\u76D1\u63A7</div>
        <div class="dash-card" id="dash-process-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F5A5}\uFE0F</span>
            <span class="dash-card-title">\u8FD0\u884C\u4E2D\u7684\u8FDB\u7A0B</span>
            <span class="dash-card-badge" id="dash-process-count">0</span>
            <button class="dash-proc-toggle" id="dash-proc-toggle" title="\u5C55\u5F00/\u6536\u8D77\u8D8B\u52BF\u56FE">\u{1F4CA} \u5C55\u5F00\u8D8B\u52BF</button>
          </div>
          <div class="dash-card-body">
            <div class="dash-process-list" id="dash-process-list">
              <div class="dash-empty">\u6682\u65E0\u8FD0\u884C\u4E2D\u7684 CLI \u8FDB\u7A0B</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Activity Timeline -->
      <div class="dash-section" id="dash-section-timeline" data-collapse="1" data-collapse-icon="\u{1F4DC}">
        <div class="dash-section-title">\u6D3B\u52A8\u65F6\u95F4\u7EBF</div>
        <div class="dash-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F4DC}</span>
            <span class="dash-card-title">\u6700\u8FD1\u64CD\u4F5C</span>
            <span class="dash-card-badge" id="dash-timeline-count">0</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-timeline" id="dash-timeline">
              <div class="dash-empty">\u6682\u65E0\u6D3B\u52A8\u8BB0\u5F55</div>
            </div>
          </div>
        </div>
      </div>

      <!-- System Resources (\u6458\u8981 + \u8DF3\u8F6C sys-resources tab\uFF1B\u8D8B\u52BF/\u78C1\u76D8\u56FE\u8868\u79FB\u51FA\uFF0C\u907F\u514D\u4E0E sys-resources \u91CD\u590D) -->
      <div class="dash-section">
        <div class="dash-section-title">\u7CFB\u7EDF\u8D44\u6E90 <a class="dash-detail-link" id="dash-sys-detail-btn" title="\u67E5\u770B\u5B8C\u6574\u7CFB\u7EDF\u8D44\u6E90">\u67E5\u770B\u8BE6\u60C5 \u2197</a></div>
        <div class="dash-card" id="dash-sys-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F321}\uFE0F</span>
            <span class="dash-card-title">\u8FD0\u884C\u73AF\u5883</span>
            <span class="dash-card-badge" id="dash-sys-uptime">0s</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-sys-gauge">
              <div class="dash-sys-gauge-header"><span class="dash-sys-gauge-label">\u5185\u5B58 (RSS)</span><span class="dash-sys-gauge-value" id="dash-sys-mem">\u2014</span></div>
              <div class="dash-progress"><div class="dash-progress-bar gauge-bar" id="dash-sys-mem-bar" style="width:0%"></div></div>
            </div>
            <div class="dash-sys-gauge">
              <div class="dash-sys-gauge-header"><span class="dash-sys-gauge-label">\u5806\u5185\u5B58</span><span class="dash-sys-gauge-value" id="dash-sys-heap">\u2014</span></div>
              <div class="dash-progress"><div class="dash-progress-bar gauge-bar-heap" id="dash-sys-heap-bar" style="width:0%"></div></div>
            </div>
            <div class="dash-sys-meta">
              <div class="dash-sys-meta-item"><span class="dash-sys-meta-label">\u5E73\u53F0</span><span class="dash-sys-meta-value" id="dash-sys-platform">\u2014</span></div>
              <div class="dash-sys-meta-item"><span class="dash-sys-meta-label">Node</span><span class="dash-sys-meta-value" id="dash-sys-node">\u2014</span></div>
              <div class="dash-sys-meta-item"><span class="dash-sys-meta-label">WS \u4F1A\u8BDD</span><span class="dash-sys-meta-value" id="dash-sys-sessions">0</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Network Info (\u6458\u8981 + \u8DF3\u8F6C network-monitor tab\uFF1BIO \u8868/\u8D8B\u52BF\u79FB\u51FA\uFF0C\u907F\u514D\u91CD\u590D) -->
      <div class="dash-section">
        <div class="dash-section-title">\u7F51\u7EDC\u72B6\u6001 <a class="dash-detail-link" id="dash-net-detail-btn" title="\u67E5\u770B\u5B8C\u6574\u7F51\u7EDC\u76D1\u63A7">\u67E5\u770B\u8BE6\u60C5 \u2197</a></div>
        <div class="dash-card" id="dash-network-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">\u{1F4E1}</span>
            <span class="dash-card-title">\u5EF6\u8FDF & \u541E\u5410</span>
            <span class="dash-card-badge" id="dash-latency-badge">\u7B49\u5F85\u4E2D</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-chip-group">
              <span class="dash-chip">\u23F1 \u5EF6\u8FDF <span class="dash-chip-value" id="dash-latency-val">\u2014</span></span>
              <span class="dash-chip">\u{1F4E4} <span class="dash-chip-value" id="dash-bytes-sent">0 B</span></span>
              <span class="dash-chip">\u{1F4E5} <span class="dash-chip-value" id="dash-bytes-recv">0 B</span></span>
              <span class="dash-chip">\u26A1 <span class="dash-chip-value" id="dash-throughput">0 B/s</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Minimal System Info -->
      <div class="dash-section" id="dash-section-uiinfo" data-collapse="1" data-collapse-icon="\u{1F6E0}\uFE0F">
        <div class="dash-section-title">\u754C\u9762\u4FE1\u606F</div>
        <div class="dash-card">
          <div class="dash-card-body">
            <div class="dash-stat"><span class="dash-stat-icon">\u{1F6E0}\uFE0F</span><span class="dash-stat-label">\u4E3B\u9898</span><span class="dash-stat-value" id="dash-theme">\u6DF1\u8272</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">\u23F1</span><span class="dash-stat-label">\u5F53\u524D\u65F6\u95F4</span><span class="dash-stat-value" id="dash-clock" style="font-size:10px;">\u2014</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">\u{1F4EB}</span><span class="dash-stat-label">\u9875\u9762\u5927\u5C0F</span><span class="dash-stat-value" id="dash-memory">\u2014</span></div>
          </div>
        </div>
      </div>
    </div>
  `,Ct(),Gt(),Ro();let t=document.getElementById("dash-proc-toggle");t&&t.addEventListener("click",function(){la();let n=document.getElementById("dash-process-list");n&&(n.dataset.serialized=""),Os()});let s=document.getElementById("dash-project-refresh");s&&s.addEventListener("click",()=>{ca(),qs()}),Eo(e),Io(),console.log("[Dashboard] Rendered")}function Eo(e){["dash-section-mcp","dash-section-project","dash-section-process","dash-section-timeline","dash-section-uiinfo"].forEach(s=>{let n=document.getElementById(s);if(!n)return;let a=n.dataset.collapseIcon||"\u{1F4CB}";So(n,a,!1)}),e.querySelectorAll(".rp-collapsible-header").forEach(s=>{s.addEventListener("click",()=>s.parentElement.classList.toggle("open"))})}function So(e,t,s){let n=e.querySelector(":scope > .dash-section-title"),a=n?n.innerHTML:"",o=document.createDocumentFragment();Array.from(e.children).forEach(r=>{r!==n&&o.appendChild(r)});let i=document.createElement("div");i.className="rp-collapsible"+(s?" open":""),i.innerHTML='<div class="rp-collapsible-header"><span class="rpc-icon">'+t+'</span><span class="rpc-collapsible-title">'+a+'</span><span class="rpc-arrow">\u25B8</span></div><div class="rp-collapsible-body"><div class="rp-collapsible-body-inner"></div></div>',i.querySelector(".rp-collapsible-body-inner").appendChild(o),e.replaceWith(i)}function Io(){let e=document.getElementById("dash-sys-detail-btn");e&&e.addEventListener("click",s=>{s.preventDefault(),N.RightPanel&&N.RightPanel.switchTab&&N.RightPanel.switchTab("sys-resources")});let t=document.getElementById("dash-net-detail-btn");t&&t.addEventListener("click",s=>{s.preventDefault(),N.RightPanel&&N.RightPanel.switchTab&&N.RightPanel.switchTab("network-monitor")})}function _o(){let e=N.state?.clis||[],t=e.length,s=0,n=0,a=0;for(let l of e){let d=l.category||"tool";d==="agent"?s++:d==="directory"?n++:a++}let o=0;try{o=M.getJSON("qcli-favorites",[]).length}catch{}Tt("dash-total-clis",t),Tt("dash-count-agent",s),Tt("dash-count-dir",n),Tt("dash-count-tool",a),Tt("dash-count-fav",o),A("dash-total-clis",t),A("dash-count-agent",s),A("dash-count-dir",n),A("dash-count-tool",a),A("dash-count-fav",o);let i=Math.max(t,10),r=Math.min(100,t/i*100),c=document.getElementById("dash-cli-progress-bar");c&&(c.style.width=r+"%"),z._prevValues.clis=t,z._prevValues.agent=s,z._prevValues.directory=n,z._prevValues.tool=a,z._prevValues.favorites=o}function Mo(){let e=N.state||{},t=!!e.connected,s=!!e.launched,n=document.getElementById("dash-conn-dot");n&&(n.className="dash-status-dot "+(t?"online":"offline"));let a=document.getElementById("dash-conn-badge");a&&(a.textContent=t?s?"\u8FD0\u884C\u4E2D":"\u5DF2\u8FDE\u63A5":"\u65AD\u5F00",a.style.color=t?"var(--success)":"var(--text-tertiary)",a.style.background=t?"var(--success-bg, rgba(34,197,94,0.1))":"var(--bg-hover)"),A("dash-conn-text",t?s?"CLI \u8FD0\u884C\u4E2D":"WebSocket \u5DF2\u8FDE\u63A5":"\u672A\u8FDE\u63A5"),A("dash-reconn-count",e.reconnectAttempts||0);let o=Math.floor((Date.now()-z._startTime)/1e3);A("dash-uptime",Dt(o))}function Ao(){let e=N.Tabs?.tabs||[],t=N.Tabs?.activeTabId;A("dash-tab-count",e.length);let s=document.getElementById("dash-tab-list");if(!s)return;if(e.length===0){s.innerHTML='<div class="dash-empty">\u6682\u65E0\u6D3B\u52A8\u4F1A\u8BDD</div>';return}let n=e.map(o=>o.tabId+"|"+(o.tabId===t?"1":"0")).join(",");if(s.dataset.serialized===n)return;s.dataset.serialized=n;let a=e.map(o=>{let i=o.tabId===t;return`<div class="dash-tab-item" data-tab-id="${o.tabId}">
      <span class="dash-tab-dot" style="background:${i?"var(--success)":"var(--text-tertiary)"}"></span>
      <span class="dash-tab-name">${h(o.name||o.cliId||"Terminal")}</span>
      <span class="dash-tab-status">${i?"\u5F53\u524D":""}</span>
    </div>`}).join("");s.innerHTML!==a&&(s.innerHTML=a)}document.addEventListener("click",e=>{let t=e.target.closest(".dash-tab-item");if(!t)return;let s=t.dataset.tabId;if(s&&N.Tabs?.switch){N.Tabs.switch(s);let n=document.getElementById("welcome-overlay");n&&n.classList.add("hidden")}});function kt(e,t,s,n,a){let o=document.getElementById(e);o&&N.ChartCore&&N.ChartCore.drawMiniTrend&&N.ChartCore.drawMiniTrend(o,t,s,n,a)}function $o(){let e=getComputedStyle(document.documentElement),t=e.getPropertyValue("--accent").trim()||"#6366f1",s=e.getPropertyValue("--success").trim()||"#22c55e",n=e.getPropertyValue("--warning").trim()||"#eab308",a=[];for(let o=0;o<a.length;o++){let i=document.getElementById(a[o]);i&&i.clientWidth>0&&i.clientWidth!==i.width&&(i.width=i.clientWidth)}kt("dash-trend-rss",C._history.rss,s,"\u7B49\u5F85\u5185\u5B58\u6570\u636E...","MB"),kt("dash-trend-heap",C._history.heap,t,"\u7B49\u5F85\u5806\u5185\u5B58\u6570\u636E...","MB"),kt("dash-trend-latency",C._history.latency,n||"#eab308","\u7B49\u5F85\u5EF6\u8FDF\u6570\u636E...","ms"),kt("dash-trend-disk",C._history.disk,"#f43f5e","\u7B49\u5F85\u78C1\u76D8\u6570\u636E...","%"),kt("dash-trend-rxrate",C._history.rxRate,"#06b6d4","\u7B49\u5F85\u7F51\u7EDC\u6570\u636E...","B/s")}document.addEventListener("click",e=>{e.target.id==="dash-mcp-reset"&&(at.reset(),Gt())});function Ro(){da(),z._clockTimer=setInterval(da,1e3)}function da(){let t=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});A("dash-clock",t),A("dash-theme",(N.state?.theme||"dark")==="dark"?"\u6DF1\u8272":"\u4EAE\u8272");let s=document.getElementById("dash-memory");if(s&&performance?.memory){let n=Math.round(performance.memory.usedJSHeapSize/1048576);s.textContent=n+" MB"}else s&&(s.textContent="\u2014")}function Tt(e,t){let s=document.getElementById(e);if(!s)return;let a={"dash-total-clis":"clis","dash-count-agent":"agent","dash-count-dir":"directory","dash-count-tool":"tool","dash-count-fav":"favorites"}[e];if(!a)return;let o=z._prevValues[a];o!==void 0&&o!==t&&(s.classList.remove("dash-countup"),s.offsetWidth,s.classList.add("dash-countup"),setTimeout(()=>s.classList.remove("dash-countup"),350))}function Bo(){let e=C.latency;A("dash-latency-val",e===0?"\u2014":e+" ms"),A("dash-bytes-sent",js(C.bytesSent)),A("dash-bytes-recv",js(C.bytesReceived));let t=Date.now(),s=Math.max(1,t-z._startTime),n=(C.bytesSent+C.bytesReceived)/(s/1e3);A("dash-throughput",js(n)+"/s");let a=document.getElementById("dash-latency-badge");a&&(e===0?(a.textContent="\u7B49\u5F85\u4E2D",a.style.background="var(--bg-hover)"):e<100?(a.textContent=e+" ms \u2713",a.style.color="var(--success)",a.style.background="rgba(34,197,94,0.1)"):e<500?(a.textContent=e+" ms",a.style.color="var(--warning, #eab308)",a.style.background="rgba(234,179,8,0.1)"):(a.textContent=e+" ms \u26A0",a.style.color="var(--danger)",a.style.background="rgba(239,68,68,0.1)"))}function js(e){if(e===0)return"0 B";let t=["B","KB","MB","GB","TB"],s=Math.floor(Math.log(e)/Math.log(1024)),n=e/Math.pow(1024,s);return(s===0?e:n.toFixed(1))+" "+t[s]}function Po(e,t){C.addEvent(e,t),document.getElementById("rp-dashboard")?.classList.contains("active")&&ua()}function ua(){let e=C.timeline;A("dash-timeline-count",e.length);let t=document.getElementById("dash-timeline");if(!t)return;if(e.length===0){t.innerHTML='<div class="dash-empty">\u6682\u65E0\u6D3B\u52A8\u8BB0\u5F55</div>';return}let s=e.length+"|"+(e[e.length-1]?.type||"");if(t.dataset.serial===s)return;t.dataset.serial=s;let n={system:"\u2699\uFE0F",tab:"\u{1F4CB}",cli:"\u{1F680}",connection:"\u{1F50C}",error:"\u274C"};t.innerHTML=e.slice(-20).reverse().map(a=>{let o=n[a.type]||"\u{1F4CC}",i=new Date(a.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});return`<div class="dash-timeline-item">
      <span class="dash-timeline-icon">${o}</span>
      <span class="dash-timeline-time">${i}</span>
      <span class="dash-timeline-text">${h(a.detail||"")}</span>
    </div>`}).join("")}z.init=Ds;z.refresh=Ct;z.render=pa;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Ds):Ds();var U=window.QCLI=window.QCLI||{},Kt={rss:{line:"#22c55e",area:"rgba(34,197,94,0.12)",label:"\u5185\u5B58 (RSS)",unit:"MB",icon:"\u{1F4BE}"},heap:{line:"#6366f1",area:"rgba(99,102,241,0.12)",label:"\u5806\u5185\u5B58",unit:"MB",icon:"\u{1F9E0}"},latency:{line:"#f59e0b",area:"rgba(245,158,11,0.12)",label:"\u5EF6\u8FDF",unit:"ms",icon:"\u23F1"},disk:{line:"#f43f5e",area:"rgba(244,63,94,0.12)",label:"\u78C1\u76D8\u4F7F\u7528\u7387",unit:"%",icon:"\u{1F4BE}"},rxRate:{line:"#06b6d4",area:"rgba(6,182,212,0.12)",label:"\u4E0B\u8F7D\u901F\u7387",unit:"B/s",icon:"\u{1F4E5}"},txRate:{line:"#8b5cf6",area:"rgba(139,92,246,0.12)",label:"\u4E0A\u4F20\u901F\u7387",unit:"B/s",icon:"\u{1F4E4}"}},rt=["rss","heap","latency","disk","rxRate","txRate"],Jt={};function Yt(e){return U._dashboardMonitor&&U._dashboardMonitor._history&&U._dashboardMonitor._history[e]||[]}function Fs(){if(U._sysResourcesInited)return;if(U._sysResourcesInited=!0,!U.UIRegistry){console.warn("[SysResources] UIRegistry not available \u2014 retrying"),setTimeout(Fs,500);return}if(U.UIRegistry.registerTab("sys-resources",{icon:"\u{1F5A5}\uFE0F",label:"\u7CFB\u7EDF\u8D44\u6E90",order:1,category:"monitor",render:function(t){Ho(t)}})){console.log("[SysResources] Tab registered"),U.RightPanel&&U.RightPanel.on&&U.RightPanel.on("tab:switch",function(s){s==="sys-resources"&&(Us(),Qs())});let t=setInterval(function(){let s=document.getElementById("rp-sys-resources");s&&s.classList.contains("active")&&(Us(),Qs())},4e3);window.addEventListener("beforeunload",function(){clearInterval(t)})}}function Ho(e){e.innerHTML='<div class="sr-content" id="sr-content"><div class="dash-section"><div class="dash-section-title">\u{1F4CA} \u8FD0\u884C\u6458\u8981</div><div class="sr-summary-grid" id="sr-summary-grid">'+rt.map(function(s){let n=Kt[s];return'<div class="sr-summary-card" style="border-left:3px solid '+n.line+'"><div class="sr-summary-icon">'+n.icon+'</div><div class="sr-summary-body"><div class="sr-summary-label">'+n.label+'</div><div class="sr-summary-current" id="sr-cur-'+s+'">\u2014</div><div class="sr-summary-stats" id="sr-stats-'+s+'"></div></div></div>'}).join("")+'</div></div><div class="dash-section"><div class="dash-section-title">\u{1F4C8} \u8D8B\u52BF\u56FE\u8868</div><div class="sr-charts-grid" id="sr-charts-grid">'+rt.map(function(s){let n=Kt[s];return'<div class="dash-card sr-chart-card"><div class="dash-card-header"><span class="dash-card-icon">'+n.icon+'</span><span class="dash-card-title">'+n.label+'</span><span class="dash-card-badge" id="sr-chart-badge-'+s+'">\u2014</span></div><div class="dash-card-body sr-chart-body"><div class="sr-chart-wrap"><canvas id="sr-chart-'+s+'" class="sr-chart-canvas"></canvas></div></div></div>'}).join("")+'</div></div><div class="dash-section"><div class="dash-section-title">\u{1F4CB} \u5386\u53F2\u6570\u636E</div><div class="dash-card"><div class="dash-card-header"><span class="dash-card-icon">\u{1F4CA}</span><span class="dash-card-title">\u6570\u636E\u70B9\u8BB0\u5F55 (\u6700\u8FD1 60 \u4E2A)</span><span class="dash-card-badge" id="sr-table-count">0</span><button class="dash-chip-btn" id="sr-export-csv" title="\u5BFC\u51FA CSV">\u{1F4E5} CSV</button></div><div class="dash-card-body" style="padding:0;"><div class="sr-table-wrap" id="sr-table-wrap"><table class="sr-table" id="sr-table"><thead><tr><th>\u65F6\u95F4</th><th>RSS (MB)</th><th>\u5806\u5185\u5B58 (MB)</th><th>\u5EF6\u8FDF (ms)</th><th>\u78C1\u76D8 (%)</th><th>\u4E0B\u8F7D (B/s)</th><th>\u4E0A\u4F20 (B/s)</th></tr></thead><tbody id="sr-table-body"></tbody></table></div></div></div></div></div>',zo(),Us(),Qs();let t=e.querySelector("#sr-export-csv");t&&t.addEventListener("click",qo)}function zo(){let e=Date.now();rt.forEach(function(t){let s=Yt(t),n=document.getElementById("sr-cur-"+t),a=document.getElementById("sr-stats-"+t);if(!n||!a)return;if(s.length===0){n.textContent="\u2014",a.textContent="";return}let o=s.map(function(u){return u.v}),i=o[o.length-1],r=Math.min.apply(null,o),c=Math.max.apply(null,o),l=o.reduce(function(u,f){return u+f},0)/o.length,d=Kt[t];n.textContent=ot(i,t)+" "+d.unit;let p=document.getElementById("sr-chart-badge-"+t);p&&(p.textContent=ot(i,t)+" "+d.unit),a.innerHTML='<span class="sr-stat-item"><span class="sr-stat-label">\u6700\u4F4E</span><span class="sr-stat-val">'+ot(r,t)+'</span></span><span class="sr-stat-item"><span class="sr-stat-label">\u6700\u9AD8</span><span class="sr-stat-val">'+ot(c,t)+'</span></span><span class="sr-stat-item"><span class="sr-stat-label">\u5E73\u5747</span><span class="sr-stat-val">'+ot(l,t)+"</span></span>"})}function Us(){rt.forEach(function(e){let t=document.getElementById("sr-chart-"+e);if(!t)return;let s=Yt(e);if(s.length<2){t.getContext("2d").clearRect(0,0,t.width,t.height);return}let n=t.parentElement;n&&n.clientWidth>0&&t.clientWidth!==n.clientWidth&&(t.style.width=n.clientWidth+"px",t.style.height="120px");let a=s.map(function(r){return r.v}),o=s.map(function(r){let c=Math.round((Date.now()-r.t)/1e3);return c<60?c+"s\u524D":Math.floor(c/60)+"m\u524D"}),i=Kt[e];if(U.ChartCore&&U.ChartCore.Chart){if(Jt[e]){try{Jt[e].destroy()}catch(c){console.warn("[SysResources] Chart destroy error:",c?.message)}Jt[e]=null}let r=new U.ChartCore.Chart({canvas:t,type:"area",data:{labels:o,datasets:[{label:i.label,data:a,color:i.line,fillColor:i.line}]},options:{animate:!1,showGrid:!0,showAxis:!0,showLegend:!1,showTooltip:!0,showDots:!1,fillOpacity:.15,lineWidth:1.5,fontSize:9,yAxisTicks:3,yAxisFormat:function(c){return ot(c,e)}}});Jt[e]=r}else No(t,s,i.line,e)})}function No(e,t,s,n){e.width=e.parentElement.clientWidth||300,e.height=120;let a=e.getContext("2d"),o=e.width,i=e.height;a.clearRect(0,0,o,i);let r=t.map(function(H){return H.v}),c=Math.min.apply(null,r),d=Math.max.apply(null,r)-c||1,p=4,u=4,f=o-p*2,m=i-u*2;function g(H){return u+(1-(H-c)/d)*m}let b=t.slice(-60),x=b.length>1?f/(b.length-1):f;a.beginPath(),a.moveTo(p,m+u);for(var v=0;v<b.length;v++)a.lineTo(p+v*x,g(b[v].v));a.lineTo(p+(b.length-1)*x,m+u),a.closePath();let w=U.ChartCore&&U.ChartCore.parseHexToRgba?U.ChartCore.parseHexToRgba(s,.1):null;a.fillStyle=w||s+"1A",a.fill(),a.beginPath(),a.strokeStyle=s,a.lineWidth=1.5;for(var v=0;v<b.length;v++){let q=p+v*x,Q=g(b[v].v);v===0?a.moveTo(q,Q):a.lineTo(q,Q)}a.stroke();let T=b[b.length-1];a.beginPath(),a.arc(p+(b.length-1)*x,g(T.v),3,0,Math.PI*2),a.fillStyle=s,a.fill()}function Qs(){let e=document.getElementById("sr-table-body"),t=document.getElementById("sr-table-count");if(!e)return;let s={};rt.forEach(function(i){Yt(i).forEach(function(c){s[c.t]=s[c.t]||{},s[c.t][i]=c.v})});let n=Object.keys(s).map(Number).sort(function(i,r){return r-i});if(n.length===0){e.innerHTML='<tr><td colspan="7" class="sr-empty">\u6682\u65E0\u6570\u636E</td></tr>',t&&(t.textContent="0");return}t&&(t.textContent=String(n.length));let a="",o=60;for(let i=0;i<Math.min(n.length,o);i++){let r=n[i],c=s[r],l=new Date(r).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});a+='<tr><td class="sr-td-time">'+l+"</td><td>"+it(c.rss)+"</td><td>"+it(c.heap)+"</td><td>"+it(c.latency)+"</td><td>"+it(c.disk)+"</td><td>"+it(c.rxRate)+"</td><td>"+it(c.txRate)+"</td></tr>"}e.innerHTML=a}function qo(){let e={};rt.forEach(function(i){Yt(i).forEach(function(c){e[c.t]=e[c.t]||{},e[c.t][i]=c.v})});let t=Object.keys(e).map(Number).sort(function(i,r){return i-r});if(t.length===0){U.showToast&&U.showToast("\u6682\u65E0\u6570\u636E\u53EF\u5BFC\u51FA","info");return}let s=`\u65F6\u95F4,RSS (MB),\u5806\u5185\u5B58 (MB),\u5EF6\u8FDF (ms),\u78C1\u76D8 (%),\u4E0B\u8F7D (B/s),\u4E0A\u4F20 (B/s)
`;t.forEach(function(i){let r=e[i],c=new Date(i).toLocaleString();s+=c+","+(r.rss!==void 0?r.rss:"")+","+(r.heap!==void 0?r.heap:"")+","+(r.latency!==void 0?r.latency:"")+","+(r.disk!==void 0?r.disk:"")+","+(r.rxRate!==void 0?r.rxRate:"")+","+(r.txRate!==void 0?r.txRate:"")+`
`});let n=new Blob(["\uFEFF"+s],{type:"text/csv;charset=utf-8;"}),a=URL.createObjectURL(n),o=document.createElement("a");o.href=a,o.download="system-resources-"+new Date().toISOString().slice(0,19).replace(/:/g,"-")+".csv",document.body.appendChild(o),o.click(),document.body.removeChild(o),setTimeout(function(){URL.revokeObjectURL(a)},5e3),U.showToast&&U.showToast("\u2705 CSV \u5DF2\u5BFC\u51FA","success")}function ot(e,t){return e==null?"\u2014":typeof e!="number"?String(e):t==="rxRate"||t==="txRate"?e>=1048576?(e/1048576).toFixed(1):e>=1024?(e/1024).toFixed(1):e.toFixed(0):e>=1e3||e>=100?e.toFixed(0):(e>=10,e.toFixed(1))}function it(e){return e==null?"\u2014":typeof e=="number"?e>=1e3||e>=100?e.toFixed(0):e.toFixed(1):String(e)}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Fs):setTimeout(Fs,200);var Oo=window.QCLI=window.QCLI||{},jo="QCLI_FinanceDB",Do=1,Fo=["budgets","settlements","assets","dcaPlans"],Xt=null;function fa(){return new Promise(function(e,t){if(Xt)return e(Xt);let s=indexedDB.open(jo,Do);s.onupgradeneeded=function(n){let a=n.target.result;Fo.forEach(function(o){a.objectStoreNames.contains(o)||a.createObjectStore(o,{keyPath:"id"})})},s.onsuccess=function(n){Xt=n.target.result,e(Xt)},s.onerror=function(n){t(n.target.error)}})}function ct(e,t){return fa().then(function(s){return s.transaction(e,t||"readonly").objectStore(e)})}var Uo={loadAll:function(e){return ct(e).then(function(t){return new Promise(function(s,n){let a=t.getAll();a.onsuccess=function(){s(a.result||[])},a.onerror=function(){n(a.error)}})})},getById:function(e,t){return ct(e).then(function(s){return new Promise(function(n,a){let o=s.get(t);o.onsuccess=function(){n(o.result||null)},o.onerror=function(){a(o.error)}})})},add:function(e,t){return t.id||(t.id=Date.now().toString(36)+Math.random().toString(36).slice(2,8)),t.createdAt=t.createdAt||new Date().toISOString(),t.updatedAt=new Date().toISOString(),ct(e,"readwrite").then(function(s){return new Promise(function(n,a){let o=s.add(t);o.onsuccess=function(){n(t)},o.onerror=function(){a(o.error)}})})},update:function(e,t,s){return this.getById(e,t).then(function(n){if(!n)throw new Error("Not found: "+t);return Object.assign(n,s),n.updatedAt=new Date().toISOString(),ct(e,"readwrite").then(function(a){return new Promise(function(o,i){let r=a.put(n);r.onsuccess=function(){o(n)},r.onerror=function(){i(r.error)}})})})},remove:function(e,t){return ct(e,"readwrite").then(function(s){return new Promise(function(n,a){let o=s.delete(t);o.onsuccess=function(){n(!0)},o.onerror=function(){a(o.error)}})})},clear:function(e){return ct(e,"readwrite").then(function(t){return new Promise(function(s,n){let a=t.clear();a.onsuccess=function(){s(!0)},a.onerror=function(){n(a.error)}})})},queryByIndex:function(e,t,s){return fa().then(function(n){let i=n.transaction(e,"readonly").objectStore(e).index(t);return new Promise(function(r,c){let l=i.getAll(s);l.onsuccess=function(){r(l.result||[])},l.onerror=function(){c(l.error)}})})}};Oo.FinanceStore=Uo;var S=window.QCLI=window.QCLI||{};function se(e){return e==null||isNaN(e)?"0.00":Number(e).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}function D(e){return e==null?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;")}var pe={draft:{label:"\u8349\u7A3F",cls:"finance-status-draft"},submitted:{label:"\u5F85\u5BA1\u6279",cls:"finance-status-submitted"},approved:{label:"\u5DF2\u901A\u8FC7",cls:"finance-status-approved"},rejected:{label:"\u5DF2\u62D2\u7EDD",cls:"finance-status-rejected"},closed:{label:"\u5DF2\u5173\u95ED",cls:"finance-status-closed"}},dt={pending:{label:"\u5F85\u6838\u9500",cls:"finance-status-pending"},partial:{label:"\u90E8\u5206\u6838\u9500",cls:"finance-status-partial"},settled:{label:"\u5DF2\u6838\u9500",cls:"finance-status-settled"}},qe=[{id:"project",label:"\u9879\u76EE\u7ECF\u8D39"},{id:"office",label:"\u529E\u516C\u884C\u653F"},{id:"travel",label:"\u5DEE\u65C5\u4EA4\u901A"},{id:"equipment",label:"\u8BBE\u5907\u91C7\u8D2D"},{id:"other",label:"\u5176\u4ED6"}],W="/api/finance";function xa(e){let t=pe[e]||dt[e];return t?t.cls:""}function wa(e){let t=pe[e]||dt[e];return t?t.label:e}function Js(e){for(let t=0;t<qe.length;t++)if(qe[t].id===e)return qe[t].label;return e}var Ks="overview",Zt="",es="",Ys=null,Xs=null,Ws=[],ma=!1;function ka(e,t){let s=setTimeout(e,t);return Ws.push(s),s}function Ta(){Ws.forEach(function(e){clearTimeout(e)}),Ws=[]}function Qo(){ma||(ma=!0,S.injectCSS&&S.injectCSS("/css/finance.css"),Ca(),console.log("[Finance] Module initialized"),console.log("[Finance] Open /budget.html for standalone page"))}function Oe(){let e=document.getElementById("rp-finance");e&&(Ta(),e.innerHTML=Vo(),Ca(e),ka(function(){Wo()},50))}function Vo(){let e=[{id:"overview",label:"\u603B\u89C8",icon:"\u{1F4CA}"},{id:"budgets",label:"\u9884\u7B97\u7533\u8BF7",icon:"\u{1F4CB}"},{id:"settlements",label:"\u9500\u8D26\u8BB0\u5F55",icon:"\u2705"},{id:"ai",label:"AI \u5EFA\u8BAE",icon:"\u{1F4A1}"}],t='<div class="finance-sub-tabs">';for(let s=0;s<e.length;s++){let n=e[s];t+='<button class="finance-sub-tab'+(n.id===Ks?" active":"")+'" data-sub="'+n.id+'">'+n.icon+" "+n.label+"</button>"}return t+='</div><div class="finance-content" id="finance-content"></div>',t}var ha=!1;function Ca(e){ha||(ha=!0,document.addEventListener("click",function(t){if(!t.target.closest("#rp-finance, #standalone-content, #app.budget-container, .finance-modal-overlay, .finance-modal, .finance-content"))return;let s=t.target.closest(".finance-sub-tab");if(s){Ks=s.dataset.sub,Oe();return}if(t.target.closest(".finance-modal-close")||t.target.closest(".finance-modal-overlay")&&!t.target.closest(".finance-modal")){lt();return}if(t.target.closest("#finance-create-budget")){Vs(null);return}let n=t.target.closest(".finance-budget-card");if(n&&n.dataset.id){Yo(n.dataset.id);return}if(t.target.closest("#finance-create-settlement")){ba(null);return}let a=t.target.closest(".finance-budget-edit");if(a){Vs(a.dataset.id);return}let o=t.target.closest(".finance-budget-delete");if(o){va(o.dataset.id);return}let i=t.target.closest(".finance-budget-status");if(i){Ko(i.dataset.id,i.dataset.status);return}let r=t.target.closest(".finance-settle-edit");if(r){ba(r.dataset.id);return}let c=t.target.closest(".finance-settle-delete");if(c){Zo(c.dataset.id);return}if(t.target.closest("#finance-ai-refresh")){let l=document.getElementById("finance-content");l&&tn(l);return}if(t.target.closest("#finance-submit-budget")){Jo();return}if(t.target.closest("#finance-add-item")){Go();return}if(t.target.closest(".fi-remove")){let l=t.target.closest("tr");l&&l.parentNode&&l.parentNode.removeChild(l),Gs();return}if(t.target.closest("#finance-submit-settlement")){Xo();return}if(t.target.closest(".finance-cancel-btn")){lt();return}if(t.target.closest(".finance-detail-edit")){let l=t.target.closest(".finance-detail-edit").dataset.id;lt(),setTimeout(function(){Vs(l)},100);return}if(t.target.closest(".finance-detail-delete")){let l=t.target.closest(".finance-detail-delete").dataset.id;lt(),setTimeout(function(){va(l)},100);return}}),document.addEventListener("input",function(t){t.target.closest("#rp-finance, #standalone-content, #app.budget-container, .finance-modal-overlay")&&t.target.closest("#fb-items")&&Gs()}),document.addEventListener("change",function(t){if(t.target.closest("#rp-finance, #standalone-content, #app.budget-container")){if(t.target.id==="finance-filter-status"){Zt=t.target.value;let s=document.getElementById("finance-content");s&&Zs(s)}if(t.target.id==="finance-settle-filter"){es=t.target.value;let s=document.getElementById("finance-content");s&&en(s)}}}))}function Wo(){let e=document.getElementById("finance-content");if(e)switch(Ks){case"overview":La(e);break;case"budgets":Zs(e);break;case"settlements":en(e);break;case"ai":tn(e);break}}function La(e){e.innerHTML='<div class="finance-loading">\u52A0\u8F7D\u4E2D...</div>',fetch(W+"/stats").then(function(t){return t.json()}).then(function(t){if(!t.success)throw new Error(t.error||"Error");let s=t.stats,n=s.budgetStatusCount&&s.budgetStatusCount.submitted||0,a=s.totalBudget>0?(s.totalSettled/s.totalBudget*100).toFixed(1):"0.0",o="";if(s.categoryStats){let c=Object.keys(s.categoryStats);for(let l=0;l<c.length;l++){let d=c[l],p=s.categoryStats[d],u=p.total>0?(p.settled/p.total*100).toFixed(1):"0.0";o+="<tr><td>"+Js(d)+"</td><td>"+p.count+"</td><td>\xA5"+se(p.total)+"</td><td>\xA5"+se(p.settled)+"</td><td>"+u+"%</td></tr>"}}let i="",r=Object.keys(pe);for(let c=0;c<r.length;c++){let l=r[c],d=s.budgetStatusCount&&s.budgetStatusCount[l]||0;d>0&&(i+='<span class="finance-status '+pe[l].cls+'" style="margin:2px 4px 2px 0;">'+pe[l].label+": "+d+"</span>")}i||(i='<span style="color:var(--text-tertiary);font-size:11px;">\u6682\u65E0\u9884\u7B97</span>'),e.innerHTML='<div class="finance-metric-grid"><div class="finance-metric"><div class="finance-metric-label">\u603B\u9884\u7B97</div><div class="finance-metric-value">\xA5'+se(s.totalBudget)+'</div><div class="finance-metric-sub">'+s.budgetCount+' \u4E2A\u9884\u7B97\u5355</div></div><div class="finance-metric"><div class="finance-metric-label">\u5DF2\u6838\u9500</div><div class="finance-metric-value">\xA5'+se(s.totalSettled)+'</div><div class="finance-metric-sub">\u6267\u884C\u7387 '+a+'%</div></div><div class="finance-metric"><div class="finance-metric-label">\u5F85\u5BA1\u6279</div><div class="finance-metric-value">'+n+'</div><div class="finance-metric-sub">\u9884\u7B97\u7533\u8BF7</div></div><div class="finance-metric"><div class="finance-metric-label">\u5F85\u6838\u9500</div><div class="finance-metric-value">'+s.pendingSettlements+'</div><div class="finance-metric-sub">\u7B14\u9500\u8D26</div></div></div><details class="collapsible-block"><summary>\u{1F4CA} \u5206\u7C7B\u9884\u7B97\u6267\u884C</summary><div class="finance-card"><div class="finance-card-title">\u5206\u7C7B\u9884\u7B97\u6267\u884C\u660E\u7EC6</div><table class="finance-table"><thead><tr><th>\u5206\u7C7B</th><th>\u6570\u91CF</th><th>\u9884\u7B97\u603B\u989D</th><th>\u5DF2\u6838\u9500</th><th>\u6267\u884C\u7387</th></tr></thead><tbody>'+(o||'<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--text-tertiary)">\u6682\u65E0\u6570\u636E</td></tr>')+'</tbody></table></div></details><div class="finance-card"><div class="finance-card-title">\u{1F4CB} \u9884\u7B97\u72B6\u6001\u5206\u5E03</div><div style="display:flex;gap:4px;flex-wrap:wrap;">'+i+"</div></div>"}).catch(function(t){e.innerHTML='<div class="finance-empty"><div class="finance-empty-icon">\u{1F4CA}</div>\u65E0\u6CD5\u52A0\u8F7D\u7EDF\u8BA1\u6570\u636E<br><span style="font-size:10px;color:var(--text-tertiary)">'+D(t.message)+"</span></div>"})}function Zs(e){e.innerHTML='<div class="finance-loading">\u52A0\u8F7D\u4E2D...</div>',fetch(W+"/budgets").then(function(t){return t.json()}).then(function(t){if(!t.success)throw new Error("Error");let s=t.budgets||[],n='<option value="">\u5168\u90E8\u72B6\u6001</option>',a=Object.keys(pe);for(let r=0;r<a.length;r++){let c=a[r];n+='<option value="'+c+'"'+(c===Zt?" selected":"")+">"+pe[c].label+"</option>"}let o=s;Zt&&(o=s.filter(function(r){return r.status===Zt}));let i=o.map(function(r){let c=pe[r.status]||pe.draft,l=0;r.settlements&&r.settlements.forEach(function(u){l+=u.amount||0});let d=r.totalAmount>0?l/r.totalAmount*100:0,p=d>=80?"danger":d>=50?"warn":"good";return'<div class="finance-budget-card" data-id="'+r.id+'"><div class="finance-budget-card-header"><div><div class="finance-budget-card-title">'+D(r.title)+'</div><div class="finance-budget-card-category">'+Js(r.category)+'</div></div><span class="finance-status '+c.cls+'">'+c.label+'</span></div><div style="font-size:13px;font-weight:600;">\xA5'+se(r.totalAmount)+'</div><div class="finance-progress"><div class="finance-progress-fill '+p+'" style="width:'+Math.min(d,100)+'%"></div></div><div class="finance-budget-card-footer"><span>\u5DF2\u7528 \xA5'+se(l)+" / \xA5"+se(r.totalAmount)+" ("+d.toFixed(1)+'%)</span><span style="font-size:10px;color:var(--text-tertiary)">'+(r.createdAt||"").slice(0,10)+"</span></div></div>"}).join("");e.innerHTML='<div class="finance-filter-bar"><select id="finance-filter-status">'+n+'</select><span style="font-size:10px;color:var(--text-tertiary)">'+o.length+" / "+s.length+'</span><div class="spacer"></div><button class="finance-btn" id="finance-create-budget">\u2795 \u65B0\u5EFA\u9884\u7B97</button></div><div id="finance-budget-list">'+(i||'<div class="finance-empty"><div class="finance-empty-icon">\u{1F4CB}</div>\u6682\u65E0\u9884\u7B97\u7533\u8BF7<br><span style="font-size:10px;color:var(--text-tertiary)">\u70B9\u51FB\u4E0A\u65B9\u300C\u65B0\u5EFA\u9884\u7B97\u300D\u521B\u5EFA\u7B2C\u4E00\u6761</span></div>')+"</div>"}).catch(function(t){e.innerHTML='<div class="finance-empty"><div class="finance-empty-icon">\u{1F4CB}</div>\u65E0\u6CD5\u52A0\u8F7D\u9884\u7B97\u6570\u636E<br><span style="font-size:10px;color:var(--text-tertiary)">'+D(t.message)+"</span></div>"})}function Vs(e){e?fetch(W+"/budgets/"+e).then(function(t){return t.json()}).then(function(t){t.success?ga(t.budget):S.showToast&&S.showToast("\u52A0\u8F7D\u9884\u7B97\u5931\u8D25","error")}):ga({id:"",title:"",category:"project",totalAmount:0,description:"",items:[],status:"draft"})}function ga(e){Ys=e;let t=e.id?"\u7F16\u8F91\u9884\u7B97\u7533\u8BF7":"\u65B0\u5EFA\u9884\u7B97\u7533\u8BF7",s="";for(let i=0;i<qe.length;i++)s+='<option value="'+qe[i].id+'"'+(qe[i].id===e.category?" selected":"")+">"+qe[i].label+"</option>";let n=e.items&&e.items.length?e.items:[{description:"",amount:"",note:""}],a="";for(let i=0;i<n.length;i++){let r=n[i];a+='<tr><td><input class="fi-desc" value="'+D(r.description)+'" placeholder="\u9879\u76EE\u540D\u79F0" /></td><td><input class="fi-amt" type="number" value="'+(r.amount||"")+'" placeholder="\u91D1\u989D" min="0" style="width:100px" /></td><td><input class="fi-note" value="'+D(r.note||"")+'" placeholder="\u5907\u6CE8" /></td><td>'+(i>0?'<button class="finance-btn small danger fi-remove" style="padding:2px 6px;font-size:10px">\u2715</button>':"")+"</td></tr>"}let o=document.createElement("div");o.className="finance-modal-overlay",o.id="finance-modal",o.innerHTML='<div class="finance-modal" style="max-width:520px;"><div class="finance-modal-header"><h3>'+t+'</h3><button class="finance-modal-close">&times;</button></div><div class="finance-form-group"><label>\u6807\u9898</label><input id="fb-title" value="'+D(e.title)+'" placeholder="\u9884\u7B97\u6807\u9898\uFF08\u4F8B\u5982\uFF1A2025\u5E74Q3 \u670D\u52A1\u5668\u91C7\u8D2D\uFF09" /></div><div class="finance-form-group"><label>\u7C7B\u522B</label><select id="fb-category">'+s+'</select></div><div class="finance-form-group"><label style="display:flex;justify-content:space-between;"><span>\u660E\u7EC6</span><span id="fb-total" style="color:var(--accent);font-weight:600;">\xA50.00</span></label><table class="finance-items-table"><thead><tr><th style="width:40%">\u9879\u76EE</th><th style="width:80px">\u91D1\u989D</th><th>\u5907\u6CE8</th><th style="width:24px"></th></tr></thead><tbody id="fb-items">'+a+'</tbody></table><button class="finance-btn secondary small" id="finance-add-item" style="margin-top:4px">+ \u6DFB\u52A0\u660E\u7EC6</button></div><div class="finance-form-group"><label>\u8BF4\u660E</label><textarea id="fb-desc" rows="3" placeholder="\u8865\u5145\u8BF4\u660E\uFF08\u53EF\u9009\uFF09">'+D(e.description||"")+'</textarea></div><div class="finance-modal-actions"><button class="finance-btn secondary finance-cancel-btn">\u53D6\u6D88</button><button class="finance-btn" id="finance-submit-budget">'+(e.id?"\u4FDD\u5B58\u4FEE\u6539":"\u63D0\u4EA4\u7533\u8BF7")+"</button></div></div>",document.body.appendChild(o),ka(Gs,50)}function Gs(){let e=document.querySelectorAll("#fb-items tr"),t=0;for(let n=0;n<e.length;n++)t+=parseFloat(e[n].querySelector(".fi-amt").value)||0;let s=document.getElementById("fb-total");s&&(s.textContent="\xA5"+se(t))}function Go(){let e=document.getElementById("fb-items");if(!e)return;let t=document.createElement("tr");t.innerHTML='<td><input class="fi-desc" placeholder="\u9879\u76EE\u540D\u79F0" /></td><td><input class="fi-amt" type="number" placeholder="\u91D1\u989D" min="0" style="width:100px" /></td><td><input class="fi-note" placeholder="\u5907\u6CE8" /></td><td><button class="finance-btn small danger fi-remove" style="padding:2px 6px;font-size:10px">\u2715</button></td>',e.appendChild(t)}function Jo(){let e=document.getElementById("fb-title"),t=document.getElementById("fb-category"),s=document.getElementById("fb-desc");if(!e||!e.value.trim()){S.showToast&&S.showToast("\u8BF7\u8F93\u5165\u9884\u7B97\u6807\u9898","warning");return}let n=[],a=document.querySelectorAll("#fb-items tr");for(let d=0;d<a.length;d++){let p=a[d].querySelector(".fi-desc"),u=a[d].querySelector(".fi-amt"),f=a[d].querySelector(".fi-note");if(p&&u){let m=parseFloat(u.value)||0;(p.value.trim()||m>0)&&n.push({description:p.value.trim(),amount:m,note:f?f.value:""})}}let o=0;for(let d=0;d<n.length;d++)o+=n[d].amount;let i=Ys||{},r={title:e.value.trim(),category:t.value,totalAmount:o,description:s?s.value.trim():"",items:n,status:i.id?void 0:"submitted"},c=i.id?W+"/budgets/"+i.id:W+"/budgets",l=i.id?"PUT":"POST";fetch(c,{method:l,headers:{"Content-Type":"application/json"},body:JSON.stringify(r)}).then(function(d){return d.json()}).then(function(d){d.success?(lt(),S.showToast&&S.showToast(i.id?"\u9884\u7B97\u5DF2\u66F4\u65B0 \u2705":"\u9884\u7B97\u5DF2\u63D0\u4EA4 \u2705","success"),Oe()):S.showToast&&S.showToast("\u63D0\u4EA4\u5931\u8D25: "+(d.error||"\u672A\u77E5\u9519\u8BEF"),"error")}).catch(function(d){S.showToast&&S.showToast("\u63D0\u4EA4\u5931\u8D25: "+d.message,"error")})}function Ko(e,t){fetch(W+"/budgets/"+e+"/status",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:t})}).then(function(s){return s.json()}).then(function(s){s.success?(S.showToast&&S.showToast("\u72B6\u6001\u5DF2\u66F4\u65B0 \u2705","success"),Oe()):S.showToast&&S.showToast("\u64CD\u4F5C\u5931\u8D25: "+(s.error||"\u672A\u77E5\u9519\u8BEF"),"error")}).catch(function(s){S.showToast&&S.showToast("\u8BF7\u6C42\u5931\u8D25: "+s.message,"error")})}function va(e){confirm("\u786E\u5B9A\u5220\u9664\u6B64\u9884\u7B97\u7533\u8BF7\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002")&&fetch(W+"/budgets/"+e,{method:"DELETE"}).then(function(t){return t.json()}).then(function(t){t.success?(S.showToast&&S.showToast("\u5DF2\u5220\u9664 \u2705","success"),Oe()):S.showToast&&S.showToast("\u5220\u9664\u5931\u8D25: "+(t.error||"\u672A\u77E5\u9519\u8BEF"),"error")}).catch(function(t){S.showToast&&S.showToast("\u8BF7\u6C42\u5931\u8D25: "+t.message,"error")})}function Yo(e){fetch(W+"/budgets/"+e).then(function(t){return t.json()}).then(function(t){if(!t.success)return;let s=t.budget,n=pe[s.status]||pe.draft,a="",o=s.items||[];for(let i=0;i<o.length;i++)a+="<tr><td>"+D(o[i].description)+'</td><td style="text-align:right">\xA5'+se(o[i].amount)+"</td><td>"+D(o[i].note||"-")+"</td></tr>";a||(a='<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary)">\u65E0\u660E\u7EC6</td></tr>'),fetch(W+"/settlements?budgetId="+e).then(function(i){return i.json()}).then(function(i){let r=i.success?i.settlements||[]:[],c="";for(let d=0;d<r.length;d++){let p=r[d];c+="<tr><td>"+(p.settlementDate||p.createdAt||"").slice(0,10)+'</td><td style="text-align:right">\xA5'+se(p.amount)+"</td><td>"+D(p.payee||"-")+'</td><td><span class="finance-status '+xa(p.status)+'">'+wa(p.status)+"</span></td></tr>"}c||(c='<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary)">\u6682\u65E0\u9500\u8D26\u8BB0\u5F55</td></tr>');let l=document.createElement("div");l.className="finance-modal-overlay",l.id="finance-modal",l.innerHTML='<div class="finance-modal" style="max-width:600px;"><div class="finance-modal-header"><h3>'+D(s.title)+'</h3><button class="finance-modal-close">&times;</button></div><div class="finance-detail-row"><span class="finance-detail-label">\u7C7B\u522B</span><span class="finance-detail-value">'+Js(s.category)+'</span></div><div class="finance-detail-row"><span class="finance-detail-label">\u72B6\u6001</span><span class="finance-detail-value"><span class="finance-status '+n.cls+'">'+n.label+'</span></span></div><div class="finance-detail-row"><span class="finance-detail-label">\u603B\u91D1\u989D</span><span class="finance-detail-value" style="font-size:14px;font-weight:700;">\xA5'+se(s.totalAmount)+'</span></div><div style="margin:12px 0 4px;font-size:12px;font-weight:600;color:var(--text-secondary)">\u{1F4CB} \u9884\u7B97\u660E\u7EC6</div><table class="finance-table"><thead><tr><th>\u9879\u76EE</th><th style="text-align:right">\u91D1\u989D</th><th>\u5907\u6CE8</th></tr></thead><tbody>'+a+"</tbody></table>"+(s.description?'<div style="margin:6px 0;font-size:11px;color:var(--text-tertiary);padding:6px;background:var(--bg-elevated);border-radius:4px;">'+D(s.description)+"</div>":"")+'<div style="margin:12px 0 4px;font-size:12px;font-weight:600;color:var(--text-secondary)">\u2705 \u9500\u8D26\u8BB0\u5F55</div><table class="finance-table"><thead><tr><th>\u65E5\u671F</th><th style="text-align:right">\u91D1\u989D</th><th>\u6536\u6B3E\u65B9</th><th>\u72B6\u6001</th></tr></thead><tbody>'+c+'</tbody></table><div class="finance-modal-actions">'+(s.status==="submitted"?'<button class="finance-btn secondary small finance-budget-status" data-id="'+s.id+'" data-status="approved">\u901A\u8FC7 \u2705</button><button class="finance-btn danger small finance-budget-status" data-id="'+s.id+'" data-status="rejected">\u62D2\u7EDD \u274C</button>':"")+(s.status==="approved"?'<button class="finance-btn danger small finance-budget-status" data-id="'+s.id+'" data-status="closed">\u5173\u95ED \u{1F512}</button>':"")+'<button class="finance-btn secondary small finance-detail-edit" data-id="'+s.id+'">\u7F16\u8F91 \u270F\uFE0F</button>'+(s.status==="draft"||s.status==="submitted"?'<button class="finance-btn danger small finance-detail-delete" data-id="'+s.id+'">\u5220\u9664 \u{1F5D1}</button>':"")+"</div></div>",document.body.appendChild(l)}).catch(function(i){console.error("[Finance] budget detail error:",i)})}).catch(function(t){console.error("[Finance] budget detail error:",t)})}function en(e){e.innerHTML='<div class="finance-loading">\u52A0\u8F7D\u4E2D...</div>',Promise.all([fetch(W+"/settlements").then(function(t){return t.json()}),fetch(W+"/budgets").then(function(t){return t.json()})]).then(function(t){let s=t[0],n=t[1];if(!s.success)throw new Error("Error");let a=s.settlements||[],o={},i=n.budgets||[];for(let p=0;p<i.length;p++)o[i[p].id]=i[p];let r='<option value="">\u5168\u90E8\u72B6\u6001</option>',c=Object.keys(dt);for(let p=0;p<c.length;p++)r+='<option value="'+c[p]+'"'+(c[p]===es?" selected":"")+">"+dt[c[p]].label+"</option>";let l=es?a.filter(function(p){return p.status===es}):a,d=l.map(function(p){let u=o[p.budgetId];return'<div class="finance-settle-card" style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><div><span style="font-size:13px;font-weight:600;">\xA5'+se(p.amount)+'</span><span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;">'+(p.settlementDate||p.createdAt||"").slice(0,10)+'</span></div><span class="finance-status '+xa(p.status)+'">'+wa(p.status)+'</span></div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">\u{1F4CE} '+(u?D(u.title):"(\u5DF2\u5220\u9664\u7684\u9884\u7B97)")+(p.payee?" \xB7 \u6536\u6B3E: "+D(p.payee):"")+(p.receipt?" \xB7 \u6536\u636E: "+D(p.receipt):"")+'</div><div style="margin-top:6px;display:flex;gap:6px;"><button class="finance-btn small secondary finance-settle-edit" data-id="'+p.id+'">\u7F16\u8F91</button><button class="finance-btn small danger finance-settle-delete" data-id="'+p.id+'">\u5220\u9664</button></div></div>'}).join("");e.innerHTML='<div class="finance-filter-bar"><select id="finance-settle-filter">'+r+'</select><span style="font-size:10px;color:var(--text-tertiary)">'+l.length+" / "+a.length+'</span><div class="spacer"></div><button class="finance-btn" id="finance-create-settlement">\u2795 \u65B0\u589E\u9500\u8D26</button></div><div id="finance-settle-list">'+(d||'<div class="finance-empty"><div class="finance-empty-icon">\u2705</div>\u6682\u65E0\u9500\u8D26\u8BB0\u5F55</div>')+"</div>"}).catch(function(t){e.innerHTML='<div class="finance-empty"><div class="finance-empty-icon">\u2705</div>\u65E0\u6CD5\u52A0\u8F7D\u9500\u8D26\u6570\u636E<br><span style="font-size:10px;color:var(--text-tertiary)">'+D(t.message)+"</span></div>"})}function ba(e){fetch(W+"/budgets").then(function(t){return t.json()}).then(function(t){let s=(t.budgets||[]).filter(function(n){return n.status==="approved"||n.status==="draft"});e?fetch(W+"/settlements").then(function(n){return n.json()}).then(function(n){let a=null,o=n.settlements||[];for(let i=0;i<o.length;i++)if(o[i].id===e){a=o[i];break}a?ya(a,s):S.showToast&&S.showToast("\u9500\u8D26\u8BB0\u5F55\u4E0D\u5B58\u5728","error")}).catch(function(n){console.error("[Finance] settlement fetch error:",n)}):ya({id:"",budgetId:"",amount:0,settlementDate:new Date().toISOString().slice(0,10),payee:"",receipt:"",note:"",status:"pending"},s)}).catch(function(t){console.error("[Finance] budget fetch error:",t)})}function ya(e,t){Xs=e;let s='<option value="">-- \u9009\u62E9\u5173\u8054\u9884\u7B97 --</option>';for(let i=0;i<t.length;i++)s+='<option value="'+t[i].id+'"'+(t[i].id===e.budgetId?" selected":"")+">"+D(t[i].title)+" (\xA5"+se(t[i].totalAmount)+")</option>";let n="",a=Object.keys(dt);for(let i=0;i<a.length;i++)n+='<option value="'+a[i]+'"'+(a[i]===e.status?" selected":"")+">"+dt[a[i]].label+"</option>";let o=document.createElement("div");o.className="finance-modal-overlay",o.id="finance-modal",o.innerHTML='<div class="finance-modal"><div class="finance-modal-header"><h3>'+(e.id?"\u7F16\u8F91\u9500\u8D26":"\u65B0\u589E\u9500\u8D26")+'</h3><button class="finance-modal-close">&times;</button></div><div class="finance-form-group"><label>\u5173\u8054\u9884\u7B97</label><select id="fs-budget">'+s+'</select></div><div class="finance-form-row"><div class="finance-form-group"><label>\u91D1\u989D (\xA5)</label><input id="fs-amount" type="number" value="'+(e.amount||"")+'" min="0" step="0.01" placeholder="0.00" /></div><div class="finance-form-group"><label>\u9500\u8D26\u65E5\u671F</label><input id="fs-date" type="date" value="'+(e.settlementDate||new Date().toISOString().slice(0,10))+'" /></div></div><div class="finance-form-row"><div class="finance-form-group"><label>\u6536\u6B3E\u65B9</label><input id="fs-payee" value="'+D(e.payee||"")+'" placeholder="\u4F8B\u5982\uFF1A\u963F\u91CC\u4E91" /></div><div class="finance-form-group"><label>\u6536\u636E\u7F16\u53F7</label><input id="fs-receipt" value="'+D(e.receipt||"")+'" placeholder="INV-xxxx" /></div></div><div class="finance-form-group"><label>\u72B6\u6001</label><select id="fs-status">'+n+'</select></div><div class="finance-form-group"><label>\u5907\u6CE8</label><textarea id="fs-note" rows="2" placeholder="\u53EF\u9009\u5907\u6CE8\u4FE1\u606F">'+D(e.note||"")+'</textarea></div><div class="finance-modal-actions"><button class="finance-btn secondary finance-cancel-btn">\u53D6\u6D88</button><button class="finance-btn" id="finance-submit-settlement">'+(e.id?"\u4FDD\u5B58":"\u6DFB\u52A0")+"</button></div></div>",document.body.appendChild(o)}function Xo(){let e=document.getElementById("fs-budget"),t=document.getElementById("fs-amount"),s=document.getElementById("fs-date"),n=document.getElementById("fs-payee"),a=document.getElementById("fs-receipt"),o=document.getElementById("fs-status"),i=document.getElementById("fs-note");if(!e||!e.value){S.showToast&&S.showToast("\u8BF7\u9009\u62E9\u5173\u8054\u9884\u7B97","warning");return}if(!t||!t.value||parseFloat(t.value)<=0){S.showToast&&S.showToast("\u8BF7\u8F93\u5165\u6709\u6548\u91D1\u989D","warning");return}let r=Xs||{},c={budgetId:e.value,amount:parseFloat(t.value),settlementDate:s?s.value:new Date().toISOString().slice(0,10),payee:n?n.value:"",receipt:a?a.value:"",status:o?o.value:"pending",note:i?i.value:""},l=r.id?W+"/settlements/"+r.id:W+"/settlements",d=r.id?"PUT":"POST";fetch(l,{method:d,headers:{"Content-Type":"application/json"},body:JSON.stringify(c)}).then(function(p){return p.json()}).then(function(p){p.success?(lt(),S.showToast&&S.showToast("\u9500\u8D26\u8BB0\u5F55\u5DF2\u4FDD\u5B58 \u2705","success"),Oe()):S.showToast&&S.showToast("\u4FDD\u5B58\u5931\u8D25","error")}).catch(function(p){S.showToast&&S.showToast("\u4FDD\u5B58\u5931\u8D25: "+p.message,"error")})}function Zo(e){confirm("\u786E\u5B9A\u5220\u9664\u6B64\u9500\u8D26\u8BB0\u5F55\uFF1F")&&fetch(W+"/settlements/"+e,{method:"DELETE"}).then(function(t){return t.json()}).then(function(t){t.success?(S.showToast&&S.showToast("\u5DF2\u5220\u9664 \u2705","success"),Oe()):S.showToast&&S.showToast("\u5220\u9664\u5931\u8D25: "+(t.error||"\u672A\u77E5\u9519\u8BEF"),"error")}).catch(function(t){S.showToast&&S.showToast("\u8BF7\u6C42\u5931\u8D25: "+t.message,"error")})}function tn(e){e.innerHTML='<div class="finance-loading">AI \u5206\u6790\u4E2D...</div>',fetch(W+"/ai-suggest",{method:"POST"}).then(function(t){return t.json()}).then(function(t){if(!t.success)throw new Error("AI failed");let s=t.suggestions||[],n="";for(let a=0;a<s.length;a++){let o=s[a],i=o.type==="warning"?"\u26A0\uFE0F":o.type==="optimization"?"\u{1F4A1}":o.type==="forecast"?"\u{1F4CA}":"\u{1F916}",r=o.severity==="high"?"rejected":o.severity==="medium"?"submitted":"draft";n+='<div class="finance-suggestion-card '+(o.severity||"low")+'" style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><div style="font-size:12px;font-weight:600;">'+i+" "+D(o.title)+'</div><span class="finance-status finance-status-'+r+'" style="font-size:9px;">'+(o.severity||"info")+'</span></div><div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">'+D(o.content)+"</div></div>"}n||(n='<div class="finance-empty"><div class="finance-empty-icon">\u{1F4A1}</div>\u6682\u65E0\u5EFA\u8BAE</div>'),e.innerHTML='<div class="finance-filter-bar"><span style="font-size:11px;color:var(--text-tertiary);">\u57FA\u4E8E\u9884\u7B97\u548C\u9500\u8D26\u6570\u636E\u7684\u89C4\u5219\u5206\u6790</span><div class="spacer"></div><button class="finance-btn secondary small" id="finance-ai-refresh">\u{1F504} \u5237\u65B0</button></div>'+n+'<div style="margin-top:10px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;font-size:10px;color:var(--text-tertiary);line-height:1.6;">\u{1F916} AI \u5EFA\u8BAE\u57FA\u4E8E\u672C\u5730\u89C4\u5219\u5F15\u64CE\u8FD0\u884C\uFF1A<br>\u2022 \u9884\u7B97\u4F7F\u7528\u7387 \u226580% \u2192 \u26A0\uFE0F \u8D85\u652F\u9884\u8B66<br>\u2022 \u521B\u5EFA\u8D8530\u5929\u4E14\u4F7F\u7528\u7387 <20% \u2192 \u{1F4A1} \u8D44\u91D1\u8C03\u914D\u5EFA\u8BAE<br>\u2022 \u6709\u5F85\u6838\u9500\u8BB0\u5F55 \u2192 \u{1F52E} \u63D0\u9192\u6838\u9500<br>\u2022 \u5F85\u5BA1\u6279\u9884\u7B97 \u2192 \u{1F4CA} \u5BA1\u6279\u63D0\u9192<br>\u6240\u6709\u6570\u636E\u5728\u672C\u5730\u5904\u7406\uFF0C\u65E0\u9700\u8054\u7F51\u3002</div>'}).catch(function(){e.innerHTML='<div class="finance-empty"><div class="finance-empty-icon">\u{1F4A1}</div>AI \u5206\u6790\u6682\u65F6\u4E0D\u53EF\u7528</div>'})}function lt(){let e=document.getElementById("finance-modal");e&&e.parentNode&&e.parentNode.removeChild(e),Ys=null,Xs=null}S.Finance={init:Qo,cleanup:function(){Ta()},render:Oe,renderOverview:La,renderBudgets:Zs,renderSettlements:en,renderAISuggestions:tn,_initialized:!1};console.log("[Finance] Module loaded (waiting for standalone page to call init())");function Sa(){return window.QCLI||{}}var $e=[],pt="",ye=null,je=null;async function er(){try{return $e=(await(await fetch("/api/browser/scripts")).json()).scripts||[],$e}catch{return $e=[],[]}}async function tr(e){try{let s=await(await fetch(`/api/browser/scripts/${encodeURIComponent(e)}/toggle`,{method:"POST"})).json();if(!s.success)return!1;let n=$e.find(a=>a.id===e);return n&&(n.enabled=s.enabled),!0}catch{return!1}}async function sr(e){try{return(await fetch(`/api/browser/scripts/${encodeURIComponent(e)}`,{method:"DELETE"})).ok}catch{return!1}}async function nr(e){try{let t=e.id?"PUT":"POST",s=e.id?`/api/browser/scripts/${encodeURIComponent(e.id)}`:"/api/browser/scripts",a=await(await fetch(s,{method:t,headers:{"Content-Type":"application/json"},body:JSON.stringify(e)})).json();if(!a.success)throw new Error(a.error||"Save failed");return a.script}catch(t){throw t}}function nn(){if(!je||!je.list)return;let e=pt?$e.filter(t=>t.name.toLowerCase().includes(pt)||t.urlPattern.toLowerCase().includes(pt)||(t.tags||[]).some(s=>s.toLowerCase().includes(pt))):$e;if(je.list.innerHTML="",e.length===0){je.list.innerHTML=`<div class="bs-empty">${pt?"\u6CA1\u6709\u5339\u914D\u7684\u811A\u672C":`\u8FD8\u6CA1\u6709\u521B\u5EFA\u4EFB\u4F55\u811A\u672C
\u70B9\u51FB"+ \u65B0\u5EFA\u811A\u672C"\u5F00\u59CB`}</div>`;return}for(let t of e){let s=document.createElement("div");s.className="bs-item"+(t.enabled?"":" disabled");let n=document.createElement("label");n.className="bs-toggle";let a=document.createElement("input");a.type="checkbox",a.checked=t.enabled,a.addEventListener("change",async()=>{await tr(t.id),s.classList.toggle("disabled",!t.enabled)}),n.appendChild(a);let o=document.createElement("span");o.className="bs-toggle-slider",n.appendChild(o),s.appendChild(n);let i=document.createElement("div");i.className="bs-item-info";let r=document.createElement("div");r.className="bs-item-header";let c=document.createElement("span");if(c.className="bs-item-name",c.textContent=t.name,r.appendChild(c),t.tags&&t.tags.length>0)for(let f of t.tags){let m=document.createElement("span");m.className="bs-item-tag",m.textContent=f,r.appendChild(m)}i.appendChild(r);let l=document.createElement("div");l.className="bs-item-meta",l.textContent=`${t.urlPattern} \xB7 \u4FEE\u6539\u4E8E ${ar(t.updatedAt)}`,i.appendChild(l),s.appendChild(i);let d=document.createElement("div");d.className="bs-item-actions";let p=document.createElement("button");p.className="bs-action-btn",p.textContent="\u270F\uFE0F",p.title="\u7F16\u8F91",p.addEventListener("click",f=>{f.stopPropagation(),an(t)}),d.appendChild(p);let u=document.createElement("button");u.className="bs-action-btn danger",u.textContent="\u{1F5D1}\uFE0F",u.title="\u5220\u9664",u.addEventListener("click",async f=>{if(f.stopPropagation(),!confirm(`\u786E\u5B9A\u5220\u9664\u811A\u672C"${t.name}"\uFF1F`))return;if(await sr(t.id)){$e=$e.filter(b=>b.id!==t.id),nn();let g=Sa().showToast;g&&g(`\u5DF2\u5220\u9664\u811A\u672C"${t.name}"`,"info")}}),d.appendChild(u),s.appendChild(d),s.addEventListener("click",()=>{let f=s.querySelector(".bs-item-preview");if(f)f.classList.toggle("expanded");else{let m=document.createElement("div");m.className="bs-item-preview",m.textContent=t.code.length>300?t.code.slice(0,300)+`
// ...`:t.code,s.appendChild(m),requestAnimationFrame(()=>m.classList.add("expanded"))}}),je.list.appendChild(s)}}function ar(e){let t=Date.now()-e,s=Math.floor(t/6e4);if(s<1)return"\u521A\u521A";if(s<60)return`${s} \u5206\u949F\u524D`;let n=Math.floor(s/60);return n<24?`${n} \u5C0F\u65F6\u524D`:`${Math.floor(n/24)} \u5929\u524D`}function an(e){ye=e?{...e}:null,ir()}function ir(){let e=document.getElementById("bs-editor-overlay");e&&e.remove();let t=document.createElement("div");t.id="bs-editor-overlay",t.className="bs-editor-overlay",t.innerHTML=`
    <div class="bs-editor-panel">
      <div class="bs-editor-header">
        <span class="bs-editor-title">${ye?.id?"\u270F\uFE0F \u7F16\u8F91\u811A\u672C":"\u{1F4DC} \u65B0\u5EFA\u811A\u672C"}</span>
        <button class="bs-editor-close" id="bs-editor-close">\u2715</button>
      </div>
      <div class="bs-editor-body">
        <div class="bs-field">
          <label class="bs-field-label">\u540D\u79F0</label>
          <input type="text" class="bs-field-input" id="bs-editor-name" 
                 value="${h(ye?.name||"")}" 
                 placeholder="\u811A\u672C\u540D\u79F0" maxlength="100">
        </div>
        <div class="bs-field">
          <label class="bs-field-label">URL \u5339\u914D\u6A21\u5F0F</label>
          <input type="text" class="bs-field-input bs-field-mono" id="bs-editor-urlpattern" 
                 value="${h(ye?.urlPattern||"*://*/*")}" 
                 placeholder="*://*.example.com/*">
          <div class="bs-field-hint">\u652F\u6301 glob \u901A\u914D\u7B26\uFF1A* \u5339\u914D\u4E00\u4E2A\u8DEF\u5F84\u6BB5\uFF0C** \u5339\u914D\u4EFB\u610F\u8DEF\u5F84</div>
        </div>
        <div class="bs-field">
          <label class="bs-field-label">\u63CF\u8FF0</label>
          <input type="text" class="bs-field-input" id="bs-editor-desc" 
                 value="${h(ye?.description||"")}" 
                 placeholder="\u7B80\u77ED\u63CF\u8FF0\u8FD9\u4E2A\u811A\u672C\u7684\u4F5C\u7528" maxlength="500">
        </div>
        <div class="bs-field">
          <label class="bs-field-label">\u6807\u7B7E\uFF08\u9017\u53F7\u5206\u9694\uFF09</label>
          <input type="text" class="bs-field-input" id="bs-editor-tags" 
                 value="${h((ye?.tags||[]).join(", "))}" 
                 placeholder="utility, login, automation">
        </div>
        <div class="bs-field">
          <label class="bs-field-label">JavaScript \u4EE3\u7801</label>
          <textarea class="bs-field-textarea" id="bs-editor-code" 
                    placeholder="// \u5728\u8FD9\u91CC\u7F16\u5199\u4F60\u7684\u7528\u6237\u811A\u672C" 
                    spellcheck="false">${h(ye?.code||"")}</textarea>
          <div class="bs-field-hint">\u811A\u672C\u5728\u9875\u9762\u52A0\u8F7D\u65F6\u81EA\u52A8\u6267\u884C\u3002\u5982\u679C\u8981\u9650\u5236\u5728\u7279\u5B9A URL \u4E0A\u8FD0\u884C\uFF0C\u811A\u672C\u5185\u90E8\u5224\u65AD location.href\u3002</div>
        </div>
      </div>
      <div class="bs-editor-footer">
        <span class="bs-editor-error" id="bs-editor-error"></span>
        <button class="bs-editor-cancel" id="bs-editor-cancel">\u53D6\u6D88</button>
        <button class="bs-editor-save" id="bs-editor-save">\u{1F4BE} \u4FDD\u5B58</button>
      </div>
    </div>
  `,document.body.appendChild(t),document.getElementById("bs-editor-close").addEventListener("click",Lt),document.getElementById("bs-editor-cancel").addEventListener("click",Lt),document.getElementById("bs-editor-save").addEventListener("click",Ea),t.addEventListener("click",n=>{n.target===t&&Lt()});let s=n=>{n.key==="Escape"&&Lt(),(n.metaKey||n.ctrlKey)&&n.key==="Enter"&&Ea()};document.addEventListener("keydown",s),t._keyHandler=s,setTimeout(()=>document.getElementById("bs-editor-name").focus(),100)}function Lt(){let e=document.getElementById("bs-editor-overlay");e&&(e._keyHandler&&document.removeEventListener("keydown",e._keyHandler),e.remove()),ye=null}async function Ea(){let e=document.getElementById("bs-editor-name").value.trim(),t=document.getElementById("bs-editor-urlpattern").value.trim(),s=document.getElementById("bs-editor-desc").value.trim(),n=document.getElementById("bs-editor-tags").value.trim(),a=document.getElementById("bs-editor-code").value,o=document.getElementById("bs-editor-error");if(!e){o.textContent="\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A";return}if(!a){o.textContent="\u4EE3\u7801\u4E0D\u80FD\u4E3A\u7A7A";return}if(!t){o.textContent="URL \u5339\u914D\u6A21\u5F0F\u4E0D\u80FD\u4E3A\u7A7A";return}o.textContent="";let i=document.getElementById("bs-editor-save");i.disabled=!0,i.textContent="\u4FDD\u5B58\u4E2D...";try{let r=n?n.split(",").map(d=>d.trim()).filter(Boolean):[],c={name:e,urlPattern:t,description:s,tags:r,code:a,...ye?.id?{id:ye.id}:{}};await nr(c),Lt(),await sn();let l=Sa().showToast;l&&l(`\u811A\u672C"${e}"\u5DF2\u4FDD\u5B58`,"success")}catch(r){o.textContent=`\u4FDD\u5B58\u5931\u8D25: ${r.message}`}finally{i.disabled=!1,i.textContent="\u{1F4BE} \u4FDD\u5B58"}}async function sn(){await er(),nn()}function or(e){e.innerHTML=`
    <div class="bs-panel">
      <div class="bs-search-bar">
        <input type="text" class="bs-search-input" id="bs-search-input"
               placeholder="\u{1F50D} \u641C\u7D22\u811A\u672C..." aria-label="\u641C\u7D22\u811A\u672C" >
      </div>
      <div class="bs-list" id="bs-list">
        <div class="bs-empty">\u52A0\u8F7D\u4E2D...</div>
      </div>
      <div class="bs-toolbar">
        <button class="bs-toolbar-btn primary" id="bs-add-btn">+ \u65B0\u5EFA\u811A\u672C</button>
        <button class="bs-toolbar-btn" id="bs-refresh-btn">\u{1F504} \u5237\u65B0</button>
      </div>
    </div>
  `,je={panel:e,list:e.querySelector("#bs-list"),searchInput:e.querySelector("#bs-search-input")},je.searchInput.addEventListener("input",t=>{pt=t.target.value.toLowerCase().trim(),nn()}),e.querySelector("#bs-add-btn").addEventListener("click",()=>an(null)),e.querySelector("#bs-refresh-btn").addEventListener("click",sn),sn()}(function e(){let t=window.QCLI||{},s=t.UIRegistry;if(!s){console.warn("[BrowserScripts] UIRegistry not available, will retry"),setTimeout(e,500);return}s.registerTab("browser-scripts",{category:"other",icon:"\u{1F4DC}",label:"\u6D4F\u89C8\u5668\u811A\u672C",order:20,render:a=>or(a)})&&console.log('[BrowserScripts] Panel registered as "browser-scripts" tab'),s.registerMenuItem("browser-scripts:new-from-selection",{label:"\u{1F4DC} \u4E3A\u6B64\u9875\u9762\u521B\u5EFA\u811A\u672C",requiresSelection:!1,order:80,action:(a,o)=>{let i=t.Tabs,r="";try{fetch("/api/browser/ping").then(l=>l.json()).then(l=>{l.connected&&l.url&&(r=l.url)}).catch(()=>{})}catch(l){console.warn("[BrowserScripts] Failed to fetch browser ping:",l?.message)}let c=a?`// Created from terminal selection
// URL: ${r||"unknown"}

${a}`:`// \u5728\u6B64\u7F16\u5199\u811A\u672C
console.log("Browser script running on:", location.href);
`;an({name:"",urlPattern:r?r.replace(/^(https?:\/\/[^/]+).*$/,"$1/*"):"*://*/*",description:"\u4ECE\u7EC8\u7AEF\u521B\u5EFA\u7684\u811A\u672C",code:c,tags:["terminal"]})}}),s.registerCommand("browser-scripts:open",{icon:"\u{1F4DC}",name:"\u6253\u5F00\u6D4F\u89C8\u5668\u811A\u672C\u7BA1\u7406",desc:"\u7BA1\u7406\u7528\u6237\u811A\u672C\uFF08\u65B0\u5EFA\u3001\u7F16\u8F91\u3001\u542F\u7528/\u7981\u7528\uFF09",category:"browser",execute:()=>{let a=t.RightPanel;a&&(a.collapsed&&a.open(),a.switchTab("browser-scripts"))}}),t.injectCSS("/css/browser-scripts.css")})();function St(){return window.QCLI||{}}var ne=[],X=!1,Et="",on="all",R=null;async function ts(e,t){try{return await(await fetch("/api/browser/network",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:e,filter:t})})).json()}catch(s){return{success:!1,error:s.message}}}async function rr(){let e=await ts("start");if(e.success)X=!0,ns(),R&&R.panel&&(R.panel._pollTimer=setInterval(Ma,2e3));else{let t=St().showToast;t&&t("\u274C \u542F\u52A8\u7F51\u7EDC\u76D1\u63A7\u5931\u8D25\uFF1A"+(e.error||"\u672A\u77E5\u9519\u8BEF")+"\uFF08\u8BF7\u5148\u8FDE\u63A5\u6D4F\u89C8\u5668 CDP\uFF09","error")}return e}async function rn(){X=!1,R&&R.panel&&R.panel._pollTimer&&(clearInterval(R.panel._pollTimer),R.panel._pollTimer=null),await ts("stop"),ns()}async function Ma(){if(!X)return;let e=await ts("get");e.success&&e.entries&&(ne=e.entries,De(),ss(e.stats),typeof e.isActive=="boolean"&&e.isActive!==X&&(X=e.isActive,ns(),!X&&R&&R.panel&&R.panel._pollTimer&&(clearInterval(R.panel._pollTimer),R.panel._pollTimer=null)))}async function Ia(){let e=await ts("get");e.success&&(ne=e.entries||[],De(),ss(e.stats),X=e.isActive||!1,X&&R&&R.panel&&!R.panel._pollTimer&&(R.panel._pollTimer=setInterval(Ma,2e3)),ns())}async function cr(){ne=[],De(),ss(null)}function De(){if(!R||!R.list)return;let e=ne.filter(t=>!(Et&&!t.url.toLowerCase().includes(Et.toLowerCase())||on!=="all"&&t.type!==on));if(R.list.innerHTML="",e.length===0){R.list.innerHTML=`<div class="nm-empty">
      <div class="nm-empty-icon">${Et?"\u{1F50D}":"\u{1F310}"}</div>
      ${Et?"\u6CA1\u6709\u5339\u914D\u7684\u7F51\u7EDC\u8BF7\u6C42":X?"\u7B49\u5F85\u7F51\u7EDC\u8BF7\u6C42...":"\u70B9\u51FB \u25B6 \u5F00\u59CB\u6355\u83B7"}
    </div>`;return}for(let t of e){let s=document.createElement("div");s.className="nm-entry"+(t.error?" error":"");let n=document.createElement("span");n.className="nm-entry-method",n.textContent=t.method||"GET",s.appendChild(n);let a=document.createElement("span");if(a.className="nm-entry-url",a.textContent=lr(t.url,80),a.title=t.url,s.appendChild(a),t.status){let c=document.createElement("span");c.className="nm-entry-status s"+Math.floor(t.status/100)*100,c.textContent=t.status,s.appendChild(c)}let o=document.createElement("span");o.className="nm-entry-duration",o.textContent=t.duration!=null?t.duration+"ms":"",s.appendChild(o);let i=document.createElement("span");i.className="nm-entry-type",i.textContent=t.type||"",s.appendChild(i);let r=document.createElement("div");r.className="nm-entry-detail",r.textContent=dr(t),s.appendChild(r),s.addEventListener("click",()=>{r.classList.toggle("expanded")}),R.list.appendChild(s)}}function ss(e){if(!(!R||!R.statsBar)){if(!e){R.statsBar.innerHTML='<span class="nm-stat">\u6682\u65E0\u6570\u636E</span>';return}R.statsBar.innerHTML=`
    <span class="nm-stat">\u603B\u6570: <span class="nm-stat-value">${e.total||0}</span></span>
    <span class="nm-stat">\u9519\u8BEF: <span class="nm-stat-value" style="color:${e.errors>0?"var(--danger)":"inherit"}">${e.errors||0}</span></span>
    <span class="nm-stat">\u5E73\u5747\u8017\u65F6: <span class="nm-stat-value">${e.avgDuration||0}ms</span></span>
  `}}function ns(){!R||!R.recordBtn||(R.recordBtn.innerHTML=X?'<span class="nm-recording-dot"></span> \u505C\u6B62':"\u25B6 \u6355\u83B7",R.recordBtn.className="nm-btn"+(X?" recording":""))}function lr(e,t){if(!e)return"";if(e.length<=t)return e;try{let s=new URL(e),n=s.pathname+s.search,a=s.hostname,o=a.length+8,i=t-o-3;if(i>10)return s.protocol+"//"+a+n.slice(0,i)+"..."}catch(s){console.warn("[NetworkMonitor] truncateUrl parse error:",s?.message)}return e.slice(0,t)+"..."}function dr(e){let t=[];return t.push(`URL: ${e.url}`),t.push(`Method: ${e.method}`),t.push(`Status: ${e.status} ${e.statusText||""}`),t.push(`Type: ${e.type}`),t.push(`Duration: ${e.duration||0}ms`),t.push(`Time: ${e.timestamp||""}`),e.requestHeaders&&Object.keys(e.requestHeaders).length>0&&t.push(`
Request Headers:
${JSON.stringify(e.requestHeaders,null,2).slice(0,500)}`),e.responseHeaders&&Object.keys(e.responseHeaders).length>0&&t.push(`
Response Headers:
${JSON.stringify(e.responseHeaders,null,2).slice(0,500)}`),e.body&&t.push(`
Body Preview:
${e.body.slice(0,500)}`),t.join(`
`)}function pr(){if(ne.length===0){let i=St().showToast;i&&i("\u6CA1\u6709\u6570\u636E\u53EF\u5BFC\u51FA","info");return}let e={log:{version:"1.2",creator:{name:"Hesi Network Monitor",version:"1.0"},entries:ne.map(i=>ur(i))}},t=JSON.stringify(e,null,2),s=new Blob([t],{type:"application/har+json"}),n=URL.createObjectURL(s),a=document.createElement("a");a.href=n,a.download=`network-traffic-${Date.now()}.har`,document.body.appendChild(a),a.click(),document.body.removeChild(a),URL.revokeObjectURL(n);let o=St().showToast;o&&o(`\u{1F4E4} \u5DF2\u5BFC\u51FA ${ne.length} \u6761\u8BF7\u6C42\u4E3A HAR \u6587\u4EF6`,"success")}function ur(e){let t=[];try{new URL(e.url).searchParams.forEach((l,d)=>{t.push({name:d,value:l})})}catch(c){console.warn("[NetworkMonitor] URL parse error in HAR entry:",c?.message)}let s=_a(e.requestHeaders||{}),n=_a(e.responseHeaders||{}),a=e.body?e.body.length:-1,o="application/octet-stream";for(let c of n)if(c.name.toLowerCase()==="content-type"){o=c.value;break}let i=e.timestamp||new Date().toISOString(),r=e.duration||0;return{startedDateTime:i,time:r,request:{method:e.method||"GET",url:e.url,httpVersion:"HTTP/1.1",headers:s,queryString:t,cookies:[],headersSize:-1,bodySize:e.body?e.body.length:-1,postData:(e.method==="POST"||e.method==="PUT"||e.method==="PATCH")&&e.body?{mimeType:o,text:e.body.slice(0,1e4),size:a}:void 0},response:{status:e.status||0,statusText:e.statusText||"",httpVersion:"HTTP/1.1",headers:n,cookies:[],content:{size:a,mimeType:o,text:e.body?e.body.slice(0,1e4):void 0},redirectURL:"",headersSize:-1,bodySize:a},cache:{},timings:{blocked:-1,dns:-1,connect:-1,send:0,wait:r,receive:0,ssl:-1},_resourceType:e.type||"xhr",_error:e.error||!1}}function _a(e){return!e||typeof e!="object"?[]:Object.entries(e).filter(([t,s])=>s!=null).map(([t,s])=>({name:t,value:String(s)}))}function fr(){let e=document.createElement("input");e.type="file",e.accept=".har,application/json,application/har+json",e.addEventListener("change",async t=>{let s=t.target.files?.[0];if(s)try{let n=await s.text(),a=JSON.parse(n);if(!a.log||!a.log.entries)throw new Error("\u65E0\u6548\u7684 HAR \u6587\u4EF6\uFF1A\u7F3A\u5C11 log.entries");X&&await rn();let o=a.log.entries.map(mr),i=St().showToast;ne=o,De(),ss({total:ne.length,errors:ne.filter(r=>r.error).length,byMethod:{},byType:{},avgDuration:ne.reduce((r,c)=>r+(c.duration||0),0)/Math.max(1,ne.length)}),i&&i(`\u{1F4E5} \u5DF2\u5BFC\u5165 ${o.length} \u6761 HAR \u8BF7\u6C42\u8BB0\u5F55`,"success")}catch(n){let a=St().showToast;a&&a(`\u274C HAR \u5BFC\u5165\u5931\u8D25: ${n.message}`,"error")}}),e.click()}function mr(e){let t=e.request||{},s=e.response||{},n=s.content||{},a={};if(Array.isArray(t.headers))for(let i of t.headers)a[i.name]=i.value;let o={};if(Array.isArray(s.headers))for(let i of s.headers)o[i.name]=i.value;return{id:"har-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),url:t.url||"",method:t.method||"GET",type:e._resourceType||"xhr",status:s.status||0,statusText:s.statusText||"",requestHeaders:a,responseHeaders:o,body:n.text||"",duration:e.time||e.timings?.wait||0,timestamp:e.startedDateTime||new Date().toISOString(),error:e._error||s.status>=400}}function hr(e){e.innerHTML=`
    <div class="nm-panel">
      <div class="nm-toolbar">
        <button class="nm-btn" id="nm-record-btn">${X?"\u23F9 \u505C\u6B62":"\u25B6 \u6355\u83B7"}</button>
        <button class="nm-btn clear-btn" id="nm-clear-btn">\u{1F5D1} \u6E05\u9664</button>
        <button class="nm-btn" id="nm-refresh-btn">\u{1F504} \u5237\u65B0</button>
        <button class="nm-btn" id="nm-export-btn" title="\u5BFC\u51FA\u4E3A HAR \u683C\u5F0F">\u{1F4E4} HAR</button>
        <button class="nm-btn" id="nm-import-btn" title="\u5BFC\u5165 HAR \u6587\u4EF6">\u{1F4E5} HAR</button>
        <div class="nm-type-filter">
          <button class="nm-type-btn active" data-type="all">\u5168\u90E8</button>
          <button class="nm-type-btn" data-type="fetch">Fetch</button>
          <button class="nm-type-btn" data-type="xhr">XHR</button>
        </div>
        <input type="text" class="nm-filter-input" id="nm-filter-input" placeholder="\u{1F50D} \u8FC7\u6EE4 URL..." aria-label="\u8FC7\u6EE4\u7F51\u7EDC\u8BF7\u6C42" />
      </div>
      <div class="nm-stats-bar" id="nm-stats-bar">
        <span class="nm-stat">\u6682\u65E0\u6570\u636E</span>
      </div>
      <div class="nm-list" id="nm-list"></div>
    </div>
  `,R={panel:e,list:e.querySelector("#nm-list"),statsBar:e.querySelector("#nm-stats-bar"),recordBtn:e.querySelector("#nm-record-btn"),filterInput:e.querySelector("#nm-filter-input")},R.recordBtn.addEventListener("click",async()=>{X?await rn():(ne=[],De(),await rr())}),e.querySelector("#nm-clear-btn").addEventListener("click",async()=>{X&&await rn(),await cr()}),e.querySelector("#nm-refresh-btn").addEventListener("click",Ia),e.querySelector("#nm-export-btn").addEventListener("click",pr),e.querySelector("#nm-import-btn").addEventListener("click",fr),e.querySelectorAll(".nm-type-btn").forEach(t=>{t.addEventListener("click",()=>{e.querySelectorAll(".nm-type-btn").forEach(s=>s.classList.remove("active")),t.classList.add("active"),on=t.dataset.type,De()})}),R.filterInput.addEventListener("input",t=>{Et=t.target.value,De()}),Ia()}(function e(){let t=window.QCLI||{},s=t.UIRegistry;if(!s){console.warn("[NetworkMonitor] UIRegistry not available, will retry"),setTimeout(e,500);return}s.registerTab("network-monitor",{category:"other",icon:"\u{1F310}",label:"\u7F51\u7EDC\u76D1\u63A7",order:40,render:a=>hr(a)})&&console.log('[NetworkMonitor] Panel registered as "network-monitor" tab'),s.registerCommand("network-monitor:open",{icon:"\u{1F310}",name:"\u6253\u5F00\u7F51\u7EDC\u76D1\u63A7",desc:"\u76D1\u63A7\u6D4F\u89C8\u5668\u7F51\u7EDC\u8BF7\u6C42",category:"browser",execute:()=>{let a=t.RightPanel;a&&(a.collapsed&&a.open(),a.switchTab("network-monitor"))}}),t.injectCSS("/css/network-monitor.css")})();function is(){return window.QCLI||{}}var as=[],Aa=0,ut=null;async function gr(){try{let t=await(await fetch("/api/browser/farm/contexts")).json();return t.success&&(as=t.contexts||[],Aa=t.activeContext||0),t}catch{return{contexts:[]}}}async function vr(e){try{return await(await fetch("/api/browser/farm/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:e})})).json()}catch(t){return{success:!1,error:t.message}}}async function br(e){try{return await(await fetch("/api/browser/farm/switch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({index:e})})).json()}catch(t){return{success:!1,error:t.message}}}async function yr(e){try{return await(await fetch("/api/browser/farm/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({index:e})})).json()}catch(t){return{success:!1,error:t.message}}}function xr(){if(!(!ut||!ut.list)){if(ut.list.innerHTML="",as.length===0){ut.list.innerHTML='<div class="bf-empty"><div class="bf-empty-icon">\u{1F33E}</div><p>\u6CA1\u6709\u6D3B\u8DC3\u7684\u6D4F\u89C8\u5668\u4F1A\u8BDD</p><p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">\u5148\u8FDE\u63A5\u6D4F\u89C8\u5668\uFF0C\u7136\u540E\u521B\u5EFA\u65B0\u4F1A\u8BDD</p></div>';return}for(let e=0;e<as.length;e++){let t=as[e],s=e===Aa,n=document.createElement("div");n.className="bf-session"+(s?" active":"");let a=document.createElement("div");a.className="bf-session-status"+(s?" online":""),n.appendChild(a);let o=document.createElement("div");o.className="bf-session-info";let i=document.createElement("div");i.className="bf-session-header",i.innerHTML=`<span class="bf-session-name">${h(t.label||"Session #"+e)}</span>
      <span class="bf-session-id">ctx-${e}</span>
      ${s?'<span class="bf-session-badge">\u5F53\u524D</span>':""}`,o.appendChild(i);let r=document.createElement("div");if(r.className="bf-session-meta",r.textContent=`${t.pages||0} \u4E2A\u9875\u9762 \xB7 ${t.createdAt?kr(t.createdAt):"\u521A\u521A"}`,o.appendChild(r),t.urls&&t.urls.length>0){let l=document.createElement("div");l.className="bf-session-urls",l.textContent=t.urls.slice(0,3).join(", ")+(t.urls.length>3?` +${t.urls.length-3}`:""),o.appendChild(l)}n.appendChild(o);let c=document.createElement("div");if(c.className="bf-session-actions",!s){let l=document.createElement("button");l.className="bf-action-btn",l.textContent="\u5207\u6362",l.title="\u5207\u6362\u5230\u8BE5\u4F1A\u8BDD",l.addEventListener("click",async d=>{if(d.stopPropagation(),(await br(e)).success){await It();let u=is().showToast;u&&u(`\u5DF2\u5207\u6362\u5230\u4F1A\u8BDD #${e}`,"success")}}),c.appendChild(l)}if(e>0){let l=document.createElement("button");l.className="bf-action-btn danger",l.textContent="\u2715",l.title="\u5173\u95ED\u4F1A\u8BDD",l.addEventListener("click",async d=>{d.stopPropagation();let p=await yr(e);if(p.success){await It();let u=is().showToast;u&&u(p.message,"info")}}),c.appendChild(l)}n.appendChild(c),ut.list.appendChild(n)}}}function It(){return gr().then(()=>xr())}function wr(e){e.innerHTML=`
    <div class="bf-panel">
      <div class="bf-toolbar">
        <button class="bf-btn primary" id="bf-create-btn">+ \u65B0\u5EFA\u4F1A\u8BDD</button>
        <button class="bf-btn" id="bf-refresh-btn">\u{1F504} \u5237\u65B0</button>
      </div>
      <div class="bf-list" id="bf-list">
        <div class="bf-empty">\u52A0\u8F7D\u4E2D...</div>
      </div>
    </div>
  `,ut={panel:e,list:e.querySelector("#bf-list")},e.querySelector("#bf-create-btn").addEventListener("click",async()=>{let t=prompt("\u4F1A\u8BDD\u6807\u7B7E\uFF08\u53EF\u9009\uFF09\uFF1A"),s=await vr(t||void 0);if(s.success){await It();let n=is().showToast;n&&n(s.message,"success")}else{let n=is().showToast;n&&n("\u521B\u5EFA\u5931\u8D25: "+(s.error||"\u672A\u77E5\u9519\u8BEF"),"error")}}),e.querySelector("#bf-refresh-btn").addEventListener("click",It),It()}function kr(e){if(!e)return"\u521A\u521A";let t=Date.now()-(typeof e=="number"?e:new Date(e).getTime()),s=Math.floor(t/6e4);if(s<1)return"\u521A\u521A";if(s<60)return`${s} \u5206\u949F\u524D`;let n=Math.floor(s/60);return n<24?`${n} \u5C0F\u65F6\u524D`:`${Math.floor(n/24)} \u5929\u524D`}(function e(){let t=window.QCLI||{},s=t.UIRegistry;if(!s){setTimeout(e,500);return}s.registerTab("browser-farm",{category:"other",icon:"\u{1F33E}",label:"\u6D4F\u89C8\u5668\u519C\u573A",order:21,render:n=>wr(n)}),s.registerCommand("browser-farm:open",{icon:"\u{1F33E}",name:"\u6253\u5F00\u6D4F\u89C8\u5668\u519C\u573A",desc:"\u7BA1\u7406\u591A\u4E2A\u9694\u79BB\u7684\u6D4F\u89C8\u5668\u4F1A\u8BDD",category:"browser",execute:()=>{let n=t.RightPanel;n&&(n.collapsed&&n.open(),n.switchTab("browser-farm"))}}),console.log("[BrowserFarm] Panel registered")})();function os(){return window.QCLI||{}}var xe=null,we=null,Ba="\u5FEB\u7167 A",Pa="\u5FEB\u7167 B",Mt=[],cn="diff",ke=null;async function $a(){try{return await(await fetch("/api/browser/dom-snapshot",{method:"POST"})).json()}catch(e){return{success:!1,error:e.message}}}async function Tr(e,t){try{return await(await fetch("/api/browser/dom-diff",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({snapshotA:e,snapshotB:t})})).json()}catch(s){return{success:!1,error:s.message}}}function Cr(){if(!(!ke||!ke.list)){if(!xe||!we){ke.list.innerHTML='<div class="dd-empty"><div class="dd-empty-icon">\u{1F4CB}</div><p>\u6355\u83B7\u4E24\u4E2A DOM \u5FEB\u7167\u540E\u81EA\u52A8\u5BF9\u6BD4</p><p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">\u70B9\u51FB\u300C\u6355\u83B7\u5FEB\u7167 A\u300D\u548C\u300C\u6355\u83B7\u5FEB\u7167 B\u300D</p></div>';return}if(Mt.length===0){ke.list.innerHTML='<div class="dd-empty"><div class="dd-empty-icon">\u2705</div><p>\u4E24\u5FEB\u7167\u4E4B\u95F4\u6CA1\u6709\u5DEE\u5F02</p></div>';return}ke.list.innerHTML=Mt.map(e=>{let t={added:"\u65B0\u589E",removed:"\u79FB\u9664",modified:"\u4FEE\u6539"}[e.type]||e.type,s=e.type;return`<div class="dd-item ${s}">
      <div class="dd-item-type ${s}">${t}</div>
      <div class="dd-item-path">${h(e.path)}</div>
      <div class="dd-item-detail">${h(e.details)}</div>
    </div>`}).join("")}}function Ra(e,t){if(!(!ke||!ke.list)){if(!e){ke.list.innerHTML=`<div class="dd-empty"><div class="dd-empty-icon">\u{1F4CB}</div><p>\u5C1A\u672A\u6355\u83B7 ${t}</p></div>`;return}ke.list.innerHTML=`<pre class="dd-snapshot-view">${h(JSON.stringify(e,null,2))}</pre>`}}function Ha(){cn==="snapshotA"?Ra(xe,Ba):cn==="snapshotB"?Ra(we,Pa):Cr()}function _t(){let e=document.getElementById("dd-status-a"),t=document.getElementById("dd-status-b"),s=document.getElementById("dd-diff-count");e&&(e.textContent=xe?`\u2705 \u5DF2\u6355\u83B7 (${xe.nodeCount||0} \u8282\u70B9)`:"\u2014 \u672A\u6355\u83B7"),t&&(t.textContent=we?`\u2705 \u5DF2\u6355\u83B7 (${we.nodeCount||0} \u8282\u70B9)`:"\u2014 \u672A\u6355\u83B7"),s&&(s.textContent=`${Mt.length} \u5904\u5DEE\u5F02`),Ha()}function Lr(e){e.innerHTML=`
    <div class="dd-panel">
      <div class="dd-toolbar">
        <button class="dd-btn" id="dd-capture-a">\u{1F4F8} \u5FEB\u7167 A</button>
        <button class="dd-btn" id="dd-capture-b">\u{1F4F8} \u5FEB\u7167 B</button>
        <button class="dd-btn" id="dd-compare">\u{1F50D} \u5BF9\u6BD4</button>
        <button class="dd-btn" id="dd-clear">\u{1F5D1} \u6E05\u9664</button>
      </div>
      <div class="dd-status-bar" id="dd-status-bar">
        <span class="dd-stat">\u5FEB\u7167 A: <span id="dd-status-a">\u2014 \u672A\u6355\u83B7</span></span>
        <span class="dd-stat">\u5FEB\u7167 B: <span id="dd-status-b">\u2014 \u672A\u6355\u83B7</span></span>
        <span class="dd-stat">\u5DEE\u5F02: <span id="dd-diff-count">0</span></span>
      </div>
      <div class="dd-view-tabs">
        <button class="dd-view-tab active" data-view="diff">\u5DEE\u5F02\u89C6\u56FE</button>
        <button class="dd-view-tab" data-view="snapshotA">\u5FEB\u7167 A</button>
        <button class="dd-view-tab" data-view="snapshotB">\u5FEB\u7167 B</button>
      </div>
      <div class="dd-list" id="dd-list">
        <div class="dd-empty"><div class="dd-empty-icon">\u{1F4CB}</div><p>\u6355\u83B7\u4E24\u4E2A DOM \u5FEB\u7167\u540E\u81EA\u52A8\u5BF9\u6BD4</p></div>
      </div>
    </div>
  `,ke={panel:e,list:e.querySelector("#dd-list")},e.querySelector("#dd-capture-a").addEventListener("click",async()=>{let s=await $a();if(s.success){xe=s.snapshot,Ba=`\u5FEB\u7167 A (${new Date().toLocaleTimeString()})`;let n=os().showToast;n&&n(`DOM \u5FEB\u7167 A \u5DF2\u6355\u83B7 (${s.nodeCount} \u8282\u70B9)`,"success")}xe&&we&&await t(),_t()}),e.querySelector("#dd-capture-b").addEventListener("click",async()=>{let s=await $a();if(s.success){we=s.snapshot,Pa=`\u5FEB\u7167 B (${new Date().toLocaleTimeString()})`;let n=os().showToast;n&&n(`DOM \u5FEB\u7167 B \u5DF2\u6355\u83B7 (${s.nodeCount} \u8282\u70B9)`,"success")}xe&&we&&await t(),_t()});async function t(){let s=await Tr(xe,we);s.success&&(Mt=s.diffs||[])}e.querySelector("#dd-compare").addEventListener("click",async()=>{if(!xe||!we){let s=os().showToast;s&&s("\u8BF7\u5148\u6355\u83B7\u5FEB\u7167 A \u548C\u5FEB\u7167 B","info");return}await t(),_t()}),e.querySelector("#dd-clear").addEventListener("click",()=>{xe=null,we=null,Mt=[],_t();let s=os().showToast;s&&s("\u5DF2\u6E05\u9664\u6240\u6709\u5FEB\u7167","info")}),e.querySelectorAll(".dd-view-tab").forEach(s=>{s.addEventListener("click",()=>{e.querySelectorAll(".dd-view-tab").forEach(n=>n.classList.remove("active")),s.classList.add("active"),cn=s.dataset.view,Ha()})}),_t()}(function e(){let t=window.QCLI||{},s=t.UIRegistry;if(!s){setTimeout(e,500);return}s.registerTab("dom-diff",{icon:"\u{1F4CB}",label:"DOM \u5DEE\u5F02",category:"other",order:22,render:n=>Lr(n)}),s.registerCommand("dom-diff:open",{icon:"\u{1F4CB}",name:"\u6253\u5F00 DOM \u5DEE\u5F02\u5BF9\u6BD4",desc:"\u6355\u83B7\u548C\u5BF9\u6BD4 DOM \u5FEB\u7167\u5DEE\u5F02",category:"browser",execute:()=>{let n=t.RightPanel;n&&(n.collapsed&&n.open(),n.switchTab("dom-diff"))}}),console.log("[DOMDiff] Panel registered")})();function At(){return window.QCLI||{}}var ue=null,fe=null;async function Er(){try{return await(await fetch("/api/browser/detect-forms",{method:"POST"})).json()}catch(e){return{success:!1,error:e.message}}}async function za(e){try{return await(await fetch("/api/browser/fill-forms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields:e})})).json()}catch(t){return{success:!1,error:t.message}}}function Sr(){if(!fe||!fe.list)return;if(!ue||!ue.forms||ue.forms.length===0){fe.list.innerHTML='<div class="af-empty"><div class="af-empty-icon">\u{1F4DD}</div><p>\u672A\u68C0\u6D4B\u5230\u8868\u5355</p><p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">\u5BFC\u822A\u5230\u5305\u542B\u8868\u5355\u7684\u9875\u9762\u540E\u70B9\u51FB\u300C\u68C0\u6D4B\u8868\u5355\u300D</p></div>';return}let e="";for(let s=0;s<ue.forms.length;s++){let n=ue.forms[s];if(n.fields.length!==0){e+=`<div class="af-form-section">
      <div class="af-form-header">
        <span class="af-form-title">\u8868\u5355 ${s+1}${n.id?" #"+n.id:""}</span>
        <span class="af-form-action">${n.method||"GET"} ${n.action?"\u2192 "+n.action.slice(0,40):""}</span>
        <span class="af-form-count">${n.fieldCount} \u5B57\u6BB5</span>
      </div>`;for(let a=0;a<n.fields.length;a++){let o=n.fields[a];e+=`<div class="af-field">
        <div class="af-field-label">
          <span class="af-field-name">${h(o.label||o.name||o.id||"unknown")}</span>
          ${o.required?'<span class="af-field-required">*</span>':""}
          <span class="af-field-type">${o.type||o.tag}</span>
        </div>
        <div class="af-field-input-row">
          <input type="text" class="af-field-input" id="af-input-${s}-${a}"
            placeholder="${h(o.placeholder||"\u8F93\u5165\u503C...")}"
            value="${h(o.value||"")}"
            data-form="${s}" data-field="${a}" />
          <button class="af-fill-btn" data-form="${s}" data-field="${a}" title="\u4EC5\u586B\u5145\u6B64\u5B57\u6BB5">\u25B6</button>
        </div>
        <div class="af-field-meta">${o.name?'name="'+h(o.name)+'"':""}${o.id?' id="'+h(o.id)+'"':""}</div>
        ${o.options?'<div class="af-field-options">\u9009\u9879: '+o.options.map(i=>h(i.text)).join(", ")+"</div>":""}
      </div>`}e+=`<button class="af-btn af-fill-all" data-form-index="${s}">\u{1F4DD} \u586B\u5199\u6B64\u8868\u5355\u6240\u6709\u5B57\u6BB5</button>`,e+="</div>"}}fe.list.innerHTML=e,fe.list.querySelectorAll(".af-fill-btn").forEach(s=>{s.addEventListener("click",async()=>{let n=parseInt(s.dataset.form),a=parseInt(s.dataset.field),o=ue.forms[n]?.fields[a];if(!o)return;let i=document.getElementById(`af-input-${n}-${a}`),r=i?i.value:"",c=await za([{name:o.name,id:o.id,value:r,type:o.type}]),l=At().showToast;c.success&&c.filled>0?l&&l(`\u2705 \u5DF2\u586B\u5145: ${o.label||o.name}`,"success"):l&&l(`\u274C \u586B\u5145\u5931\u8D25: ${c.error||"\u672A\u77E5\u9519\u8BEF"}`,"error")})}),fe.list.querySelectorAll(".af-fill-all").forEach(s=>{s.addEventListener("click",async()=>{let n=parseInt(s.dataset.formIndex),a=ue.forms[n];if(!a)return;let o=[];for(let c=0;c<a.fields.length;c++){let l=document.getElementById(`af-input-${n}-${c}`),d=l?l.value:"";d&&o.push({name:a.fields[c].name,id:a.fields[c].id,value:d,type:a.fields[c].type})}if(o.length===0){let c=At().showToast;c&&c("\u8BF7\u5148\u8F93\u5165\u8981\u586B\u5145\u7684\u503C","info");return}let i=await za(o),r=At().showToast;i.success?r&&r(`\u2705 \u5DF2\u586B\u5145 ${i.filled}/${i.attempted} \u4E2A\u5B57\u6BB5`,"success"):r&&r(`\u274C \u586B\u5145\u5931\u8D25: ${i.error}`,"error")})});let t=fe.statusBar;t&&(t.innerHTML=`
      <span class="af-stat">\u8868\u5355: ${ue.formCount||0}</span>
      <span class="af-stat">\u5B57\u6BB5: ${ue.totalFields||0}</span>
    `)}function Ir(e){e.innerHTML=`
    <div class="af-panel">
      <div class="af-toolbar">
        <button class="af-btn primary" id="af-detect-btn">\u{1F50D} \u68C0\u6D4B\u8868\u5355</button>
        <button class="af-btn" id="af-clear-btn">\u{1F5D1} \u6E05\u9664</button>
      </div>
      <div class="af-status-bar" id="af-status-bar">
        <span class="af-stat">\u70B9\u51FB\u300C\u68C0\u6D4B\u8868\u5355\u300D\u5F00\u59CB</span>
      </div>
      <div class="af-list" id="af-list">
        <div class="af-empty"><div class="af-empty-icon">\u{1F4DD}</div><p>\u68C0\u6D4B\u9875\u9762\u4E0A\u7684\u8868\u5355\u5B57\u6BB5</p></div>
      </div>
    </div>
  `,fe={panel:e,list:e.querySelector("#af-list"),statusBar:e.querySelector("#af-status-bar")},e.querySelector("#af-detect-btn").addEventListener("click",async()=>{let t=await Er();if(t.success){ue=t,Sr();let s=At().showToast;s&&s(`\u68C0\u6D4B\u5230 ${t.formCount} \u4E2A\u8868\u5355\uFF0C${t.totalFields} \u4E2A\u5B57\u6BB5`,"success")}else{let s=At().showToast;s&&s("\u68C0\u6D4B\u5931\u8D25: "+(t.error||""),"error")}}),e.querySelector("#af-clear-btn").addEventListener("click",()=>{ue=null,fe.list.innerHTML='<div class="af-empty"><div class="af-empty-icon">\u{1F4DD}</div><p>\u68C0\u6D4B\u9875\u9762\u4E0A\u7684\u8868\u5355\u5B57\u6BB5</p></div>',fe.statusBar&&(fe.statusBar.innerHTML='<span class="af-stat">\u70B9\u51FB\u300C\u68C0\u6D4B\u8868\u5355\u300D\u5F00\u59CB</span>')})}(function e(){let t=window.QCLI||{},s=t.UIRegistry;if(!s){setTimeout(e,500);return}s.registerTab("form-autofill",{icon:"\u{1F4DD}",label:"\u8868\u5355\u586B\u8868",category:"other",order:23,render:n=>Ir(n)}),s.registerCommand("form-autofill:open",{icon:"\u{1F4DD}",name:"\u6253\u5F00\u8868\u5355\u81EA\u52A8\u586B\u8868",desc:"\u68C0\u6D4B\u5E76\u586B\u5145\u9875\u9762\u8868\u5355",category:"browser",execute:()=>{let n=t.RightPanel;n&&(n.collapsed&&n.open(),n.switchTab("form-autofill"))}}),console.log("[FormAutofill] Panel registered")})();function Na(){return window.QCLI||{}}var Te=null,Ce=null;async function _r(){try{return await(await fetch("/api/browser/accessibility",{method:"POST"})).json()}catch(e){return{success:!1,error:e.message}}}function Mr(){if(!Ce||!Ce.list)return;if(!Te||!Te.issues||Te.issues.length===0){Ce.list.innerHTML='<div class="a11y-empty"><div class="a11y-empty-icon">\u2705</div><p>\u672A\u53D1\u73B0\u65E0\u969C\u788D\u95EE\u9898</p></div>';return}let e={};for(let n of Te.issues){let a=n.category||"other";e[a]||(e[a]=[]),e[a].push(n)}let t={page:"\u{1F4C4} \u9875\u9762\u7ED3\u6784",image:"\u{1F5BC}\uFE0F \u56FE\u7247",form:"\u{1F4DD} \u8868\u5355",heading:"\u{1F4D1} \u6807\u9898\u5C42\u7EA7",keyboard:"\u2328\uFE0F \u952E\u76D8",contrast:"\u{1F3A8} \u5BF9\u6BD4\u5EA6",aria:"\u267F ARIA",other:"\u{1F4CC} \u5176\u4ED6"},s="";for(let[n,a]of Object.entries(e)){s+=`<div class="a11y-category">
      <div class="a11y-category-header">${t[n]||n} <span class="a11y-category-count">${a.length}</span></div>`;for(let o of a){let i={high:"\u{1F534}",medium:"\u{1F7E1}",low:"\u{1F7E2}",info:"\u{1F535}"};s+=`<div class="a11y-issue ${o.severity||"info"}">
        <div class="a11y-issue-header">
          <span class="a11y-issue-icon">${i[o.severity]||"\u{1F535}"}</span>
          <span class="a11y-issue-code">${o.code||""}</span>
          <span class="a11y-issue-severity">${o.severity||""}</span>
        </div>
        <div class="a11y-issue-message">${h(o.message)}</div>
        ${o.selector?`<div class="a11y-issue-selector">${h(o.selector)}</div>`:""}
      </div>`}s+="</div>"}Ce.list.innerHTML=s}function qa(){if(!Ce||!Ce.scoreBar)return;if(!Te){Ce.scoreBar.innerHTML='<span class="a11y-stat">\u70B9\u51FB\u300C\u8FD0\u884C\u5206\u6790\u300D\u5F00\u59CB</span>';return}let e=Te.score||0,t=Te.stats||{},s=e>=80?"#22c55e":e>=50?"#eab308":"#ef4444";Ce.scoreBar.innerHTML=`
    <div class="a11y-score-bar">
      <div class="a11y-score-circle" style="border-color: ${s}; color: ${s};">${e}</div>
      <div class="a11y-score-details">
        <span class="a11y-stat">\u{1F534} \u9519\u8BEF: ${t.error||0}</span>
        <span class="a11y-stat">\u{1F7E1} \u8B66\u544A: ${t.warning||0}</span>
        <span class="a11y-stat">\u{1F535} \u63D0\u793A: ${t.info||0}</span>
      </div>
    </div>
    <div class="a11y-url">${h(Te.url||"")}</div>
  `}function Ar(e){e.innerHTML=`
    <div class="a11y-panel">
      <div class="a11y-toolbar">
        <button class="a11y-btn primary" id="a11y-run-btn">\u267F \u8FD0\u884C\u5206\u6790</button>
        <button class="a11y-btn" id="a11y-clear-btn">\u{1F5D1} \u6E05\u9664</button>
      </div>
      <div class="a11y-score-bar" id="a11y-score-bar">
        <span class="a11y-stat">\u70B9\u51FB\u300C\u8FD0\u884C\u5206\u6790\u300D\u5F00\u59CB</span>
      </div>
      <div class="a11y-list" id="a11y-list">
        <div class="a11y-empty"><div class="a11y-empty-icon">\u267F</div><p>\u8FD0\u884C\u53EF\u8BBF\u95EE\u6027\u5206\u6790</p></div>
      </div>
    </div>
  `,Ce={panel:e,list:e.querySelector("#a11y-list"),scoreBar:e.querySelector("#a11y-score-bar")},e.querySelector("#a11y-run-btn").addEventListener("click",async()=>{let t=e.querySelector("#a11y-run-btn");t.disabled=!0,t.textContent="\u23F3 \u5206\u6790\u4E2D...";let s=await _r();if(s.success){Te=s,qa(),Mr();let n=Na().showToast;n&&n(`\u267F \u65E0\u969C\u788D\u8BC4\u5206: ${s.score}/100 (${s.issueCount} \u4E2A\u95EE\u9898)`,s.score>=80?"success":"info")}else{let n=Na().showToast;n&&n("\u5206\u6790\u5931\u8D25: "+(s.error||""),"error")}t.disabled=!1,t.textContent="\u267F \u8FD0\u884C\u5206\u6790"}),e.querySelector("#a11y-clear-btn").addEventListener("click",()=>{Te=null,Ce.list.innerHTML='<div class="a11y-empty"><div class="a11y-empty-icon">\u267F</div><p>\u8FD0\u884C\u53EF\u8BBF\u95EE\u6027\u5206\u6790</p></div>',qa()})}(function e(){let t=window.QCLI||{},s=t.UIRegistry;if(!s){setTimeout(e,500);return}s.registerTab("accessibility",{icon:"\u267F",label:"\u65E0\u969C\u788D",category:"other",order:50,render:n=>Ar(n)}),s.registerCommand("accessibility:open",{icon:"\u267F",name:"\u6253\u5F00\u65E0\u969C\u788D\u5206\u6790",desc:"\u8FD0\u884C\u53EF\u8BBF\u95EE\u6027\u5BA1\u6838",category:"browser",execute:()=>{let n=t.RightPanel;n&&(n.collapsed&&n.open(),n.switchTab("accessibility"))}}),console.log("[A11y] Panel registered")})();(function(){let t=window.QCLI||{};function s(i){i.innerHTML=`
      <div class="chp-container" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div class="chp-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:600;">\u{1FA7A} CLI \u5065\u5EB7\u68C0\u67E5</span>
            <span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;">\u9A8C\u8BC1\u6240\u6709\u5DF2\u6CE8\u518C CLI \u8DEF\u5F84</span>
          </div>
          <button id="chp-scan-btn" style="padding:4px 12px;border-radius:6px;border:1px solid var(--border-default);background:var(--accent);color:#fff;font-size:11px;cursor:pointer;">\u{1F50D} \u5F00\u59CB\u68C0\u67E5</button>
        </div>
        <div id="chp-summary" style="display:none;"></div>
        <div id="chp-results" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
          <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);font-size:12px;">
            <div style="font-size:36px;margin-bottom:8px;opacity:0.3;">\u{1FA7A}</div>
            <div>\u70B9\u51FB\u300C\u5F00\u59CB\u68C0\u67E5\u300D\u9A8C\u8BC1\u6240\u6709\u5DF2\u6CE8\u518C CLI \u8DEF\u5F84</div>
          </div>
        </div>
      </div>
    `;let r=document.getElementById("chp-scan-btn");r&&r.addEventListener("click",n)}async function n(){let i=document.getElementById("chp-results"),r=document.getElementById("chp-summary"),c=document.getElementById("chp-scan-btn");if(!(!i||!r||!c)){c.disabled=!0,c.textContent="\u23F3 \u68C0\u67E5\u4E2D...",i.innerHTML='<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px;">\u23F3 \u6B63\u5728\u68C0\u67E5 CLI \u8DEF\u5F84...</div>';try{let l=await fetch("/api/clis/health");if(!l.ok)throw new Error("HTTP "+l.status);let d=await l.json();if(!d.success)throw new Error(d.error||"Unknown error");let{results:p,summary:u}=d;r.style.display="block";let f=u.total>0?Math.round(u.ok/u.total*100):0,m=f===100?"#22c55e":f>=80?"#eab308":"#ef4444";if(r.innerHTML=`
        <div style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:8px;padding:10px 14px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">${f===100?"\u2705":f>=80?"\u26A0\uFE0F":"\u{1F6A8}"}</span>
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
                <span style="color:var(--text-secondary);">\u5065\u5EB7\u5EA6</span>
                <span style="font-weight:600;color:${m};">${f}%</span>
              </div>
              <div style="height:4px;background:var(--bg-hover);border-radius:2px;overflow:hidden;">
                <div style="height:100%;width:${f}%;background:${m};border-radius:2px;transition:width 0.5s;"></div>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;font-size:10px;flex-wrap:wrap;">
            <span style="padding:2px 8px;border-radius:4px;background:rgba(34,197,94,0.1);color:#22c55e;">\u2705 ${u.ok} \u6B63\u5E38</span>
            ${u.missing>0?`<span style="padding:2px 8px;border-radius:4px;background:rgba(239,68,68,0.1);color:#ef4444;">\u274C ${u.missing} \u7F3A\u5931</span>`:""}
            ${u.resolved>0?`<span style="padding:2px 8px;border-radius:4px;background:rgba(234,179,8,0.1);color:#eab308;">\u{1F504} ${u.resolved} \u5DF2\u89E3\u6790</span>`:""}
            <span style="padding:2px 8px;border-radius:4px;background:var(--bg-hover);color:var(--text-tertiary);">\u{1F4CA} ${u.total} \u603B\u8BA1</span>
          </div>
        </div>
      `,p.length===0){i.innerHTML='<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px;">\u6682\u65E0\u5DF2\u6CE8\u518C CLI</div>';return}let g=p.filter(v=>v.status==="missing"),b=p.filter(v=>v.status==="ok"),x=p.filter(v=>v.status==="resolved");if(i.innerHTML="",g.length>0){let v=document.createElement("div");v.innerHTML=`
          <div style="font-size:10px;font-weight:600;color:#ef4444;padding:4px 0;text-transform:uppercase;letter-spacing:0.5px;">
            \u274C \u7F3A\u5931 (${g.length})
          </div>
          <div style="display:flex;gap:4px;margin-bottom:6px;">
            <button class="chp-fix-btn" data-action="remove-broken" style="padding:3px 10px;border-radius:4px;border:1px solid #ef4444;background:rgba(239,68,68,0.1);color:#ef4444;font-size:10px;cursor:pointer;">\u{1F5D1} \u79FB\u9664\u5168\u90E8\u7F3A\u5931</button>
          </div>
        `;let w=document.createElement("div");w.style.cssText="display:flex;flex-direction:column;gap:3px;",g.forEach(T=>{let H=a(T,"missing");w.appendChild(H)}),v.appendChild(w),i.appendChild(v)}if(x.length>0){let v=document.createElement("div");v.innerHTML=`<div style="font-size:10px;font-weight:600;color:#eab308;padding:8px 0 4px;text-transform:uppercase;letter-spacing:0.5px;">\u{1F504} \u5F85\u89E3\u6790 (${x.length})</div>`;let w=document.createElement("div");w.style.cssText="display:flex;flex-direction:column;gap:3px;",x.forEach(T=>{w.appendChild(a(T,"resolved"))}),v.appendChild(w),i.appendChild(v)}if(b.length>0){let v=document.createElement("div");v.innerHTML=`<div style="font-size:10px;font-weight:600;color:#22c55e;padding:8px 0 4px;text-transform:uppercase;letter-spacing:0.5px;">\u2705 \u6B63\u5E38 (${b.length})</div>`;let w=document.createElement("div");if(w.style.cssText="display:flex;flex-direction:column;gap:2px;",b.slice(0,20).forEach(T=>{w.appendChild(a(T,"ok"))}),b.length>20){let T=document.createElement("div");T.style.cssText="font-size:10px;color:var(--text-tertiary);text-align:center;padding:4px;",T.textContent=`...\u53CA\u5176\u4ED6 ${b.length-20} \u4E2A\u6B63\u5E38 CLI`,w.appendChild(T)}v.appendChild(w),i.appendChild(v)}i.querySelectorAll(".chp-fix-btn").forEach(v=>{v.addEventListener("click",async()=>{if(v.dataset.action==="remove-broken"){if(!confirm("\u786E\u5B9A\u79FB\u9664\u6240\u6709\u7F3A\u5931\u7684 CLI \u5417\uFF1F"))return;let T=g.map(H=>H.id);try{(await fetch("/api/clis/batch-delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:T})})).ok&&(t.showToast?.(`\u5DF2\u79FB\u9664 ${T.length} \u4E2A\u7F3A\u5931 CLI`,"success"),t.renderCLIList&&t.renderCLIList(),t.Sidebar?.renderCLIList&&t.Sidebar.renderCLIList(),n())}catch(H){t.showToast?.("\u79FB\u9664\u5931\u8D25: "+H.message,"error")}}})})}catch(l){i.innerHTML=`<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px;">\u274C \u68C0\u67E5\u5931\u8D25: ${l.message}</div>`}finally{c.disabled=!1,c.textContent="\u{1F50D} \u91CD\u65B0\u68C0\u67E5"}}}function a(i,r){let c=document.createElement("div");c.style.cssText="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:11px;";let l=r==="ok"?"\u2705":r==="resolved"?"\u{1F504}":"\u274C",d=document.createElement("span");d.style.cssText="font-weight:600;color:var(--text-primary);min-width:80px;",d.textContent=i.name;let p=document.createElement("span");p.style.cssText="color:var(--text-tertiary);font-size:9px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",p.textContent=i.path||"(\u672A\u8BBE\u7F6E\u8DEF\u5F84)";let u=document.createElement("span");if(u.style.cssText="font-size:9px;padding:1px 6px;border-radius:4px;",r==="ok"?(u.style.cssText+="background:rgba(34,197,94,0.1);color:#22c55e;",u.textContent=i.version||"\u6B63\u5E38"):r==="missing"?(u.style.cssText+="background:rgba(239,68,68,0.1);color:#ef4444;",u.textContent="\u7F3A\u5931"):(u.style.cssText+="background:rgba(234,179,8,0.1);color:#eab308;",u.textContent="\u5F85\u89E3\u6790"),c.appendChild(document.createTextNode(l+" ")),c.appendChild(d),c.appendChild(p),c.appendChild(u),r==="missing"){let f=document.createElement("button");f.textContent="\u2715",f.style.cssText="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:10px;padding:2px;",f.title="\u79FB\u9664",f.addEventListener("click",async()=>{try{(await fetch(`/api/clis/${i.id}`,{method:"DELETE"})).ok&&(c.remove(),t.showToast?.(`\u5DF2\u79FB\u9664 ${i.name}`,"info"),t.renderCLIList&&t.renderCLIList())}catch{t.showToast?.("\u79FB\u9664\u5931\u8D25","error")}}),c.appendChild(f)}return c}let o=t.UIRegistry;o&&o.registerTab("cli-health",{category:"other",icon:"\u{1FA7A}",label:"CLI \u5065\u5EB7",order:10,render:s}),t.CLIHealth={render:s,runHealthCheck:n},console.log("[CLIHealthPanel] Registered")})();(function(){let t=window.QCLI||{},s=new Set;function n(d){s=new Set,d.innerHTML=`
      <div class="cli-imp-container" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div class="cli-imp-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:600;">\u{1F4E6} CLI \u6279\u91CF\u64CD\u4F5C</span>
            <span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;">\u5BFC\u5165 / \u5BFC\u51FA\u914D\u7F6E</span>
          </div>
        </div>

        <!-- Export Section -->
        <div style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:8px;padding:10px 14px;">
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">\u{1F4E4} \u5BFC\u51FA CLI</div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:8px;">\u9009\u62E9\u8981\u5BFC\u51FA\u7684 CLI\uFF0C\u751F\u6210 JSON \u914D\u7F6E\u6587\u4EF6</div>
          <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button id="cli-imp-select-all" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">\u5168\u9009</button>
            <button id="cli-imp-deselect-all" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">\u53D6\u6D88\u5168\u9009</button>
            <button id="cli-imp-export-btn" style="padding:3px 10px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-size:10px;cursor:pointer;" disabled>\u{1F4E5} \u5BFC\u51FA\u9009\u4E2D (0)</button>
          </div>
          <div id="cli-imp-export-list" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;"></div>
        </div>

        <!-- Import Section -->
        <div style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:8px;padding:10px 14px;">
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">\u{1F4E5} \u5BFC\u5165 CLI</div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:8px;">\u4E0A\u4F20 JSON \u914D\u7F6E\u6587\u4EF6\u5BFC\u5165 CLI\uFF08\u652F\u6301\u5BFC\u51FA\u683C\u5F0F\u53CA\u7B80\u6613\u683C\u5F0F\uFF09</div>
          <div style="display:flex;gap:6px;">
            <input type="file" id="cli-imp-file-input" accept=".json" style="display:none;" aria-label="\u9009\u62E9 CLI \u5BFC\u5165\u6587\u4EF6" />
            <button id="cli-imp-choose-file" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">\u{1F4C2} \u9009\u62E9\u6587\u4EF6</button>
            <span id="cli-imp-file-name" style="font-size:10px;color:var(--text-tertiary);align-self:center;">\u672A\u9009\u62E9\u6587\u4EF6</span>
          </div>
          <div id="cli-import-preview" style="margin-top:8px;display:none;"></div>
        </div>

        <div id="cli-imp-status" style="font-size:10px;color:var(--text-tertiary);text-align:center;"></div>
      </div>
    `,a(),o()}async function a(){let d=document.getElementById("cli-imp-export-list");if(d)try{let p=await fetch("/api/clis");if(!p.ok)throw new Error("HTTP "+p.status);let f=(await p.json()).clis||[];if(f.length===0){d.innerHTML='<div style="padding:12px;text-align:center;color:var(--text-tertiary);font-size:11px;">\u6682\u65E0\u5DF2\u6CE8\u518C CLI</div>';return}d.innerHTML=f.map(m=>{let g=m.id,b=s.has(g);return`<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;background:${b?"var(--accent-glow)":"transparent"};">
          <input type="checkbox" class="cli-imp-checkbox" data-id="${g}" ${b?"checked":""} style="accent-color:var(--accent);" />
          <span style="font-weight:600;color:var(--text-primary);flex:1;">${h(m.name)}</span>
          <span style="font-size:9px;color:var(--text-tertiary);">${m.category||"tool"}</span>
          <span style="font-size:9px;color:var(--text-tertiary);">${m.version?m.version.slice(0,15):""}</span>
        </label>`}).join("")}catch(p){d.innerHTML='<div style="padding:12px;text-align:center;color:#ef4444;font-size:11px;">\u274C \u52A0\u8F7D\u5931\u8D25: '+p.message+"</div>"}}function o(){let d=document.getElementById("cli-imp-export-list");d&&d.addEventListener("change",f=>{let m=f.target.closest(".cli-imp-checkbox");if(!m)return;let g=m.dataset.id;m.checked?s.add(g):s.delete(g),i();let b=m.closest("label");b&&(b.style.background=m.checked?"var(--accent-glow)":"transparent")}),document.getElementById("cli-imp-select-all")?.addEventListener("click",()=>{document.querySelectorAll(".cli-imp-checkbox").forEach(f=>{f.checked=!0,s.add(f.dataset.id);let m=f.closest("label");m&&(m.style.background="var(--accent-glow)")}),i()}),document.getElementById("cli-imp-deselect-all")?.addEventListener("click",()=>{document.querySelectorAll(".cli-imp-checkbox").forEach(f=>{f.checked=!1,s.delete(f.dataset.id);let m=f.closest("label");m&&(m.style.background="transparent")}),i()}),document.getElementById("cli-imp-export-btn")?.addEventListener("click",r);let p=document.getElementById("cli-imp-choose-file"),u=document.getElementById("cli-imp-file-input");p&&u&&(p.addEventListener("click",()=>u.click()),u.addEventListener("change",c))}function i(){let d=document.getElementById("cli-imp-export-btn");if(!d)return;let p=s.size;d.disabled=p===0,d.textContent=p>0?`\u{1F4E5} \u5BFC\u51FA\u9009\u4E2D (${p})`:"\u{1F4E5} \u5BFC\u51FA\u9009\u4E2D (0)"}async function r(){if(s.size!==0)try{let d=await fetch("/api/clis/batch-export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:Array.from(s)})});if(!d.ok)throw new Error("HTTP "+d.status);let p=await d.json();if(!p.success)throw new Error(p.error||"Export failed");let u=JSON.stringify(p.export,null,2),f=new Blob([u],{type:"application/json"}),m=URL.createObjectURL(f),g=document.createElement("a");g.href=m,g.download=`cli-export-${new Date().toISOString().slice(0,10)}.json`,document.body.appendChild(g),g.click(),document.body.removeChild(g),URL.revokeObjectURL(m),t.showToast?.(`\u5DF2\u5BFC\u51FA ${s.size} \u4E2A CLI`,"success")}catch(d){t.showToast?.("\u5BFC\u51FA\u5931\u8D25: "+d.message,"error")}}async function c(d){let p=d.target.files?.[0];if(!p)return;let u=document.getElementById("cli-imp-file-name"),f=document.getElementById("cli-import-preview"),m=document.getElementById("cli-imp-status");if(u&&(u.textContent="\u{1F4C4} "+p.name),!(!f||!m))try{let g=await p.text(),b=JSON.parse(g),x=[];if(b.clis&&Array.isArray(b.clis))x=b.clis;else if(Array.isArray(b))x=b;else{f.innerHTML='<div style="color:#ef4444;font-size:11px;padding:8px;">\u274C \u65E0\u6548\u683C\u5F0F\uFF1A\u6587\u4EF6\u5E94\u5305\u542B "clis" \u6570\u7EC4\u6216\u4E3A CLI \u6570\u7EC4</div>',f.style.display="block";return}if(x.length===0){f.innerHTML='<div style="color:var(--text-tertiary);font-size:11px;padding:8px;">\u6587\u4EF6\u4E2D\u6CA1\u6709 CLI \u6570\u636E</div>',f.style.display="block";return}f.style.display="block",f.innerHTML=`
        <div style="margin-top:4px;">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">\u{1F4CB} \u53D1\u73B0 ${x.length} \u4E2A CLI\uFF1A</div>
          <div style="max-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;margin-bottom:6px;">
            ${x.map(v=>`<div style="font-size:10px;padding:2px 4px;background:var(--bg-elevated);border-radius:4px;">${v.name||"(\u672A\u547D\u540D)"} \xB7 ${v.category||"tool"}</div>`).join("")}
          </div>
          <button id="cli-imp-do-import" style="padding:4px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-size:10px;cursor:pointer;">\u{1F4E5} \u5BFC\u5165 ${x.length} \u4E2A CLI</button>
        </div>
      `,document.getElementById("cli-imp-do-import")?.addEventListener("click",async()=>{try{let v=await fetch("/api/clis/batch-import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clis:x})});if(!v.ok)throw new Error("HTTP "+v.status);let w=await v.json();w.success&&(m.textContent=`\u2705 \u5DF2\u5BFC\u5165 ${w.imported} \u4E2A\uFF0C\u8DF3\u8FC7 ${w.skipped} \u4E2A\uFF08\u5DF2\u5B58\u5728\uFF09`,t.renderCLIList&&t.renderCLIList(),a(),f.style.display="none")}catch(v){m.textContent=`\u274C \u5BFC\u5165\u5931\u8D25: ${v.message}`}})}catch(g){f.innerHTML=`<div style="color:#ef4444;font-size:11px;padding:8px;">\u274C \u65E0\u6CD5\u89E3\u6790\u6587\u4EF6: ${g.message}</div>`,f.style.display="block"}}let l=t.UIRegistry;l&&l.registerTab("cli-importer",{category:"other",icon:"\u{1F4E6}",label:"CLI \u6279\u91CF",order:11,render:n}),t.CLIImporter={render:n},console.log("[CLIImporter] Registered")})();(function(){let t=window.QCLI||{};async function s(i){i.innerHTML=`
      <div class="cpi-container" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div class="cpi-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:600;">\u{1F4E6} \u9884\u8BBE CLI \u5B89\u88C5</span>
            <span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;" id="cpi-preset-name">\u52A0\u8F7D\u4E2D...</span>
          </div>
          <button id="cpi-refresh-btn" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">\u{1F504} \u5237\u65B0</button>
        </div>
        <div id="cpi-content">
          <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);font-size:12px;">
            <div style="font-size:32px;margin-bottom:8px;opacity:0.3;">\u23F3</div>
            <div>\u6B63\u5728\u83B7\u53D6\u9884\u8BBE\u6570\u636E...</div>
          </div>
        </div>
      </div>
    `,document.getElementById("cpi-refresh-btn")?.addEventListener("click",()=>s(i)),await n(i)}async function n(i){let r=document.getElementById("cpi-content"),c=document.getElementById("cpi-preset-name");if(!(!r||!c))try{let[l,d]=await Promise.all([fetch("/api/presets"),fetch("/api/presets/available")]),p=l.ok?await l.json():null,u=d.ok?await d.json():null,f=p?.active||"unknown";if(c.textContent=`\u5F53\u524D\u9884\u8BBE: ${f}`,!u?.success||!u.available||u.available.length===0){r.innerHTML=`
          <div style="text-align:center;padding:40px 20px;">
            <div style="font-size:36px;margin-bottom:8px;opacity:0.3;">\u2705</div>
            <div style="font-size:12px;color:var(--text-secondary);">\u5F53\u524D\u9884\u8BBE\u7684\u6240\u6709 CLI \u5747\u5DF2\u5B89\u88C5</div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px;">
              \u5DF2\u6CE8\u518C ${u?.registered||0} / ${u?.totalInPreset||0} \u4E2A
            </div>
          </div>
        `;return}let{available:m,totalInPreset:g,registered:b}=u,x=m.filter(w=>w.canResolve),v=m.filter(w=>!w.canResolve);r.innerHTML=`
        <div style="font-size:10px;color:var(--text-tertiary);padding:4px 0;">
          \u5DF2\u6CE8\u518C ${b} / ${g} \u4E2A \xB7 
          \u53EF\u5B89\u88C5 ${x.length} \u4E2A \xB7 
          \u9700\u624B\u52A8 ${v.length} \u4E2A
        </div>
        ${x.length>0?`
          <div style="margin:4px 0;">
            <button id="cpi-install-all" style="padding:4px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-size:10px;cursor:pointer;">
              \u26A1 \u4E00\u952E\u5B89\u88C5\u5168\u90E8 (${x.length})
            </button>
          </div>
        `:""}
        <div style="display:flex;flex-direction:column;gap:3px;" id="cpi-available-list">
          ${a(x,v)}
        </div>
      `,r.querySelectorAll(".cpi-install-btn").forEach(w=>{w.addEventListener("click",async()=>{let T=w.dataset.name,H=w.dataset.category;w.disabled=!0,w.textContent="\u23F3 \u5B89\u88C5\u4E2D...";try{let q=await fetch("/api/clis",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:T,args:[],category:H||"tool"})});if(q.ok)w.textContent="\u2705 \u5DF2\u5B89\u88C5",w.style.background="rgba(34,197,94,0.1)",w.style.color="#22c55e",w.style.borderColor="#22c55e",t.showToast?.(`\u2705 ${T} \u5DF2\u5B89\u88C5`,"success"),t.renderCLIList&&t.renderCLIList();else{let Q=await q.json();w.textContent="\u274C "+(Q.error||"\u5931\u8D25"),setTimeout(()=>{w.disabled=!1,w.textContent="\u26A1 \u5B89\u88C5"},2e3)}}catch(q){w.textContent="\u274C \u9519\u8BEF",t.showToast?.("\u5B89\u88C5\u5931\u8D25: "+q.message,"error")}})}),document.getElementById("cpi-install-all")?.addEventListener("click",async()=>{let w=document.getElementById("cpi-install-all");if(!w)return;w.disabled=!0,w.textContent="\u23F3 \u6B63\u5728\u5B89\u88C5...";let T=0,H=0;for(let q of x)try{(await fetch("/api/clis",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:q.name,args:[],category:q.category||"tool"})})).ok?T++:H++}catch{H++}w.textContent=`\u2705 \u5B8C\u6210: ${T} \u6210\u529F, ${H} \u5931\u8D25`,t.showToast?.(`\u5B89\u88C5\u5B8C\u6210: ${T} \u6210\u529F, ${H} \u5931\u8D25`,H>0?"warning":"success"),t.renderCLIList&&t.renderCLIList(),setTimeout(()=>s(i),1500)})}catch(l){r.innerHTML=`<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px;">\u274C \u52A0\u8F7D\u5931\u8D25: ${l.message}</div>`}}function a(i,r){let c="";return i.length>0&&(c+='<div style="font-size:10px;font-weight:600;color:var(--accent);padding:6px 0 2px;">\u26A1 \u53EF\u4E00\u952E\u5B89\u88C5</div>',i.forEach(l=>{c+=`
          <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:11px;">
            <span style="font-weight:600;color:var(--text-primary);flex:1;">${h(l.name)}</span>
            <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(99,102,241,0.1);color:var(--accent);">${l.category}</span>
            <button class="cpi-install-btn" data-name="${l.name}" data-category="${l.category}" style="padding:3px 10px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-size:10px;cursor:pointer;">\u26A1 \u5B89\u88C5</button>
          </div>
        `})),r.length>0&&(c+='<div style="font-size:10px;font-weight:600;color:var(--text-tertiary);padding:8px 0 2px;">\u{1F4CB} \u9700\u624B\u52A8\u5B89\u88C5\uFF08\u672A\u5728 PATH \u4E2D\u627E\u5230\uFF09</div>',r.forEach(l=>{c+=`
          <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;font-size:11px;opacity:0.7;">
            <span style="font-weight:600;color:var(--text-primary);flex:1;">${h(l.name)}</span>
            <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--bg-hover);color:var(--text-tertiary);">${l.category}</span>
            <span style="font-size:9px;color:var(--text-tertiary);">\u672A\u627E\u5230</span>
          </div>
        `})),c}let o=t.UIRegistry;o&&o.registerTab("cli-preset-install",{category:"other",icon:"\u{1F4E6}",label:"CLI \u5B89\u88C5",order:12,render:s}),t.CLIPresetInstall={render:s},console.log("[CLIPresetInstall] Registered")})();function me(){return window.QCLI||{}}function ja(){let e=document.getElementById("global-search-panel");if(!e)return;e.classList.remove("hidden");let t=document.getElementById("global-search-input");t&&(t.value="",setTimeout(()=>t.focus(),100));let s=document.getElementById("global-search-results");s&&(s.innerHTML="");let n=document.getElementById("global-search-status");n&&n.classList.remove("visible")}function ft(){document.getElementById("global-search-panel")?.classList.add("hidden")}function $r(){let e=document.getElementById("global-search-panel");e&&(e.classList.contains("hidden")?ja():ft())}function Oa(e){let t=document.getElementById("global-search-results");if(!t)return;let s=document.getElementById("global-search-status"),n=document.getElementById("global-search-count");if(!e||e.length<2){t.innerHTML="",n&&(n.textContent=""),s&&s.classList.remove("visible");return}let a=e.toLowerCase(),o=me().Tabs?.tabs||[],i=0,r=[];for(let c of o){if(!c.buffer)continue;let l=c.buffer.split(`
`),d=[];for(let p=0;p<l.length;p++)l[p].toLowerCase().includes(a)&&d.push({lineNum:p+1,text:l[p]});d.length>0&&(r.push({tab:c,matches:d}),i+=d.length)}if(n&&(n.textContent=i>0?`${i} \u6761`:""),r.length===0){t.innerHTML='<div class="gsr-empty">\u672A\u627E\u5230\u5339\u914D\u7ED3\u679C</div>',s&&(s.textContent=`\u641C\u7D22 "${e}" \u2014 \u5171 0 \u6761`,s.classList.add("visible"));return}s&&(s.textContent=`\u641C\u7D22 "${e}" \u2014 \u5728 ${r.length} \u4E2A\u7EC8\u7AEF\u4E2D\u627E\u5230 ${i} \u6761`,s.classList.add("visible")),t.innerHTML="";for(let c of r){let l=c.tab,d=document.createElement("div");d.className="gsr-tab-group";let p=document.createElement("div");p.className="gsr-tab-header",p.textContent=`${l.icon||"\u25B8"} ${l.name||l.cliId||"Terminal"}`;let u=document.createElement("span");u.textContent=` (${c.matches.length})`,p.appendChild(u),d.appendChild(p);let f=50,m=c.matches.slice(0,f);for(let g of m){let b=document.createElement("div");b.className="gsr-item",b.dataset.tabId=l.tabId;let x=document.createElement("span");x.className="gsr-item-line",x.textContent=g.lineNum,b.appendChild(x);let v=document.createElement("span");v.className="gsr-item-text";let w=g.text.toLowerCase().indexOf(a);if(w!==-1){let T=g.text.slice(0,w),H=g.text.slice(w,w+e.length),q=g.text.slice(w+e.length);v.innerHTML=h(T)+"<mark>"+h(H)+"</mark>"+h(q)}else v.textContent=g.text;b.appendChild(v),b.addEventListener("click",()=>{ft(),l.tabId&&me().Tabs&&me().Tabs.switch(l.tabId);let T=me().Tabs?.term;T&&T.focus()}),d.appendChild(b)}if(c.matches.length>f){let g=document.createElement("div");g.className="gsr-empty",g.style.padding="8px var(--space-2)",g.style.fontSize="11px",g.textContent=`\u2026 \u8FD8\u6709 ${c.matches.length-f} \u6761\u7ED3\u679C`,d.appendChild(g)}t.appendChild(d)}}Promise.resolve().then(()=>{me()._globalSearchPatched||(me()._globalSearchPatched=!0,me().openGlobalSearch=ja,me().closeGlobalSearch=ft,me().toggleGlobalSearch=$r,me().renderGlobalSearchResults=Oa,document.addEventListener("keydown",e=>{let t=document.getElementById("global-search-panel");if(!(!t||t.classList.contains("hidden"))&&e.key==="Escape"){e.preventDefault(),ft();let s=me().Tabs?.term;s&&s.focus()}}),document.getElementById("global-search-input")?.addEventListener("input",e=>{Oa(e.target.value)}),document.getElementById("global-search-close-btn")?.addEventListener("click",ft),document.getElementById("global-search-bg")?.addEventListener("click",ft))});var Be=window.QCLI||{},K={plugins:[],loading:!1,detail:null};(function(){let t="pm-panel-css";if(document.getElementById(t))return;let s=document.createElement("style");s.id=t,s.textContent=`
    /* \u2500\u2500 Plugin Manager Panel \u2500\u2500 */
    .pmp-container {
      padding: 8px;
      height: 100%;
      overflow-y: auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      align-content: start;
    }
    .pmp-container > .pmp-header,
    .pmp-container > .pmp-stats,
    .pmp-container > .pmp-empty {
      grid-column: 1 / -1;
    }

    .pmp-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 4px 8px;
      border-bottom: 1px solid var(--border-default, rgba(255,255,255,0.06));
      margin-bottom: 4px;
    }
    .pmp-header h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-header-actions {
      margin-left: auto;
      display: flex;
      gap: 4px;
    }
    .pmp-header-btn {
      background: none;
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
      color: var(--text-secondary, #98989d);
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .pmp-header-btn:hover {
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-primary, #f5f5f7);
      border-color: var(--accent, #6366f1);
    }

    /* \u2500\u2500 Stats bar \u2500\u2500 */
    .pmp-stats {
      display: flex;
      gap: 12px;
      padding: 4px 4px;
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
    }
    .pmp-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .pmp-stat-val {
      font-weight: 600;
      color: var(--text-secondary, #98989d);
    }

    /* \u2500\u2500 Plugin cards \u2500\u2500 */
    .pmp-card {
      background: var(--bg-overlay, rgba(255,255,255,0.02));
      border: 1px solid var(--border-default, rgba(255,255,255,0.06));
      border-radius: 10px;
      padding: 10px 12px;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .pmp-card:hover {
      border-color: var(--accent, #6366f1);
      background: var(--bg-hover, rgba(99,102,241,0.04));
    }
    .pmp-card.disabled {
      opacity: 0.55;
    }

    .pmp-card-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .pmp-card-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--bg-hover, rgba(255,255,255,0.04));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .pmp-card-info {
      flex: 1;
      min-width: 0;
    }
    .pmp-card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #f5f5f7);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pmp-card-meta {
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 1px;
    }

    /* \u2500\u2500 Toggle switch \u2500\u2500 */
    .pmp-toggle {
      position: relative;
      width: 32px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .pmp-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .pmp-toggle-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: var(--bg-hover, rgba(255,255,255,0.08));
      border-radius: 9px;
      transition: all 0.2s ease;
    }
    .pmp-toggle-slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      left: 2px;
      bottom: 2px;
      background: var(--text-tertiary, #71717a);
      border-radius: 50%;
      transition: all 0.2s ease;
    }
    .pmp-toggle input:checked + .pmp-toggle-slider {
      background: var(--accent, #6366f1);
    }
    .pmp-toggle input:checked + .pmp-toggle-slider::before {
      transform: translateX(14px);
      background: #fff;
    }

    /* \u2500\u2500 Capability badges \u2500\u2500 */
    .pmp-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 8px;
    }
    .pmp-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-tertiary, #71717a);
      border: 1px solid var(--border-default, rgba(255,255,255,0.04));
      white-space: nowrap;
    }
    .pmp-badge.cli { color: #22c55e; border-color: rgba(34,197,94,0.2); background: rgba(34,197,94,0.06); }
    .pmp-badge.workflow { color: #6366f1; border-color: rgba(99,102,241,0.2); background: rgba(99,102,241,0.06); }
    .pmp-badge.aiTool { color: #f59e0b; border-color: rgba(245,158,11,0.2); background: rgba(245,158,11,0.06); }
    .pmp-badge.route { color: #06b6d4; border-color: rgba(6,182,212,0.2); background: rgba(6,182,212,0.06); }
    .pmp-badge.preset { color: #a855f7; border-color: rgba(168,85,247,0.2); background: rgba(168,85,247,0.06); }
    .pmp-badge.mcp { color: #ec4899; border-color: rgba(236,72,153,0.2); background: rgba(236,72,153,0.06); }
    .pmp-badge.ui { color: #14b8a6; border-color: rgba(20,185,166,0.2); background: rgba(20,185,166,0.06); }

    /* \u2500\u2500 Card actions \u2500\u2500 */
    .pmp-card-actions {
      display: none;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border-default, rgba(255,255,255,0.04));
    }
    .pmp-card:hover .pmp-card-actions {
      display: flex;
    }
    .pmp-action-btn {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 6px;
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
      background: none;
      color: var(--text-secondary, #98989d);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pmp-action-btn:hover {
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-action-btn.danger {
      color: #ef4444;
      border-color: rgba(239,68,68,0.15);
    }
    .pmp-action-btn.danger:hover {
      background: rgba(239,68,68,0.1);
    }

    /* \u2500\u2500 Empty state \u2500\u2500 */
    .pmp-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-tertiary, #71717a);
      font-size: 13px;
      gap: 8px;
      padding: 40px 20px;
      text-align: center;
    }
    .pmp-empty-icon { font-size: 36px; }
    .pmp-empty-action {
      margin-top: 8px;
      padding: 6px 16px;
      border-radius: 8px;
      border: 1px solid var(--accent, #6366f1);
      background: var(--accent, #6366f1);
      color: #fff;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pmp-empty-action:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }

    /* \u2500\u2500 Loading \u2500\u2500 */
    .pmp-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 8px;
      color: var(--text-tertiary, #71717a);
      font-size: 13px;
    }
    .pmp-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border-default, rgba(255,255,255,0.08));
      border-top-color: var(--accent, #6366f1);
      border-radius: 50%;
      animation: pmp-spin 0.6s linear infinite;
    }
    @keyframes pmp-spin {
      to { transform: rotate(360deg); }
    }

    /* \u2500\u2500 Detail view \u2500\u2500 */
    .pmp-detail-back {
      display: flex; align-items: center; gap: 6px;
      background: none; border: none; color: var(--text-secondary, #98989d);
      font-size: 12px; cursor: pointer; padding: 4px 0; margin-bottom: 8px;
      transition: color 0.15s;
    }
    .pmp-detail-back:hover { color: var(--text-primary, #f5f5f7); }

    .pmp-detail-header {
      display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
    }
    .pmp-detail-icon {
      width: 40px; height: 40px; border-radius: 10px;
      background: var(--bg-hover, rgba(255,255,255,0.04));
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    .pmp-detail-title {
      font-size: 16px; font-weight: 700; color: var(--text-primary, #f5f5f7);
    }
    .pmp-detail-subtitle {
      font-size: 11px; color: var(--text-tertiary, #71717a);
      margin-top: 1px;
    }
    .pmp-detail-status {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; padding: 2px 8px; border-radius: 10px;
      font-weight: 500;
    }
    .pmp-detail-status.loaded {
      background: rgba(34,197,94,0.1); color: #22c55e;
    }
    .pmp-detail-status.disabled {
      background: rgba(239,68,68,0.1); color: #ef4444;
    }

    .pmp-detail-section {
      background: var(--bg-overlay, rgba(255,255,255,0.02));
      border: 1px solid var(--border-default, rgba(255,255,255,0.06));
      border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
    }
    .pmp-detail-section-title {
      font-size: 11px; font-weight: 600; color: var(--text-tertiary, #71717a);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }
    .pmp-detail-row {
      display: flex; align-items: baseline;
      padding: 3px 0; font-size: 12px;
    }
    .pmp-detail-label {
      color: var(--text-tertiary, #71717a); width: 80px; flex-shrink: 0;
    }
    .pmp-detail-value {
      color: var(--text-primary, #f5f5f7); word-break: break-all;
    }
    .pmp-detail-value.missing {
      color: var(--text-tertiary, #71717a); font-style: italic;
    }

    .pmp-detail-code {
      font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', monospace);
      font-size: 11px; background: rgba(0,0,0,0.2);
      border-radius: 6px; padding: 8px 10px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-word;
      color: var(--text-secondary, #98989d); line-height: 1.5;
      margin-top: 4px;
    }

    .pmp-detail-cap-item {
      padding: 6px 0; border-bottom: 1px solid var(--border-default, rgba(255,255,255,0.04));
      font-size: 12px;
    }
    .pmp-detail-cap-item:last-child { border-bottom: none; }
    .pmp-detail-cap-name {
      font-weight: 600; color: var(--text-primary, #f5f5f7);
    }
    .pmp-detail-cap-desc {
      font-size: 11px; color: var(--text-tertiary, #71717a); margin-top: 2px;
    }
    .pmp-detail-cap-table {
      margin-top: 4px; font-size: 11px; width: 100%;
      border-collapse: collapse;
    }
    .pmp-detail-cap-table td {
      padding: 2px 8px 2px 0; vertical-align: top;
      color: var(--text-secondary, #98989d);
    }
    .pmp-detail-cap-table td:first-child {
      color: var(--text-tertiary, #71717a); width: 70px;
    }

    /* \u2500\u2500 Create dialog \u2500\u2500 */
    .pmp-create-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(5,5,8,0.7);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pmp-fade-in 0.15s ease;
    }
    .pmp-create-overlay.hidden { display: none; }
    @keyframes pmp-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .pmp-create-dialog {
      width: 440px;
      max-width: 90vw;
      max-height: 85vh;
      overflow-y: auto;
      background: var(--bg-overlay, #1c1c1e);
      border: 1px solid var(--border-default, rgba(255,255,255,0.1));
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    .pmp-create-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary, #f5f5f7);
      margin: 0 0 16px;
    }

    .pmp-create-field {
      margin-bottom: 12px;
    }
    .pmp-create-field label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary, #98989d);
      margin-bottom: 4px;
    }
    .pmp-create-field input,
    .pmp-create-field textarea {
      width: 100%;
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
      background: var(--bg-input, rgba(255,255,255,0.04));
      color: var(--text-primary, #f5f5f7);
      font-size: 13px;
      font-family: inherit;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }
    .pmp-create-field input:focus,
    .pmp-create-field textarea:focus {
      outline: none;
      border-color: var(--accent, #6366f1);
    }
    .pmp-create-field textarea {
      resize: vertical;
      min-height: 50px;
    }
    .pmp-create-field small {
      display: block;
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
      margin-top: 2px;
    }

    .pmp-features-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 12px;
    }
    .pmp-feature-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid var(--border-default, rgba(255,255,255,0.06));
      background: none;
      color: var(--text-secondary, #98989d);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .pmp-feature-chip:hover {
      border-color: var(--accent, #6366f1);
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-feature-chip.selected {
      border-color: var(--accent, #6366f1);
      background: rgba(99,102,241,0.1);
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-feature-icon { font-size: 14px; }

    .pmp-create-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .pmp-create-btn {
      padding: 7px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      border: none;
    }
    .pmp-create-btn.primary {
      background: var(--accent, #6366f1);
      color: #fff;
    }
    .pmp-create-btn.primary:hover { opacity: 0.9; }
    .pmp-create-btn.primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .pmp-create-btn.secondary {
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-secondary, #98989d);
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
    }
    .pmp-create-btn.secondary:hover {
      color: var(--text-primary, #f5f5f7);
    }

    .pmp-create-error {
      color: #ef4444;
      font-size: 12px;
      margin-top: 8px;
    }
    .pmp-create-success {
      color: #22c55e;
      font-size: 12px;
      margin-top: 8px;
    }
  `,document.head.appendChild(s)})();function Fe(){K.loading=!0,Ue(),fetch("/api/plugins/all").then(e=>e.json()).then(e=>{K.plugins=e.plugins||[],K.loading=!1,Ue()}).catch(e=>{console.error("[PluginManager] Failed to load plugins:",e),K.loading=!1,Ue()})}function Rr(e,t){fetch("/api/plugins/"+encodeURIComponent(e)+"/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:t})}).then(s=>s.json()).then(s=>{s.success?Fe():Be.showToast?.("\u63D2\u4EF6\u5207\u6362\u5931\u8D25: "+(s.error||"\u672A\u77E5\u9519\u8BEF"),"error")}).catch(s=>{Be.showToast?.("\u7F51\u7EDC\u9519\u8BEF: "+s.message,"error")})}function Br(e){confirm('\u786E\u5B9A\u8981\u5378\u8F7D\u63D2\u4EF6 "'+e+'" \u5417\uFF1F\u63D2\u4EF6\u76EE\u5F55\u5C06\u88AB\u5220\u9664\u3002')&&fetch("/api/plugins/market/installed/"+encodeURIComponent(e),{method:"DELETE"}).then(t=>t.json()).then(t=>{t.success?(Be.showToast?.('\u2705 \u63D2\u4EF6 "'+e+'" \u5DF2\u5378\u8F7D',"success"),Fe()):Be.showToast?.("\u5378\u8F7D\u5931\u8D25: "+(t.error||"\u672A\u77E5\u9519\u8BEF"),"error")}).catch(t=>{Be.showToast?.("\u5378\u8F7D\u5931\u8D25: "+t.message,"error")})}function Ue(){let e=document.getElementById("rp-plugin-manager");if(!e)return;if(K.loading){e.innerHTML='<div class="pmp-loading"><div class="pmp-spinner"></div><span>\u52A0\u8F7D\u63D2\u4EF6\u5217\u8868...</span></div>';return}if(K.detail){e.innerHTML=jr(K.detail);return}let t=K.plugins.filter(a=>a.enabled),s=K.plugins.filter(a=>!a.enabled),n='<div class="pmp-container">';if(n+='<div class="pmp-header"><h3>\u{1F50C} \u63D2\u4EF6\u7BA1\u7406</h3><div class="pmp-header-actions"><button class="pmp-header-btn" onclick="PMANAGER.openMarket()">\u{1F3EA} \u5E7F\u573A</button><button class="pmp-header-btn" onclick="PMANAGER.openCreate()">+ \u65B0\u5EFA</button><button class="pmp-header-btn" onclick="PMANAGER.refresh()">\u27F3</button></div></div>',n+='<div class="pmp-stats"><span class="pmp-stat">\u5DF2\u52A0\u8F7D <span class="pmp-stat-val">'+t.length+'</span></span><span class="pmp-stat">\u5DF2\u7981\u7528 <span class="pmp-stat-val">'+s.length+'</span></span><span class="pmp-stat">\u5171 <span class="pmp-stat-val">'+K.plugins.length+"</span></span></div>",K.plugins.length===0)n+='<div class="pmp-empty"><div class="pmp-empty-icon">\u{1F50C}</div><div>\u8FD8\u6CA1\u6709\u5B89\u88C5\u4EFB\u4F55\u63D2\u4EF6</div><div style="font-size:11px;color:var(--text-tertiary);">\u70B9\u51FB\u300C\u5E7F\u573A\u300D\u6D4F\u89C8\u793E\u533A\u63D2\u4EF6\uFF0C\u6216\u300C\u65B0\u5EFA\u300D\u521B\u5EFA\u4F60\u81EA\u5DF1\u7684\u63D2\u4EF6</div><button class="pmp-empty-action" onclick="PMANAGER.openMarket()">\u{1F3EA} \u6253\u5F00\u63D2\u4EF6\u5E7F\u573A</button></div>';else{for(let a of t)n+=Da(a,!0);for(let a of s)n+=Da(a,!1)}n+="</div>",e.innerHTML=n}function Da(e,t){let s=Fa(e),n=e.version||"\u2014",a=e.author||"\u2014",o={clis:"\u{1F527}",workflow:"\u26A1",aiTool:"\u{1F916}",route:"\u{1F310}",preset:"\u{1F3A8}",mcp:"\u{1F517}",ui:"\u{1F5A5}\uFE0F"},i={clis:"CLI",workflow:"Workflow",aiTool:"AI Tool",route:"Route",preset:"Preset",mcp:"MCP",ui:"UI"},r=(e.capabilities||[]).map(l=>{let d=o[l]||"\u{1F4E6}",p=i[l]||l;return'<span class="pmp-badge '+l+'">'+d+" "+p+"</span>"}).join("");return'<div class="pmp-card'+(t?"":" disabled")+`" onclick="PMANAGER.showDetail('`+h(e.name)+`')"><div class="pmp-card-header"><div class="pmp-card-icon">`+s+'</div><div class="pmp-card-info"><div class="pmp-card-name">'+h(e.name)+'</div><div class="pmp-card-meta"><span>v'+h(n)+"</span><span>by "+h(a)+'</span></div></div><label class="pmp-toggle" title="'+(t?"\u7981\u7528":"\u542F\u7528")+'"><input type="checkbox"'+(t?" checked":"")+` onchange="PMANAGER.toggle('`+h(e.name)+`', this.checked)" /><span class="pmp-toggle-slider"></span></label></div>`+(r?'<div class="pmp-badges">'+r+"</div>":"")+`<div class="pmp-card-actions"><button class="pmp-action-btn" onclick="PMANAGER.reload('`+h(e.name)+`')">\u27F3 \u91CD\u8F7D</button><button class="pmp-action-btn danger" onclick="PMANAGER.uninstall('`+h(e.name)+`')">\u{1F5D1} \u5378\u8F7D</button></div></div>`}var P={name:"",description:"",author:"",version:"0.1.0",features:[],creating:!1,error:"",success:""};function Pr(){P={name:"",description:"",author:"",version:"0.1.0",features:[],creating:!1,error:"",success:""},document.body.insertAdjacentHTML("beforeend",'<div class="pmp-create-overlay" id="pmp-create-overlay"></div>');let e=document.getElementById("pmp-create-overlay");e.addEventListener("click",function(s){s.target===e&&ln()}),e.innerHTML="";let t=document.createElement("div");t.className="pmp-create-dialog",t.id="pmp-create-dialog",e.appendChild(t),Re()}function ln(){let e=document.getElementById("pmp-create-overlay");e&&e.remove()}function Re(){let e=document.getElementById("pmp-create-dialog");if(!e)return;let t=[{id:"cli",icon:"\u{1F527}",label:"CLI \u5DE5\u5177"},{id:"workflow",icon:"\u26A1",label:"\u5DE5\u4F5C\u6D41"},{id:"aiTool",icon:"\u{1F916}",label:"AI \u5DE5\u5177"},{id:"route",icon:"\u{1F310}",label:"HTTP \u8DEF\u7531"},{id:"ui",icon:"\u{1F5A5}\uFE0F",label:"UI \u9762\u677F"},{id:"mcp",icon:"\u{1F517}",label:"MCP \u670D\u52A1"},{id:"lifecycle",icon:"\u{1F504}",label:"\u751F\u547D\u5468\u671F"}],s=P.error?'<div class="pmp-create-error">\u274C '+h(P.error)+"</div>":"",n=P.success?'<div class="pmp-create-success">\u2705 '+h(P.success)+"</div>":"",a=t.map(function(i){return'<button class="pmp-feature-chip'+(P.features.indexOf(i.id)!==-1?" selected":"")+`" onclick="PMANAGER.toggleFeature('`+i.id+`')"><span class="pmp-feature-icon">`+i.icon+"</span><span>"+i.label+"</span></button>"}).join("");e.innerHTML='<h3 class="pmp-create-title">\u{1F50C} \u521B\u5EFA\u65B0\u63D2\u4EF6</h3><div class="pmp-create-field"><label for="pmp-create-name">\u63D2\u4EF6\u540D\u79F0 *</label><input type="text" id="pmp-create-name" placeholder="my-awesome-plugin" value="'+h(P.name)+`" oninput="PMANAGER.updateField('name', this.value)" /><small>\u4EC5\u652F\u6301\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u8FDE\u5B57\u7B26\uFF08kebab-case\uFF09</small></div><div class="pmp-create-field"><label for="pmp-create-desc">\u63CF\u8FF0</label><input type="text" id="pmp-create-desc" placeholder="A short description of your plugin" value="`+h(P.description)+`" oninput="PMANAGER.updateField('description', this.value)" /></div><div style="display:flex;gap:12px;"><div class="pmp-create-field" style="flex:1;"><label for="pmp-create-author">\u4F5C\u8005</label><input type="text" id="pmp-create-author" placeholder="Your name" value="`+h(P.author)+`" oninput="PMANAGER.updateField('author', this.value)" /></div><div class="pmp-create-field" style="flex:1;"><label for="pmp-create-version">\u7248\u672C</label><input type="text" id="pmp-create-version" value="`+h(P.version)+`" oninput="PMANAGER.updateField('version', this.value)" /></div></div><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:6px;">\u9009\u62E9\u529F\u80FD\uFF08\u53EF\u9009\uFF09</label><div class="pmp-features-grid">`+a+"</div>"+s+n+'<div class="pmp-create-actions"><button class="pmp-create-btn secondary" onclick="PMANAGER.closeCreate()">\u53D6\u6D88</button><button class="pmp-create-btn primary" id="pmp-create-submit" '+(P.creating?"disabled":"")+' onclick="PMANAGER.submitCreate()">'+(P.creating?"\u23F3 \u521B\u5EFA\u4E2D...":"\u{1F680} \u521B\u5EFA\u63D2\u4EF6")+"</button></div>";let o=document.getElementById("pmp-create-name");o&&setTimeout(function(){o.focus()},100)}function Hr(e,t){P[e]=t}function zr(e){let t=P.features.indexOf(e);t===-1?P.features.push(e):P.features.splice(t,1),Re()}function Nr(){let e=P.name.trim();if(!e){P.error="\u8BF7\u8F93\u5165\u63D2\u4EF6\u540D\u79F0",Re();return}if(!/^[a-z0-9-]+$/.test(e)){P.error="\u63D2\u4EF6\u540D\u79F0\u4EC5\u652F\u6301\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u8FDE\u5B57\u7B26",Re();return}P.creating=!0,P.error="",P.success="",Re();let t={name:e,description:P.description.trim(),author:P.author.trim(),version:P.version.trim()||"0.1.0",features:P.features};fetch("/api/plugins/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)}).then(s=>s.json()).then(s=>{P.creating=!1,s.success?(P.success='\u63D2\u4EF6 "'+e+'" \u521B\u5EFA\u6210\u529F\uFF01'+(s.loadResult?.success?" \u5DF2\u81EA\u52A8\u52A0\u8F7D\u3002":" \u4F46\u52A0\u8F7D\u5931\u8D25: "+(s.loadResult?.error||"")),Re(),Fe(),setTimeout(ln,2e3)):(P.error=s.error||"\u521B\u5EFA\u5931\u8D25",Re())}).catch(s=>{P.creating=!1,P.error="\u7F51\u7EDC\u9519\u8BEF: "+s.message,Re()})}function qr(e){K.detail={name:e,loading:!0},Ue(),fetch("/api/plugins/market/installed").then(t=>t.json()).then(t=>{let s=(t.plugins||[]).find(n=>n.name===e||n.manifest&&n.manifest.name===e);s?K.detail={name:e,loading:!1,plugin:s,manifest:s.manifest}:K.detail={name:e,loading:!1,error:"\u672A\u627E\u5230\u63D2\u4EF6\u6570\u636E"},Ue()}).catch(t=>{K.detail={name:e,loading:!1,error:t.message},Ue()})}function Or(){K.detail=null,Ue()}function jr(e){if(e.loading)return'<div class="pmp-loading" style="padding:60px 20px"><div class="pmp-spinner"></div><span>\u52A0\u8F7D\u8BE6\u60C5...</span></div>';if(e.error)return'<div class="pmp-container"><button class="pmp-detail-back" onclick="PMANAGER.closeDetail()">\u2190 \u8FD4\u56DE\u5217\u8868</button><div class="pmp-empty"><div class="pmp-empty-icon">\u26A0\uFE0F</div><p>'+h(e.error)+"</p></div></div>";let t=e.plugin||{},s=e.manifest||{},n=Fa(s),a='<div class="pmp-container">';a+='<button class="pmp-detail-back" onclick="PMANAGER.closeDetail()">\u2190 \u8FD4\u56DE\u5217\u8868</button>';let o=t.loaded?"loaded":"disabled",i=t.loaded?"\u2705 \u5DF2\u52A0\u8F7D":"\u274C \u672A\u52A0\u8F7D";if(e.manifest||(i="\u26A0\uFE0F \u65E0 manifest"),a+='<div class="pmp-detail-header"><div class="pmp-detail-icon">'+n+'</div><div style="flex:1;min-width:0;"><div class="pmp-detail-title">'+h(s.name||t.name||"?")+'</div><div class="pmp-detail-subtitle">v'+h(s.version||"\u2014")+" \xB7 by "+h(s.author||"\u2014")+'</div></div><span class="pmp-detail-status '+o+'">'+i+"</span></div>",s&&Object.keys(s).length>0){a+='<div class="pmp-detail-section"><div class="pmp-detail-section-title">\u{1F4CB} \u6E05\u5355\u4FE1\u606F</div>';let l=[{label:"\u540D\u79F0",value:s.name},{label:"\u7248\u672C",value:s.version},{label:"\u63CF\u8FF0",value:s.description},{label:"\u4F5C\u8005",value:s.author},{label:"\u8BB8\u53EF",value:s.license}];for(let d=0;d<l.length;d++){let p=l[d];a+='<div class="pmp-detail-row"><span class="pmp-detail-label">'+p.label+'</span><span class="pmp-detail-value'+(p.value?"":" missing")+'">'+(p.value?h(String(p.value)):"\u672A\u8BBE\u7F6E")+"</span></div>"}a+="</div>"}let r=[{key:"mcpServers",icon:"\u{1F517}",label:"MCP \u670D\u52A1\u5668"},{key:"aiTools",icon:"\u{1F916}",label:"AI \u5DE5\u5177"},{key:"clis",icon:"\u{1F527}",label:"CLI \u5DE5\u5177"},{key:"workflows",icon:"\u26A1",label:"\u5DE5\u4F5C\u6D41"},{key:"routes",icon:"\u{1F310}",label:"HTTP \u8DEF\u7531"},{key:"presets",icon:"\u{1F3A8}",label:"\u9884\u8BBE"}];for(let l=0;l<r.length;l++){let d=r[l],p=s[d.key];if(!(!p||!Array.isArray(p)||p.length===0)){a+='<div class="pmp-detail-section"><div class="pmp-detail-section-title">'+d.icon+" "+d.label+' <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-tertiary);">('+p.length+")</span></div>";for(let u=0;u<p.length;u++){var c=p[u];if(a+='<div class="pmp-detail-cap-item">',d.key==="mcpServers"){if(a+='<div class="pmp-detail-cap-name">'+h(c.name||"unnamed")+"</div>",a+='<table class="pmp-detail-cap-table">',a+="<tr><td>\u547D\u4EE4</td><td>"+h(c.command||"")+" "+h((c.args||[]).join(" "))+"</td></tr>",c.env&&Object.keys(c.env).length>0){let f=Object.keys(c.env).map(function(m){return m+"="+c.env[m]}).join(" ");a+="<tr><td>\u73AF\u5883\u53D8\u91CF</td><td>"+h(f)+"</td></tr>"}a+="</table>"}else if(d.key==="aiTools"){if(a+='<div class="pmp-detail-cap-name">'+h(c.name||"unnamed")+"</div>",c.description&&(a+='<div class="pmp-detail-cap-desc">'+h(c.description)+"</div>"),c.parameters){let f=c.parameters.properties?Object.keys(c.parameters.properties):[];f.length>0&&(a+='<table class="pmp-detail-cap-table">',a+="<tr><td>\u53C2\u6570</td><td>"+h(f.join(", "))+"</td></tr>",a+="</table>")}}else d.key==="clis"?(a+='<div class="pmp-detail-cap-name">'+h(c.name||c.id||"unnamed")+"</div>",a+='<table class="pmp-detail-cap-table">',a+="<tr><td>\u8DEF\u5F84</td><td>"+h(c.path||"")+"</td></tr>",c.type&&(a+="<tr><td>\u7C7B\u578B</td><td>"+h(c.type)+"</td></tr>"),a+="</table>"):d.key==="workflows"?(a+='<div class="pmp-detail-cap-name">'+h(c.name||c.id||"unnamed")+"</div>",c.description&&(a+='<div class="pmp-detail-cap-desc">'+h(c.description)+"</div>")):d.key==="routes"?a+='<div class="pmp-detail-cap-name">'+h((c.method||"GET").toUpperCase())+" "+h(c.path||"/")+"</div>":d.key==="presets"&&(a+='<div class="pmp-detail-cap-name">'+h(c.name||"unnamed")+"</div>");a+="</div>"}a+="</div>"}}return s.lifecycle&&(a+='<div class="pmp-detail-section"><div class="pmp-detail-section-title">\u{1F504} \u751F\u547D\u5468\u671F</div>',s.lifecycle.onLoad&&(a+='<div class="pmp-detail-row"><span class="pmp-detail-label">onLoad</span><span class="pmp-detail-value">'+h(s.lifecycle.onLoad)+"</span></div>"),s.lifecycle.onUnload&&(a+='<div class="pmp-detail-row"><span class="pmp-detail-label">onUnload</span><span class="pmp-detail-value">'+h(s.lifecycle.onUnload)+"</span></div>"),a+="</div>"),s&&Object.keys(s).length>0&&(a+='<div class="pmp-detail-section"><div class="pmp-detail-section-title">\u{1F4C4} \u539F\u59CB JSON</div><div class="pmp-detail-code">'+h(JSON.stringify(s,null,2))+"</div></div>"),a+=`<div style="display:flex;gap:6px;padding:4px 0 8px;"><button class="pmp-action-btn" onclick="PMANAGER.reload('`+h(t.name||e.name)+`')">\u27F3 \u91CD\u8F7D</button><button class="pmp-action-btn danger" onclick="PMANAGER.uninstall('`+h(t.name||e.name)+`')">\u{1F5D1} \u5378\u8F7D</button></div>`,a+="</div>",a}function Fa(e){return e.icon?e.icon:"\u{1F50C}"}var Dr={refresh:Fe,load:Fe,showDetail:function(e){qr(e)},closeDetail:function(){Or()},toggle:function(e,t){Rr(e,t)},uninstall:function(e){Br(e)},reload:function(e){fetch("/api/plugins/"+encodeURIComponent(e)+"/reload",{method:"POST"}).then(t=>t.json()).then(t=>{t.success?(Be.showToast?.('\u2705 \u63D2\u4EF6 "'+e+'" \u5DF2\u91CD\u8F7D',"success"),Fe()):Be.showToast?.("\u91CD\u8F7D\u5931\u8D25: "+(t.error||"\u672A\u77E5\u9519\u8BEF"),"error")}).catch(t=>{Be.showToast?.("\u91CD\u8F7D\u5931\u8D25: "+t.message,"error")})},openMarket:function(){window.open("/plugin-plaza.html","_blank")},openCreate:function(){Pr()},closeCreate:function(){ln()},updateField:function(e,t){Hr(e,t)},toggleFeature:function(e){zr(e)},submitCreate:function(){Nr()}};window.PMANAGER=Dr;(function e(){let t=window.QCLI?.UIRegistry;if(!t){setTimeout(e,100);return}t.registerTab("plugin-manager",{category:"plugin",icon:"\u{1F50C}",label:"\u63D2\u4EF6",order:30,render:function(n){n.innerHTML='<div id="rp-plugin-manager" style="height:100%;"></div>',setTimeout(Fe,50)}})&&console.log("[PluginManager] Registered as right panel tab")})();function Va(){return window.QCLI||{}}var Ua=3e3,rs=null,mt=null,dn=null,pn=null;async function Fr(){try{let e=await fetch("/api/rate-limit-stats");return e.ok?await e.json():null}catch{return null}}function Ur(e){return e>=6e4?`${e/6e4} min`:e>=1e3?`${e/1e3} s`:`${e} ms`}function Qa(e){return e>=1e6?(e/1e6).toFixed(1)+"M":e>=1e3?(e/1e3).toFixed(1)+"K":String(e)}function Qr(e,t){let s=e.max>0?Math.min(100,Math.round(e.activeIPs/e.max*100)):0,n=e.totalRequests>0?Math.round(e.blocked/e.totalRequests*100):0,a="ok";return n>20?a="danger":n>5&&(a="warn"),`
    <div class="rl-limiter-card" data-severity="${a}">
      <div class="rl-limiter-header">
        <span class="rl-limiter-name">${e.name}</span>
        <span class="rl-limiter-budget">${e.max} req/${Ur(e.windowMs)}</span>
      </div>

      <div class="rl-limiter-body">
        <div class="rl-metric">
          <span class="rl-metric-value">${Qa(e.totalRequests)}</span>
          <span class="rl-metric-label">\u603B\u8BF7\u6C42</span>
          ${t?`<span class="rl-delta">+${t.totalRequests}</span>`:""}
        </div>
        <div class="rl-metric rl-metric-blocked">
          <span class="rl-metric-value ${n>5?"text-danger":""}">${Qa(e.blocked)}</span>
          <span class="rl-metric-label">\u5DF2\u62E6\u622A (${n}%)</span>
          ${t?`<span class="rl-delta rl-delta-danger">+${t.blocked}</span>`:""}
        </div>
        <div class="rl-metric">
          <span class="rl-metric-value">${e.activeIPs}</span>
          <span class="rl-metric-label">\u6D3B\u8DC3 IP</span>
        </div>
      </div>

      <div class="rl-bar">
        <div class="rl-bar-fill" style="width:${s}%"></div>
      </div>

      ${e.topIP?`
        <div class="rl-topip">
          <span class="rl-topip-label">\u6700\u9AD8\u9891</span>
          <code class="rl-topip-ip">${e.topIP.ip}</code>
          <span class="rl-topip-count">${e.topIP.count} \u6B21</span>
        </div>
      `:`
        <div class="rl-topip rl-topip-empty">\u6682\u65E0\u6D41\u91CF</div>
      `}
    </div>
  `}async function Vr(e){rs=e,e.innerHTML=`
    <div class="rl-panel">
      <div class="rl-header">
        <h3 class="rl-title">\u{1F6A6} \u9650\u6D41\u72B6\u6001</h3>
        <div class="rl-controls">
          <button class="rl-refresh-btn" title="\u7ACB\u5373\u5237\u65B0">\u27F3</button>
          <span class="rl-status-dot" title="\u81EA\u52A8\u5237\u65B0\u4E2D"></span>
        </div>
      </div>
      <div class="rl-limiters" id="rl-limiters">
        <div class="rl-loading">\u52A0\u8F7D\u4E2D...</div>
      </div>
      <div class="rl-footer">
        <span class="rl-update-time" id="rl-update-time"></span>
      </div>
    </div>
  `;let t=e.querySelector(".rl-refresh-btn");t&&t.addEventListener("click",()=>{t.classList.add("spinning"),$t().finally(()=>{setTimeout(()=>t.classList.remove("spinning"),300)})}),await $t(),clearInterval(mt),mt=setInterval($t,Ua),pn&&pn();let s=Va().RightPanel;s&&s.on&&(pn=s.on("tab:switch",n=>{n!=="rate-limit"?(clearInterval(mt),mt=null):mt||(mt=setInterval($t,Ua),$t())}))}async function $t(){if(!rs)return;let e=await Fr();if(!e)return;let t=rs.querySelector("#rl-limiters"),s=rs.querySelector("#rl-update-time");if(!t)return;let n=e.limiters||[];if(n.length===0){t.innerHTML='<div class="rl-empty">\u6682\u65E0\u9650\u6D41\u5668\u6570\u636E</div>';return}let a=null;if(dn){a={};for(let i of n){let r=dn.find(c=>c.name===i.name);r&&(a[i.name]={totalRequests:i.totalRequests-r.totalRequests,blocked:i.blocked-r.blocked})}}dn=n;let o=[...n].sort((i,r)=>{let c=i.totalRequests>0?i.blocked/i.totalRequests:0;return(r.totalRequests>0?r.blocked/r.totalRequests:0)-c});t.innerHTML=o.map(i=>Qr(i,a?.[i.name])).join(""),s&&(s.textContent="\u66F4\u65B0: "+new Date(e.ts).toLocaleTimeString())}(function e(){let t=Va().UIRegistry;if(!t){console.warn("[RateLimitPanel] UIRegistry not available, will retry"),setTimeout(e,200);return}t.registerTab("rate-limit",{category:"plugin",icon:"\u{1F6A6}",label:"\u9650\u6D41",order:31,render:function(n){Vr(n)}})&&console.log("[RateLimitPanel] Registered rate-limit tab in right panel")})();(function(){let t="rl-panel-css";if(document.getElementById(t))return;let s=document.createElement("style");s.id=t,s.textContent=`
    .rl-panel {
      padding: 12px;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
    }
    .rl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color, #2a2a2e);
    }
    .rl-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
    }
    .rl-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .rl-refresh-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-secondary, #a1a1aa);
      padding: 2px 6px;
      border-radius: 4px;
      transition: transform 0.3s ease, color 0.2s;
    }
    .rl-refresh-btn:hover { color: var(--text-primary, #e4e4e7); background: rgba(255,255,255,0.05); }
    .rl-refresh-btn.spinning { animation: rl-spin 0.6s linear; }
    @keyframes rl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .rl-status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
      animation: rl-pulse 2s infinite;
    }
    @keyframes rl-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .rl-limiters {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .rl-loading, .rl-empty {
      color: var(--text-tertiary, #71717a);
      font-size: 13px;
      text-align: center;
      padding: 24px 0;
    }
    .rl-limiter-card {
      background: var(--bg-card, #18181b);
      border: 1px solid var(--border-color, #2a2a2e);
      border-radius: 8px;
      padding: 10px 12px;
      transition: border-color 0.3s;
    }
    .rl-limiter-card[data-severity="danger"] { border-color: #ef4444; }
    .rl-limiter-card[data-severity="warn"]   { border-color: #eab308; }
    .rl-limiter-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .rl-limiter-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      text-transform: capitalize;
    }
    .rl-limiter-budget {
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
      background: rgba(255,255,255,0.05);
      padding: 2px 8px;
      border-radius: 10px;
    }
    .rl-limiter-body {
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
    }
    .rl-metric {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .rl-metric-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary, #e4e4e7);
      font-variant-numeric: tabular-nums;
    }
    .rl-metric-blocked .rl-metric-value { color: #ef4444; }
    .rl-metric-label {
      font-size: 10px;
      color: var(--text-tertiary, #71717a);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .rl-delta {
      font-size: 10px;
      color: #22c55e;
      font-weight: 500;
    }
    .rl-delta-danger { color: #ef4444; }
    .rl-bar {
      height: 3px;
      background: rgba(255,255,255,0.06);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .rl-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #22d3ee);
      border-radius: 2px;
      transition: width 0.5s ease;
    }
    .rl-topip {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }
    .rl-topip-label {
      color: var(--text-tertiary, #71717a);
    }
    .rl-topip-ip {
      font-family: monospace;
      color: var(--text-secondary, #a1a1aa);
      background: rgba(255,255,255,0.04);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
    }
    .rl-topip-count {
      color: var(--text-tertiary, #71717a);
    }
    .rl-topip-empty {
      color: var(--text-tertiary, #71717a);
      font-style: italic;
    }
    .rl-footer {
      padding-top: 6px;
      border-top: 1px solid var(--border-color, #2a2a2e);
    }
    .rl-update-time {
      font-size: 10px;
      color: var(--text-tertiary, #71717a);
    }
    .text-danger { color: #ef4444 !important; }
  `,document.head.appendChild(s)})();var F=window.QCLI=window.QCLI||{},ae={MERMAID:"mermaid",DOT:"dot",GRAPHVIZ:"graphviz",PLANTUML:"plantuml"},Wr={[ae.MERMAID]:"Mermaid",[ae.DOT]:"Graphviz DOT",[ae.GRAPHVIZ]:"Graphviz",[ae.PLANTUML]:"PlantUML"},Gr={[ae.MERMAID]:"\u{1F4CA}",[ae.DOT]:"\u{1F500}",[ae.GRAPHVIZ]:"\u{1F500}",[ae.PLANTUML]:"\u{1F4D0}"},Wa={_initialized:!1,_theme:"dark",_pendingNodes:[],_renderTimer:null,_themeObserver:null,_graphvizLoaded:!1,_graphvizInstance:null,_plantumlLoaded:!1,_plantumlRender:null,init(e){if(this._initialized)return;let t=window.mermaid;if(!t){console.warn("[DiagramRenderer] Mermaid.js not loaded yet \u2014 will retry"),setTimeout(()=>this.init(e),500);return}this._theme=e||"dark",t.initialize({startOnLoad:!1,theme:this._theme==="dark"?"dark":"default",themeVariables:this._theme==="dark"?{background:"transparent",primaryColor:"#1e3a5f",primaryTextColor:"#e0e0e0",primaryBorderColor:"#3a6a9f",lineColor:"#5a8abf",secondaryColor:"#1a2a3a",tertiaryColor:"#15202b",fontSize:"14px"}:{background:"transparent",primaryColor:"#d4e8ff",primaryTextColor:"#333",primaryBorderColor:"#6a9acf",lineColor:"#4a7aaa",secondaryColor:"#e8f0f8",tertiaryColor:"#f0f4f8",fontSize:"14px"},fontFamily:"'Cascadia Code', 'Consolas', 'Courier New', 'Microsoft YaHei', '\u5FAE\u8F6F\u96C5\u9ED1', 'PingFang SC', 'SimSun', monospace"}),this._initialized=!0,console.log("[DiagramRenderer] Mermaid initialized, theme:",this._theme),this._watchTheme()},_watchTheme(){this._themeObserver||(this._themeObserver=new MutationObserver(()=>{let t=(document.documentElement.getAttribute("data-theme")||"dark")==="light"?"light":"dark";this.setTheme(t)}),this._themeObserver.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]}))},setTheme(e){if(e===this._theme&&this._initialized)return;this._theme=e,this._initialized=!1;let t=document.querySelectorAll('.mermaid-container, .diagram-container[data-type="mermaid"]');t.length>0&&(this.init(e),setTimeout(()=>{for(let s of t){let n=s.getAttribute("data-source");n&&this._renderMermaid(s,n)}},100))},renderAll(){this._scanDiagramSources(),this._scanMermaidElements()},_scanDiagramSources(){let e=document.querySelectorAll(".diagram-source:not([data-rendered])");if(e.length!==0)for(let t of e){let s=t.getAttribute("data-type")||ae.MERMAID,n=t.textContent.trim();if(!n){t.setAttribute("data-rendered","empty");continue}let a=document.createElement("div");a.className="diagram-container",a.setAttribute("data-source",n),a.setAttribute("data-type",s),t.parentNode.replaceChild(a,t),this.renderSingle(a,s,n)}},_scanMermaidElements(){let e=document.querySelectorAll(".mermaid:not([data-rendered])");if(e.length===0)return;if(!window.mermaid){for(let s of e)this._pendingNodes.push(s);this._renderTimer||(this._renderTimer=setInterval(()=>{window.mermaid&&(clearInterval(this._renderTimer),this._renderTimer=null,this.init(F._theme||this._theme),this._flushPending())},500),setTimeout(()=>{if(this._renderTimer){clearInterval(this._renderTimer),this._renderTimer=null;for(let s of this._pendingNodes)s.setAttribute("data-rendered","error"),s.innerHTML='<div class="mermaid-error">\u26A0\uFE0F Mermaid \u5E93\u52A0\u8F7D\u5931\u8D25\uFF0C\u65E0\u6CD5\u6E32\u67D3\u6D41\u7A0B\u56FE</div>';this._pendingNodes=[]}},3e4));return}this.init(F._theme||this._theme);for(let s of e){let n=s.textContent.trim();if(!n){s.setAttribute("data-rendered","empty");continue}let a=document.createElement("div");a.className="diagram-container mermaid-container",a.setAttribute("data-source",n),a.setAttribute("data-type","mermaid"),s.parentNode.replaceChild(a,s),this.renderSingle(a,"mermaid",n)}},_flushPending(){for(let e of this._pendingNodes){let t=e.getAttribute("data-source")||e.textContent.trim();if(t){let s=document.createElement("div");s.className="diagram-container mermaid-container",s.setAttribute("data-source",t),s.setAttribute("data-type","mermaid"),e.parentNode.replaceChild(s,e),this.renderSingle(s,"mermaid",t)}}this._pendingNodes=[]},async renderSingle(e,t,s){switch(t){case ae.MERMAID:await this._renderMermaid(e,s);break;case ae.DOT:case ae.GRAPHVIZ:await this._renderGraphviz(e,s);break;case ae.PLANTUML:await this._renderPlantUML(e,s);break;default:e.innerHTML=this._errorHTML(s,"\u4E0D\u652F\u6301\u7684\u56FE\u8868\u7C7B\u578B: "+this._escapeHtml(t)),e.setAttribute("data-rendered","error")}},getTypeInfo(e){let t=e?.toLowerCase()||"";return{icon:Gr[t]||"\u{1F4CA}",label:Wr[t]||"Diagram"}},async _renderMermaid(e,t){let s=window.mermaid;if(!s){e.innerHTML=this._errorHTML(t,"Mermaid \u5E93\u672A\u52A0\u8F7D"),e.setAttribute("data-rendered","error");return}this.init(F._theme||this._theme);let n="dia-mermaid-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);try{let a=await s.render(n,t);e.innerHTML=a.svg,e.setAttribute("data-rendered","done"),this._postRender(e)}catch(a){console.warn("[DiagramRenderer] Mermaid error:",a.message),e.innerHTML=this._errorHTML(t,"\u6D41\u7A0B\u56FE\u89E3\u6790\u5931\u8D25: "+this._escapeHtml(a.message)),e.setAttribute("data-rendered","error")}},async _ensureGraphviz(){if(this._graphvizLoaded)return;let e=window.hpccWasm;if(!e?.graphviz)return new Promise(t=>{let s=()=>{window.hpccWasm?.graphviz?t():setTimeout(s,300)};s()});try{this._graphvizInstance=await e.graphviz.load(),this._graphvizLoaded=!0,console.log("[DiagramRenderer] Graphviz engine loaded")}catch(t){throw console.error("[DiagramRenderer] Failed to load Graphviz:",t),new Error("Graphviz \u5F15\u64CE\u52A0\u8F7D\u5931\u8D25")}},async _renderGraphviz(e,t){try{await this._ensureGraphviz();let s=this._graphvizInstance.dot(t,"svg");e.innerHTML=s,e.setAttribute("data-rendered","done"),this._postRender(e)}catch(s){console.warn("[DiagramRenderer] Graphviz error:",s.message),e.innerHTML=this._errorHTML(t,"Graphviz \u6E32\u67D3\u5931\u8D25: "+this._escapeHtml(s.message)),e.setAttribute("data-rendered","error")}},async _ensurePlantUML(){if(!this._plantumlLoaded){await this._ensureGraphviz();try{let e=await import("https://cdn.jsdelivr.net/npm/@plantuml/core@1.2026.6/plantuml.js");this._plantumlRender=e.render,this._plantumlLoaded=!0,console.log("[DiagramRenderer] PlantUML engine loaded")}catch(e){throw console.error("[DiagramRenderer] Failed to load PlantUML:",e),new Error("PlantUML \u5F15\u64CE\u52A0\u8F7D\u5931\u8D25")}}},async _renderPlantUML(e,t){try{await this._ensurePlantUML();let s="puml-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),n=document.createElement("div");n.id=s,e.appendChild(n);let a=t.split(/\r\n|\r|\n/),o=document.documentElement.getAttribute("data-theme")!=="light";this._plantumlRender(a,s,{dark:o}),e.setAttribute("data-rendered","done"),this._postRender(e)}catch(s){console.warn("[DiagramRenderer] PlantUML error:",s.message),e.innerHTML=this._errorHTML(t,"PlantUML \u6E32\u67D3\u5931\u8D25: "+this._escapeHtml(s.message)),e.setAttribute("data-rendered","error")}},_postRender(e){let t=e.querySelector("svg");t&&(t.style.maxWidth="100%",t.style.height="auto",t.style.cursor="zoom-in",t.addEventListener("click",()=>{t.classList.contains("diagram-zoomed")?(t.classList.remove("diagram-zoomed"),t.style.maxWidth="100%",t.style.cursor="zoom-in"):(t.classList.add("diagram-zoomed"),t.style.maxWidth="none",t.style.width="auto",t.style.cursor="zoom-out",e.scrollIntoView({behavior:"smooth",block:"center"}))}),this._addToolbar(e))},_addToolbar(e){let t=e.querySelector("svg");if(!t)return;let s=document.createElement("div");s.className="diagram-export-bar";let n=document.createElement("button");n.className="de-btn de-btn-copy",n.title="\u590D\u5236 SVG \u5230\u526A\u8D34\u677F",n.textContent="\u{1F4CB}",n.addEventListener("click",i=>{i.stopPropagation(),this.copySVG(t,n)}),s.appendChild(n);let a=document.createElement("button");a.className="de-btn de-btn-svg",a.title="\u5BFC\u51FA\u4E3A SVG",a.textContent="\u2B07 SVG",a.addEventListener("click",i=>{i.stopPropagation(),this.exportSVG(e)}),s.appendChild(a);let o=document.createElement("button");o.className="de-btn de-btn-png",o.title="\u5BFC\u51FA\u4E3A PNG\uFF082x \u9AD8\u6E05\uFF09",o.textContent="\u2B07 PNG",o.addEventListener("click",i=>{i.stopPropagation(),this.exportPNG(e)}),s.appendChild(o),e.appendChild(s)},copySVG(e,t){let n=new XMLSerializer().serializeToString(e);navigator.clipboard.writeText(n).then(()=>{F.showToast&&F.showToast("\u2705 SVG \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F","success"),t&&(t.textContent="\u2705",setTimeout(()=>{t.textContent="\u{1F4CB}"},1500))}).catch(()=>{let a=document.createElement("textarea");a.value=n,a.style.cssText="position:fixed;opacity:0;",document.body.appendChild(a),a.select(),document.execCommand("copy"),document.body.removeChild(a),F.showToast&&F.showToast("\u2705 SVG \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F","success"),t&&(t.textContent="\u2705",setTimeout(()=>{t.textContent="\u{1F4CB}"},1500))})},exportSVG(e,t="diagram"){let s=e?.querySelector("svg");if(!s){F.showToast&&F.showToast("\u26A0\uFE0F \u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u56FE\u8868","error");return}let a=new XMLSerializer().serializeToString(s),o=new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="no"?>
`,a],{type:"image/svg+xml;charset=utf-8"}),i=URL.createObjectURL(o),r=document.createElement("a");r.href=i,r.download=t+".svg",document.body.appendChild(r),r.click(),document.body.removeChild(r),setTimeout(()=>URL.revokeObjectURL(i),5e3),F.showToast&&F.showToast("\u2705 \u5DF2\u5BFC\u51FA "+t+".svg","success")},exportPNG(e,t="diagram",s=2){let n=e?.querySelector("svg");if(!n){F.showToast&&F.showToast("\u26A0\uFE0F \u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u56FE\u8868","error");return}F.showToast?.("\u23F3 \u6B63\u5728\u751F\u6210 PNG...","info");let a=n.getBBox?n.getBBox():null,o=parseFloat(n.getAttribute("width")||a?.width||n.clientWidth)||800,i=parseFloat(n.getAttribute("height")||a?.height||n.clientHeight)||600,c=new XMLSerializer().serializeToString(n);c.includes("viewBox=")||(c=c.replace("<svg",'<svg viewBox="0 0 '+o+" "+i+'"'));let l=document.createElement("canvas");l.width=o*s,l.height=i*s;let d=l.getContext("2d"),p=document.documentElement.getAttribute("data-theme")==="dark";d.fillStyle=p?"#1a1b1e":"#ffffff",d.fillRect(0,0,l.width,l.height),d.scale(s,s);let u=new Image,f=new Blob([c],{type:"image/svg+xml;charset=utf-8"}),m=URL.createObjectURL(f);u.onload=()=>{d.drawImage(u,0,0),URL.revokeObjectURL(m),l.toBlob(g=>{if(!g){F.showToast&&F.showToast("\u26A0\uFE0F PNG \u751F\u6210\u5931\u8D25","error");return}let b=URL.createObjectURL(g),x=document.createElement("a");x.href=b,x.download=t+".png",document.body.appendChild(x),x.click(),document.body.removeChild(x),setTimeout(()=>URL.revokeObjectURL(b),5e3),F.showToast&&F.showToast("\u2705 \u5DF2\u5BFC\u51FA "+t+".png ("+(g.size/1024).toFixed(1)+"KB)","success")},"image/png")},u.onerror=()=>{URL.revokeObjectURL(m),F.showToast&&F.showToast("\u26A0\uFE0F PNG \u5BFC\u51FA\u5931\u8D25\uFF1ASVG \u6E32\u67D3\u5F02\u5E38","error")},u.src=m},findContainer(e){return e?.closest(".mermaid-container, .diagram-container")},_errorHTML(e,t){return'<div class="diagram-error"><span class="diagram-error-icon">\u26A0\uFE0F</span><span class="diagram-error-text">'+this._escapeHtml(t)+'</span><details class="diagram-error-details"><summary>\u67E5\u770B\u539F\u6587</summary><pre><code>'+this._escapeHtml(e)+"</code></pre></details></div>"},_escapeHtml(e){let t={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};return e.replace(/[&<>"']/g,s=>t[s])}};F.DiagramRenderer=Wa;F.MermaidRenderer=Wa;var he=window.QCLI=window.QCLI||{},G={stats:{totalToolCalls:0,totalTokens:0,estimatedCostUSD:0,humanHoursSaved:0,wbCalls:0,wbDuration:0,wbHumanHoursSaved:0}};function Jr(e){if(!e)return;e.tokenIn&&(G.stats.totalTokens+=e.tokenIn),e.tokenOut&&(G.stats.totalTokens+=e.tokenOut),(e.ev==="tool_call"||e.ev==="resource_read")&&G.stats.totalToolCalls++;let t=e.tokenIn||0,s=e.tokenOut||0;G.stats.estimatedCostUSD+=t/1e6*.15+s/1e6*.6,G.stats.humanHoursSaved=Math.round(G.stats.totalToolCalls*5/60*10)/10,(e.tool==="workbuddy"||e.type==="wb:usage")&&(G.stats.wbCalls++,G.stats.wbDuration+=e.durMs||e.duration||0,G.stats.wbHumanHoursSaved=Math.round(G.stats.wbCalls*15/60*10)/10),cs()}function Kr(){let e=45.45454545454545,t=G.stats.humanHoursSaved,s=t*e,n=G.stats.estimatedCostUSD*7.3;return{hoursSaved:Math.round(t*10)/10,laborCostSaved:Math.round(s*100)/100,aiCost:Math.round(n*100)/100,netSavings:Math.round((s-n)*100)/100,roi:n>0?Math.round(s/n*100)/100:0}}function Yr(e){return e>=1e6?(e/1e6).toFixed(1)+"M":e>=1e3?(e/1e3).toFixed(1)+"K":e.toString()}function cs(){let e=document.getElementById("rp-opc-dashboard");if(!e)return;let{totalToolCalls:t,totalTokens:s,estimatedCostUSD:n,humanHoursSaved:a,wbCalls:o,wbDuration:i,wbHumanHoursSaved:r}=G.stats,c=Kr();e.innerHTML=['<div style="padding:16px;">','<div style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text-primary);">\u{1F3E2} OPC \u6548\u76CA\u76D1\u63A7</div>','<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">','<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">','<div style="font-size:22px;font-weight:700;color:#3b82f6;">',String(t),"</div>",'<div style="font-size:11px;color:var(--text-tertiary);">AI \u5DE5\u5177\u8C03\u7528</div></div>','<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">','<div style="font-size:22px;font-weight:700;color:#8b5cf6;">',Yr(s),"</div>",'<div style="font-size:11px;color:var(--text-tertiary);">Token \u6D88\u8017</div></div>','<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">','<div style="font-size:22px;font-weight:700;color:#22c55e;">\xA5',c.aiCost.toFixed(2),"</div>",'<div style="font-size:11px;color:var(--text-tertiary);">AI \u603B\u6210\u672C</div></div>','<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">','<div style="font-size:22px;font-weight:700;color:#f59e0b;">',String(a),"h</div>",'<div style="font-size:11px;color:var(--text-tertiary);">\u7B49\u6548\u8282\u7701\u5DE5\u65F6</div></div>',"</div>",'<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;border-left:3px solid #8b5cf6;margin-bottom:16px;">','<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">','<div><div style="font-size:20px;font-weight:700;color:#8b5cf6;">',String(o),"</div>",'<div style="font-size:10px;color:var(--text-tertiary);">\u{1F916} WorkBuddy \u8C03\u7528</div></div>','<div><div style="font-size:20px;font-weight:700;color:#8b5cf6;">',String(r),"h</div>",'<div style="font-size:10px;color:var(--text-tertiary);">\u7B49\u6548\u8282\u7701\u5DE5\u65F6</div></div>',o>0?'<div style="grid-column:span 2;"><div style="font-size:11px;color:var(--text-tertiary);">\u5E73\u5747\u8017\u65F6: '+(i/o).toFixed(0)+"ms</div></div>":"","</div></div>",'<details class="collapsible-block"><summary>\u{1F4B0} \u6295\u5165\u4EA7\u51FA\u5206\u6790</summary>','<div style="background:var(--bg-card);padding:12px;border-radius:8px;">','<div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-primary);">\u{1F4B0} \u6295\u5165\u4EA7\u51FA\u5206\u6790</div>','<table style="width:100%;font-size:12px;border-collapse:collapse;">','<tr><td style="padding:4px 0;color:var(--text-tertiary);">\u8282\u7701\u4EBA\u529B\u6210\u672C\uFF1A</td>','<td style="padding:4px 0;text-align:right;color:#22c55e;font-weight:500;">\xA5',c.laborCostSaved.toFixed(2),"</td></tr>",'<tr><td style="padding:4px 0;color:var(--text-tertiary);">AI \u4F7F\u7528\u6210\u672C\uFF1A</td>','<td style="padding:4px 0;text-align:right;color:#ef4444;font-weight:500;">\xA5',c.aiCost.toFixed(2),"</td></tr>",'<tr style="border-top:1px solid var(--border-color);"><td style="padding:6px 0 4px;color:var(--text-primary);font-weight:500;">\u51C0\u8282\u7701\uFF1A</td>','<td style="padding:6px 0 4px;text-align:right;font-weight:600;color:',c.netSavings>=0?"#22c55e":"#ef4444",';">\xA5',c.netSavings.toFixed(2),"</td></tr>",'<tr><td style="padding:4px 0;color:var(--text-tertiary);">ROI\uFF08\u6295\u5165\u4EA7\u51FA\u6BD4\uFF09\uFF1A</td>','<td style="padding:4px 0;text-align:right;font-weight:500;color:',c.roi>=1?"#22c55e":"#f59e0b",';">',c.roi.toFixed(2),"x</td></tr>","</table></div></details>",'<details class="collapsible-block"><summary>\u{1F4CA} \u884C\u4E1A\u5BF9\u6807</summary>','<div style="background:var(--bg-card);padding:12px;border-radius:8px;">','<div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-primary);">\u{1F4CA} \u884C\u4E1A\u5BF9\u6807\uFF08\u817E\u8BAF\u4E91\u516C\u5F00\u8BFE\u6570\u636E\uFF09</div>','<div style="font-size:11px;color:var(--text-tertiary);line-height:1.8;">',"\u2022 100\u5F20\u56FE\u6E32\u67D3 AI\u7B97\u529B\u4EC5 <strong>\xA50.4</strong><br>","\u2022 3D Max\u8BBE\u8BA1 \u4ECE2\u5929 \u2192 <strong>15\u5206\u949F</strong><br>","\u2022 \u4EBA\u6548\u6BD4 3-5\u4EBA\u66FF\u4EE3\u4F20\u7EDF <strong>100-150\u4EBA</strong><br>","\u2022 \u83B7\u5BA2\u6210\u672C\u4EC5\u4E3A\u4F20\u7EDF\u6A21\u5F0F <strong>1/10</strong>","</div></div></details>",'<div style="margin-bottom:16px;">','<div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-primary);">\u{1F680} OPC \u5FEB\u6377\u542F\u52A8</div>','<div style="display:flex;flex-direction:column;gap:6px;">',`<button class="opc-quick-btn" data-wf="opc-new-media" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-card)'">\u{1F4F1} \u65B0\u5A92\u4F53\u83B7\u5BA2\u5DE5\u4F5C\u6D41</button>`,`<button class="opc-quick-btn" data-wf="opc-sales-report" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-card)'">\u{1F4CA} \u9500\u552E\u6570\u636E\u6C47\u603B\u5DE5\u4F5C\u6D41</button>`,`<button class="opc-quick-btn" data-wf="opc-competitor-monitor" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-card)'">\u{1F50D} \u7ADE\u54C1\u81EA\u52A8\u76D1\u63A7\u5DE5\u4F5C\u6D41</button>`,`<button class="opc-quick-btn" data-wf="opc-de-team" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-card)'">\u{1F465} \u6570\u5B57\u5458\u5DE5\u56E2\u961F\u534F\u4F5C</button>`,`<button class="opc-quick-btn" data-wf="workbuddy-enhanced" style="padding:10px 14px;border-radius:8px;border:1px solid #8b5cf6;background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background='rgba(139,92,246,0.1)'" onmouseout="this.style.background='var(--bg-card)'">\u{1F916} WorkBuddy \u589E\u5F3A\u5DE5\u4F5C\u6D41</button>`,`<button class="opc-quick-btn" data-wf="workbuddy-batch" style="padding:10px 14px;border-radius:8px;border:1px solid #8b5cf6;background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background='rgba(139,92,246,0.1)'" onmouseout="this.style.background='var(--bg-card)'">\u{1F4CB} WorkBuddy \u6279\u91CF\u5904\u7406</button>`,"</div></div>",`<button id="opc-reset-btn" style="padding:8px 14px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:11px;transition:all 0.15s;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-tertiary)'">\u{1F504} \u91CD\u7F6E\u7EDF\u8BA1\u6570\u636E</button>`,"</div>"].join(""),e.querySelectorAll(".opc-quick-btn").forEach(function(d){d.addEventListener("click",function(){let p=this.dataset.wf,u=he.Workflows&&he.Workflows.workflows&&he.Workflows.workflows.list?he.Workflows.workflows.list.find(function(f){return f.id===p}):null;u?he.Workflows.handleWorkflowClick&&he.Workflows.handleWorkflowClick(u):fetch("/api/workflows").then(function(f){return f.json()}).then(function(f){let m=f.workflows?f.workflows.find(function(g){return g.id===p}):null;m&&he.Workflows&&he.Workflows.handleWorkflowClick&&he.Workflows.handleWorkflowClick(m)}).catch(function(f){console.warn("[OPCDashboard] Failed to fetch workflow:",f)})})});let l=e.querySelector("#opc-reset-btn");l&&l.addEventListener("click",function(){G.stats={totalToolCalls:0,totalTokens:0,estimatedCostUSD:0,humanHoursSaved:0,wbCalls:0,wbDuration:0,wbHumanHoursSaved:0},cs()})}function Ga(){let e=he.UIRegistry;e&&e.registerTab("opc-dashboard",{icon:"\u{1F3E2}",label:"OPC\u6548\u76CA",order:4,category:"digital",render:function(s){s.innerHTML='<div id="rp-opc-dashboard"></div>',cs()}})&&console.log("[OPCDashboard] Tab registered in right panel"),he.OPCDashboard=G,G.recordMetric=Jr,G.updateDashboard=cs}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Ga):Ga();var ge=window.QCLI=window.QCLI||{};function ht(e,t){try{return getComputedStyle(document.documentElement).getPropertyValue(e).trim()||t}catch{return t}}function Xr(e,t){let s=e.replace("#",""),n=parseInt(s.substring(0,2),16),a=parseInt(s.substring(2,4),16),o=parseInt(s.substring(4,6),16);return{r:n,g:a,b:o,a:t}}function B(e){if(!e||!e.canvas){console.error("[ChartCore] Missing canvas element");return}this.canvas=e.canvas,this.ctx=this.canvas.getContext("2d"),this.type=e.type||"line",this.data=e.data||{labels:[],datasets:[]},this.options=Object.assign({},B.defaultOptions,e.options),this._dpr=window.devicePixelRatio||1,this._width=0,this._height=0,this._padding=null,this._chartArea=null,this._tooltip=null,this._animationId=null,this._animationProgress=0,this._destroyed=!1,this._boundResize=this._handleResize.bind(this),this._boundMouseMove=this._onMouseMove.bind(this),this._boundMouseLeave=this._onMouseLeave.bind(this),this._setupCanvas(),this._createTooltip(),this._bindEvents(),this._animationProgress=0,this._animateIn()}B.defaultOptions={animate:!0,animationDuration:600,showGrid:!0,showAxis:!0,showLegend:!1,showTooltip:!0,showDots:!0,fillOpacity:.15,gridColor:null,axisColor:null,textColor:null,fontFamily:null,fontSize:10,lineWidth:1.5,barPadding:.2,barRadius:2,dotRadius:2.5,yAxisTicks:5,yAxisFormat:null,xAxisLabelRotation:0,maintainAspectRatio:!1,colors:null};B.prototype._setupCanvas=function(){let e=this.canvas.getBoundingClientRect();this._width=e.width,this._height=e.height,this.canvas.width=e.width*this._dpr,this.canvas.height=e.height*this._dpr,this.ctx.scale(this._dpr,this._dpr)};B.prototype._resolveThemeColors=function(){let e=this.options;return this._cachedTheme&&!this._themeDirty?this._cachedTheme:(this._cachedTheme={grid:e.gridColor||ht("--border-subtle","rgba(255,255,255,0.06)"),axis:e.axisColor||ht("--border-default","rgba(255,255,255,0.1)"),text:e.textColor||ht("--text-tertiary","#71717a"),font:e.fontFamily||ht("--font-mono","'JetBrains Mono', monospace")},this._themeDirty=!1,this._cachedTheme)};B.prototype.invalidateTheme=function(){this._themeDirty=!0};B.prototype._computePadding=function(){let e=this.options,t=this._resolveThemeColors(),s=this.ctx,n=this._width,a=this._height,o=0;if(e.showAxis){let d=[],p=[],u=[];this.data.datasets.forEach(b=>{b.hidden||(b.data&&d.push(...b.data),b.ohlc&&b.ohlc.forEach(x=>{p.push(x.low),u.push(x.high)}))});let f,m;p.length>0&&u.length>0&&d.length===0?(f=Math.min(...p),m=Math.max(...u)):d.length>0?(f=Math.min(...d),m=Math.max(...d)):(f=0,m=100);let g=m-f||1;for(let b=0;b<=e.yAxisTicks;b++){let x=f+g*b/e.yAxisTicks,v=e.yAxisFormat?e.yAxisFormat(x):this._formatValue(x);s.font=`${e.fontSize}px ${t.font}`;let w=s.measureText(v);w.width>o&&(o=w.width)}}let i=8+(e.showAxis?o+8:0),r=8,c=8,l=8+(e.showAxis?e.fontSize+6:0);this._padding={top:c,bottom:l,left:i,right:r},this._chartArea={x:i,y:c,w:Math.max(10,n-i-r),h:Math.max(10,a-c-l)}};B.prototype._mapDataToPixels=function(){let e=this._chartArea;if(!e||e.w<=0||e.h<=0)return null;let t=[],s=[],n=[];this.data.datasets.forEach(c=>{c.hidden||(c.data&&t.push(...c.data),c.ohlc&&c.ohlc.forEach(l=>{s.push(l.low),n.push(l.high)}))});let a,o,i;if(s.length>0&&n.length>0&&t.length===0)a=Math.min(...s),o=Math.max(...n);else if(t.length>0)a=Math.min(...t),o=Math.max(...t);else return null;i=o-a||1;let r=this.data.labels.length||1;return{min:a,max:o,range:i,count:r}};B.prototype._xToPixel=function(e){let t=this._chartArea;if(!t||t.w<=0)return t.x;let s=this.data.labels.length||1,n=s>1?t.w/(s-1):t.w/2;return this.type==="bar"||this.type==="candlestick"?t.x+(e+.5)*(t.w/s):t.x+e*n};B.prototype._yToPixel=function(e,t){let s=this._chartArea;if(!s)return s.y;let{min:n,range:a}=t;return s.y+s.h-(e-n)/a*s.h};B.prototype.render=function(){if(this._destroyed)return;let e=this.ctx,t=this._width,s=this._height;if(t<=0||s<=0)return;e.clearRect(0,0,t,s),this._computePadding();let n=this._mapDataToPixels();if(!n)return;let a=this._resolveThemeColors(),o=this._animationProgress;this.options.showGrid&&this._drawGrid(n,a),this.options.showAxis&&this._drawAxes(n,a),this.data.datasets.forEach((i,r)=>{if(i.hidden)return;let c=i.color||(this.options.colors?this.options.colors[r%this.options.colors.length]:null)||this._getDefaultColor(r),l=i.fillColor||c;switch(this.type){case"line":case"area":this._drawLineOrArea(i,n,c,l,o,a);break;case"bar":this._drawBars(i,n,c,o,a);break;case"candlestick":this._drawCandlesticks(i,n,a);break}})};B.prototype._drawGrid=function(e,t){let s=this.ctx,n=this._chartArea,{min:a,range:o}=e;s.save(),s.strokeStyle=t.grid,s.lineWidth=.5;for(let i=0;i<=this.options.yAxisTicks;i++){let r=a+o*i/this.options.yAxisTicks,c=this._yToPixel(r,e);s.beginPath(),s.moveTo(n.x,c),s.lineTo(n.x+n.w,c),s.stroke()}s.restore()};B.prototype._drawAxes=function(e,t){let s=this.ctx,n=this._chartArea,{min:a,range:o,count:i}=e,r=this.options;s.save(),s.fillStyle=t.text,s.font=`${r.fontSize}px ${t.font}`,s.textAlign="right",s.textBaseline="middle";for(let p=0;p<=r.yAxisTicks;p++){let u=a+o*p/r.yAxisTicks,f=this._yToPixel(u,e),m=r.yAxisFormat?r.yAxisFormat(u):this._formatValue(u);s.fillText(m,n.x-6,f)}s.textAlign="center",s.textBaseline="top";let c=this.data.labels,l=Math.max(1,Math.floor(n.w/30)),d=Math.max(1,Math.ceil(i/l));for(let p=0;p<i;p+=d){let u=this._xToPixel(p);s.fillText(c[p]||"",u,n.y+n.h+4)}s.strokeStyle=t.axis,s.lineWidth=.5,s.beginPath(),s.moveTo(n.x,n.y+n.h),s.lineTo(n.x+n.w,n.y+n.h),s.stroke(),s.restore()};B.prototype._drawLineOrArea=function(e,t,s,n,a,o){let i=this.ctx,r=this._chartArea,c=e.data||[],l=c.length,d=this.options;if(l===0)return;let p=s,u=n||s,f=Math.max(1,Math.floor(l*a));if(i.save(),i.beginPath(),i.rect(r.x,r.y,r.w,r.h),i.clip(),this.type==="area"){i.beginPath(),i.moveTo(this._xToPixel(0),r.y+r.h);for(let b=0;b<f;b++){let x=this._xToPixel(b),v=this._yToPixel(c[b],t);i.lineTo(x,v)}i.lineTo(this._xToPixel(f-1),r.y+r.h),i.closePath();let m=Xr(u,d.fillOpacity),g=i.createLinearGradient(0,r.y,0,r.y+r.h);g.addColorStop(0,`rgba(${m.r},${m.g},${m.b},${m.a})`),g.addColorStop(1,`rgba(${m.r},${m.g},${m.b},0)`),i.fillStyle=g,i.fill()}i.beginPath(),i.strokeStyle=p,i.lineWidth=d.lineWidth,i.lineJoin="round",i.lineCap="round";for(let m=0;m<f;m++){let g=this._xToPixel(m),b=this._yToPixel(c[m],t);m===0?i.moveTo(g,b):i.lineTo(g,b)}if(i.stroke(),d.showDots&&f<=60){let m=Math.max(1,Math.floor(l/40));for(let g=0;g<f;g+=m){let b=this._xToPixel(g),x=this._yToPixel(c[g],t);i.beginPath(),i.arc(b,x,d.dotRadius,0,Math.PI*2),i.fillStyle=p,i.fill(),i.strokeStyle=ht("--bg-surface","#121214"),i.lineWidth=1.5,i.stroke()}}i.restore()};B.prototype._drawBars=function(e,t,s,n,a){let o=this.ctx,i=this._chartArea,r=e.data||[],c=r.length,l=this.options;if(c===0)return;let d=i.w/c*(1-l.barPadding),p=Math.max(1,Math.floor(c*n)),u=i.y+i.h;o.save(),o.beginPath(),o.rect(i.x,i.y,i.w,i.h),o.clip();for(let f=0;f<p;f++){let m=this._xToPixel(f)-d/2,g=this._yToPixel(r[f],t),x=Math.max(1,u-g)*n;if(o.fillStyle=s,l.barRadius>0){let v=Math.min(l.barRadius,x/2,d/2);o.beginPath(),o.moveTo(m+v,u),o.lineTo(m+v,u-x+v),o.quadraticCurveTo(m+v,u-x,m+v*2,u-x),o.lineTo(m+d-v*2,u-x),o.quadraticCurveTo(m+d-v,u-x,m+d-v,u-x+v),o.lineTo(m+d-v,u),o.closePath(),o.fill()}else o.fillRect(m,u-x,d,x)}o.restore()};B.prototype._drawCandlesticks=function(e,t,s){let n=this.ctx,a=this._chartArea,o=e.ohlc||[],i=o.length,r=this.options;if(i===0)return;let c=Math.max(1,a.w/i*.6),l=Math.max(1,c*.15),d=e.upColor||"#22c55e",p=e.downColor||"#ef4444";n.save(),n.beginPath(),n.rect(a.x,a.y,a.w,a.h),n.clip();for(let u=0;u<i;u++){let f=o[u];if(!f||f.open==null||f.close==null)continue;let{open:m,high:g,low:b,close:x}=f,v=x>=m,w=this._xToPixel(u),T=this._yToPixel(m,t),H=this._yToPixel(x,t),q=this._yToPixel(g,t),Q=this._yToPixel(b,t),ce=Math.min(T,H),J=Math.max(T,H),Ot=Math.max(1,J-ce),jt=Math.max(1,l/2),Ne=c/2,et=v?d:p;n.beginPath(),n.strokeStyle=et,n.lineWidth=l,n.lineCap="round",n.moveTo(w,q),n.lineTo(w,Q),n.stroke(),n.fillStyle=et,n.globalAlpha=.8,n.fillRect(w-Ne,ce,c,Ot),n.globalAlpha=1}n.restore()};B.prototype._createTooltip=function(){this.options.showTooltip&&(this._tooltip=document.createElement("div"),this._tooltip.className="chart-tooltip",this._tooltip.innerHTML='<div class="chart-tooltip-title"></div><div class="chart-tooltip-body"></div>',this.canvas.parentNode.appendChild(this._tooltip))};B.prototype._bindEvents=function(){this.options.showTooltip&&(this.canvas.addEventListener("mousemove",this._boundMouseMove),this.canvas.addEventListener("mouseleave",this._boundMouseLeave)),window.addEventListener("resize",this._boundResize)};B.prototype._unbindEvents=function(){this.canvas&&(this.canvas.removeEventListener("mousemove",this._boundMouseMove),this.canvas.removeEventListener("mouseleave",this._boundMouseLeave)),window.removeEventListener("resize",this._boundResize)};B.prototype._onMouseMove=function(e){if(!this._tooltip||this._destroyed)return;let t=this.canvas.getBoundingClientRect(),s=e.clientX-t.left,n=e.clientY-t.top,a=this._chartArea;if(!a||s<a.x||s>a.x+a.w||n<a.y||n>a.y+a.h){this._tooltip.classList.remove("visible");return}let o=this.data.labels.length;if(o===0)return;let i=0,r=1/0;for(let g=0;g<o;g++){let b=this._xToPixel(g),x=Math.abs(s-b);x<r&&(r=x,i=g)}if(r>30){this._tooltip.classList.remove("visible");return}let c=this.data.labels[i]||"",l=this._tooltip.querySelector(".chart-tooltip-title");l&&(l.textContent=c);let d=this._tooltip.querySelector(".chart-tooltip-body");d&&(d.innerHTML=this.data.datasets.map((g,b)=>{if(g.hidden)return"";let x=g.data&&g.data[i]!==void 0?g.data[i]:"\u2014";return`<div class="chart-tooltip-row">
        <span class="chart-tooltip-dot" style="background:${g.color||this._getDefaultColor(b)}"></span>
        <span>${g.label||""}:</span>
        <span class="chart-tooltip-value">${this._formatValue(x)}</span>
      </div>`}).join(""));let p=s+12,u=n-10,f=this._tooltip.offsetWidth||120,m=this._tooltip.offsetHeight||60;p+f>this._width-8&&(p=s-f-12),u+m>this._height-8&&(u=this._height-m-8),u<8&&(u=8),this._tooltip.style.left=p+"px",this._tooltip.style.top=u+"px",this._tooltip.classList.add("visible")};B.prototype._onMouseLeave=function(){this._tooltip&&this._tooltip.classList.remove("visible")};B.prototype._animateIn=function(){if(!this.options.animate){this._animationProgress=1,this.render();return}let e=this.options.animationDuration,t=performance.now(),s=n=>{if(this._destroyed)return;let a=n-t;this._animationProgress=Math.min(1,a/e),this._animationProgress=1-Math.pow(1-this._animationProgress,3),this.render(),this._animationProgress<1&&(this._animationId=requestAnimationFrame(s))};this._animationId=requestAnimationFrame(s)};B.prototype._handleResize=function(){this._destroyed||(this._resizeTimer&&clearTimeout(this._resizeTimer),this._resizeTimer=setTimeout(()=>{this.resize()},150))};B.prototype.resize=function(){this._destroyed||(this._setupCanvas(),this._animationProgress=1,this.render())};B.prototype.setData=function(e){this.data=e,this._animationProgress=0,this._animateIn()};B.prototype.setType=function(e){this.type=e,this._animationProgress=0,this._animateIn()};B.prototype.setOptions=function(e){Object.assign(this.options,e),this.render()};B.prototype.toggleDataset=function(e){this.data.datasets[e]&&(this.data.datasets[e].hidden=!this.data.datasets[e].hidden,this.render())};B.prototype.destroy=function(){this._destroyed=!0,this._animationId&&cancelAnimationFrame(this._animationId),this._resizeTimer&&clearTimeout(this._resizeTimer),this._unbindEvents(),this._tooltip&&this._tooltip.parentNode&&this._tooltip.parentNode.removeChild(this._tooltip)};B.prototype._getDefaultColor=function(e){let t=["#6366f1","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#ec4899","#14b8a6"];return t[e%t.length]};B.prototype._formatValue=function(e){return e==null?"\u2014":typeof e=="number"?Math.abs(e)>=1e6?(e/1e6).toFixed(1)+"M":Math.abs(e)>=1e3?(e/1e3).toFixed(1)+"K":e.toFixed(2):String(e)};ge.ChartCore=ge.ChartCore||{};ge.ChartCore.parseHexToRgba=function(t,s){if(!t)return null;let n=t.trim();if(n.startsWith("#")){let a=n.replace("#",""),o=parseInt(a.substring(0,2),16),i=parseInt(a.substring(2,4),16),r=parseInt(a.substring(4,6),16);if(!isNaN(o)&&!isNaN(i)&&!isNaN(r))return"rgba("+o+","+i+","+r+","+s+")"}return null};ge.ChartCore.drawMiniTrend=function(t,s,n,a,o){if(!t)return;let i=t.getContext("2d"),r=t.width,c=t.height;if(i.clearRect(0,0,r,c),s.length<2){i.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--text-tertiary").trim()||"#71717a",i.font="9px monospace",i.textAlign="center",i.fillText(a||"\u7B49\u5F85\u6570\u636E...",r/2,c/2+3);return}let l=s.map(function(le){return le.v}),d=Math.min.apply(null,l),p=Math.max.apply(null,l),u=p-d,f=u===0?p*.5||10:u*.15;d=Math.max(0,d-f),p=p+f;let m=p-d,g=Date.now(),b=Math.min(6e4,s[s.length-1].t-s[0].t+1e3),x=g-b,v=s.filter(function(le){return le.t>=x});if(v.length<2){i.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--text-tertiary").trim()||"#71717a",i.font="9px monospace",i.textAlign="center",i.fillText("\u7B49\u5F85\u6570\u636E...",r/2,c/2+3);return}let w=2,T=2,H=r-w*2,q=c-T*2;function Q(le){return w+(le-x)/b*H}function ce(le){return T+(1-(le-d)/m)*q}i.beginPath(),i.moveTo(Q(v[0].t),q+T);for(var J=0;J<v.length;J++)i.lineTo(Q(v[J].t),ce(v[J].v));i.lineTo(Q(v[v.length-1].t),q+T),i.closePath();let Ot=ge.ChartCore.parseHexToRgba(n,.2),jt=ge.ChartCore.parseHexToRgba(n,.02),Ne=i.createLinearGradient(0,T,0,q+T);Ne.addColorStop(0,Ot||n+"33"),Ne.addColorStop(1,jt||n+"05"),i.fillStyle=Ne,i.fill(),i.beginPath(),i.strokeStyle=n,i.lineWidth=1.2,i.lineJoin="round",i.lineCap="round";for(var J=0;J<v.length;J++){let On=Q(v[J].t),jn=ce(v[J].v);J===0?i.moveTo(On,jn):i.lineTo(On,jn)}i.stroke();let et=v[v.length-1];i.beginPath(),i.arc(Q(et.t),ce(et.v),2.5,0,Math.PI*2),i.fillStyle=n,i.fill(),i.fillStyle=n,i.font="bold 8px monospace",i.textAlign="right",i.textBaseline="top",i.fillText(et.v.toFixed(1)+" "+(o||""),r-w,T),i.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--text-tertiary").trim()||"#71717a",i.font="7px monospace",i.textAlign="left",i.textBaseline="bottom",i.fillText(Math.min.apply(null,v.map(function(le){return le.v})).toFixed(1),w+1,q+T-1),i.textAlign="right",i.fillText(Math.max.apply(null,v.map(function(le){return le.v})).toFixed(1),r-w,T+9)};ge.ChartCore.drawSparkLine=function(t,s,n){if(!t||s.length<2)return;let a=t.getContext("2d"),o=t.width,i=t.height;a.clearRect(0,0,o,i);let r=s.map(function(q){return q.v}),c=Math.min.apply(null,r),l=Math.max.apply(null,r),d=l-c;d===0&&(d=l*.5||10,c=Math.max(0,c-d*.5),l=l+d*.5);let p=d,u=1,f=1,m=o-u*2,g=i-f*2;function b(q){return f+(1-(q-c)/p)*g}let x=s.slice(-30);if(x.length<2)return;let v=m/(x.length-1),w=ge.ChartCore.parseHexToRgba(n,.15);if(w){a.beginPath(),a.moveTo(u,g+f);for(var T=0;T<x.length;T++)a.lineTo(u+T*v,b(x[T].v));a.lineTo(u+(x.length-1)*v,g+f),a.closePath(),a.fillStyle=w,a.fill()}a.beginPath(),a.strokeStyle=n,a.lineWidth=1;for(var T=0;T<x.length;T++){let Q=u+T*v,ce=b(x[T].v);T===0?a.moveTo(Q,ce):a.lineTo(Q,ce)}a.stroke();let H=x[x.length-1];a.beginPath(),a.arc(u+(x.length-1)*v,b(H.v),1.5,0,Math.PI*2),a.fillStyle=n,a.fill()};ge.ChartCore.Chart=B;ge.ChartCore.getCSSVar=ht;ge.ChartCore.formatValue=B.prototype._formatValue;console.log("[ChartCore] Loaded");var Zr=window.QCLI=window.QCLI||{},L={recognition:null,active:!1,finalText:"",pendingText:"",target:"chat",_targetPinned:!1},ls="qcli-voice-input-",V={autoSend:M.get(ls+"autoSend")==="true",lang:M.get(ls+"lang")||"zh-CN",defaultTarget:M.get(ls+"defaultTarget")||"auto"};function fn(e,t){M.set(ls+e,String(t))}var ie=document.getElementById("voice-input-btn"),Qe=document.getElementById("voice-status"),ee=null,Z=null,Pe=null;function ec(){if(!ee){if(!document.getElementById("voice-confirm-style")){let e=document.createElement("style");e.id="voice-confirm-style",e.textContent=`
.voice-confirm-bar{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);
  z-index:9000;width:min(620px,92vw);background:var(--bg-elevated);
  border:1px solid var(--border-default);border-radius:12px;
  box-shadow:0 8px 30px rgba(0,0,0,.45);
  padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:14px;color:var(--text-primary)}
.voice-confirm-bar.hidden{display:none}
.vc-row{display:flex;align-items:flex-start;gap:8px}
.vc-label{font-size:18px;line-height:1.4}
.vc-text{flex:1;min-height:42px;max-height:140px;resize:vertical;width:100%;
  background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border-default);
  border-radius:8px;padding:8px 10px;font:inherit;line-height:1.5}
.vc-text:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-glow)}
.vc-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.vc-actions button{border:1px solid var(--border-default);background:var(--bg-overlay);
  color:var(--text-primary);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
.vc-actions button:hover{border-color:var(--accent);background:var(--bg-hover)}
.vc-send{background:var(--accent);color:#fff;border-color:transparent}
.vc-send:hover{background:var(--accent-hover);border-color:transparent}
.vc-target{margin-right:auto}
`,document.head.appendChild(e)}ee=document.createElement("div"),ee.id="voice-confirm-bar",ee.className="voice-confirm-bar hidden",ee.innerHTML=`
    <div class="vc-row">
      <span class="vc-label">\u{1F3A4}</span>
      <textarea id="vc-text" class="vc-text" placeholder="\u8BC6\u522B\u7ED3\u679C\uFF0C\u53EF\u7F16\u8F91\u540E\u53D1\u9001"></textarea>
    </div>
    <div class="vc-actions">
      <button id="vc-target" class="vc-target" title="\u5207\u6362\u53D1\u9001\u76EE\u6807">\u53D1\u5230\u804A\u5929</button>
      <button id="vc-cancel">\u53D6\u6D88</button>
      <button id="vc-rerecord">\u91CD\u5F55</button>
      <button id="vc-send" class="vc-send">\u786E\u8BA4\u53D1\u9001</button>
    </div>`,document.body.appendChild(ee),Z=ee.querySelector("#vc-text"),Pe=ee.querySelector("#vc-target"),ee.querySelector("#vc-send").addEventListener("click",()=>Ja()),ee.querySelector("#vc-cancel").addEventListener("click",()=>un(!0)),ee.querySelector("#vc-rerecord").addEventListener("click",()=>sc()),Pe.addEventListener("click",()=>tc()),Z.addEventListener("keydown",e=>{(e.ctrlKey||e.metaKey)&&e.key==="Enter"&&(e.preventDefault(),Ja())})}}function mn(){if(V.defaultTarget==="terminal")return"terminal";if(V.defaultTarget==="chat")return"chat";let e=document.getElementById("chat-input");return e&&document.activeElement===e?"chat":window.QCLI?.state?.launched?"terminal":"chat"}function Rt(e){return e==="terminal"?"\u53D1\u5230\u7EC8\u7AEF":"\u53D1\u5230\u804A\u5929"}function tc(){L.target=L.target==="terminal"?"chat":"terminal",L._targetPinned=!0,Pe&&(Pe.textContent=Rt(L.target))}function Ka(e){if(L.target==="chat"){if(window.QCLI?.ChatUI?.sendChatMessage){window.QCLI.ChatUI.sendChatMessage(e);return}let a=document.getElementById("chat-input");a&&(a.value=e,a.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:!0})));return}let s=window.QCLI?.state?.launched,n=window.QCLI?.Tabs?.activeTabId;s&&n?window.QCLI?.wsSend?.({type:"input",data:e+`
`,tabId:n}):(window.QCLI?.showToast?.(s?"\u7EC8\u7AEF\u65E0\u6D3B\u52A8\u6807\u7B7E\u9875\uFF0C\u5DF2\u6539\u4E3A\u53D1\u9001\u5230\u804A\u5929":"\u7EC8\u7AEF\u672A\u8FD0\u884C\uFF0C\u5DF2\u6539\u4E3A\u53D1\u9001\u5230\u804A\u5929","info"),window.QCLI?.ChatUI?.sendChatMessage&&window.QCLI.ChatUI.sendChatMessage(e))}function Ja(){let e=(Z?.value||"").trim();if(!e){un(!0);return}Ka(e),un(!0),L.finalText="",L.pendingText=""}function sc(){if(Z&&(Z.value=""),L.finalText="",L.pendingText="",L.active){try{L.recognition.stop()}catch(e){console.warn("[VoiceInput] rerecord stop failed:",e?.message)}setTimeout(()=>{try{L.recognition&&L.recognition.start()}catch{}},150)}else hn()}function un(e){ee&&ee.classList.add("hidden"),e&&(L.pendingText="",Z&&(Z.value=""))}function nc(e){if(ec(),L.pendingText=e,L._targetPinned||(L.target=mn()),Z){let t=Z.value.trim();Z.value=(t?t+(t.endsWith(`
`)?"":`
`):"")+e}Pe&&(Pe.textContent=Rt(L.target)),ee.classList.remove("hidden"),Z&&(Z.focus(),Z.setSelectionRange(Z.value.length,Z.value.length))}function ac(e){if(!e||!e.trim())return;let t=e.trim();V.autoSend?Ka(t):nc(t)}function Ya(){let e=window.SpeechRecognition||window.webkitSpeechRecognition;return e?(L.recognition=new e,L.recognition.continuous=!0,L.recognition.interimResults=!0,L.recognition.lang=V.lang||"zh-CN",L.recognition.onresult=t=>{for(let s=t.resultIndex;s<t.results.length;s++){let n=t.results[s][0].transcript;t.results[s].isFinal&&(L.finalText+=n,ac(n))}},L.recognition.onerror=t=>{if(console.warn("[Voice] Error:",t.error),t.error==="no-speech"){if(L.active&&L.recognition)try{L.recognition.start()}catch(s){console.warn("[VoiceInput] Recognition start failed:",s?.message)}return}t.error!=="aborted"&&(Bt(),window.QCLI?.showToast?.(`Voice error: ${t.error}`,"error"))},L.recognition.onend=()=>{if(L.active&&L.recognition)try{L.recognition.start()}catch{Bt()}},!0):(ie&&(ie.title="Speech recognition not supported in this browser",ie.style.opacity="0.3",ie.style.cursor="not-allowed"),!1)}function Xa(){if(!L.recognition&&!Ya()){window.QCLI?.showToast?.("Speech recognition not available in this browser. Try Chrome or Edge.","error");return}L.recognition&&(L.recognition.lang=V.lang||"zh-CN"),L.active?Bt():hn()}function hn(){if(L.recognition)try{if(L.active=!0,L.finalText="",L.recognition.start(),ie&&ie.classList.add("recording"),Qe){Qe.classList.remove("hidden");let e=Qe.querySelector(".voice-text");e&&(e.textContent="Listening...")}window.QCLI?.showToast?.("Voice input active \u2192 speak, then confirm to send","info")}catch{L.active=!1,window.QCLI?.showToast?.("Could not start microphone. Check permissions.","error"),ie&&ie.classList.remove("recording"),Qe&&Qe.classList.add("hidden")}}function Bt(){try{L.recognition&&L.recognition.stop()}catch(e){console.warn("[VoiceInput] Error:",e?.message)}L.active=!1,L.finalText="",ie&&ie.classList.remove("recording"),Qe&&Qe.classList.add("hidden")}function Za(e){V.autoSend=!!e,fn("autoSend",V.autoSend)}function ei(e){e&&(V.lang=e,fn("lang",e),L.recognition&&(L.recognition.lang=e))}function ti(e){if(!["auto","chat","terminal"].includes(e)||e===V.defaultTarget)return;V.defaultTarget=e,fn("defaultTarget",e),L._targetPinned=!1,L.target=mn(),Pe&&(Pe.textContent=Rt(L.target)),ni();let t={auto:"\u81EA\u52A8\uFF08\u6309\u7126\u70B9/\u7EC8\u7AEF\uFF09",chat:"\u804A\u5929\uFF08AI \u52A9\u624B\uFF09",terminal:"\u7EC8\u7AEF"};window.QCLI?.showToast?.(`\u9ED8\u8BA4\u53D1\u9001\u76EE\u6807 \u2192 ${t[e]}\uFF08\u8BC6\u522B\u540E${Rt(L.target)}\uFF09`,"info",2e3)}function ic(){return{...V}}function oc(){if(document.getElementById("voice-input-panel-style"))return;let e=document.createElement("style");e.id="voice-input-panel-style",e.textContent=`
.vi-settings-panel{position:fixed;top:64px;right:24px;z-index:8500;width:340px;max-width:92vw;
  /* \u9ED8\u8BA4\u4F4D\u7F6E\uFF08\u515C\u5E95\uFF09\uFF1B\u5B9E\u9645\u4F4D\u7F6E\u7531 JS \u6839\u636E\u89E6\u53D1\u6309\u94AE\u52A8\u6001\u8BA1\u7B97 */
  background:var(--bg-elevated);color:var(--text-primary);
  border:1px solid var(--border-default);border-radius:12px;
  box-shadow:0 8px 30px rgba(0,0,0,.45);
  font-size:14px;overflow:hidden}
.vi-settings-panel.hidden{display:none}
.vi-settings-header{display:flex;align-items:center;gap:8px;padding:10px 12px;
  border-bottom:1px solid var(--border-default)}
.vi-settings-icon{font-size:16px}
.vi-settings-title{flex:1;font-weight:600}
.vi-settings-close{background:transparent;border:0;color:var(--text-secondary);
  font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px}
.vi-settings-close:hover{background:var(--bg-hover);color:var(--text-primary)}
.vi-settings-body{padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.vi-setting-row{display:flex;align-items:center;gap:8px}
.vi-setting-label{flex:1;color:var(--text-primary)}
.vi-select{flex:1;background:var(--bg-overlay);color:var(--text-primary);
  border:1px solid var(--border-default);border-radius:8px;padding:6px 10px;font:inherit}
.vi-toggle{display:inline-block;position:relative;width:36px;height:20px;flex-shrink:0}
.vi-toggle input{opacity:0;width:0;height:0}
.vi-toggle-slider{position:absolute;inset:0;background:var(--bg-active);
  border-radius:20px;transition:.2s;cursor:pointer}
.vi-toggle-slider::before{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;
  background:var(--text-primary);border-radius:50%;transition:.2s}
.vi-toggle input:checked + .vi-toggle-slider{background:var(--accent)}
.vi-toggle input:checked + .vi-toggle-slider::before{transform:translateX(16px)}
.vi-test-btn{margin-top:4px;padding:8px 12px;background:var(--accent);color:#fff;
  border:0;border-radius:8px;cursor:pointer;font:inherit}
.vi-test-btn:hover{background:var(--accent-hover)}
.vi-effective-target{font-size:12px;color:var(--text-secondary);
  padding:6px 10px;background:var(--bg-overlay);border-radius:6px;
  border-left:3px solid var(--accent);flex-direction:column;align-items:flex-start;gap:2px}
.vi-effective-target strong{color:var(--accent);font-weight:600}
`,document.head.appendChild(e)}function si(){oc();let e=document.getElementById("vi-settings-panel");e||(e=cc()),e.classList.contains("hidden")?(rc(e),e.classList.remove("hidden"),lc(e)):e.classList.add("hidden")}function rc(e){let t=document.getElementById("voice-input-settings-btn");if(!t)return;let s=t.getBoundingClientRect(),n=340,a=360,o=8,i=16,r=s.right-n;r<i&&(r=i),r+n+i>window.innerWidth&&(r=Math.max(i,window.innerWidth-n-i)),e.style.right="auto";let c=s.bottom+o;c+a+i>window.innerHeight&&(c=s.top-a-o,c<i&&(c=i)),e.style.top=`${c}px`,e.style.left=`${r}px`,e.style.removeProperty("right")}function cc(){let e=[["zh-CN","\u4E2D\u6587"],["en-US","English"],["ja-JP","\u65E5\u672C\u8A9E"],["ko-KR","\uD55C\uAD6D\uC5B4"]].map(([s,n])=>`<option value="${s}">${n}</option>`).join(""),t=document.createElement("div");return t.id="vi-settings-panel",t.className="vi-settings-panel hidden",t.innerHTML=`
    <div class="vi-settings-header">
      <span class="vi-settings-icon">\u{1F3A4}</span>
      <span class="vi-settings-title" data-i18n="voice.inputSettings">\u8BED\u97F3\u8F93\u5165\u8BBE\u7F6E</span>
      <button class="vi-settings-close" id="vi-settings-close" title="\u5173\u95ED">\u2715</button>
    </div>
    <div class="vi-settings-body">
      <div class="vi-setting-row">
        <span class="vi-setting-label">\u8BC6\u522B\u540E\u81EA\u52A8\u53D1\u9001\uFF08\u8DF3\u8FC7\u786E\u8BA4\uFF09</span>
        <label class="vi-toggle">
          <input type="checkbox" id="vi-autosend">
          <span class="vi-toggle-slider"></span>
        </label>
      </div>
      <div class="vi-setting-row">
        <span class="vi-setting-label">\u8BC6\u522B\u8BED\u8A00</span>
        <select id="vi-lang" class="vi-select">${e}</select>
      </div>
      <div class="vi-setting-row">
        <span class="vi-setting-label" data-i18n="voice.defaultTargetLabel">\u9ED8\u8BA4\u53D1\u9001\u76EE\u6807</span>
        <select id="vi-default-target" class="vi-select">
          <option value="auto" ${V.defaultTarget==="auto"?"selected":""}>\u81EA\u52A8\uFF08\u6309\u7126\u70B9/\u7EC8\u7AEF\uFF09</option>
          <option value="chat" ${V.defaultTarget==="chat"?"selected":""}>\u804A\u5929\uFF08AI \u52A9\u624B\uFF09</option>
          <option value="terminal" ${V.defaultTarget==="terminal"?"selected":""}>\u7EC8\u7AEF</option>
        </select>
      </div>
      <div class="vi-setting-row vi-effective-target" id="vi-effective-target">
        <!-- \u5B9E\u65F6\u663E\u793A\u300C\u5F53\u524D\u751F\u6548\u76EE\u6807\u300D\uFF08\u57FA\u4E8E defaultTarget + \u5F53\u524D\u7126\u70B9/\u7EC8\u7AEF\u72B6\u6001\uFF09 -->
      </div>
      <div class="vi-setting-row" style="font-size:12px;color:var(--text-secondary);flex-direction:column;align-items:flex-start;gap:4px">
        <span>\u{1F4A1} \u8BC6\u522B\u65F6\u9EA6\u514B\u98CE\u4F1A\u6309\u5F53\u524D\u7126\u70B9\u81EA\u52A8\u8DEF\u7531\uFF1A</span>
        <span>\xB7 \u804A\u5929\u8F93\u5165\u6846\u805A\u7126 \u2192 \u53D1\u9001\u5230\u804A\u5929</span>
        <span>\xB7 \u7EC8\u7AEF\u8FD0\u884C\u4E2D \u2192 \u53D1\u9001\u5230\u7EC8\u7AEF</span>
      </div>
    </div>
  `,document.body.appendChild(t),t.querySelector("#vi-settings-close").addEventListener("click",()=>{t.classList.add("hidden")}),t}function lc(e){let t=e.querySelector("#vi-autosend"),s=e.querySelector("#vi-lang"),n=e.querySelector("#vi-default-target");t&&(t.checked=!!V.autoSend),s&&(s.value=V.lang||"zh-CN"),n&&(n.value=V.defaultTarget||"auto"),ni()}function ni(){let e=document.getElementById("vi-effective-target");if(!e)return;let t=V.defaultTarget||"auto",s=mn(),n={auto:"\u81EA\u52A8\uFF08\u6309\u7126\u70B9/\u7EC8\u7AEF\uFF09",chat:"\u804A\u5929\uFF08AI \u52A9\u624B\uFF09",terminal:"\u7EC8\u7AEF"}[t],a=Rt(s),o=t==="auto"?"":t!==s?' <span style="color:var(--text-tertiary);font-size:11px">\uFF08\u88AB\u624B\u52A8\u8986\u76D6\uFF09</span>':"";e.innerHTML=`
    <span>\u5F53\u524D\u9ED8\u8BA4\uFF1A<strong>${n}</strong></span>
    <span>\u5F53\u524D\u751F\u6548\uFF1A<strong>${a}</strong>${o}</span>
  `}function dc(){document.addEventListener("change",e=>{let t=e.target;t.id==="vi-autosend"?Za(t.checked):t.id==="vi-lang"?ei(t.value):t.id==="vi-default-target"&&ti(t.value)}),document.addEventListener("click",e=>{if(e.target.closest("#voice-input-settings-btn")){e.preventDefault(),si();return}let s=document.getElementById("vi-settings-panel");if(s&&!s.classList.contains("hidden")){let n=e.target===s||s.contains(e.target),a=e.target.closest("#voice-input-settings-btn");!n&&!a&&s.classList.add("hidden")}})}ie&&(ie.addEventListener("click",Xa),Ya());dc();window.addEventListener("beforeunload",()=>{L.active&&Bt()});var pc={toggle:Xa,start:hn,stop:Bt,setAutoSend:Za,setLang:ei,setDefaultTarget:ti,getInputSettings:ic,toggleSettingsPanel:si};Zr.VoiceInput=pc;var uc=window.QCLI=window.QCLI||{},y={currentUtterance:null,speaking:!1,paused:!1,queue:[],enabled:!1,autoRead:!0,rate:1,pitch:1,volume:1,selectedVoice:null,language:"auto",engine:"web",edgeVoice:null},oi="qcli-tts-",ri=["enabled","autoRead","rate","pitch","volume","selectedVoice","language","engine","edgeVoice"];function fc(){for(let e of ri){let t=M.get(oi+e);t!==null&&(e==="enabled"||e==="autoRead"?y[e]=t==="true":e==="rate"||e==="pitch"||e==="volume"?y[e]=parseFloat(t):e==="edgeVoice"?y.edgeVoice=t==="null"||t===""?null:t:y[e]=t)}}function mc(){for(let e of ri)M.set(oi+e,String(y[e]))}function yn(){return window.speechSynthesis?.getVoices()||[]}function ci(){let e=yn();if(y.selectedVoice){let t=e.find(s=>s.voiceURI===y.selectedVoice);if(t)return t}return li(e)}function li(e,t){let s=t||gn(),n=e.find(o=>o.lang.startsWith(s));if(n)return n;let a=e.find(o=>o.lang.startsWith(s.slice(0,2)));return a||e[0]||null}function gn(){return y.language==="auto"?(document.documentElement.lang||navigator.language||"zh-CN").startsWith("zh")?"zh":"en":y.language}function vn(e){if(!e)return gn();let t=(e.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)||[]).length,s=e.length;return s===0?gn():t/s>.15?"zh":"en"}function hc(e,t=150){if(!e||e.length<=t)return[e];let s=[],n="";for(let a=0;a<e.length;a++)if(n+=e[a],n.length>=t){let o=n.match(/^(.+?)([，。！？!?;；\s,])/);o&&o[1].length>=20?(s.push(o[1]+o[2]),n=n.slice(o[0].length)):(s.push(n),n="")}return n&&s.push(n),s}function ai(){if(y.queue.length>0||y.speaking)return!0;let e=window.speechSynthesis;return!!(e&&e.speaking)}function di(e){return e?e.replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}]/gu,""):""}function He(e,t={}){if(!y.enabled||!e||!e.trim()||(e=di(e),!e||!e.trim()))return!1;let s=e.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").replace(/[。？！]/g,"\uFF0C").replace(/\n+/g,"\uFF0C").trim();if(!s)return!1;let n=hc(s,150);if(n.length>1){let a=t.lang||vn(n[0]);if(ai())return t.enqueue&&n.forEach(r=>y.queue.push({text:r,lang:a})),!!t.enqueue;let[o,...i]=n;return i.forEach(r=>y.queue.push({text:r,lang:a})),ps(o,{...t,lang:a})}return ai()?t.enqueue?(y.queue.push({text:s,lang:t.lang||vn(s)}),!0):!1:ps(s,t)}function ps(e,t){let s=window.speechSynthesis;if(!s)return!1;s.cancel(),y.speaking=!1;let n=t.lang||vn(e),a=new SpeechSynthesisUtterance(e);a.lang=n==="zh"?"zh-CN":"en-US",a.rate=y.rate,a.pitch=y.pitch,a.volume=y.volume;let o=ci();o&&(a.voice=o),a.onstart=()=>{y.speaking=!0,y.currentUtterance=a,gt(),t.onStart?.()},a.onend=()=>{if(y.speaking=!1,y.currentUtterance=null,gt(),t.onEnd?.(),y.queue.length>0){let i=y.queue.shift();ps(i.text,{lang:i.lang})}},a.onerror=i=>{if(console.warn("[VoiceOutput] Speech error:",i.error),y.speaking=!1,y.currentUtterance=null,gt(),y.queue.length>0){let r=y.queue.shift();ps(r.text,{lang:r.lang})}};try{return s.speak(a),y.speaking=!0,y.currentUtterance=a,!0}catch(i){return console.warn("[VoiceOutput] speak() failed:",i.message),!1}}function xn(){let e=window.speechSynthesis;e&&e.cancel(),y.speaking=!1,y.currentUtterance=null,y.queue=[],gt()}function gc(){let e=window.speechSynthesis;e&&(e.paused?(e.resume(),y.paused=!1):y.speaking&&(e.pause(),y.paused=!0),gt())}function vc(e){if(!y.enabled||!y.autoRead)return;if(!e||e.length>3e3){e&&e.length>3e3&&y.enabled&&He("AI \u56DE\u590D\u5185\u5BB9\u8F83\u957F\uFF0C\u8BF7\u5728\u804A\u5929\u9762\u677F\u4E2D\u9605\u8BFB",{enqueue:!0});return}let t=us(e);He(t,{enqueue:!0})}function us(e){return e?e.replace(/```[\s\S]*?```/g,"\u4EE3\u7801\u5757").replace(/`([^`]+)`/g,"$1").replace(/!\[([^\]]*)\]\([^)]+\)/g,(t,s)=>s||"\u56FE\u7247").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/(\*{1,3}|_{1,3})(.+?)\1/g,"$2").replace(/^#{1,6}\s+/gm,"").replace(/^[\s]*[-*+]\s+/gm,"").replace(/^\s*\d+[.)]\s+/gm,"").replace(/^>\s+/gm,"").replace(/^[-*_]{3,}\s*$/gm,"").replace(/\|/g," ").replace(/[-:]+\s*[-:|]+\s*/g,"").replace(/<[^>]+>/g,"").replace(/\n{2,}/g," ").trim():""}function gt(){let e=document.getElementById("tts-toggle-btn"),t=document.getElementById("tts-indicator");e&&(e.classList.toggle("speaking",y.speaking),e.classList.toggle("tts-enabled",y.enabled),e.title=y.enabled?y.speaking?"\u{1F50A} \u6B63\u5728\u6717\u8BFB...":"\u{1F50A} \u8BED\u97F3\u8F93\u51FA\u5DF2\u5F00\u542F":"\u{1F507} \u8BED\u97F3\u8F93\u51FA\u5DF2\u5173\u95ED"),t&&t.classList.toggle("hidden",!y.speaking)}function bc(){return{...y}}function Le(e){let t=!1;for(let[s,n]of Object.entries(e))s in y&&y[s]!==n&&(y[s]=n,t=!0);t&&(mc(),gt(),e.enabled===!1&&xn())}function pi(e){Le({enabled:!!e})}function ui(e){Le({autoRead:!!e})}function yc(e){Le({rate:Math.max(.1,Math.min(10,parseFloat(e)||1))})}function xc(e){Le({pitch:Math.max(0,Math.min(2,parseFloat(e)||1))})}function wc(e){Le({volume:Math.max(0,Math.min(1,parseFloat(e)||1))})}function kc(e){["auto","zh","en"].includes(e)&&Le({language:e})}function fi(e){["web","edge","auto"].includes(e)&&Le({engine:e})}function wn(e){Le({edgeVoice:e||null})}function Tc(e){if(!y.enabled||!y.autoRead)return!1;let t=us(e||"");return!t||t.length>3e3?(t&&t.length>3e3&&y.enabled&&He("AI \u56DE\u590D\u5185\u5BB9\u8F83\u957F\uFF0C\u8BF7\u5728\u804A\u5929\u9762\u677F\u4E2D\u9605\u8BFB",{enqueue:!0}),!1):y.engine==="edge"&&typeof Pt=="function"?Pt(t,{enqueue:!0}):He(t,{enqueue:!0})}var ds=null,ii=Promise.resolve();async function Pt(e,t={}){if(!y.enabled||!e||!e.trim()||(e=di(e),e=e.replace(/[。？！]/g,"\uFF0C").replace(/\n+/g,"\uFF0C"),!e||!e.trim()))return!1;if(!(y.engine==="edge"||y.engine==="auto"&&ds!==!1))return ds=!1,He(e,t);let n=y.edgeVoice||"zh-CN-XiaoxiaoNeural",a=String(y.rate||"1.0"),o=fetch("/api/tts/synthesize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:e,voice:n,rate:a})}).then(async c=>{if(!c.ok)throw new Error("status "+c.status);return c.arrayBuffer()}),i=ii,r;ii=new Promise(c=>{r=c}),await i;try{let c=await o;if(!await Lc(c))throw new Error("decode failed");return ds=!0,!0}catch(c){return console.warn("[VoiceOutput] Edge TTS failed, fallback to Web Speech:",c&&c.message),ds=!1,await Cc(e,t),!0}finally{r()}}function Cc(e,t={}){return new Promise(s=>{let n=!1,a=()=>{n||(n=!0,s(!0))};He(e,{...t,onEnd:a})||a(),setTimeout(a,8e3)})}function Lc(e){return new Promise(t=>{let s=window.AudioContext||window.webkitAudioContext;if(!s){t(!1);return}let n=new s;n.decodeAudioData(e.slice(0),a=>{let o=n.createBufferSource();o.buffer=a,o.connect(n.destination),o.onended=()=>{n.close(),t(!0)},o.start(0)},a=>{console.warn("[VoiceOutput] decodeAudioData failed:",a),n.close(),t(!1)})})}function Ec(e){Le({selectedVoice:e||null})}function bn(){let e=document.getElementById("tts-settings-panel");e||(e=Sc()),e.classList.toggle("hidden"),e.classList.contains("hidden")||kn(e)}function Sc(){if(!document.getElementById("tts-input-style")){let t=document.createElement("style");t.id="tts-input-style",t.textContent=".tts-setting-section-title{padding:6px 0 2px;font-size:12px;font-weight:600;color:var(--text-secondary,#aaa);letter-spacing:.04em}.tts-voice-group[hidden]{display:none}",document.head.appendChild(t)}let e=document.createElement("div");return e.id="tts-settings-panel",e.className="tts-settings-panel hidden",e.innerHTML=`
    <div class="tts-settings-header">
      <span class="tts-settings-icon">\u{1F50A}</span>
      <span class="tts-settings-title">\u8BED\u97F3\u8F93\u51FA\u8BBE\u7F6E</span>
      <button class="tts-settings-close" id="tts-settings-close">\u2715</button>
    </div>
    <div class="tts-settings-body" id="tts-settings-body">
      <div class="tts-setting-row">
        <span class="tts-setting-label">\u542F\u7528\u8BED\u97F3\u8F93\u51FA</span>
        <label class="tts-toggle">
          <input type="checkbox" id="tts-enabled" ${y.enabled?"checked":""}>
          <span class="tts-toggle-slider"></span>
        </label>
      </div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">AI \u56DE\u590D\u81EA\u52A8\u6717\u8BFB</span>
        <label class="tts-toggle">
          <input type="checkbox" id="tts-auto-read" ${y.autoRead?"checked":""}>
          <span class="tts-toggle-slider"></span>
        </label>
      </div>
      <div class="tts-setting-divider"></div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">\u8BED\u901F</span>
        <div class="tts-slider-group">
          <input type="range" id="tts-rate" min="0.1" max="3" step="0.1" value="${y.rate}">
          <span class="tts-value" id="tts-rate-val">${y.rate.toFixed(1)}x</span>
        </div>
      </div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">\u97F3\u9AD8</span>
        <div class="tts-slider-group">
          <input type="range" id="tts-pitch" min="0" max="2" step="0.1" value="${y.pitch}">
          <span class="tts-value" id="tts-pitch-val">${y.pitch.toFixed(1)}</span>
        </div>
      </div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">\u97F3\u91CF</span>
        <div class="tts-slider-group">
          <input type="range" id="tts-volume" min="0" max="1" step="0.1" value="${y.volume}">
          <span class="tts-value" id="tts-volume-val">${Math.round(y.volume*100)}%</span>
        </div>
      </div>
      <div class="tts-setting-divider"></div>
      <div class="tts-setting-section-title">TTS \u5F15\u64CE\uFF08\u9AD8\u8D28\u91CF\uFF09</div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">\u5F15\u64CE</span>
        <select id="tts-engine" class="tts-select">
          <option value="web" ${y.engine==="web"?"selected":""}>\u6D4F\u89C8\u5668\u539F\u751F\uFF08\u96F6\u4F9D\u8D56\uFF09</option>
          <option value="edge" ${y.engine==="edge"?"selected":""}>Edge TTS\uFF08\u9700\u8054\u7F51\uFF09</option>
          <option value="auto" ${y.engine==="auto"?"selected":""}>\u81EA\u52A8\uFF08Edge \u4F18\u5148\uFF09</option>
        </select>
      </div>
      <div class="tts-voice-group" data-engine="web">
        <div class="tts-setting-row">
          <span class="tts-setting-label">\u6717\u8BFB\u8BED\u8A00</span>
          <select id="tts-language" class="tts-select">
            <option value="auto" ${y.language==="auto"?"selected":""}>\u81EA\u52A8\u68C0\u6D4B</option>
            <option value="zh" ${y.language==="zh"?"selected":""}>\u4E2D\u6587</option>
            <option value="en" ${y.language==="en"?"selected":""}>English</option>
          </select>
        </div>
        <div class="tts-setting-row">
          <span class="tts-setting-label">\u53D1\u97F3\u4EBA</span>
          <select id="tts-voice" class="tts-select"></select>
        </div>
      </div>
      <div class="tts-voice-group" data-engine="edge">
        <div class="tts-setting-row">
          <span class="tts-setting-label">Edge \u53D1\u97F3\u4EBA</span>
          <select id="tts-edge-voice" class="tts-select"></select>
        </div>
      </div>
      <div class="tts-setting-divider"></div>
      <button class="tts-test-btn" id="tts-test-btn">\u{1F50A} \u6D4B\u8BD5\u8BED\u97F3\uFF08\u5F53\u524D\u5F15\u64CE\uFF09</button>
    </div>
  `,document.body.appendChild(e),e.querySelector("#tts-settings-close").addEventListener("click",()=>{e.classList.add("hidden")}),e.addEventListener("click",t=>{t.target===e&&e.classList.add("hidden")}),e}function kn(e){Ac();let t=e.querySelector("#tts-voice");if(t){let a=yn(),o=y.selectedVoice;if(t.innerHTML=a.map(i=>`<option value="${i.voiceURI}" ${i.voiceURI===o?"selected":""}>
        ${i.name} (${i.lang})
      </option>`).join(""),!o&&t.options.length>0){let i=li(a);i&&(t.value=i.voiceURI)}}let s=e.querySelector("#tts-edge-voice"),n=e.querySelector('.tts-voice-group[data-engine="edge"]');s&&n&&!n.hidden&&Ic(s)}async function Ic(e){try{let t=await fetch("/api/tts/voices");if(!t.ok)throw new Error("status "+t.status);let s=await t.json(),n=(s.voices||[]).filter(o=>o.locale&&o.locale.startsWith("zh")),a=n.length?n:s.voices||[];e.innerHTML=a.map(o=>`<option value="${o.name}" ${o.name===y.edgeVoice?"selected":""}>${o.name} (${o.locale})</option>`).join(""),!y.edgeVoice&&e.options.length>0?(e.value=e.options[0].value,wn(e.options[0].value)):y.edgeVoice&&!a.some(o=>o.name===y.edgeVoice)&&console.warn("[VoiceOutput] saved Edge voice not in list:",y.edgeVoice)}catch(t){console.warn("[VoiceOutput] load Edge voices failed:",t&&t.message);let s=y.edgeVoice&&y.edgeVoice!=="null"?y.edgeVoice:"zh-CN-XiaoxiaoNeural";e.innerHTML=`<option value="${s}">${s}\uFF08\u52A0\u8F7D\u5931\u8D25\uFF0C\u7A0D\u540E\u91CD\u8BD5\uFF09</option>`,e.value=s}}function _c(){document.addEventListener("change",e=>{let t=e.target;switch(t.id){case"tts-enabled":pi(t.checked);break;case"tts-auto-read":ui(t.checked);break;case"tts-rate":{yc(t.value);let s=document.getElementById("tts-rate-val");s&&(s.textContent=parseFloat(t.value).toFixed(1)+"x");break}case"tts-pitch":{xc(t.value);let s=document.getElementById("tts-pitch-val");s&&(s.textContent=parseFloat(t.value).toFixed(1));break}case"tts-volume":{wc(t.value);let s=document.getElementById("tts-volume-val");s&&(s.textContent=Math.round(parseFloat(t.value)*100)+"%");break}case"tts-language":kc(t.value);break;case"tts-voice":Ec(t.value);break;case"tts-engine":{fi(t.value);let s=document.getElementById("tts-settings-panel");s&&kn(s);break}case"tts-edge-voice":wn(t.value);break}}),document.addEventListener("input",e=>{e.target.id}),document.addEventListener("click",e=>{e.target.id==="tts-test-btn"&&Mc("\u4F60\u597D\uFF0C\u6B22\u8FCE\u4F7F\u7528\u8BED\u97F3\u8F93\u51FA\u529F\u80FD\u3002\u8FD9\u662F\u4E00\u6761\u6D4B\u8BD5\u8BED\u97F3\u3002")})}function Mc(e){if(!y.enabled)return!1;let t=us(e||"");if(!t)return!1;let s=y.engine||"web";return s==="edge"||s==="auto"?Pt(t):He(t)}function Ac(){let e=y.engine||"web",t=e==="web"||e==="auto",s=e==="edge"||e==="auto";document.querySelectorAll(".tts-voice-group").forEach(n=>{let a=n.dataset.engine;n.hidden=a==="web"?!t:!s})}var $c={get state(){return{...y}},get enabled(){return y.enabled},get speaking(){return y.speaking},speak:He,speakAIResponse:vc,speakSentence:Tc,speakStreaming:Pt,stop:xn,togglePause:gc,getVoices:yn,getSelectedVoice:ci,getSettings:bc,updateSettings:Le,setEnabled:pi,setAutoRead:ui,setEngine:fi,setEdgeVoice:wn,toggleSettingsPanel:bn,stripMarkdown:us};uc.VoiceOutput=$c;fc();_c();window.speechSynthesis&&window.speechSynthesis.getVoices().length===0&&(window.speechSynthesis.onvoiceschanged=()=>{let e=document.getElementById("tts-settings-panel");e&&!e.classList.contains("hidden")&&kn(e)});document.addEventListener("click",e=>{(e.target.id==="tts-toggle-btn"||e.target.closest("#tts-toggle-btn"))&&(e.preventDefault(),y.enabled&&y.speaking?xn():bn())});console.log("[VoiceOutput] Initialized (enabled:",y.enabled,")");var ze=window.QCLI=window.QCLI||{},E={list:[],active:null,ws:null};async function hi(){try{let e=await fetch("/api/workflows");if(!e.ok)return[];let t=await e.json();return E.list=t.workflows||[],Ve(),E.list}catch(e){return console.warn("[Workflows] Load failed:",e),[]}}var gi=null;function Ve(){let e=gi||document.getElementById("workflow-list");if(!e)return;if(e.innerHTML="",E.list.length===0){e.innerHTML='<div class="agent-empty">No workflows available</div>';return}let t=document.createElement("div");t.className="wfp-header",t.innerHTML=`
      <span class="wfp-header-icon">\u26A1</span>
      <span class="wfp-header-title">\u5DE5\u4F5C\u6D41</span>
      <span class="wfp-header-count">${E.list.length}</span>
    `,e.appendChild(t);let s=document.createElement("div");s.className="wfp-list",e.appendChild(s);for(let n of E.list){let a=document.createElement("div");a.className="wfp-item",a.dataset.wfId=n.id;let o=(n.name||"").replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/u,"").trim()||n.name;a.title=n.description||o;let i=document.createElement("div");i.className="wfp-left",i.innerHTML=`<span class="wfp-icon">${n.icon||"\u26A1"}</span><span class="wfp-name">${o}</span>`,a.appendChild(i);let r=document.createElement("div");r.className="wfp-badges";let c=document.createElement("span");c.className="wfp-badge steps",n.tasks&&Array.isArray(n.tasks)&&n.tasks.length>0?(c.textContent="DAG",c.classList.add("dag"),a.dataset.dag="1"):c.textContent=`${n.steps.length} \u6B65`,r.appendChild(c);let l=document.createElement("span");l.className="wfp-badge cat",n.tasks&&Array.isArray(n.tasks)&&n.tasks.length>0?(l.textContent="\u5E76\u884C",l.classList.add("parallel")):(l.textContent="\u987A\u5E8F",l.classList.add("sequential")),r.appendChild(l),a.appendChild(r),E.active&&E.active.id===n.id&&E.active.status==="running"&&a.classList.add("running"),a.addEventListener("click",()=>{Rc(n)}),s.appendChild(a)}}function Rc(e){if(e.tasks&&Array.isArray(e.tasks)&&e.tasks.length>0){ze.Orchestrator?.runDAG?(ze.Orchestrator.runDAG(e),ze.RightPanel?.switchTab&&ze.RightPanel.switchTab("orchestrator")):Ee("\u7F16\u6392\u6A21\u5757\u672A\u5C31\u7EEA","error");return}let t=e.variables;if(t&&Object.keys(t).length>0){Bc(e);return}fs(e)}function Bc(e){let t=e.variables||{},s=Object.keys(t);if(s.length===0){fs(e);return}let n="";for(let c of s){let l=t[c],d=l.label||c,p=l.required?"required":"",u=l.default||"";if(n+=`<label>${d}`,l.type==="select"&&l.options){n+=`<select id="wf-var-${c}" class="wf-var-input" ${p}>`;for(let f of l.options)n+=`<option value="${f}"${f===u?" selected":""}>${f}</option>`;n+="</select>"}else if(l.type==="number"){let f=l.min!=null?` min="${l.min}"`:"",m=l.max!=null?` max="${l.max}"`:"";n+=`<input type="number" id="wf-var-${c}" class="wf-var-input" value="${u}" ${p}${f}${m}>`}else n+=`<input type="text" id="wf-var-${c}" class="wf-var-input" value="${u}" placeholder="${l.placeholder||""}" ${p}>`;l.description&&(n+=`<small>${l.description}</small>`),n+="</label>"}let a=document.createElement("div");a.className="modal-overlay hidden",a.id="wf-variable-modal",a.innerHTML=`
      <div class="modal wf-var-modal">
        <h2>${e.icon||"\u26A1"} ${e.name}</h2>
        <div class="wf-var-form">
          ${n}
        </div>
        <div class="modal-actions">
          <button id="wf-var-cancel" class="secondary-btn">Cancel</button>
          <button id="wf-var-start" class="primary-btn">\u25B6 Start</button>
        </div>
        <div id="wf-var-error" class="form-error hidden"></div>
      </div>
    `,document.body.appendChild(a),requestAnimationFrame(()=>a.classList.remove("hidden"));let o=a.querySelector("#wf-var-error");function i(){a.classList.add("hidden"),setTimeout(()=>a.remove(),250)}a.querySelector("#wf-var-cancel").addEventListener("click",i),a.addEventListener("click",c=>{c.target===a&&i()}),a.querySelector("#wf-var-start").addEventListener("click",()=>{let c={},l=!1;for(let p of s){let u=t[p],f=document.getElementById(`wf-var-${p}`),m=f?f.value.trim():"";if(u.required&&!m){l=!0,f?.focus(),o.textContent=`"${u.label||p}" is required`,o.classList.remove("hidden");break}c[p]=m||u.default||""}if(l)return;o.classList.add("hidden");let d={...e,steps:e.steps.map(p=>({...p,task:Pc(p.task,c)}))};i(),fs(d)}),a.addEventListener("keydown",c=>{c.key==="Enter"&&c.target.classList.contains("wf-var-input")&&a.querySelector("#wf-var-start").click()});let r=a.querySelector(".wf-var-input");r&&setTimeout(()=>r.focus(),100)}function Pc(e,t){let s=e;for(let[n,a]of Object.entries(t)){s=s.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`,"gi"),a);let o=n.toUpperCase();o!==n&&(s=s.replace(new RegExp(`\\{\\{\\s*${o}\\s*\\}\\}`,"g"),a));let r=[o,...{audio_bitrate:["AUDIO_BITRATE"],output_suffix:["OUTPUT_SUFFIX"],language:["LANG"],output_format:["FMT"]}[n]||[]];for(let c of[...new Set(r)])s=s.replace(new RegExp(`(?<=\\b${c}\\s*=\\s*)"([^"]*)"`,"g"),`"${a}"`),s=s.replace(new RegExp(`\\b(${c}=)(\\S+)`,"g"),(l,d,p)=>/[\$`]/.test(p)?l:d+a)}return s}function fs(e){if(E.active&&E.active.status==="running"){Ee("A workflow is already running. Cancel it first.","error");return}let t=E.ws;if(!t||t.readyState!==WebSocket.OPEN){Ee("WebSocket not connected","error");return}E.active={id:e.id,name:e.name,icon:e.icon,steps:e.steps.map(s=>({...s,status:"pending",output:""})),currentStep:-1,status:"running",results:[],wfId:null},t.send(JSON.stringify({type:"workflow:start",workflowId:e.id,name:e.name,steps:e.steps})),Ee(`\u25B6 Started: ${e.name}`,"info"),Ve(),bi()}function vi(){if(!E.active||E.active.status!=="running")return;let e=E.ws;e&&e.readyState===WebSocket.OPEN&&e.send(JSON.stringify({type:"workflow:cancel",wfId:E.active.wfId})),E.active.status="cancelled",Ee("\u23F9 Workflow cancelled","info"),Ve(),oe()}function bi(){let e=document.getElementById("wf-progress-overlay");e||(e=document.createElement("div"),e.id="wf-progress-overlay",e.className="wf-progress-overlay",e.innerHTML=`
        <div class="wf-progress-panel">
          <div class="wf-progress-header">
            <span class="wf-progress-title"></span>
            <button class="wf-progress-close" id="wf-progress-close" title="Close">\u2715</button>
          </div>
          <div class="wf-progress-steps" id="wf-progress-steps"></div>
          <div class="wf-progress-footer">
            <button id="wf-cancel-btn" class="wf-cancel-btn">Cancel Workflow</button>
          </div>
        </div>
      `,document.body.appendChild(e),e.querySelector("#wf-progress-close").addEventListener("click",()=>{e.classList.add("hidden")}),e.querySelector("#wf-cancel-btn").addEventListener("click",()=>{vi()}),e.addEventListener("click",t=>{t.target===e&&e.classList.add("hidden")})),e.classList.remove("hidden"),oe()}function oe(){let e=document.getElementById("wf-progress-overlay");if(!e)return;if(!E.active){e.classList.add("hidden");return}let t=E.active;e.querySelector(".wf-progress-title").textContent=`${t.icon||"\u26A1"} ${t.name}`;let s=document.getElementById("wf-progress-steps");s.innerHTML="";for(let n=0;n<t.steps.length;n++){let a=t.steps[n],o=a.mode==="parallel"&&a.agents,i=document.createElement("div");i.className="wf-step-item "+a.status;let r=document.createElement("span");switch(r.className="wf-step-status",a.status){case"running":r.textContent="\u27F3",r.style.animation="spin 1s linear infinite";break;case"completed":r.textContent="\u2705";break;case"error":r.textContent="\u274C";break;case"cancelled":r.textContent="\u23F9";break;default:r.textContent="\u25CB"}i.appendChild(r);let c=document.createElement("div");c.className="wf-step-info";let l=document.createElement("div");if(l.className="wf-step-label",l.textContent=`Step ${n+1}: ${a.label}`,c.appendChild(l),o&&a.agentOutputs){let d=document.createElement("div");d.className="wf-parallel-agents";for(let p=0;p<a.agentOutputs.length;p++){let u=a.agentOutputs[p],f=document.createElement("div");f.className="wf-parallel-agent-card "+(u.status||"pending");let m=document.createElement("div");m.className="wf-parallel-agent-header";let g=document.createElement("span");g.className="wf-parallel-agent-icon",u.status==="running"?(g.textContent="\u27F3",g.style.animation="spin 1s linear infinite"):u.status==="completed"?g.textContent="\u2705":u.status==="error"?g.textContent="\u274C":g.textContent="\u25CB",m.appendChild(g);let b=document.createElement("span");b.className="wf-parallel-agent-name";let x={opencode:"\u26A1 OpenCode",codebuff:"\u{1F9CA} Codebuff",freebuff:"\u{1F9CA} Freebuff"};b.textContent=x[u.agentId]||u.agentId,m.appendChild(b);let v=document.createElement("span");v.className="wf-parallel-agent-toggle",v.textContent="\u25BC",v.style.marginLeft="auto",v.style.fontSize="8px",v.style.color="var(--text-tertiary)",m.appendChild(v),f.appendChild(m);let w=document.createElement("pre");w.className="wf-parallel-agent-output",w.textContent=u.output?u.output.slice(-1e3):"(awaiting output...)";let T=!1;m.addEventListener("click",function(){T=!T,w.classList.toggle("expanded",T),v.textContent=T?"\u25B2":"\u25BC"}),f.appendChild(w),d.appendChild(f)}c.appendChild(d)}if(o&&a.status==="completed"&&a.output){let d=document.createElement("div");d.className="wf-merge-result";let p=document.createElement("div");p.className="wf-merge-label",p.textContent="\u{1F500} Merged Result",d.appendChild(p);let u=document.createElement("pre");u.className="wf-merge-output",u.textContent=a.output.slice(-500),d.appendChild(u),c.appendChild(d)}if(a.type==="await_human"){let d=document.createElement("div");if(d.style.cssText="font-size:11px;color:#f59e0b;margin-top:4px;font-weight:500;display:flex;align-items:center;gap:4px;",d.innerHTML="\u{1F64B} \u7B49\u5F85\u4EBA\u5DE5\u8F93\u5165",a.humanRequest){let p=document.createElement("div");p.style.cssText="font-size:11px;color:var(--text-tertiary);margin-top:2px;padding:6px 8px;background:var(--bg-card);border-radius:4px;border-left:2px solid #f59e0b;",p.textContent=a.humanRequest.slice(0,100)+(a.humanRequest.length>100?"...":""),d.appendChild(p)}c.appendChild(d)}if(a.output){let d=document.createElement("pre");d.className="wf-step-output",d.textContent=a.output.slice(-300),c.appendChild(d)}i.appendChild(c),s.appendChild(i)}requestAnimationFrame(()=>{s.scrollTop=s.scrollHeight})}function mi(e){if(!E.active)return;let t=E.active.steps[e.stepIndex];if(!t||t.mode!=="parallel")return;t.agentOutputs||(t.agentOutputs=(t.agents||[]).map(n=>({agentId:n.agentId,output:"",status:"pending"})));let s=t.agentOutputs[e.agentIndex];s&&(e.type==="workflow:step:output"?(s.status="running",s.output+=e.data||"",s.output.length>3e3&&(s.output="..."+s.output.slice(-2970))):e.type==="workflow:step:agent:complete"&&(s.status=e.exitCode===0?"completed":"error",!s.output&&e.output&&(s.output=e.output))),oe()}function Hc(e){switch(e.type){case"workflow:started":{E.active&&E.active.status==="running"&&(E.active.wfId=e.workflowId,E.active.totalSteps=e.totalSteps);break}case"workflow:step:start":{if(!E.active)break;let t=E.active.steps[e.stepIndex];t&&(t.status="running",E.active.currentStep=e.stepIndex),oe();break}case"workflow:step:output":{if(!E.active)break;let t=E.active.steps[e.stepIndex];if(t){if(t.mode==="parallel"&&e.agentIndex!==void 0){mi(e);break}t.output+=e.data,t.output.length>5e3&&(t.output="..."+t.output.slice(-4970)),oe()}break}case"workflow:step:agent:complete":{if(!E.active)break;mi(e);break}case"workflow:step:complete":{if(!E.active)break;let t=E.active.steps[e.stepIndex];t&&(t.status=e.exitCode===0?"completed":"error",!t.output&&e.output&&(t.output=e.output)),oe();break}case"workflow:step:error":{if(!E.active)break;let t=E.active.steps[e.stepIndex];t&&(t.status="error",t.output=(t.output||"")+`
[Error] `+(e.error||"Unknown error")),oe();break}case"workflow:progress":{E.active&&(E.active.currentStep=e.currentStep);break}case"workflow:completed":{if(E.active){E.active.status="completed";let t=E.active.steps.filter(s=>s.status==="completed").length;Ee(`\u2705 ${E.active.name} completed (${t}/${E.active.steps.length} steps)`,"success"),Ve(),oe()}break}case"workflow:cancelled":{E.active&&(E.active.status="cancelled",Ee("\u23F9 Workflow cancelled","info"),Ve(),oe());break}case"human:request":{if(ze.DigitalEmployees?.handleWSMessage&&ze.DigitalEmployees.handleWSMessage(e),E.active&&e.stepIndex!==void 0){let t=E.active.steps[e.stepIndex];t&&(t.status="await_human",t.humanRequest=e.question),oe()}break}case"workflow:error":{Ee("Workflow error: "+(e.message||"unknown"),"error");break}}}function zc(){if(E.active&&E.active.status==="running"){E.active.status="error";for(let e of E.active.steps)(e.status==="pending"||e.status==="running")&&(e.status="error",e.output=(e.output||"")+`
[Disconnected] WebSocket connection lost`);Ee("\u23F9 Workflow interrupted \u2014 connection lost","error"),Ve(),oe()}}function Ee(e,t){let s=document.getElementById("wf-toast")||(()=>{let n=document.createElement("div");return n.id="wf-toast",n.className="wf-toast",document.body.appendChild(n),n})();s.textContent=e,s.className="wf-toast "+(t||"info"),s.classList.add("visible"),clearTimeout(s._timer),s._timer=setTimeout(()=>s.classList.remove("visible"),3e3)}function yi(){let e=ze.UIRegistry;if(!e){setTimeout(yi,300);return}e.registerTab("workflows",{icon:"\u26A1",label:"\u5DE5\u4F5C\u6D41",category:"digital",order:6,render:t=>{gi=t,hi()}}),console.log("[Workflows] Panel registered as right-panel tab")}yi();var Nc={loadWorkflows:hi,renderWorkflowList:Ve,startWorkflow:fs,cancelWorkflow:vi,handleWSMessage:Hc,handleDisconnect:zc,showWorkflowProgress:bi,updateProgressDisplay:oe,workflows:E,showWfToast:Ee};ze.Workflows=Nc;var $=window.QCLI=window.QCLI||{},xi=["pending","blocked","running","waiting_human","completed","failed","skipped"],Tn={pending:{label:"\u5F85\u8FD0\u884C",color:"var(--text-tertiary)",icon:"\u25CB"},blocked:{label:"\u963B\u585E",color:"var(--accent-purple)",icon:"\u26D4"},running:{label:"\u8FD0\u884C\u4E2D",color:"var(--info)",icon:"\u27F3"},completed:{label:"\u5B8C\u6210",color:"var(--success)",icon:"\u2705"},failed:{label:"\u5931\u8D25",color:"var(--danger)",icon:"\u274C"},skipped:{label:"\u8DF3\u8FC7",color:"var(--text-tertiary)",icon:"\u23ED"},waiting_human:{label:"\u5F85\u4EBA\u5DE5",color:"var(--warning)",icon:"\u{1F64B}"}},_={workflows:[],activeRun:null,panel:null,filter:null};function Ie(e){return document.getElementById(e)}function zt(e){$.wsSend&&$.wsSend(e)}var We=null,Cn=null;async function In(){if(We)return We;try{let e=await fetch("/api/digital-employees/roles");if(e.ok){let t=await e.json();We=Array.isArray(t.roles)?t.roles:[],Cn=new Map(We.map(s=>[s.role,s]))}}catch{}return We||[]}function Ht(e){return Cn&&Cn.get(e)||null}function _n(){let e=['<option value="">\uFF08\u65E0\u89D2\u8272\uFF09</option>'];for(let t of We||[])e.push(`<option value="${h(t.role)}">${h(t.icon||"")} ${h(t.name||t.role)}</option>`);return e.join("")}function Ln(e,t){e&&(e.innerHTML=_n(),t&&(e.value=t))}var Ge=null,qc=null;async function Mn(){if(Ge)return Ge;try{let e=await fetch("/api/skills");if(e.ok){let t=await e.json();Ge=Array.isArray(t.skills)?t.skills:[],qc=new Map(Ge.map(s=>[s.id,s]))}}catch{}return Ge||[]}function An(){let e=['<option value="">\uFF08\u65E0\u6280\u80FD\uFF09</option>'];for(let t of Ge||[])e.push(`<option value="${h(t.id)}">\u{1F6E0} ${h(t.name||t.id)}</option>`);return e.join("")}function En(e,t){e&&(e.innerHTML=An(),t&&(e.value=t))}var Je=null,Oc=null;async function $n(){if(Je)return Je;try{let e=await fetch("/api/experts");if(e.ok){let t=await e.json();Je=Array.isArray(t.experts)?t.experts:[],Oc=new Map(Je.map(s=>[s.id,s]))}}catch{}return Je||[]}function Rn(){let e=['<option value="">\uFF08\u65E0\u4E13\u5BB6\uFF09</option>'];for(let t of Je||[])e.push(`<option value="${h(t.id)}">${h(t.icon||"\u{1F9D1}\u200D\u{1F4BC}")} ${h(t.name||t.id)}</option>`);return e.join("")}function Sn(e,t){e&&(e.innerHTML=Rn(),t&&(e.value=t))}function ms(e,t){return(!_.activeRun||_.activeRun.wfId!==e)&&(_.activeRun={wfId:e,name:t||"",tasks:new Map,order:[],ended:!1,outcome:null}),t&&!_.activeRun.name&&(_.activeRun.name=t),_.activeRun}async function Bn(){try{let e=await fetch("/api/workflows");if(!e.ok)return;let s=(await e.json()).workflows||[];_.workflows=s.filter(n=>n.tasks&&Array.isArray(n.tasks)&&n.tasks.length>0),Qc()}catch(e){console.warn("[Orchestrator] Load workflows failed:",e)}}function wi(e,t){let s=e;for(let[n,a]of Object.entries(t||{}))s=s.replace(new RegExp("\\{\\{\\s*"+n+"\\s*\\}\\}","gi"),a);return s}function Ci(e){if(_.activeRun&&!_.activeRun.ended){$.showToast?.("\u26A0\uFE0F \u5DF2\u6709\u8FD0\u884C\u4E2D\u7684\u7F16\u6392\uFF0C\u8BF7\u5148\u53D6\u6D88","error");return}let t=e.variables||{};if(Object.keys(t).length>0){jc(e);return}Pn(e,{})}function Pn(e,t){let s=(e.tasks||[]).map(n=>{let a=Object.assign({},n);return a.task&&(a.task=wi(a.task,t)),a.agents&&(a.agents=a.agents.map(o=>Object.assign({},o,{task:o.task?wi(o.task,t):o.task}))),a});if(zt({type:"workflow:run",name:e.name,tasks:s,maxConcurrency:e.maxConcurrency||4,variables:t}),$.showToast?.("\u{1F680} \u5DF2\u542F\u52A8\u7F16\u6392\uFF1A"+(e.name||"DAG"),"info"),_.panel){let n=Ie("orch-run");n&&n.scrollIntoView({behavior:"smooth",block:"start"})}}function jc(e){let t=e.variables||{},s=Object.keys(t),n="";for(let i of s){let r=t[i],c=r.label||i,l=r.default||"",d=r.required?"required":"";if(r.type==="select"&&r.options){n+=`<label>${h(c)}<select id="orch-var-${i}" class="orch-input" ${d}>`;for(let p of r.options)n+=`<option value="${h(p)}"${p===l?" selected":""}>${h(p)}</option>`;n+="</select></label>"}else r.type==="number"?n+=`<label>${h(c)}<input type="number" id="orch-var-${i}" class="orch-input" value="${h(l)}" ${d}></label>`:n+=`<label>${h(c)}<input type="text" id="orch-var-${i}" class="orch-input" value="${h(l)}" placeholder="${h(r.placeholder||"")}" ${d}></label>`}let a=document.createElement("div");a.className="modal-overlay hidden",a.id="orch-var-modal",a.innerHTML=`
    <div class="modal orch-modal">
      <h2>\u{1F916} ${h(e.name||"\u7F16\u6392")}</h2>
      <div class="orch-var-form">${n}</div>
      <div class="modal-actions">
        <button id="orch-var-cancel" class="secondary-btn">\u53D6\u6D88</button>
        <button id="orch-var-start" class="primary-btn">\u25B6 \u542F\u52A8</button>
      </div>
    </div>`,document.body.appendChild(a),requestAnimationFrame(()=>a.classList.remove("hidden"));function o(){a.classList.add("hidden"),setTimeout(()=>a.remove(),250)}a.querySelector("#orch-var-cancel").addEventListener("click",o),a.addEventListener("click",i=>{i.target===a&&o()}),a.querySelector("#orch-var-start").addEventListener("click",()=>{let i={},r=!1;for(let c of s){let l=Ie("orch-var-"+c),d=l?l.value.trim():"";if(t[c].required&&!d){r=!0,l?.focus(),$.showToast?.("\u8BF7\u586B\u5199\uFF1A"+(t[c].label||c),"error");break}i[c]=d||t[c].default||""}r||(o(),Pn(e,i))})}function Dc(){let e=document.createElement("div");e.className="modal-overlay hidden",e.id="orch-composer-modal",e.innerHTML=`
    <div class="modal orch-modal orch-composer">
      <h2>\u{1F6E0} \u81EA\u5B9A\u4E49\u7F16\u6392\uFF08DAG\uFF09</h2>
      <div class="orch-form-row">
        <label>\u540D\u79F0<input type="text" id="orch-c-name" class="orch-input" placeholder="\u6211\u7684\u7F16\u6392" value="\u81EA\u5B9A\u4E49\u7F16\u6392"></label>
        <label>\u5E76\u53D1\u4E0A\u9650<input type="number" id="orch-c-conc" class="orch-input" value="4" min="1" max="16"></label>
      </div>
      <div class="orch-task-list" id="orch-c-tasks"></div>
      <button id="orch-c-addtask" class="secondary-btn">\uFF0B \u6DFB\u52A0\u4EFB\u52A1</button>
      <div class="modal-actions">
        <button id="orch-c-preview" class="secondary-btn">\u{1F578} \u9884\u89C8\u56FE</button>
        <button id="orch-c-export" class="secondary-btn">\u{1F4BE} \u5BFC\u51FA</button>
        <button id="orch-c-cancel" class="secondary-btn">\u53D6\u6D88</button>
        <button id="orch-c-run" class="primary-btn">\u{1F680} \u8FD0\u884C</button>
      </div>
      <div id="orch-c-error" class="form-error hidden"></div>
    </div>`,document.body.appendChild(e),requestAnimationFrame(()=>e.classList.remove("hidden"));let t=e.querySelector("#orch-c-tasks");function s(i){let r=document.createElement("div");r.className="orch-task-row",r.innerHTML=`
      <div class="orch-task-row-head">
        <input class="orch-input orch-t-id" placeholder="id (\u5982 t1)" value="${h(i?.id||"")}">
        <input class="orch-input orch-t-label" placeholder="\u6807\u7B7E" value="${h(i?.label||"")}">
        <input class="orch-input orch-t-agent" placeholder="agentId (opencode)" value="${h(i?.agentId||"opencode")}">
        <input class="orch-input orch-t-deps" placeholder="\u4F9D\u8D56(\u9017\u53F7\u5206\u9694 id)" value="${h((i?.dependsOn||[]).join(","))}">
        <button class="orch-t-del" title="\u5220\u9664">\u2715</button>
      </div>
      <select class="orch-input orch-t-role" title="\u4E13\u5BB6\u56E2\u89D2\u8272\uFF08\u53EF\u9009\uFF09">${_n()}</select>
      <select class="orch-input orch-t-skill" title="\u6280\u80FD\uFF08\u53EF\u9009\uFF0C\u6444\u5165\u81EA\u6280\u80FD\u5E93\uFF09">${An()}</select>
      <select class="orch-input orch-t-expert" title="\u4E13\u5BB6\uFF08\u53EF\u9009\uFF0C\u6444\u5165\u81EA\u4E13\u5BB6\u5E93\uFF09">${Rn()}</select>
      <textarea class="orch-input orch-t-task" rows="2" placeholder="\u4EFB\u52A1\u6307\u4EE4 (prompt) \u2014\u2014 \u8FD0\u884C/\u5BFC\u51FA\u65F6\u4F7F\u7528">${h(i?.task||"")}</textarea>`,r.querySelector(".orch-t-del").addEventListener("click",()=>r.remove()),Ln(r.querySelector(".orch-t-role"),i?.role||""),En(r.querySelector(".orch-t-skill"),i?.skillId||""),Sn(r.querySelector(".orch-t-expert"),i?.expertId||""),t.appendChild(r)}s({id:"t1",label:"\u6536\u96C6\u4FE1\u606F",agentId:"opencode",task:""}),s({id:"t2",label:"\u5206\u6790",agentId:"opencode",dependsOn:["t1"],task:""}),(!We||!Ge||!Je)&&Promise.all([In(),Mn(),$n()]).then(()=>{t.querySelectorAll(".orch-t-role").forEach(i=>Ln(i,i.value)),t.querySelectorAll(".orch-t-skill").forEach(i=>En(i,i.value)),t.querySelectorAll(".orch-t-expert").forEach(i=>Sn(i,i.value))});function n(){let i=t.querySelectorAll(".orch-task-row"),r=[],c=new Set,l="";return i.forEach(d=>{let p=d.querySelector(".orch-t-id").value.trim(),u=d.querySelector(".orch-t-label").value.trim(),f=d.querySelector(".orch-t-agent").value.trim()||"opencode",m=d.querySelector(".orch-t-deps").value.split(",").map(T=>T.trim()).filter(Boolean),g=d.querySelector(".orch-t-task").value,b=d.querySelector(".orch-t-role").value.trim(),x=d.querySelector(".orch-t-skill").value.trim(),v=d.querySelector(".orch-t-expert").value.trim(),w=b?Ht(b):null;if(!p){l="\u6BCF\u4E2A\u4EFB\u52A1\u90FD\u9700\u8981 id";return}if(c.has(p)){l="\u4EFB\u52A1 id \u91CD\u590D\uFF1A"+p;return}c.add(p),r.push({id:p,label:u||p,agentId:f,dependsOn:m,task:g,mode:"serial",role:b||void 0,roleName:w?w.name:void 0,persona:w?w.persona:void 0,skillId:x||void 0,expertId:v||void 0})}),{tasks:r,errMsg:l}}function a(i){let r=e.querySelector("#orch-c-error");r.textContent=i,r.classList.remove("hidden")}e.querySelector("#orch-c-addtask").addEventListener("click",()=>s({})),e.querySelector("#orch-c-cancel").addEventListener("click",o),e.addEventListener("click",i=>{i.target===e&&o()}),e.querySelector("#orch-c-preview").addEventListener("click",()=>{let{tasks:i,errMsg:r}=n();if(r){a(r);return}if(i.length===0){a("\u8BF7\u81F3\u5C11\u6DFB\u52A0\u4E00\u4E2A\u4EFB\u52A1");return}Ii("\u4F9D\u8D56\u56FE\u9884\u89C8 \xB7 "+(e.querySelector("#orch-c-name").value.trim()||"\u81EA\u5B9A\u4E49\u7F16\u6392"),i)}),e.querySelector("#orch-c-export").addEventListener("click",()=>{let i=e.querySelector("#orch-c-name").value.trim()||"\u81EA\u5B9A\u4E49\u7F16\u6392",r=parseInt(e.querySelector("#orch-c-conc").value,10)||4,{tasks:c,errMsg:l}=n();if(l){a(l);return}if(c.length===0){a("\u8BF7\u81F3\u5C11\u6DFB\u52A0\u4E00\u4E2A\u4EFB\u52A1");return}Kc({name:i,maxConcurrency:r,tasks:c})}),e.querySelector("#orch-c-run").addEventListener("click",()=>{let i=e.querySelector("#orch-c-name").value.trim()||"\u81EA\u5B9A\u4E49\u7F16\u6392",r=parseInt(e.querySelector("#orch-c-conc").value,10)||4,{tasks:c,errMsg:l}=n();if(l){a(l);return}if(c.length===0){a("\u8BF7\u81F3\u5C11\u6DFB\u52A0\u4E00\u4E2A\u4EFB\u52A1");return}o(),Pn({name:i,maxConcurrency:r,tasks:c},{})});function o(){e.classList.add("hidden"),setTimeout(()=>e.remove(),250)}}function Fc(){let e=_.activeRun;if(!e||e.ended){$.showToast?.("\u8BF7\u5148\u8FD0\u884C\u4E00\u4E2A\u7F16\u6392","error");return}let t=[...e.tasks.keys()],s=document.createElement("div");s.className="modal-overlay hidden",s.id="orch-addtask-modal",s.innerHTML=`
    <div class="modal orch-modal">
      <h2>\u2795 \u52A8\u6001\u6DFB\u52A0\u4EFB\u52A1</h2>
      <label>\u4EFB\u52A1 id<input type="text" id="orch-at-id" class="orch-input" placeholder="task-extra"></label>
      <label>\u6807\u7B7E<input type="text" id="orch-at-label" class="orch-input" placeholder="\u8865\u5145\u8C03\u7814"></label>
      <label>Agent ID<input type="text" id="orch-at-agent" class="orch-input" value="opencode"></label>
      <label>\u4E13\u5BB6\u56E2\u89D2\u8272<select id="orch-at-role" class="orch-input">${_n()}</select></label>
      <label>\u6280\u80FD\uFF08\u53EF\u9009\uFF09<select id="orch-at-skill" class="orch-input">${An()}</select></label>
      <label>\u4E13\u5BB6\uFF08\u53EF\u9009\uFF09<select id="orch-at-expert" class="orch-input">${Rn()}</select></label>
      <label>\u4F9D\u8D56\uFF08\u5DF2\u6709\u4EFB\u52A1 id\uFF0C\u9017\u53F7\u5206\u9694\uFF09<input type="text" id="orch-at-deps" class="orch-input" placeholder="${t.slice(0,3).join(", ")}"></label>
      <label>\u4EFB\u52A1\u6307\u4EE4\uFF08prompt\uFF09<textarea id="orch-at-task" class="orch-input" rows="4" placeholder="\u8981\u8BE5 Agent \u505A\u7684\u4E8B..."></textarea></label>
      <div class="modal-actions">
        <button id="orch-at-cancel" class="secondary-btn">\u53D6\u6D88</button>
        <button id="orch-at-send" class="primary-btn">\u53D1\u9001</button>
      </div>
      <div id="orch-at-error" class="form-error hidden"></div>
    </div>`,document.body.appendChild(s),requestAnimationFrame(()=>s.classList.remove("hidden")),Promise.all([In(),Mn(),$n()]).then(()=>{let a=s.querySelector("#orch-at-role");a&&Ln(a,a.value);let o=s.querySelector("#orch-at-skill");o&&En(o,o.value);let i=s.querySelector("#orch-at-expert");i&&Sn(i,i.value)});function n(){s.classList.add("hidden"),setTimeout(()=>s.remove(),250)}s.querySelector("#orch-at-cancel").addEventListener("click",n),s.addEventListener("click",a=>{a.target===s&&n()}),s.querySelector("#orch-at-send").addEventListener("click",()=>{let a=s.querySelector("#orch-at-id").value.trim(),o=s.querySelector("#orch-at-label").value.trim(),i=s.querySelector("#orch-at-agent").value.trim()||"opencode",r=s.querySelector("#orch-at-role").value.trim(),c=s.querySelector("#orch-at-skill").value.trim(),l=s.querySelector("#orch-at-expert").value.trim(),d=r?Ht(r):null,p=s.querySelector("#orch-at-deps").value.split(",").map(m=>m.trim()).filter(Boolean),u=s.querySelector("#orch-at-task").value.trim(),f=s.querySelector("#orch-at-error");if(!a||!u){f.textContent="id \u548C\u4EFB\u52A1\u6307\u4EE4\u5FC5\u586B",f.classList.remove("hidden");return}zt({type:"workflow:addTask",task:{id:a,label:o||a,agentId:i,task:u,dependsOn:p,mode:"serial",role:r||void 0,roleName:d?d.name:void 0,persona:d?d.persona:void 0,skillId:c||void 0,expertId:l||void 0}}),$.showToast?.("\u2795 \u5DF2\u63D0\u4EA4\u52A8\u6001\u4EFB\u52A1\uFF1A"+a,"info"),n()})}function Li(e,t){zt({type:"human:respond",taskId:e,answer:t}),$.showToast?.("\u{1F64B} \u5DF2\u63D0\u4EA4\u4EBA\u5DE5\u56DE\u590D","success")}function Uc(e,t){!t||!t.trim()||(zt({type:"agent:msg",kind:"request",from:"orchestrator",to:e,payload:t.trim()}),$.showToast?.("\u{1F4E8} \u5DF2\u53D1\u9001\u6D88\u606F\u7ED9 "+e,"info"))}function Ei(){let e=_.activeRun;if(!e){$.showToast?.("\u5F53\u524D\u6CA1\u6709\u8FD0\u884C\u4E2D\u7684\u7F16\u6392","info");return}if(e.ended){$.showToast?.("\u8BE5\u7F16\u6392\u5DF2\u7ED3\u675F","info");return}e._cancelling||(e._cancelling=!0,zt({type:"workflow:cancel",wfId:e.wfId}),$.showToast?.("\u23F9 \u6B63\u5728\u53D6\u6D88\u7F16\u6392\uFF1A"+(e.name||""),"info"),Xe(),e._cancelTimer=setTimeout(()=>{e._cancelling&&!e.ended&&(e._cancelling=!1,e.ended=!0,e.outcome="cancelled",Ke(),Ye(),Xe(),$.showToast?.("\u23F9 \u5DF2\u5F3A\u5236\u53D6\u6D88\uFF08\u672A\u6536\u5230\u540E\u7AEF\u786E\u8BA4\uFF0C\u7F16\u6392\u53EF\u80FD\u4ECD\u5728\u540E\u53F0\u8FD0\u884C\uFF09","error"))},8e3))}function Qc(){let e=Ie("orch-wf-list");if(e){if(_.workflows.length===0){e.innerHTML='<div class="orch-empty">\u672A\u53D1\u73B0 DAG \u5DE5\u4F5C\u6D41\u3002\u53EF\u7528\u300C\u81EA\u5B9A\u4E49\u7F16\u6392\u300D\u521B\u5EFA\u3002</div>';return}e.innerHTML="";for(let t of _.workflows){let s=document.createElement("div");s.className="orch-wf-item";let n=(t.tasks||[]).length;s.innerHTML=`
      <div class="orch-wf-info">
        <div class="orch-wf-name">${h(t.icon||"\u{1F916}")} ${h(t.name)}</div>
        <div class="orch-wf-desc">${h(t.description||"")}</div>
        <div class="orch-wf-meta"><span class="orch-badge">DAG</span><span>${n} \u4EFB\u52A1</span><span>\u5E76\u884C ${t.maxConcurrency||4}</span></div>
      </div>
      <button class="primary-btn orch-wf-run" data-id="${h(t.id)}">\u25B6 \u8FD0\u884C</button>`,s.querySelector(".orch-wf-run").addEventListener("click",()=>{let a=_.workflows.find(o=>o.id===t.id);a&&Ci(a)}),e.appendChild(s)}}}function Ke(){let e=Ie("orch-status-bar");if(!e)return;let t=_.activeRun;if(!t){e.innerHTML="";return}let s={};xi.forEach(n=>s[n]=0);for(let n of t.tasks.values())s[n.status]=(s[n.status]||0)+1;e.innerHTML=xi.map(n=>{let a=Tn[n];return`<button class="orch-status-chip${_.filter===n?" active":""}" data-status="${n}" style="--chip:${a.color}">
      <span class="orch-chip-dot"></span>${a.icon} ${a.label} <b>${s[n]}</b></button>`}).join(""),e.querySelectorAll(".orch-status-chip").forEach(n=>{n.addEventListener("click",()=>{_.filter=_.filter===n.dataset.status?null:n.dataset.status,Ke(),Ye()})})}function Vc(e){let t=Tn[e.status]||Tn.pending,s=document.createElement("div");s.className="orch-card status-"+e.status,s.dataset.taskId=e.id,s.style.setProperty("--stripe",t.color);let n=e.dependsOn&&e.dependsOn.length?'<span class="orch-card-deps">\u4F9D\u8D56\uFF1A'+e.dependsOn.map(p=>h(p)).join(", ")+"</span>":"",a=e.mode==="parallel"?"\u5E76\u884C "+(e.agents||[]).map(p=>h(p.agentId)).join("+"):e.agentId?h(e.agentId):e.type==="await_human"?"\u{1F64B} \u4EBA\u5DE5":"\u2014",o=e.retries&&e.retries>0?`<span class="orch-card-retry">\u21BB${e.retries}</span>`:"",i=e.role&&Ht(e.role)?Ht(e.role):null,r=i?`<span class="orch-card-role" style="--role-color:${h(i.color||"var(--accent)")}">${h(i.icon||"")} ${h(i.name||e.role)}</span>`:"";s.innerHTML=`
    <div class="orch-card-head">
      <span class="orch-card-status" style="color:${t.color}">${t.icon}</span>
      <span class="orch-card-label">${h(e.label||e.id)}</span>
      ${o}
    </div>
    <div class="orch-card-sub">
      <span class="orch-card-owner">${a}</span>
      ${r}
      ${n}
    </div>
    <div class="orch-card-actions"></div>
    <div class="orch-card-output hidden"></div>`;let c=s.querySelector(".orch-card-actions");if(e.status==="waiting_human"){let p=document.createElement("div");p.className="orch-human-box",p.innerHTML=`
      <textarea class="orch-input orch-human-input" rows="2" placeholder="\u8F93\u5165\u4EBA\u5DE5\u56DE\u590D..."></textarea>
      <button class="primary-btn orch-human-send">\u63D0\u4EA4\u56DE\u590D</button>`,p.querySelector(".orch-human-send").addEventListener("click",()=>{let u=p.querySelector(".orch-human-input"),f=u.value.trim();if(!f){u.focus();return}Li("wf-"+_.activeRun.wfId+"-"+e.id,f)}),c.appendChild(p)}else if(e.status==="running"){let p=document.createElement("button");p.className="orch-mini-btn",p.textContent="\u{1F4E8} \u53D1\u6D88\u606F",p.addEventListener("click",()=>{let u=window.prompt("\u53D1\u9001\u7ED9 "+e.id+" \u7684\u6D88\u606F\uFF1A");u&&Uc(e.id,u)}),c.appendChild(p)}let l=s.querySelector(".orch-card-output"),d=document.createElement("button");return d.className="orch-mini-btn orch-toggle-out",d.textContent="\u{1F4C4} \u8F93\u51FA",d.addEventListener("click",()=>{l.classList.toggle("hidden"),!l.classList.contains("hidden")&&!l.dataset.filled&&(l.textContent=e.output&&e.output.trim()?e.output.slice(-4e3):"\uFF08\u6682\u65E0\u8F93\u51FA\uFF09",l.dataset.filled="1")}),c.appendChild(d),s}function Ye(){let e=Ie("orch-board");if(!e)return;let t=_.activeRun;if(!t||t.tasks.size===0){e.innerHTML='<div class="orch-empty">\u6682\u65E0\u4EFB\u52A1\u3002\u8FD0\u884C\u4E0A\u65B9 DAG \u5DE5\u4F5C\u6D41\uFF0C\u6216\u70B9\u300C\u81EA\u5B9A\u4E49\u7F16\u6392\u300D\u3002</div>';return}e.innerHTML="";for(let s of t.order){let n=t.tasks.get(s);n&&(_.filter&&n.status!==_.filter||e.appendChild(Vc(n)))}e.children.length===0&&(e.innerHTML='<div class="orch-empty">\u5F53\u524D\u8FC7\u6EE4\u6761\u4EF6\u4E0B\u6CA1\u6709\u4EFB\u52A1\u3002</div>')}function Xe(){let e=_.activeRun,t=Ie("orch-run-name"),s=Ie("orch-run-outcome"),n=Ie("orch-cancel"),a=Ie("orch-add-task");t&&(t.textContent=e?e.name||"\u7F16\u6392 #"+e.wfId:""),s&&(s.className="orch-outcome",e&&e.outcome?(s.textContent=e.outcome==="completed"?"\u2705 \u5B8C\u6210":e.outcome==="failed"?"\u274C \u5931\u8D25":"\u23F9 \u5DF2\u53D6\u6D88",s.classList.add(e.outcome)):e?s.textContent="\u8FD0\u884C\u4E2D\u2026":s.textContent=""),n&&(e&&e._cancelling&&!e.ended?(n.disabled=!0,n.textContent="\u23F3 \u53D6\u6D88\u4E2D\u2026"):(n.disabled=!(e&&!e.ended),n.textContent="\u23F9 \u53D6\u6D88")),a&&(a.disabled=!(e&&!e.ended))}function Wc(e){switch(e.type){case"task:added":{let t=ms(e.workflowId,""),s=e.task;t.tasks.has(s.id)||t.order.push(s.id),t.tasks.set(s.id,Object.assign(t.tasks.get(s.id)||{},{id:s.id,label:s.label,agentId:s.agentId,mode:s.mode,type:s.type,dependsOn:s.dependsOn||[],status:s.status||"pending",retries:s.retries||0,maxRetries:s.maxRetries,onFailure:s.onFailure,output:t.tasks.get(s.id)?.output||"",error:null})),Ke(),Ye(),Xe();break}case"task:status":{let t=_.activeRun;if(!t)break;let s=t.tasks.get(e.taskId);if(!s)break;s.status=e.status,e.error&&(s.error=e.error),e.retry&&(s.retries=e.retry),Ke(),Ye(),Xe();break}case"task:output":{let t=_.activeRun;if(!t)break;let s=t.tasks.get(e.taskId);if(!s)break;s.output=(s.output||"")+(e.data||""),s.output.length>8e3&&(s.output="\u2026"+s.output.slice(-7900));let n=document.querySelector('.orch-card[data-task-id="'+Gc(e.taskId)+'"] .orch-card-output');n&&!n.classList.contains("hidden")&&(n.textContent=s.output.slice(-4e3),n.dataset.filled="1");break}case"task:agent:complete":break;case"agent:msg":{let t=_.activeRun,s=e.kind==="request"?e.from+" \u2192 "+e.to:e.to+" \u2192 "+e.from;if($.showToast?.("\u{1F4E8} Agent \u6D88\u606F ["+e.kind+"] "+s+"\uFF1A"+String(e.payload||"").slice(0,60),"info"),t){let n=t.tasks.get(e.to);if(n){let a=`
[agent:msg `+e.kind+" "+s+"] "+(e.payload||"")+`
`;n.output=(n.output||"")+a}}break}case"human:request":{let t=_.activeRun;t&&e.workflowId&&ms(e.workflowId,t.name);break}case"workflow:started":{let t=ms(e.workflowId,e.name||"");t.ended=!1,t.outcome=null,Ke(),Ye(),Xe();break}case"workflow:completed":case"workflow:failed":case"workflow:cancelled":{let t=ms(e.workflowId,_.activeRun?_.activeRun.name:"");t.ended=!0,t._cancelling=!1,t._cancelTimer&&(clearTimeout(t._cancelTimer),t._cancelTimer=null),t.outcome=e.type==="workflow:completed"?"completed":e.type==="workflow:failed"?"failed":"cancelled",e.summary&&(t.summary=e.summary),Ke(),Ye(),Xe(),t.outcome==="completed"?$.showToast?.("\u2705 \u7F16\u6392\u5B8C\u6210\uFF1A"+(t.name||""),"success"):t.outcome==="failed"?$.showToast?.("\u274C \u7F16\u6392\u5931\u8D25\uFF1A"+(t.name||""),"error"):t.outcome==="cancelled"&&$.showToast?.("\u23F9 \u5DF2\u53D6\u6D88\u7F16\u6392\uFF1A"+(t.name||""),"info");break}case"workflow:error":{$.showToast?.("\u26A0\uFE0F \u7F16\u6392\u9519\u8BEF\uFF1A"+(e.message||"\u672A\u77E5"),"error");break}}}function Gc(e){return String(e).replace(/"/g,'\\"')}function ki(e){let t=String(e??"").replace(/[^A-Za-z0-9_]/g,"_");return t||(t="n"),/^[0-9]/.test(t)&&(t="n_"+t),t}function Jc(e){let t={},s={},n=Array.isArray(e)?e:[];for(let o of n){let i=o.id!=null?String(o.id):"";t[i]=ki(i),s[i]=o.label!=null&&String(o.label).trim()?String(o.label):i}for(let o of n)for(let i of o.dependsOn||[]){let r=String(i);t[r]||(t[r]=ki(r),s[r]=r)}let a=["flowchart TD"];for(let o of Object.keys(t)){let i=String(s[o]||o).replace(/"/g,"'").replace(/\r?\n/g," ").slice(0,60);i||(i=o);let r=n.find(c=>String(c.id)===o);if(r&&r.role){let c=Ht(r.role);c&&(i=(i+" \xB7 "+(c.icon||"")+(c.name||r.role)).slice(0,80))}a.push("  "+t[o]+'["'+i+'"]')}for(let o of n){let i=t[o.id!=null?String(o.id):""];for(let r of o.dependsOn||[]){let c=t[String(r)];i&&c&&a.push("  "+c+" --> "+i)}}return a.join(`
`)}function Si(e,t,s){let n=new Blob([e],{type:(s||"text/plain")+";charset=utf-8"}),a=URL.createObjectURL(n),o=document.createElement("a");o.href=a,o.download=t,document.body.appendChild(o),o.click(),o.remove(),setTimeout(()=>URL.revokeObjectURL(a),5e3)}function Ii(e,t){let s=Jc(t),n=document.createElement("div");n.className="modal-overlay hidden",n.id="orch-dag-modal",n.innerHTML=`
    <div class="modal orch-modal orch-dag-modal">
      <h2>\u{1F578} ${h(e||"\u4F9D\u8D56\u5173\u7CFB\u56FE (DAG)")}</h2>
      <div id="orch-dag-render" class="orch-dag-render"><div class="orch-dag-loading">\u23F3 \u6E32\u67D3\u4E2D\u2026</div></div>
      <details class="orch-dag-src">
        <summary>\u{1F4C4} Mermaid \u6E90\u7801</summary>
        <pre id="orch-dag-mmd"></pre>
      </details>
      <div class="modal-actions">
        <button id="orch-dag-copy" class="secondary-btn">\u{1F4CB} \u590D\u5236\u6E90\u7801</button>
        <button id="orch-dag-dl" class="secondary-btn">\u2B07 \u4E0B\u8F7D .mmd</button>
        <button id="orch-dag-close" class="primary-btn">\u5173\u95ED</button>
      </div>
    </div>`,document.body.appendChild(n),requestAnimationFrame(()=>n.classList.remove("hidden")),n.querySelector("#orch-dag-mmd").textContent=s;let a=n.querySelector("#orch-dag-render");function o(){if(window.mermaid&&$.DiagramRenderer)a.innerHTML="",$.DiagramRenderer.renderSingle(a,"mermaid",s).catch(r=>{a.innerHTML='<div class="orch-dag-error">\u26A0\uFE0F \u6D41\u7A0B\u56FE\u6E32\u67D3\u5931\u8D25\uFF1A'+h(r&&r.message?r.message:"")+"</div>"});else{a.innerHTML='<div class="orch-dag-loading">\u23F3 Mermaid \u5E93\u52A0\u8F7D\u4E2D\u2026\uFF08\u6E90\u7801\u5DF2\u5728\u4E0B\u65B9\u63D0\u4F9B\uFF09</div>';let r=setInterval(()=>{window.mermaid&&$.DiagramRenderer&&(clearInterval(r),a.innerHTML="",$.DiagramRenderer.renderSingle(a,"mermaid",s))},400);setTimeout(()=>clearInterval(r),1e4)}}o(),n.querySelector("#orch-dag-copy").addEventListener("click",()=>{navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(s).then(()=>$.showToast?.("\u2705 \u5DF2\u590D\u5236 Mermaid \u6E90\u7801","success"),()=>$.showToast?.("\u590D\u5236\u5931\u8D25","error")):$.showToast?.("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u526A\u8D34\u677F","error")}),n.querySelector("#orch-dag-dl").addEventListener("click",()=>{Si(s,(e||"dag")+".mmd","text/plain")});function i(){n.classList.add("hidden"),setTimeout(()=>n.remove(),250)}n.querySelector("#orch-dag-close").addEventListener("click",i),n.addEventListener("click",r=>{r.target===n&&i()})}async function Kc(e){if(!e||!e.tasks||e.tasks.length===0){$.showToast?.("\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u4EFB\u52A1","error");return}if(/�/.test(e.name||"")){$.showToast?.("\u26A0\uFE0F \u540D\u79F0\u542B\u4E71\u7801\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165\u540D\u79F0\u540E\u518D\u5BFC\u51FA","error");return}let t={id:e.id,name:e.name,description:e.description||"\u81EA\u5B9A\u4E49\u7F16\u6392\u5BFC\u51FA\u7684 DAG \u5DE5\u4F5C\u6D41",icon:e.icon||"\u{1F916}",kind:"dag",maxConcurrency:e.maxConcurrency||4,tasks:e.tasks.map(s=>({id:s.id,label:s.label||s.id,agentId:s.agentId||"opencode",dependsOn:s.dependsOn||[],task:s.task||"",mode:s.mode||"serial",...s.role?{role:s.role,roleName:s.roleName,persona:s.persona}:{},...s.skillId?{skillId:s.skillId}:{},...s.expertId?{expertId:s.expertId}:{}}))};Si(JSON.stringify(t,null,2),(t.id||"workflow")+".json","application/json");try{let s=await fetch("/api/workflows",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)}),n=await s.json().catch(()=>({}));s.ok&&n.success?($.showToast?.("\u{1F4BE} \u5DF2\u4FDD\u5B58\u5230 workflows/"+n.file+"\uFF0C\u5DF2\u52A0\u5165\u5DE5\u4F5C\u6D41\u5217\u8868","success"),Bn()):$.showToast?.("\u26A0\uFE0F \u670D\u52A1\u7AEF\u4FDD\u5B58\u5931\u8D25\uFF1A"+(n.error||s.status)+"\uFF08\u5DF2\u4E0B\u8F7D\u5230\u672C\u5730\uFF09","error")}catch(s){$.showToast?.("\u26A0\uFE0F \u670D\u52A1\u7AEF\u4FDD\u5B58\u5931\u8D25\uFF1A"+(s.message||"")+"\uFF08\u5DF2\u4E0B\u8F7D\u5230\u672C\u5730\uFF09","error")}}function Yc(e){_.panel=e,e.innerHTML=`
    <div class="orch-wrap">
      <div class="orch-toolbar">
        <button id="orch-composer-btn" class="primary-btn">\u{1F6E0} \u81EA\u5B9A\u4E49\u7F16\u6392</button>
        <button id="orch-add-task" class="secondary-btn" disabled>\u2795 \u6DFB\u52A0\u4EFB\u52A1</button>
        <button id="orch-dag-btn" class="secondary-btn">\u{1F578} \u4F9D\u8D56\u56FE</button>
        <button id="orch-cancel" class="secondary-btn" disabled>\u23F9 \u53D6\u6D88</button>
      </div>

      <div class="orch-section-title">\u{1F4CB} DAG \u5DE5\u4F5C\u6D41</div>
      <div id="orch-wf-list" class="orch-wf-list"><div class="orch-empty">\u52A0\u8F7D\u4E2D\u2026</div></div>

      <div class="orch-run" id="orch-run">
        <div class="orch-run-header">
          <span id="orch-run-name" class="orch-run-name"></span>
          <span id="orch-run-outcome" class="orch-outcome"></span>
        </div>
        <div id="orch-status-bar" class="orch-status-bar"></div>
        <div id="orch-board" class="orch-board"></div>
      </div>
    </div>`,e.querySelector("#orch-composer-btn").addEventListener("click",Dc),e.querySelector("#orch-add-task").addEventListener("click",Fc),e.querySelector("#orch-dag-btn").addEventListener("click",()=>{let t=_.activeRun;if(!t||t.tasks.size===0){$.showToast?.("\u8BF7\u5148\u8FD0\u884C\u4E00\u4E2A\u7F16\u6392\u518D\u770B\u4F9D\u8D56\u56FE","info");return}let s=[...t.tasks.values()].map(n=>({id:n.id,label:n.label,agentId:n.agentId,dependsOn:n.dependsOn||[],mode:n.mode,role:n.role||void 0,roleName:n.roleName||void 0}));Ii("\u4F9D\u8D56\u5173\u7CFB\u56FE \xB7 "+(t.name||t.wfId),s)}),e.querySelector("#orch-cancel").addEventListener("click",Ei),Bn(),In(),Mn(),$n(),Ke(),Ye(),Xe()}function Ti(){$.UIRegistry&&$.UIRegistry.registerTab("orchestrator",{icon:"\u{1F39B}",label:"\u7F16\u6392",order:3,category:"digital",render:function(t){Yc(t)}})&&console.log("[Orchestrator] Tab \u7F16\u6392 registered"),_.loadWorkflows=Bn,_.runDAG=Ci,_.handleWSMessage=Wc,_.cancelRun=Ei,_.replyHuman=Li,$.Orchestrator=_}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Ti):Ti();var Ze=window.QCLI=window.QCLI||{},O={team:{totalMembers:0,idleCount:0,workingCount:0,waitingHumanCount:0,errorCount:0,members:[]},availableRoles:[],ws:null};async function Nt(){try{let e=await fetch("/api/digital-employees");if(!e.ok)return null;let t=await e.json();return O.team=t.team||O.team,O.availableRoles=t.availableRoles||[],hs(),t}catch(e){return console.warn("[DigitalEmployees] Failed to load team status:",e),null}}function hs(){let e=document.getElementById("rp-digital-employees");if(!e)return;let{team:t,availableRoles:s}=O;e.innerHTML=['<div style="padding:16px;">','<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">','<div style="font-size:14px;font-weight:600;color:var(--text-primary);">\u{1F465} \u6570\u5B57\u5458\u5DE5\u56E2\u961F</div>',`<button id="de-refresh-btn" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-tertiary);cursor:pointer;font-size:11px;transition:all 0.15s;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-tertiary)'">\u{1F504} \u5237\u65B0</button>`,"</div>",'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;">','<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">','<div style="font-size:18px;font-weight:700;color:var(--text-primary);">',String(t.totalMembers),"</div>",'<div style="font-size:10px;color:var(--text-tertiary);">\u603B\u4EBA\u6570</div></div>','<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">','<div style="font-size:18px;font-weight:700;color:#22c55e;">',String(t.idleCount),"</div>",'<div style="font-size:10px;color:var(--text-tertiary);">\u7A7A\u95F2</div></div>','<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">','<div style="font-size:18px;font-weight:700;color:#3b82f6;">',String(t.workingCount),"</div>",'<div style="font-size:10px;color:var(--text-tertiary);">\u5DE5\u4F5C\u4E2D</div></div>','<div style="background:var(--bg-card);padding:8px;border-radius:6px;text-align:center;">','<div style="font-size:18px;font-weight:700;color:',t.waitingHumanCount>0?"#f59e0b":"var(--text-tertiary)",';">',String(t.waitingHumanCount),"</div>",'<div style="font-size:10px;color:var(--text-tertiary);">\u7B49\u5F85\u4EBA\u5DE5</div></div>',"</div>",`<button id="de-register-btn" style="width:100%;padding:10px;border-radius:8px;border:1px dashed var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;margin-bottom:12px;transition:all 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">\uFF0B \u6CE8\u518C\u6570\u5B57\u5458\u5DE5</button>`,'<div style="font-size:12px;font-weight:500;margin-bottom:8px;color:var(--text-tertiary);">\u56E2\u961F\u6210\u5458</div>','<div id="de-member-list">',t.members.length===0?'<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:12px;">\u6682\u65E0\u5DF2\u6CE8\u518C\u7684\u6570\u5B57\u5458\u5DE5<br>\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u6CE8\u518C</div>':t.members.map(function(o){let i=o.status==="idle"?"#22c55e":o.status==="working"?"#3b82f6":o.status==="waiting_human"?"#f59e0b":"#ef4444",r=o.status==="idle"?"\u7A7A\u95F2":o.status==="working"?"\u5DE5\u4F5C\u4E2D":o.status==="waiting_human"?"\u7B49\u5F85\u4EBA\u5DE5":"\u9519\u8BEF";return['<div class="de-member-item" data-id="',h(o.id),`" style="display:flex;align-items:center;padding:10px 12px;background:var(--bg-card);border-radius:8px;margin-bottom:6px;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-card)'">`,'<div style="width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;margin-right:10px;background:',h(o.color),'20;">',h(o.icon),"</div>",'<div style="flex:1;min-width:0;">','<div style="font-size:13px;font-weight:500;color:var(--text-primary);">',h(o.name),"</div>",'<div style="font-size:11px;color:var(--text-tertiary);">',h(o.role)," \xB7 ",h(o.agentId),"</div>","</div>",'<div style="display:flex;align-items:center;gap:4px;">','<div style="width:8px;height:8px;border-radius:50%;background:',i,';"></div>','<span style="font-size:11px;color:var(--text-tertiary);">',r,"</span>","</div>","</div>"].join("")}).join(""),"</div>","</div>"].join("");let n=document.getElementById("de-refresh-btn");n&&n.addEventListener("click",function(){Nt()});let a=document.getElementById("de-register-btn");a&&a.addEventListener("click",function(){Xc()}),e.querySelectorAll(".de-member-item").forEach(function(o){o.addEventListener("click",function(){let i=this.dataset.id,r=O.team.members.find(function(c){return c.id===i});r&&Zc(r)})})}function Xc(){let e=document.createElement("div");e.className="modal-overlay hidden",e.id="de-register-modal",e.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;";let s=O.availableRoles.map(function(a){let o=a.registered?" (\u5DF2\u6CE8\u518C)":"";return'<option value="'+h(a.role)+'"'+(a.registered?" disabled":"")+">"+h(a.icon)+" "+h(a.name)+o+"</option>"}).join("");e.innerHTML=['<div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">','<div style="font-size:16px;font-weight:600;margin-bottom:16px;color:var(--text-primary);">\u6CE8\u518C\u6570\u5B57\u5458\u5DE5</div>','<label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">\u9009\u62E9\u89D2\u8272</label>','<select id="de-role-select" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;margin-bottom:12px;">',s,"</select>",'<label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">\u81EA\u5B9A\u4E49\u540D\u79F0\uFF08\u53EF\u9009\uFF09</label>','<input id="de-name-input" type="text" placeholder="\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u540D\u79F0" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;margin-bottom:12px;box-sizing:border-box;">','<label style="display:block;margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">\u5173\u8054 AI Agent</label>','<input id="de-agent-input" type="text" value="opencode" placeholder="agentId" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;margin-bottom:16px;box-sizing:border-box;">','<div style="display:flex;gap:8px;justify-content:flex-end;">','<button id="de-modal-cancel" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">\u53D6\u6D88</button>','<button id="de-modal-confirm" style="padding:10px 20px;border-radius:8px;border:none;background:#4f46e5;color:white;cursor:pointer;font-size:13px;font-weight:500;">\u786E\u8BA4\u6CE8\u518C</button>',"</div>","</div>"].join(""),document.body.appendChild(e),requestAnimationFrame(function(){e.classList.remove("hidden")});function n(){e.classList.add("hidden"),setTimeout(function(){e.remove()},250)}e.querySelector("#de-modal-cancel").addEventListener("click",n),e.addEventListener("click",function(a){a.target===e&&n()}),e.querySelector("#de-modal-confirm").addEventListener("click",function(){let a=document.getElementById("de-role-select"),o=document.getElementById("de-name-input"),i=document.getElementById("de-agent-input"),r=a?a.value:"",c=o?o.value.trim():"",l=i?i.value.trim():"opencode";r&&(O.ws&&O.ws.readyState===WebSocket.OPEN?O.ws.send(JSON.stringify({type:"de:register",role:r,name:c||void 0,agentId:l})):Ze.showToast?.("WebSocket \u672A\u8FDE\u63A5\uFF0C\u65E0\u6CD5\u6CE8\u518C","error"),n())})}function Zc(e){let t=document.createElement("div");t.className="modal-overlay hidden",t.id="de-detail-modal",t.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;",t.innerHTML=['<div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:360px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">','<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">','<div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;background:',h(e.color),'20;">',h(e.icon),"</div>","<div>",'<div style="font-size:16px;font-weight:600;color:var(--text-primary);">',h(e.name),"</div>",'<div style="font-size:12px;color:var(--text-tertiary);">',h(e.role)," \xB7 ",h(e.agentId),"</div>","</div></div>",'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">','<div style="background:var(--bg-card);padding:10px;border-radius:8px;text-align:center;">','<div style="font-size:16px;font-weight:600;color:var(--text-primary);">',String(e.stats?.tasksCompleted||0),"</div>",'<div style="font-size:11px;color:var(--text-tertiary);">\u5DF2\u5B8C\u6210\u4EFB\u52A1</div></div>','<div style="background:var(--bg-card);padding:10px;border-radius:8px;text-align:center;">','<div style="font-size:16px;font-weight:600;color:#ef4444;">',String(e.stats?.tasksFailed||0),"</div>",'<div style="font-size:11px;color:var(--text-tertiary);">\u5931\u8D25\u4EFB\u52A1</div></div>','<div style="background:var(--bg-card);padding:10px;border-radius:8px;text-align:center;grid-column:span 2;">','<div style="font-size:16px;font-weight:600;color:#f59e0b;">',String(e.stats?.humanRequests||0),"</div>",'<div style="font-size:11px;color:var(--text-tertiary);">\u4EBA\u673A\u534F\u4F5C\u8BF7\u6C42\u6B21\u6570</div></div>',"</div>",'<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px;">',"\u5F53\u524D\u72B6\u6001: ",e.status==="idle"?"\u7A7A\u95F2":e.status==="working"?"\u5DE5\u4F5C\u4E2D":e.status==="waiting_human"?"\u7B49\u5F85\u4EBA\u5DE5\u56DE\u590D":"\u9519\u8BEF","</div>",'<div style="display:flex;gap:8px;justify-content:flex-end;">','<button id="de-detail-close" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">\u5173\u95ED</button>','<button id="de-detail-unregister" style="padding:10px 20px;border-radius:8px;border:none;background:#ef4444;color:white;cursor:pointer;font-size:13px;font-weight:500;">\u6CE8\u9500\u5458\u5DE5</button>',"</div></div>"].join(""),document.body.appendChild(t),requestAnimationFrame(function(){t.classList.remove("hidden")});function s(){t.classList.add("hidden"),setTimeout(function(){t.remove()},250)}t.querySelector("#de-detail-close").addEventListener("click",s),t.addEventListener("click",function(n){n.target===t&&s()}),t.querySelector("#de-detail-unregister").addEventListener("click",function(){O.ws&&O.ws.readyState===WebSocket.OPEN&&O.ws.send(JSON.stringify({type:"de:unregister",employeeId:e.id})),s()})}function el(e){let t=document.createElement("div");t.className="modal-overlay hidden",t.id="human-input-modal",t.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;",t.innerHTML=['<div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">','<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">','<span style="font-size:20px;">\u{1F64B}</span>','<div style="font-size:15px;font-weight:600;color:var(--text-primary);">\u4EBA\u673A\u534F\u4F5C\u8BF7\u6C42</div>',"</div>",'<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px;">\u6765\u81EA\uFF1A',h(e.employeeName||"\u5DE5\u4F5C\u6D41\u5F15\u64CE"),"</div>",'<div style="background:var(--bg-card);padding:12px;border-radius:8px;margin-bottom:12px;font-size:13px;color:var(--text-primary);line-height:1.6;">',h(e.question||"\u8BF7\u8F93\u5165\u6240\u9700\u4FE1\u606F\uFF1A"),"</div>",e.workflowId?'<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;">\u5DE5\u4F5C\u6D41: '+h(e.workflowId)+" \xB7 \u6B65\u9AA4: "+(e.stepIndex!==void 0?e.stepIndex+1:"?")+"</div>":"",'<textarea id="human-answer-input" placeholder="\u8BF7\u8F93\u5165\u56DE\u590D..." style="width:100%;height:100px;padding:12px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;margin-bottom:12px;"></textarea>','<div style="display:flex;gap:8px;justify-content:flex-end;">','<button id="human-input-skip" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:13px;">\u8DF3\u8FC7</button>','<button id="human-input-submit" style="padding:10px 20px;border-radius:8px;border:none;background:#4f46e5;color:white;cursor:pointer;font-size:13px;font-weight:500;">\u63D0\u4EA4\u56DE\u590D</button>',"</div></div>"].join(""),document.body.appendChild(t),requestAnimationFrame(function(){t.classList.remove("hidden")});function s(){t.classList.add("hidden"),setTimeout(function(){t.remove()},250)}t.querySelector("#human-input-skip").addEventListener("click",function(){O.ws&&O.ws.readyState===WebSocket.OPEN&&O.ws.send(JSON.stringify({type:"human:respond",taskId:e.taskId,answer:"[\u8DF3\u8FC7]"})),s()}),t.querySelector("#human-input-submit").addEventListener("click",function(){let n=document.getElementById("human-answer-input"),a=n?n.value.trim():"";if(!a){n?.focus();return}O.ws&&O.ws.readyState===WebSocket.OPEN&&O.ws.send(JSON.stringify({type:"human:respond",taskId:e.taskId,answer:a})),Ze.showToast?.("\u{1F64B} \u56DE\u590D\u5DF2\u63D0\u4EA4","success"),s()}),setTimeout(function(){let n=document.getElementById("human-answer-input");n&&n.focus()},200),t.addEventListener("keydown",function(n){n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),document.getElementById("human-input-submit")?.click())})}function tl(e){switch(e.type){case"de:registered":Ze.showToast?.("\u2705 \u5DF2\u6CE8\u518C\u6570\u5B57\u5458\u5DE5: "+(e.employee?.name||e.employee?.role||""),"success"),Nt();break;case"de:unregistered":Ze.showToast?.("\u5DF2\u6CE8\u9500\u6570\u5B57\u5458\u5DE5","info"),Nt();break;case"de:error":Ze.showToast?.("\u274C \u6570\u5B57\u5458\u5DE5\u9519\u8BEF: "+(e.message||"\u672A\u77E5\u9519\u8BEF"),"error");break;case"de:team-status":O.team=e,hs();break;case"human:request":el(e);break;default:break}}function _i(){let e=Ze.UIRegistry;e&&e.registerTab("digital-employees",{icon:"\u{1F465}",label:"\u6570\u5B57\u5458\u5DE5",order:5,category:"digital",render:function(s){s.innerHTML='<div id="rp-digital-employees"></div>',hs(),Nt()}})&&console.log("[DigitalEmployees] Tab registered in right panel"),O.loadTeamStatus=Nt,O.renderTeamPanel=hs,O.handleWSMessage=tl,Ze.DigitalEmployees=O}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",_i):_i();var sl=window.QCLI=window.QCLI||{},Hn=15e3,k={list:[],sessions:{},pendingLaunches:{},failedLaunches:{},_sessionToAgentId:{},pendingStops:{},ws:null,_logCallbacks:{}};async function nl(){try{let e=await fetch("/api/agents");if(!e.ok)return[];let t=await e.json();k.list=t.agents||[];let s=k.list.filter(n=>n.installed).length;return console.log("[Agents] Loaded",k.list.length,"agents ("+s+" installed)"),Se(),k.list}catch(e){return console.warn("[Agents] Load failed:",e),[]}}function Se(){let e=document.getElementById("agent-list");if(!e)return;let t=k.list.filter(a=>a.installed),s=k.list.filter(a=>!a.installed);if(e.innerHTML="",t.length===0&&Object.keys(k.failedLaunches).length===0){e.innerHTML='<div class="agent-empty">No AI agents detected</div>';return}let n=new Set;for(let a of t){n.add(a.id);let o=Nn(a.id),i=a.id in k.pendingLaunches,r=k.failedLaunches[a.id],c=document.createElement("div"),l="agent-item";o&&(l+=" running"),i&&(l+=" pending"),r&&(l+=" failed"),c.className=l,c.dataset.agentId=a.id;let d=document.createElement("span");d.className="agent-icon",d.textContent=i?"\u23F3":r?"\u274C":a.icon,c.appendChild(d);let p=document.createElement("div");p.className="agent-info";let u=document.createElement("div");if(u.className="agent-name",u.textContent=a.displayName,p.appendChild(u),i){let g=document.createElement("div");g.className="agent-version agent-status-text",g.textContent="Starting...",p.appendChild(g)}else if(r){let g=document.createElement("div");g.className="agent-version agent-status-text error",g.textContent=r,p.appendChild(g)}else if(a.version&&a.version!=="unknown"){let g=document.createElement("div");g.className="agent-version",g.textContent=a.version,p.appendChild(g)}c.appendChild(p);let f=document.createElement("span");f.className="agent-status-dot",i&&f.classList.add("pending"),r&&f.classList.add("error"),c.appendChild(f);let m=document.createElement("button");m.className="agent-action-btn",i?(m.textContent="\u25CC",m.title="Launching...",m.disabled=!0):o?(m.textContent="\u25A0",m.title="Stop agent",m.addEventListener("click",g=>{g.stopPropagation(),Ai(a.id)})):(m.textContent=r?"\u21BB":"\u25B6",m.title=r?"Retry":"Start agent",m.addEventListener("click",g=>{g.stopPropagation(),delete k.failedLaunches[a.id],Mi(a)})),c.appendChild(m),c.addEventListener("click",()=>{o&&$i(a.id)}),e.appendChild(c)}for(let a in k.failedLaunches){if(n.has(a))continue;let o=k.failedLaunches[a],i=document.createElement("div");i.className="agent-item failed",i.dataset.agentId=a;let r=document.createElement("span");r.className="agent-icon",r.textContent="\u274C",i.appendChild(r);let c=document.createElement("div");c.className="agent-info";let l=document.createElement("div");l.className="agent-name",l.textContent=a,c.appendChild(l);let d=document.createElement("div");d.className="agent-version agent-status-text error",d.textContent=o,c.appendChild(d),i.appendChild(c);let p=document.createElement("span");p.className="agent-status-dot error",i.appendChild(p);let u=document.createElement("button");u.className="agent-action-btn",u.textContent="\u2715",u.title="Dismiss",u.addEventListener("click",f=>{f.stopPropagation(),delete k.failedLaunches[a],Se()}),i.appendChild(u),e.appendChild(i)}}function Nn(e){for(let t in k.sessions)if(k.sessions[t].agentId===e)return!0;return!1}function gs(e){e in k.pendingLaunches&&(clearTimeout(k.pendingLaunches[e]),delete k.pendingLaunches[e],console.log("[Agents] Cleared pending launch:",e))}function Mi(e){let t=k.ws?["CONNECTING","OPEN","CLOSING","CLOSED"][k.ws.readyState]||"UNKNOWN":"NO_WS";if(console.log("[Agents] startAgent:",e?.id,"| path:",e?.path,"| args:",e?.defaultArgs||[],"| ws:",t),!e||!e.id){re("Cannot start: invalid agent","error");return}if(!e.path){k.failedLaunches[e.id]="No command configured",Se(),re(`${e.displayName||e.id}: no command configured`,"error");return}if(!k.ws||k.ws.readyState!==WebSocket.OPEN){re("WebSocket not connected","error");return}if(Nn(e.id)){re(`${e.displayName} is already running`,"info");return}if(e.id in k.pendingLaunches){re(`${e.displayName} is already starting...`,"info");return}delete k.failedLaunches[e.id];let s=setTimeout(()=>{delete k.pendingLaunches[e.id],k.failedLaunches[e.id]="Timed out",console.log("[Agents] Timeout for",e.id,"("+Hn+"ms)"),Se(),re(`${e.displayName} failed to start (timeout ${Hn/1e3}s)`,"error")},Hn);k.pendingLaunches[e.id]=s,k.ws.send(JSON.stringify({type:"agent:launch",agentId:e.id,name:e.displayName,cmd:e.path,args:e.defaultArgs||[]})),console.log("[Agents] Sent agent:launch:",e.id,"| sessionId pending"),Se(),re(`Starting ${e.displayName}...`,"info")}function Ai(e){for(let t in k.sessions)if(k.sessions[t].agentId===e){if(!k.ws||k.ws.readyState!==WebSocket.OPEN)return;console.log("[Agents] Stopping:",e,"| session:",t),k.pendingStops[t]=!0,k.ws.send(JSON.stringify({type:"agent:kill",sessionId:t}));return}console.log("[Agents] stopAgent: no running session for",e)}function $i(e){for(let t in k.sessions)if(k.sessions[t].agentId===e){let s=k.sessions[t],n=document.getElementById("agent-log-overlay");n||(n=document.createElement("div"),n.id="agent-log-overlay",n.className="agent-log-overlay",n.innerHTML=`
            <div class="agent-log-header">
              <span class="agent-log-title"></span>
              <span class="agent-log-hint">Esc close</span>
            </div>
            <div class="agent-log-content"></div>
          `,document.body.appendChild(n),n.addEventListener("click",o=>{o.target===n&&zn()}),document.addEventListener("keydown",o=>{o.key==="Escape"&&!n.classList.contains("hidden")&&zn()})),n.classList.remove("hidden"),n.querySelector(".agent-log-title").textContent=`\u{1F4CB} ${s.name} Log`;let a=n.querySelector(".agent-log-content");a.innerHTML=s.log.map(o=>`<div class="agent-log-line">${h(o)}</div>`).join(""),a.scrollTop=a.scrollHeight;return}}function zn(){let e=document.getElementById("agent-log-overlay");e&&e.classList.add("hidden")}function re(e,t){let s=document.getElementById("agent-toast")||(()=>{let n=document.createElement("div");return n.id="agent-toast",n.className="agent-toast",document.body.appendChild(n),n})();s.textContent=e,s.className="agent-toast "+(t||"info"),s.classList.add("visible"),clearTimeout(s._timer),s._timer=setTimeout(()=>s.classList.remove("visible"),3e3)}function al(e){switch(e.type){case"agent:started":{console.log("[Agents] Received agent:started:",e.agentId,"| session:",e.sessionId,"| reattached:",!!e.reattached),gs(e.agentId),delete k.failedLaunches[e.agentId],k._sessionToAgentId[e.sessionId]=e.agentId;let t=k.sessions[e.sessionId];t&&e.reattached?(t.status="running",t.reattached=!0):k.sessions[e.sessionId]={agentId:e.agentId,name:e.name,status:"running",log:[],reattached:!!e.reattached},Se();break}case"agent:output":{let t=k.sessions[e.sessionId];if(t){let s=t.log.length===0;t.log.push(e.data),t.log.length>500&&t.log.splice(0,t.log.length-500),s&&console.log("[Agents] First output from",t.name,"| session:",e.sessionId,"| size:",e.data.length);let n=document.querySelector("#agent-log-overlay .agent-log-content");if(n&&!n.closest(".hidden")){let a=document.createElement("div");a.className="agent-log-line",a.textContent=e.data,n.appendChild(a),n.scrollTop=n.scrollHeight}}break}case"agent:exit":{let t=k.sessions[e.sessionId];console.log("[Agents] Received agent:exit:",e.sessionId,"| code:",e.code,"| signal:",e.signal),t?(t.status="exited",e.sessionId in k.pendingStops?re(`${t.name} stopped`,"info"):e.code===0?re(`${t.name} completed`,"success"):re(`${t.name} exited (code ${e.code})`,"error"),gs(t.agentId),delete k.failedLaunches[t.agentId],delete k._sessionToAgentId[e.sessionId],delete k.pendingStops[e.sessionId],delete k.sessions[e.sessionId],Se()):console.log("[Agents] exit for unknown session:",e.sessionId);break}case"agent:killed":{console.log("[Agents] Received agent:killed:",e.sessionId);let t=k.sessions[e.sessionId];t?(re(`${t.name} stopped`,"info"),gs(t.agentId),delete k.failedLaunches[t.agentId],delete k._sessionToAgentId[e.sessionId],delete k.pendingStops[e.sessionId],delete k.sessions[e.sessionId],Se()):delete k.pendingStops[e.sessionId];break}case"agent:error":{console.log("[Agents] Received agent:error:",e.agentId||"(no agentId)","| session:",e.sessionId,"| code:",e.errorCode,"| msg:",e.message);let t=e.agentId;!t&&e.sessionId&&k._sessionToAgentId[e.sessionId]&&(t=k._sessionToAgentId[e.sessionId],console.log("[Agents] Resolved agentId via _sessionToAgentId:",t));let s=e.message||"Launch failed",n="Agent error";switch(e.errorCode){case"no_command":s="No command specified",n=`${t?k.list.find(a=>a.id===t)?.displayName||t:"Agent"}: no command configured`;break;case"command_not_found":s=e.message||"Command not found in PATH",n=`${t?k.list.find(a=>a.id===t)?.displayName||t:"Agent"}: command not found`;break;case"spawn_error":s=e.message||"Failed to spawn process",n=`${t?k.list.find(a=>a.id===t)?.displayName||t:"Agent"}: failed to start`;break;default:n="Agent error: "+(e.message||"unknown");break}t&&t in k.pendingLaunches?(gs(t),k.failedLaunches[t]=s,Se()):console.log("[Agents] Error not matched to pending launch:",JSON.stringify({agentId:t,pendingKeys:Object.keys(k.pendingLaunches)})),re(n,"error");break}}}var il={loadAgents:nl,renderAgentList:Se,startAgent:Mi,stopAgent:Ai,handleWSMessage:al,isAgentRunning:Nn,showAgentLog:$i,closeAgentLog:zn,agents:k};sl.Agents=il;var vs=window.QCLI=window.QCLI||{},ys="qcli-ai-key",qn={fontSize:"qcli-font-size",sidebarCollapsed:"qcli-sidebar-collapsed",sidebarWidth:"qcli-sidebar-width",chatHeight:"qcli-chat-height",chatOpen:"qcli-chat-open",chatHistory:"qcli-chat-history",theme:"qcli-theme",lang:"qcli-lang",css:"qcli-custom-css",aiProvider:"qcli-ai-provider",aiModel:"qcli-ai-model",aiModelPlan:"qcli-ai-model-plan",aiBaseUrl:"qcli-ai-base-url",defaultCLI:"qcli-default-cli"};async function Ri(){let e={};for(let[,i]of Object.entries(qn)){let r=M.get(i);r!==null&&(e[i]=r)}let t={};try{let i=await fetch("/api/settings");i.ok&&(t=await i.json())}catch{}let s={version:2,exportedAt:new Date().toISOString(),localSettings:e,serverConfig:t},n=new Blob([JSON.stringify(s,null,2)],{type:"application/json"}),a=URL.createObjectURL(n),o=document.createElement("a");o.href=a,o.download=`qcli-settings-${new Date().toISOString().slice(0,10)}.json`,o.click(),URL.revokeObjectURL(a),_e("Settings exported","success")}function Bi(e){let t=new FileReader;t.onload=async s=>{try{let n=JSON.parse(s.target.result);if(!n.version||!n.localSettings){_e("Invalid settings file format","error");return}let a=0;for(let[o,i]of Object.entries(n.localSettings))o===ys?Ut.set(ys,i):M.set(o,i),a++;if(n.serverConfig&&n.serverConfig.registry)try{await fetch("/api/settings/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n.serverConfig)})}catch(o){console.warn("[Settings] import server config:",o?.message)}_e(`Imported ${a} settings \u2192 reload to apply`,"success"),setTimeout(()=>location.reload(),1500)}catch(n){_e("Failed to parse settings file: "+n.message,"error")}},t.readAsText(e)}function Pi(){if(!confirm(`Reset ALL settings to defaults? This will:
\u2022 Clear custom CSS
\u2022 Reset theme to system preference
\u2022 Reset font size
\u2022 Clear chat history
\u2022 Remove AI API key

This cannot be undone.`))return;let e=Object.values(qn);for(let t of e)M.remove(t);Ut.remove(ys),M.remove(ys),_e("All settings reset \u2192 reloading","info"),setTimeout(()=>location.reload(),1e3)}function ol(){let e=document.getElementById("settings-overlay");e&&(e.classList.remove("hidden"),rl())}function bs(){let e=document.getElementById("settings-overlay");e&&e.classList.add("hidden"),qt&&(document.removeEventListener("keydown",qt),qt=null)}async function rl(){let e=r=>document.getElementById(r),t=(r,c)=>{let l=e(r);l&&(l.textContent=c)},s=0,n=0;try{for(let[,r]of Object.entries(qn)){let c=M.get(r);c!==null&&(s+=c.length*2,n++)}}catch(r){console.warn("[Settings] storage calc:",r?.message)}t("settings-storage-items",n),t("settings-storage-size",s>1024?(s/1024).toFixed(1)+" KB":s+" B"),t("settings-current-theme",vs.state?.theme==="light"?"\u2600 Light":"\u{1F319} Dark"),t("settings-current-lang",(vs._locale?.current||"zh")==="zh"?"\u4E2D\u6587":"English");try{let r=await fetch("/api/settings/env");if(r.ok){let c=await r.json(),l=e("settings-env-list");if(l){l.innerHTML="";let d=Object.entries(c.env||{}).slice(0,30);if(d.length===0)l.innerHTML='<div class="settings-env-empty">No environment variables available</div>';else for(let[p,u]of d){let f=document.createElement("div");f.className="settings-env-row";let m=document.createElement("span");m.className="settings-env-key",m.textContent=p;let g=document.createElement("span");g.className="settings-env-val",g.textContent=u.length>60?u.slice(0,60)+"...":u,f.appendChild(m),f.appendChild(g),l.appendChild(f)}t("settings-env-count",c.count||0)}}}catch(r){console.warn("[Settings] fetch env vars:",r?.message)}let a=parseInt(M.get("qcli-font-size","14"),10);t("settings-font-size",a+"px");let o=parseInt(M.get("qcli-sidebar-width","240"),10);t("settings-sidebar-width",o+"px");let i=e("settings-default-cli");if(i){let r=M.get("qcli-default-cli",""),c=vs.state?.clis||[];i.innerHTML='<option value="">\u2192 None \u2192</option>';for(let l of c){let d=document.createElement("option");d.value=l.id,d.textContent=l.name||l.id,l.id===r&&(d.selected=!0),i.appendChild(d)}}}function cl(){let e=document.getElementById("settings-default-cli");if(!e)return;let t=e.value;M.set("qcli-default-cli",t),window.QCLI.onDefaultCLIChanged&&window.QCLI.onDefaultCLIChanged(t)}async function Hi(){let e={registry:[],folders:[]};try{let c=await fetch("/api/settings");c.ok&&(e=await c.json())}catch(c){console.warn("[Settings] fetch CLI config:",c?.message)}let t=[],s=[],n="";try{t=M.getJSON("qcli-favorites",[]),s=M.getJSON("qcli-hidden",[]),n=M.get("qcli-default-cli","")}catch(c){console.warn("[Settings] read local CLI settings:",c?.message)}let a={version:2,exportedAt:new Date().toISOString(),type:"qcli-cli-config",description:"Hesi configuration \u2192 CLIs, folders, favorites, and settings",clis:e.registry||[],folders:e.folders||[],favorites:t,hidden:s,defaultCLI:n},o=new Blob([JSON.stringify(a,null,2)],{type:"application/json"}),i=URL.createObjectURL(o),r=document.createElement("a");r.href=i,r.download=`qcli-cli-config-${new Date().toISOString().slice(0,10)}.json`,r.click(),URL.revokeObjectURL(i),_e("CLI config exported","success")}function zi(e){let t=new FileReader;t.onload=async s=>{try{let n=JSON.parse(s.target.result);if(!n.version||n.type!=="qcli-cli-config"){_e("Invalid CLI config file format","error");return}let a=0;if(Array.isArray(n.favorites))try{M.setJSON("qcli-favorites",n.favorites),a++}catch(o){console.warn("[Settings] import favorites:",o?.message)}if(Array.isArray(n.hidden))try{M.setJSON("qcli-hidden",n.hidden),a++}catch(o){console.warn("[Settings] import hidden:",o?.message)}if(n.defaultCLI)try{M.set("qcli-default-cli",n.defaultCLI),a++}catch(o){console.warn("[Settings] import default CLI:",o?.message)}if(n.clis||n.folders)try{await fetch("/api/settings/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({registry:n.clis||[],folders:n.folders||[]})}),a++}catch(o){console.warn("[Settings] import server CLI config:",o?.message)}_e(`Imported CLI config (${a} items) \u2192 reload to apply`,"success"),setTimeout(()=>location.reload(),1500)}catch(n){_e("Failed to parse CLI config: "+n.message,"error")}},t.readAsText(e)}function _e(e,t){let s=document.getElementById("settings-toast");s&&(s.textContent=e,s.className="settings-toast "+(t||"info"),s.style.display="",setTimeout(()=>{s.style.display="none"},3e3))}var qt=null;function ll(){if(document.getElementById("settings-overlay"))return;let e=document.createElement("div");e.id="settings-overlay",e.className="modal-overlay hidden",e.style.zIndex="750",e.innerHTML=`
    <div class="modal settings-modal">
      <div class="settings-header">
        <h2>\u2699\uFE0F Settings</h2>
        <button id="settings-close-btn" class="settings-close-btn">\u2715</button>
      </div>

      <div class="settings-body">
        <!-- Section: General -->
        <div class="settings-section">
          <div class="settings-section-title">General</div>
          <div class="settings-row">
            <span>Theme</span>
            <span id="settings-current-theme" class="settings-value">\u2014</span>
          </div>
          <div class="settings-row">
            <span>Language</span>
            <span id="settings-current-lang" class="settings-value">\u2014</span>
          </div>
          <div class="settings-row">
            <span>Terminal Font Size</span>
            <span id="settings-font-size" class="settings-value">\u2014</span>
          </div>
          <div class="settings-row">
            <span>Sidebar Width</span>
            <span id="settings-sidebar-width" class="settings-value">\u2014</span>
          </div>
          <div class="settings-row">
            <span>Default CLI (auto-launch on connect)</span>
            <select id="settings-default-cli" class="settings-select"></select>
          </div>
        </div>

        <!-- Section: Storage -->
        <div class="settings-section">
          <div class="settings-section-title">Local Storage</div>
          <div class="settings-row">
            <span>Stored Items</span>
            <span id="settings-storage-items" class="settings-value">\u2014</span>
          </div>
          <div class="settings-row">
            <span>Estimated Size</span>
            <span id="settings-storage-size" class="settings-value">\u2014</span>
          </div>
        </div>

        <!-- Section: Environment -->
        <div class="settings-section">
          <div class="settings-section-title">
            Environment Variables
            <span id="settings-env-count" class="settings-badge">0</span>
          </div>
          <div id="settings-env-list" class="settings-env-list">
            <div class="settings-env-empty">Loading...</div>
          </div>
        </div>

        <!-- Section: Export/Import -->
        <div class="settings-section">
          <div class="settings-section-title">Backup & Restore</div>
          <div class="settings-actions">
            <button id="settings-export-btn" class="secondary-btn" style="flex:1;">\u{1F4E4} Export All</button>
            <button id="settings-import-btn" class="secondary-btn" style="flex:1;">\u{1F4E5} Import All</button>
            <input type="file" id="settings-import-input" accept=".json" style="display:none;" />
          </div>
          <div class="settings-actions" style="margin-top:6px;">
            <button id="settings-export-cli-btn" class="secondary-btn" style="flex:1;">\u{1F50C} Export CLI Config</button>
            <button id="settings-import-cli-btn" class="secondary-btn" style="flex:1;">\u{1F50C} Import CLI Config</button>
            <input type="file" id="settings-import-cli-input" accept=".json" style="display:none;" />
          </div>
          <div class="settings-row" style="margin-top:8px;">
            <button id="settings-reset-btn" class="settings-reset-btn">\u{1F5D1} Reset All Settings</button>
          </div>
        </div>
      </div>

      <div id="settings-toast" class="settings-toast" style="display:none;"></div>
    </div>
  `,document.body.appendChild(e),document.getElementById("settings-close-btn").addEventListener("click",bs),e.addEventListener("click",s=>{s.target===e&&bs()}),document.getElementById("settings-export-btn").addEventListener("click",Ri);let t=document.getElementById("settings-default-cli");t&&t.addEventListener("change",cl),document.getElementById("settings-import-btn").addEventListener("click",()=>{document.getElementById("settings-import-input").click()}),document.getElementById("settings-import-input").addEventListener("change",s=>{s.target.files[0]&&(Bi(s.target.files[0]),s.target.value="")}),document.getElementById("settings-export-cli-btn").addEventListener("click",Hi),document.getElementById("settings-import-cli-btn").addEventListener("click",()=>{document.getElementById("settings-import-cli-input").click()}),document.getElementById("settings-import-cli-input").addEventListener("change",s=>{s.target.files[0]&&(zi(s.target.files[0]),s.target.value="")}),document.getElementById("settings-reset-btn").addEventListener("click",Pi),qt=function(n){n.key==="Escape"&&!e.classList.contains("hidden")&&bs()},document.addEventListener("keydown",qt)}var dl={open:()=>{ll(),ol()},close:bs,exportSettings:Ri,importSettings:Bi,exportCLIConfig:Hi,importCLIConfig:zi,resetSettings:Pi};vs.Settings=dl;window.__hesiLoadRoundtable=()=>import("./chunk-IDLCO22P.js");(function(){let t=window.QCLI||{};if(t.injectCSS)t.injectCSS("/css/p3-panels.css");else{let s=document.createElement("link");s.rel="stylesheet",s.href="/css/p3-panels.css",document.head.appendChild(s)}})();console.log("[Hesi] Lazy bundle loaded (P3 panels included)");
