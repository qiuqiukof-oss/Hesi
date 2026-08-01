/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 自然语言 → Plan 生成器（全自动 Phase 1 — auto-Planner 入口）
//
// 接收一段自然语言目标，复用 lib/memory/llm-bridge.complete（支持 openai/anthropic，
// 可测试注入），产出符合 plan-schema 的 plan 对象。生成的 plan 直接进入
// plan-routes 的现有流水线（gatePlan → runPlan → 圆桌/过闸），无需改动 run-plan。
//
// 设计约束：纯异步、零硬编码模型、失败可诊断（带 error.code）。
// ============================================================

const { complete, LLMError } = require('../../lib/memory/llm-bridge');
const { validatePlan, emptyPlan } = require('./plan-schema');

const SYSTEM_PROMPT = [
  '你是一个「目标 → 可执行 Plan」的拆解器。用户会给你一段自然语言目标。',
  '请把它拆解成一份结构化、机器可验证的 Plan，并【只输出 JSON】，不要任何解释或额外文字（可用 ```json 包裹，但内容只能是 JSON）。',
  '',
  'Plan 字段（严格遵循）：',
  '{',
  '  "objective": "一句话目标（必填）",',
  '  "title": "简短标题（可选）",',
  '  "acceptance": [ { "kind": "command"|"script"|"http"|"manual", "command": "可执行命令（kind 为 command/script 时必填）", "expect": "期望结果（可选）", "description": "验收说明（可选）" } ],',
  '  "steps": [ { "id": "唯一字符串", "goal": "本步目标", "action": "本步可执行命令（shell 命令优先）或具体指令", "type": "command（推荐）| exec", "verify": { "kind": "...", "command": "..." }, "requireApproval": false } ],',
  '  "approvalPolicy": "marked",',
  '  "allow_external": false,',
  '  "forbidden": [],',
  '  "scope_paths": [],',
  '  "budget": { "maxRounds": 0, "maxTokens": 0, "maxMinutes": 0 }',
  '}',
  '',
  '【关键规则】',
  '- steps 的 action 字段：**优先写可直接执行的 shell 命令**（如 `echo "..." > file.txt`、`mkdir -p src/components`、`node scripts/build.js`）。',
  '- 只有当步骤确实无法用单条命令表达时，才写自然语言描述（此时 type 留空或不写）。',
  '- **强烈建议每步 action 都设为 type:"command"** 并给出具体 shell 命令，这样执行器可以直接运行，不依赖外部 Agent。',
  '- acceptance 优先用 command/script/http 让机器自动验收；确实只能人判时才用 manual。',
  '- steps 的 id 必须唯一；goal/action 必填且具体。',
  '- 尽量给出可由命令行验证的 acceptance（如 grep/node/构建命令），便于全自动闭环自动判定。',
  '- **所有产出的文件路径必须落在 scope_paths 范围内**：汇总报告/日志/测试结果等文件不要写到 scope_paths 之外的目录（比如不要写到盘符根目录）。',
  '- budget 给宽松上限（如 maxRounds=步数*4，maxMinutes=步数*8）。',
  '',
  '【命令兼容性要求（重要）】',
  '- **必须使用 POSIX 兼容语法**：执行环境是 bash（Git for Windows / MSYS2 / Linux / macOS），不支持 cmd.exe 专用语法。',
  '- **绝对禁止 PowerShell / cmd 语法**：不要使用 New-Item、Set-Content、[IO.File]::WriteAllText、Test-Path、Write-Output、Get-ChildItem 等 PowerShell 命令。执行器永远是 bash，与讨论中提到的平台适配无关。',
  '- **写文件前必须先确保父目录存在**：用 `mkdir -p` 创建父目录后再写入文件。示例：mkdir -p src/pages && cat > src/pages/App.tsx << EOF ... EOF',
  '- **优先用简单命令替代 heredoc**：单行内容用 `echo "content" > file.txt`；多行内容才用 heredoc（<< EOF）。',
  '- **避免使用 Windows 路径**：始终使用正斜杠 `/` 作为路径分隔符（bash 兼容）。',
  '- **不要假设文件已存在**：如果步骤涉及读写特定文件，先用 ls/test 检查或直接创建。',
  '- **sed 替换内容含 `/` 时改用非 `/` 定界符（如 `#` 或 `|`）**：`sed \'s/pattern/path/\'` 会在 replacement 含 `/tmp/...` 等路径时解析失败（unknown option to s）。正确写法：`sed \'s#pattern#path#\'` 或 `sed "s|echo.*>|echo msg >|"`。',
  '',
  '示例（用户目标：在仓库根 README 顶部加「构建状态」章节）：',
  JSON.stringify({
    objective: '在仓库根 README.md 顶部新增「构建状态」章节',
    acceptance: [{ kind: 'command', command: "grep -q '构建状态' README.md", expect: 'README.md 含「构建状态」章节' }],
    steps: [
      { id: 's1', goal: '插入徽章章节', action: 'sed -i "1i ## 构建状态\\n" README.md', type: 'command', requireApproval: false },
    ],
    approvalPolicy: 'marked',
    budget: { maxRounds: 4, maxMinutes: 8 },
  }),
  '',
  '示例（用户目标：创建新组件文件）：',
  JSON.stringify({
    objective: '创建 Gallery 组件',
    steps: [
      { id: 's1', goal: '创建组件目录', action: 'mkdir -p src/components/gallery', type: 'command', requireApproval: false },
      { id: 's2', goal: '创建组件文件', action: "echo 'import React from \"react\";\\nexport default function Gallery() { return <div>Gallery</div>; }' > src/components/Gallery.tsx", type: 'command', requireApproval: false },
    ],
    budget: { maxRounds: 6, maxMinutes: 10 },
  }),
].join('\n');

