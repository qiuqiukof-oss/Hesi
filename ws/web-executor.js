// ============================================================
// Web Executor — 让自定义编排"关联到各网页端"的最小可用实现
//
// 设计目标（最小改动）：
//   1) 能力声明 —— 让内置 AI 助手、终端类 agent 在推理时"看得到"这条路存在。
//   2) 最小执行器 —— 支持 HTTP 型网页端点（免费模型的 API）。
//   3) 凭据隔离 —— auth 仅来自当次任务，不落盘、不进 catalog。
//
// 规划中的扩展点：纯网页 UI（无 API）的模型通过 CDP 浏览器自动化调用，
// 此处仅占位说明，不实现，避免引入原生依赖与脆弱的 DOM 解析。
// ============================================================

// 声明可用的"网页端点路径"。这是能力发现的单一事实来源。
const WEB_PATHS = [
  {
    id: 'web-free-model',
    title: '网页端点 / 免费模型',
    description: '把一个子任务发给某个网页端免费模型（API 型），取回它的回答文本。',
    transport: 'http', // http = 直连 API；cdp = 浏览器自动化（规划中）
    status: 'available-http',
  },
  {
    id: 'web-fanout-aggregate',
    title: '并发扇出 + 汇聚总结',
    description: '多个叶子任务各自指向不同网页端点，下游汇聚节点（强模型/助手）把它们的回答整合总结。',
    transport: 'dag',
    status: 'available',
  },
];

function listWebPaths() {
  return WEB_PATHS;
}

// 注入到任务 prompt 的"能力提示"——简洁，让 agent 在推理时看得见这条路。
function getCapabilityBriefing() {
  return [
    '[可用能力 / Capabilities]',
    'Hesi 编排支持把一个子任务路由到「网页端点」(免费模型)，并通过 DAG 并发多路、下游汇聚总结。',
    '发起方式：提交 workflow:addTask 时，在任务上带 executor 字段：',
    '  { type: "web", provider: "<模型名>", endpoint: "<URL>", auth?: { type: "bearer"|"cookie", token }, requestFormat?: "openai" }',
    '并发示例：多个子任务各指向不同 provider，再用一个下游任务 dependsOn 它们做整合。',
    '注意：网页端点凭据只在当次任务内存中传递，不持久化；纯网页 UI（无 API）的浏览器自动化为规划项。',
  ].join('\n');
}

// 依 executor 配置把 prompt 拼成请求体。
function buildInit(executor, prompt) {
  const fmt = (executor.requestFormat || 'raw').toLowerCase();
  if (fmt === 'openai') {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: executor.model || 'default',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    };
  }
  // raw：直接把 prompt 作为请求体（适合简单的文本/表单端点）。
  return { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: prompt };
}

// 抽取回答文本：优先从 openai 风格 JSON 里取，否则原样返回。
function extractAnswer(text) {
  try {
    const j = JSON.parse(text);
    if (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) {
      return j.choices[0].message.content;
    }
    return j.content || j.response || j.text || text;
  } catch (e) {
    return text; // 非 JSON，原样返回
  }
}

/**
 * 执行一个网页端点任务。
 * @param {object} task   — 任务对象（含 executor 字段）
 * @param {string} [prompt] — 已注入 persona/skill/expert 的最终 prompt；缺省用 task.task
 * @returns {Promise<{output:string, exitCode:number}>}
 */
async function runWebEndpoint(task, prompt) {
  const ex = task.executor || {};
  const endpoint = ex.endpoint;
  if (!endpoint || typeof endpoint !== 'string') {
    return { output: '[web] 缺少 endpoint，无法调用网页端点', exitCode: -1 };
  }
  const finalPrompt = prompt != null ? prompt : (task.task || '');
  if (!finalPrompt) {
    return { output: '[web] 无任务指令（task 为空），放弃调用', exitCode: -1 };
  }

  const init = buildInit(ex, finalPrompt);
  // 凭据：仅来自当次任务，不落盘。
  if (ex.auth && ex.auth.type === 'bearer' && ex.auth.token) {
    init.headers = Object.assign({}, init.headers, { Authorization: `Bearer ${  ex.auth.token}` });
  } else if (ex.auth && ex.auth.type === 'cookie' && ex.auth.token) {
    init.headers = Object.assign({}, init.headers, { Cookie: ex.auth.token });
  }

  const ctrl = new AbortController();
  const ms = ex.timeout || 30000;
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(endpoint, Object.assign({ signal: ctrl.signal }, init));
    const text = await res.text();
    if (!res.ok) {
      return { output: `[web] HTTP ${  res.status  }: ${  String(extractAnswer(text)).slice(0, 600)}`, exitCode: -1 };
    }
    return { output: String(extractAnswer(text)).slice(0, 8000), exitCode: 0 };
  } catch (e) {
    return { output: `[web] 调用失败: ${  e.message}`, exitCode: -1 };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { WEB_PATHS, listWebPaths, getCapabilityBriefing, runWebEndpoint };
