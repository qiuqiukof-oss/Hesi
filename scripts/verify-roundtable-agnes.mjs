/**
 * 端到端验证:经 CDP 从 Hesi 前端 localStorage 读取 agnes key,
 * 直接调用 runRoundtable 跑一轮真实圆桌讨论,打印 status 与 stats。
 * 用法: node scripts/verify-roundtable-agnes.mjs "你的议题" [maxTurns]
 * 前提: Hesi 页面在 Edge(CDP 9222)中打开,且已在前端填入 agnes key。
 */
import { runRoundtable } from '../routes/chat/discuss.js';

const CDP_BASE = 'http://127.0.0.1:9222';

async function cdpEval(expression) {
  const tabs = await (await fetch(`${CDP_BASE}/json`)).json();
  const hesi =
    tabs.find((t) => (t.url || '').includes('4264') && (t.title || '') === 'Hesi') ||
    tabs.find((t) => (t.url || '').includes('4264')) ||
    tabs.find((t) => (t.title || '').includes('Hesi'));
  if (!hesi) throw new Error('未找到 Hesi 标签页,请先在 Edge 中打开前端');
  const ws = new WebSocket(hesi.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS connect failed')); });
  const result = await new Promise((res, rej) => {
    const id = 1;
    const timer = setTimeout(() => rej(new Error('CDP eval timeout')), 10000);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { clearTimeout(timer); res(msg); }
    };
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => { try { return JSON.stringify({
          key: localStorage.getItem('qcli-ai-key') || '',
          baseUrl: localStorage.getItem('qcli-ai-base-url') || '',
          provider: localStorage.getItem('qcli-ai-provider') || '',
          model: localStorage.getItem('qcli-ai-model') || ''
        }); } catch (e) { return JSON.stringify({ error: String(e) }); } })()`,
        returnByValue: true,
      },
    }));
  });
  ws.close();
  if (result.error) throw new Error('CDP error: ' + JSON.stringify(result.error));
  return JSON.parse(result.result.result.value);
}

(async () => {
  const message = process.argv[2] || '设计一个 Hesi 圆桌缓存验收清单';
  const maxTurns = Number(process.argv[3] || 3);

  const cfg = await cdpEval();
  if (cfg.error) throw new Error('读取 localStorage 失败: ' + cfg.error);
  if (!cfg.key) throw new Error('localStorage 中没有 qcli-ai-key —— 请确认已在前端 AI 助手设置中填入 agnes key');

  console.log(`[config] provider=${cfg.provider || '(未设,默认 openai)'} model=${cfg.model || 'agnes-2.0-flash'} baseUrl=${cfg.baseUrl || 'https://apihub.agnes-ai.com/v1'} key=***(${cfg.key.length} chars)`);
  console.log(`[run] 议题: ${message} | partners=[opencode] | maxTurns=${maxTurns}\n`);

  const out = await runRoundtable({
    message,
    partners: ['opencode'],
    maxTurns,
    provider: 'openai',
    baseUrl: cfg.baseUrl || 'https://apihub.agnes-ai.com/v1',
    apiKey: cfg.key,
    model: cfg.model || 'agnes-2.0-flash',
    onEvent: (t, p) => {
      if (t === 'status' || t === 'error') console.log(`  [${t}] ${p.message}`);
    },
  });

  console.log('\n===== STATS =====');
  console.log(JSON.stringify(out.stats, null, 2));
  console.log('\ncleanFinish =', out.cleanFinish);
  if (!out.stats || !out.cleanFinish) {
    console.error('\n❌ 端到端链路未通过');
    process.exit(1);
  }
  console.log('✅ 端到端链路通过:runRoundtable 完整跑完 ' + out.stats.rounds + ' 轮');
})().catch((e) => { console.error('\n❌ FAIL: ' + e.message); process.exit(1); });