/** 从模型文本中抽出 JSON 对象（容忍 ```json 围栏与两侧多余文字）
 *
 * 容错策略（按优先级）：
 *   1. 标准 ```json ... ``` 围栏
 *   2. 首个 { ... } 块（匹配括号深度）
 *   3. 尝试修复常见问题：尾随逗号、单引号→双引号、注释剔除
 *   4. 全文直接 JSON.parse（模型恰好只返回纯 JSON）
 */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const original = t;

  // 策略 1：```json 围栏
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    t = fence[1].trim();
    try { return JSON.parse(t); } catch { /* 继续尝试其他策略 */ }
  }

  // 策略 2：找首个 { ... } JSON 对象（处理模型在 JSON 前后加解释文字的情况）
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    let candidate = t.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch { /* 继续 */ }

    // 策略 3：常见格式修复
    let repaired = candidate
      .replace(/,\s*([}\]])/g, '$1')           // 尾随逗号
      .replace(/\/\/[^\n]*/g, '')                // 单行注释
      .replace(/\/\*[\s\S]*?\*\//g, '')          // 多行注释
      .replace(/\n\s*\n/g, '\n');                // 空行压缩
    try { return JSON.parse(repaired); } catch { /* 继续 */ }

    // 策略 4：单引号 → 双引号（部分模型输出单引号 JSON）
    try {
      const singleQuoted = repaired.replace(/'([^']+)'/g, '"$1"');
      return JSON.parse(singleQuoted);
    } catch { /* 最终失败 */ }
  }

  // 策略 5：全文就是 JSON
  try { return JSON.parse(t); } catch { /* 失败 */ }

  // 全部策略失败 → 返回 null
  console.warn('[extractJson] 所有抽取策略均失败。原始文本前 500 字符:', original.slice(0, 500));
  return null;
}

/**
 * 判断模型输出是否「疑似被 max_tokens 截断」（JSON 不完整）。
 * 已能 JSON.parse 的视为完整；否则用括号配平 + 结尾字符粗判。
 * 仅用于决定是否触发续写，误判代价低（续写不成功仍会走原 repair 路径）。
 */
function looksTruncated(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t.includes('{') && !t.includes('[')) return false;
  try { JSON.parse(t); return false; } catch { /* 继续判断 */ }
  const opens = (t.match(/\{/g) || []).length + (t.match(/\[/g) || []).length;
  const closes = (t.match(/\}/g) || []).length + (t.match(/\]/g) || []).length;
  if (opens > closes) return true;          // 开括号多于闭括号 → 一定没闭合
  if (!/[}\]]\s*$/.test(t)) return true;     // 不以闭括号结尾 → 多半断在中间
  return false;
}

/** 清理模型续写输出里的 ```json 围栏与首尾空白。 */
function _cleanContinuation(cont) {
  let s = String(cont || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return s;
}

/**
 * 把「被截断的 partial」与「模型续写的 remainder」合并：
 * - 若续写本身是一个完整 JSON（模型重启式输出），优先直接用续写。
 * - 否则把 remainder 追加到 partial 末尾。
 */
function _mergePartial(partial, cont) {
  const c = _cleanContinuation(cont);
  if (!c) return partial;
  if (c.startsWith('{') || c.startsWith('[')) {
    const asFull = extractJson(c);
    if (asFull) return c; // 模型输出了完整 JSON，直接用
  }
  return partial + '\n' + c;
}

/** 构造「从中断处继续输出剩余 JSON」的续写提示（无状态，靠尾部片段提供上下文）。 */
function buildContinuePrompt(partial) {
  const tail = String(partial || '').slice(-3500); // 取末尾片段，避免输入超限
  return [
    '你刚才生成的 JSON 被输出长度限制截断了。下面是已被截断的尾部内容：',
    '```json',
    tail,
    '```',
    '请从中断处【继续】输出剩余的 JSON 内容（只输出剩余部分，不要重复上面已出现的内容，也不要添加任何解释文字），并确保整个结构最终以 } 闭合。',
  ].join('\n');
}

/**
 * 调用 LLM 生成 JSON，并带「截断感知续写」：
 * 若首轮响应被 max_tokens 截断（JSON 不完整），自动请求模型从中断处继续，
 * 最多重试 maxContinuations 次，避免复杂 plan 因硬上限被砍断而整轮报废。
 * @returns {Promise<{raw:string, plan:object|null, continued:boolean}>}
 */
async function completePlanJson(system, user, runtime, { maxContinuations = 3 } = {}) {
  const { apiKey, provider, model, baseUrl } = runtime || {};
  let raw = await complete(system, user, { apiKey, provider, model, baseUrl });
  let plan = extractJson(raw);
  if (plan) return { raw, plan, continued: false };
  if (!looksTruncated(raw)) return { raw, plan: null, continued: false };
  console.warn('[PlanGen] 首轮响应疑似被截断，启用续写（最多 %d 轮）', maxContinuations);
  for (let i = 0; i < maxContinuations; i++) {
    const cont = await complete(buildContinuePrompt(raw), '', { apiKey, provider, model, baseUrl });
    raw = _mergePartial(raw, cont);
    plan = extractJson(raw);
    console.warn('[PlanGen] 续写第 %d 轮：提取 %s', i + 1, plan ? '成功' : '失败');
    if (plan) return { raw, plan, continued: true };
  }
  return { raw, plan: null, continued: true };
}

/**
 * 结构修复（sanitize）：把 LLM 返回的「形状近似但内部畸形」的 plan 修正为合法形状。
 *
 * 轻量模型（flash 等）常见问题：
 *   - acceptance 元素是字符串而非对象：["检查文件"] → [{kind:"manual", description:"检查文件"}]
 *   - steps 元素是字符串："创建目录" → {id:"s1", goal:"创建目录", action:"创建目录"}
 *   - steps 缺 goal/action：有其他字段但漏写必填项
 *   - acceptance/steps 为 null/undefined 而非空数组
 *
 * @param {object} plan LLM 原始输出的 plan
 * @returns {object} 修复后的 plan（原地修改 + 返回）
 */
function sanitizePlan(plan) {
  if (!plan || typeof plan !== 'object') return plan;

  // ── 修复 acceptance ──
  if (plan.acceptance == null) {
    plan.acceptance = [];
  } else if (!Array.isArray(plan.acceptance)) {
    console.warn('[sanitizePlan] acceptance 不是数组，已重置为 []');
    plan.acceptance = [];
  } else {
    const VALID_KINDS = new Set(['command', 'script', 'http', 'manual']);
    plan.acceptance = plan.acceptance
      .map((a, i) => {
        if (!a || typeof a !== 'object') {
          // 字符串或其他非对象 → 转为 manual 验收
          const desc = String(a == null ? '' : a).trim();
          console.log(`[sanitizePlan] acceptance[${i}] 非对象(${typeof a})，转为 manual: "${desc.slice(0, 60)}"`);
          return desc ? { kind: 'manual', description: desc } : null;
        }
        // 对象但缺少 kind 或 kind 不在已知列表 → 默认 manual
        // LLM（尤其轻量模型）常遗漏 kind 字段，或写了 command 但命令无法执行
        if (!VALID_KINDS.has(a.kind)) {
          const oldKind = a.kind;
          const desc = a.description || a.command || `验收项${i + 1}`;
          console.log(`[sanitizePlan] acceptance[${i}] kind="${oldKind}" 无效/缺失，转为 manual: "${desc.slice(0, 60)}"`);
          return { ...a, kind: 'manual', description: a.description || desc };
        }
        return a; // 正常对象保留
      })
      .filter(Boolean); // 移除 null
  }

  // ── 修复 steps ──
  if (plan.steps == null) {
    plan.steps = [];
  } else if (!Array.isArray(plan.steps)) {
    console.warn('[sanitizePlan] steps 不是数组，已重置为 []');
    plan.steps = [];
  } else {
    const usedIds = new Set();
    plan.steps = plan.steps
      .map((s, i) => {
        const idx = i + 1;
        // 字符串步骤 → 转为对象
        if (typeof s === 'string' || typeof s === 'number') {
          const text = String(s).trim();
          console.log(`[sanitizePlan] steps[${i}] 是字符串，转为对象: "${text.slice(0, 60)}"`);
          return { id: `s${idx}`, goal: text, action: text, type: 'command' };
        }
        if (!s || typeof s !== 'object') {
          console.log(`[sanitizePlan] steps[${i}] 非对象/null，跳过`);
          return null;
        }
        // 对象但缺字段 → 尝试推断
        let changed = false;
        if (!s.id) { s.id = `s${idx}`; changed = true; }
        if (!s.goal) {
          // 用 action 或 title 推断 goal
          s.goal = s.action || s.title || `步骤 ${idx}`;
          changed = true;
          console.log(`[sanitizePlan] steps[${i}].goal 缺失，推断为: "${String(s.goal).slice(0, 60)}"`);
        }
        if (!s.action) {
          // 用 goal 推断 action（至少有个值让校验通过）
          s.action = s.goal;
          changed = true;
          console.log(`[sanitizePlan] steps[${i}].action 缺失，推断为: "${String(s.action).slice(0, 60)}"`);
        }
        if (!s.type) { s.type = 'command'; changed = true; }

        // ── 检测占位符步骤（LLM 完全没给内容，sanitizePlan 填充的假数据）──
        // 特征：goal 和 action 都是 "步骤 N" 格式，且原始对象几乎没有有效字段
        // 这种步骤执行后无事可做 → 标记为 skip 让执行器跳过
        const PLACEHOLDER_RE = /^步骤\s+\d+$/;
        if (PLACEHOLDER_RE.test(s.goal) && s.goal === s.action
            && !s.verify && (!s.originalFields || s.originalFields <= 1)) {
          console.log(`[sanitizePlan] steps[${i}] 检测为占位符（无实际内容），标记为 skip`);
          s.type = 'skip'; // 执行器遇到 type=skip 直接标记 done 不执行
          s._isPlaceholder = true; // 内部标记
        }

        if (changed) return s;
        return s; // 无需修改的保留原样
      })
      .filter(Boolean);
  }

  // ── 确保 objective 是字符串 ──
  if (plan.objective != null && typeof plan.objective !== 'string') {
    plan.objective = String(plan.objective);
    console.log('[sanitizePlan] objective 非字符串，已转换');
  }

  return plan;
}

/** 用 schema 默认值补全 plan，保证进入流水线前形状完整 */
function applyDefaults(plan, objectiveText) {
  const out = emptyPlan();
  out.id = plan.id || (`nl-${  Date.now().toString(36)}`);
  out.title = plan.title || (plan.objective || objectiveText || '自然语言目标').slice(0, 60);
  out.objective = plan.objective || objectiveText || '';
  out.acceptance = Array.isArray(plan.acceptance) ? plan.acceptance : [];
  out.steps = Array.isArray(plan.steps)
    ? plan.steps.map((s, i) => ({
        id: s.id || (`s${  i + 1}`),
        goal: s.goal || '',
        action: s.action || '',
        type: s.type,
        verify: s.verify,
        on_fail: s.on_fail,
        checkpoint: s.checkpoint,
        dependsOn: s.dependsOn,
        requireApproval: typeof s.requireApproval === 'boolean' ? s.requireApproval : undefined,
      }))
    : [];
  if (plan.approvalPolicy) out.approvalPolicy = plan.approvalPolicy;
  if (typeof plan.allow_external === 'boolean') out.allow_external = plan.allow_external;
  if (Array.isArray(plan.forbidden)) out.forbidden = plan.forbidden;
  if (Array.isArray(plan.scope_paths)) out.scope_paths = plan.scope_paths;
  if (typeof plan.autoReplan === 'boolean') out.autoReplan = plan.autoReplan;
  if (Number(plan.maxRetries) > 0) out.maxRetries = plan.maxRetries;
  if (typeof plan.runtimeIntercept === 'boolean') out.runtimeIntercept = plan.runtimeIntercept;
  const b = plan.budget && typeof plan.budget === 'object' ? plan.budget : {};
  const n = out.steps.length || 1;
  out.budget = {
    maxRounds: Number(b.maxRounds) || n * 4,
    maxTokens: Number(b.maxTokens) || 0,
    maxMinutes: Number(b.maxMinutes) || n * 8,
  };
  return out;
}

function repairPrompt(errors) {
  return [
    '你刚才生成的 plan 未通过结构校验，错误如下：',
    errors.join('\n'),
    '请修正后重新只输出符合 schema 的 JSON（字段结构与示例一致）。',
  ].join('\n');
}

/**
 * 自然语言目标 → plan 对象（可直接交给 runPlan）。
 * @param {string} text 用户目标
 * @param {{ apiKey?:string, provider?:string, baseUrl?:string, model?:string }} runtime
 * @returns {Promise<object>}
 */
async function generatePlanFromObjective(text, runtime = {}, opts = {}) {
  const { apiKey, provider, baseUrl, model } = runtime || {};
  const discussionContext = opts && opts.discussionContext;
  let userMsg = `目标：\n${text || ''}`;
  if (discussionContext) {
    // M3：把多角色讨论结论作为参考上下文注入（≤6KB 截断）。明确「仅供参考、须对齐原始目标」。
    const dc = String(discussionContext).slice(0, 6000);
    userMsg += `\n\n【多角色讨论结论（仅供参考，最终 Plan 必须对齐上方原始目标并满足机器可验证）】\n${dc}\n\n请吸收上述角色观点，产出结构化、可机器验证的 Plan JSON。`;
  }
  let raw, plan, continued = false;
  try {
    const gen = await completePlanJson(SYSTEM_PROMPT, userMsg, { apiKey, provider, model, baseUrl });
    raw = gen.raw; plan = gen.plan; continued = gen.continued;
  } catch (e) {
    // 结构化 LLM 错误 → 透传具体原因，帮助用户定位问题
    if (e instanceof LLMError) {
      const hint = [];
      if (e.code === 'NO_API_KEY') {
        hint.push('请在 Plan 页面「高级」区域填写 API Key（支持从聊天面板自动读取）');
        hint.push('或直接手写 Plan JSON 绕过 AI 生成');
      } else if (e.code === 'API_ERROR') {
        hint.push(`HTTP ${e.details?.status || '?'}: 请检查 Base URL、模型名称、API Key 是否匹配`);
        if (e.details?.body) hint.push(`服务端响应: ${e.details.body.slice(0, 200)}`);
      } else if (e.code === 'NETWORK_ERROR') {
        hint.push('请检查网络连接 / Base URL 是否可达（本地 LLM 确认端口是否正确）');
        if (e.details?.original) hint.push(`原因: ${e.details.original}`);
      }
      const ne = new Error(`无法从自然语言生成 plan: ${e.message}${hint.length ? `\n${hint.join('\n')}` : ''}`);
      ne.code = `GEN_${e.code}`;
      ne.details = e.details;
      throw ne;
    }
    throw e; // 非 LLMError 异常继续上抛
  }
  // ── 诊断日志：输出 LLM 原始响应（关键！用于排查模型返回格式问题）──
  console.log('[PlanGen] LLM 原始响应长度:', String(raw || '').length);
  console.log('[PlanGen] LLM 原始响应前 800 字符:', String(raw || '').slice(0, 800));
  console.log('[PlanGen] 截断续写触发:', continued ? '是' : '否');
  if (!raw) {
    const e = new Error(
      '无法从自然语言生成 plan：模型返回空响应。请检查模型名称是否正确，或尝试切换模型。'
    );
    e.code = 'GEN_EMPTY';
    throw e;
  }
  // plan 可能已由 completePlanJson 的续写路径提取成功；此处仅作诊断日志前的占位
  // ── 诊断日志：JSON 抽取结果 ──
  console.log('[PlanGen] extractJson 结果:', plan ? '成功（object）' : '失败（null）');
  if (plan) {
    console.log('[PlanGen] 抽取到的 plan 顶层键:', Object.keys(plan).join(','));
    console.log('[PlanGen] objective 类型:', typeof plan.objective, '值:', String(plan.objective || '(空)').slice(0, 100));
    console.log('[PlanGen] acceptance 长度:', Array.isArray(plan.acceptance) ? plan.acceptance.length : '非数组');
    console.log('[PlanGen] steps 长度:', Array.isArray(plan.steps) ? plan.steps.length : '非数组');
  }

  // ── 关键修复：先 sanitize 结构修复 → applyDefaults 补全默认值 → validatePlan 校验 ──
  //
  // LLM（尤其是 flash 类轻量模型）经常返回「形状近似但内部畸形」的数据：
  //   - acceptance 元素是字符串而非对象
  //   - steps 元素是字符串或缺少 goal/action
  //   - acceptance/steps 为 null 而非空数组
  //
  // 三层修复：
  //   1. sanitizePlan()  → 修复数组内部畸形（字符串→对象、缺字段→推断）
  //   2. applyDefaults()  → 补全顶层字段（objective/budget 等）
  //   3. auto-acceptance  → 若仍为空则生成兜底验收
  if (!plan) {
    // extractJson 完全失败 → 尝试 repair
    const v0 = { ok: false, errors: ['模型未返回可解析的 JSON'] };
    console.warn('[PlanGen] 校验失败:', v0.errors.join('；'));
    const repaired = await complete(repairPrompt(v0.errors), userMsg, { apiKey, provider, model, baseUrl });
    console.log('[PlanGen] repair 响应前 500 字符:', String(repaired || '').slice(0, 500));
    const fixed = repaired ? extractJson(repaired) : null;
    if (fixed) {
      plan = fixed;
      console.log('[PlanGen] repair 后提取成功，顶层键:', Object.keys(plan).join(','));
    } else {
      console.warn('[PlanGen] repair 也未能提取有效 JSON');
      const e = new Error('无法从自然语言生成 plan：模型未能返回有效 JSON 格式（已尝试一次修复）');
      e.code = 'GEN_NO_JSON';
      e.details = { rawLength: String(raw || '').length, rawPreview: String(raw || '').slice(0, 500) };
      throw e;
    }
  }

  // 先做结构修复（修复 LLM 返回的畸形数组元素）
  plan = sanitizePlan(plan);
  console.log('[PlanGen] sanitize 后 acceptance:', Array.isArray(plan.acceptance) ? plan.acceptance.length : '非数组',
    'steps:', Array.isArray(plan.steps) ? plan.steps.length : '非数组');

  // 再补全默认值（objective 从用户输入补、budget 自动计算等）
  plan = applyDefaults(plan, text);

  // ── 占位符检测 + 生成层自动重试（Layer 1）──
  // LLM（尤其 flash 类轻量模型）偶尔返回空壳步骤（仅有 id，缺 goal/action）
  // sanitizePlan 会将其填充为「步骤 N」占位符。与其把空壳交给执行器报错，
  // 不如在生成层立即重试一次（带上明确提示），成功率更高且更快。
  const stepsAfterDefault = Array.isArray(plan.steps) ? plan.steps : [];
  const allPlaceholder = stepsAfterDefault.length > 0
    && stepsAfterDefault.every((s) => s && (s._isPlaceholder || s.type === 'skip'));
  if (allPlaceholder) {
    console.warn(`[PlanGen] 检测到全部 ${stepsAfterDefault.length} 个步骤均为占位符（LLM 未生成有效内容），执行生成层重试`);
    console.warn('[PlanGen] 上次 LLM 原始响应前 1000 字符:', String(raw || '').slice(0, 1000));
    try {
      const raw2 = await complete(
        `${SYSTEM_PROMPT}\n\n【重要提醒】你上次返回的步骤缺少 goal 和 action 内容（只有空 id）。请确保每个步骤都有：\n- goal: 具体目标（如"创建 HTML 文件"）\n- action: 可执行的 shell 命令（如 "mkdir -p public/portfolio && cat > public/portfolio/index.html << 'EOF' ... EOF"）\n- type: "command"\n\n请重新输出完整 JSON。`,
        userMsg,
        { apiKey, provider, model, baseUrl },
      );
      console.log('[PlanGen] 重试后 LLM 响应长度:', String(raw2 || '').length);
      console.log('[PlanGen] 重试后 LLM 响应前 800 字符:', String(raw2 || '').slice(0, 800));
      if (raw2) {
        const plan2 = extractJson(raw2);
        if (plan2) {
          const sanitized2 = sanitizePlan(applyDefaults(plan2, text));
          const stillEmpty = Array.isArray(sanitized2.steps)
            && sanitized2.steps.length > 0
            && sanitized2.steps.every((s) => s && (s._isPlaceholder || s.type === 'skip'));
          if (!stillEmpty) {
            console.log('[PlanGen] 生成层重试成功，获得有效步骤');
            plan = sanitized2;
            raw = raw2; // 更新 raw 引用用于后续诊断日志
          } else {
            console.warn('[PlanGen] 重试后仍为占位符，保留原始结果交由执行层处理');
          }
        } else {
          console.warn('[PlanGen] 重试响应 JSON 解析失败，保留原始结果');
        }
      }
    } catch (retryErr) {
      console.warn('[PlanGen] 生成层重试异常:', retryErr.message);
      // 重试失败不阻断，继续用原始（占位符）结果交由执行层 → error → 外层 autoReplan
    }
  }

  // 对空 acceptance 自动生成兜底验收（避免因模型漏写 acceptance 而整体失败）
  if (!plan.acceptance || plan.acceptance.length === 0) {
    const stepCount = Array.isArray(plan.steps) ? plan.steps.length : 0;
    if (stepCount > 0) {
      // 用第一个有 action 的步骤生成基本验收
      const firstAction = plan.steps.find((s) => s.action);
      if (firstAction && firstAction.action) {
        plan.acceptance = [{
          kind: 'command',
          command: `echo "Plan 执行完成，共 ${stepCount} 步"`,
          expect: '完成',
          description: '自动生成的兜底验收（原 plan 未提供 acceptance）',
        }];
        console.log('[PlanGen] 自动生成兜底 acceptance（基于步骤数量）');
      }
    }
  }

  // 现在用补全后的 plan 做最终校验
  let v = validatePlan(plan);
  if (!v.ok) {
    console.warn('[PlanGen] 最终校验仍失败:', v.errors.join('；'));
    // 最后一次 repair（这次带上补全后的上下文）
    try {
      const repaired2 = await complete(
        [
          '你刚才生成的 plan 经默认值补全后仍未通过校验，错误如下：',
          v.errors.join('\n'),
          '当前 plan 结构：' + JSON.stringify(plan, null, 2).slice(0, 1000),
          '请修正后只输出完整 JSON（确保含 objective / acceptance[至少一条] / steps[至少一步]）。',
        ].join('\n'),
        userMsg,
        { apiKey, provider, model, baseUrl },
      );
      const fixed2 = repaired2 ? extractJson(repaired2) : null;
      if (fixed2) {
        plan = sanitizePlan(applyDefaults(fixed2, text));
        v = validatePlan(plan);
        console.log('[PlanGen] 第二次 repair 后校验:', v.ok ? '通过' : `仍失败: ${v.errors.join('；')}`);
      }
    } catch { /* repair 本身失败，继续用原始错误 */ }
  }
  if (!v.ok) {
    const e = new Error(`生成的 plan 未通过校验：${  v.errors.join('；')}`);
    e.code = 'GEN_INVALID';
    e.errors = v.errors;
    e.details = {
      rawLength: String(raw || '').length,
      rawPreview: String(raw || '').slice(0, 500),
      finalPlanKeys: Object.keys(plan),
      finalObjective: String(plan.objective || '').slice(0, 200),
      finalAcceptanceLen: Array.isArray(plan.acceptance) ? plan.acceptance.length : null,
      finalStepsLen: Array.isArray(plan.steps) ? plan.steps.length : null,
    };
    throw e;
  }
  return plan;
}

// ── 修订生成器（② 反思重规划环复用） ──

const SYSTEM_REVISE = [
  '你是「Plan 修订器」。一个自动化 Plan 没能完全跑通，下面是它的执行结果。',
  '请基于【原始目标】和【执行结果】，产出一份修订后的结构化 Plan（只输出 JSON，同 schema）。',
  '修订原则：',
  '- 保留已完成的步骤（status=done），不要重做。',
  '- 修正失败/被拦截的步骤（failed/error/blocked/loop/budget）：给出更可行、更具体的 action，或拆分，或删除明显不可能的步骤。',
  '- 加强验收（acceptance / verify），使其能被机器自动判定（优先 command/script）。',
  '- 字段结构与示例完全一致，objective 保持原目标。',
].join('\n');

/** 把上一次执行结果压成给 LLM 的精简上下文 */
function summarizeResult(prevResult) {
  const steps = Array.isArray(prevResult && prevResult.results) ? prevResult.results : [];
  const lines = steps.map((s) => {
    const extra = s.reason || (s.output ? String(s.output).slice(0, 120) : '');
    return `- [${s.status}] ${s.goal || s.id}: ${extra}`;
  });
  const acc = prevResult && prevResult.reflection ? prevResult.reflection : null;
  return [
    '执行结果概要：',
    ...lines,
    acc ? `反思状态: ${acc.status}${acc.reason ? ` — ${  acc.reason}` : ''}` : '',
    acc && acc.acceptancePassRate != null ? `验收通过率: ${acc.acceptancePassRate}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 基于「上一次失败的 Plan + 执行结果」生成修订 Plan。
 * 与 generatePlanFromObjective 共用抽取/校验/默认值逻辑，失败返回 null（由调用方决定是否终止重规划）。
 * @param {object} prevPlan
 * @param {object} prevResult  runPlan 的上一次返回（含 results / reflection）
 * @param {{ apiKey?:string, provider?:string, baseUrl?:string, model?:string }} runtime
 * @returns {Promise<object|null>}
 */
async function revisePlan(prevPlan, prevResult, runtime = {}, failureContext) {
  const { apiKey, provider, baseUrl, model } = runtime || {};
  const objective = (prevPlan && prevPlan.objective) || '';
  const userMsg = [
    `原始目标：${objective}`,
    '',
    summarizeResult(prevResult),
    failureContext ? `\n【上次执行失败详情（请重点针对修复）】\n${String(failureContext).slice(0, 4000)}` : '',
    '',
    '请产出修订后的 Plan JSON。',
  ].filter(Boolean).join('\n');
  let raw, plan;
  try {
    const gen = await completePlanJson(SYSTEM_REVISE, userMsg, { apiKey, provider, model, baseUrl });
    raw = gen.raw; plan = gen.plan;
  } catch (e) {
    if (e instanceof LLMError) {
      const ne = new Error(`无法修订 plan: ${e.message}`);
      ne.code = `REVISE_${e.code}`;
      ne.details = e.details;
      throw ne;
    }
    throw e;
  }
  if (!raw) return null;
  if (!plan) return null;
  let v = validatePlan(plan);
  if (!v.ok) {
    const repaired = await complete(repairPrompt(v.errors), userMsg, { apiKey, provider, model, baseUrl });
    const fixed = repaired ? extractJson(repaired) : null;
    if (fixed) { plan = fixed; v = validatePlan(plan); }
    if (!v.ok) return null;
  }
  return applyDefaults(plan, objective);
}

module.exports = { generatePlanFromObjective, extractJson, applyDefaults, sanitizePlan, revisePlan };
