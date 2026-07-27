// @ts-check
// ============================================================
// Workflow Engine — multi-step agent orchestration definitions
// ============================================================
const { Router } = require('express');
const fs = require('fs');
const path = require('path');

// ── 清洗：去掉 Unicode 替换符 U+FFFD 以及 GBK 被误当 UTF-8 解码后残留的异体字（西里尔/拉丁扩展等），避免列表展示乱码碎片 ──
const _FFFD = /\uFFFD/g;
const _GBK_ARTIFACT = new RegExp('[\\u00A1-\\u00FF\\u0100-\\u017F\\u0400-\\u04FF]', 'g');
function stripReplacement(s) {
  return String(s == null ? '' : s).replace(_FFFD, '').replace(_GBK_ARTIFACT, '').trim();
}
function hasReplacement(s) {
  return /�/.test(String(s == null ? '' : s));
}

// ── Load workflow definitions from JSON files ──
function loadJSONWorkflows() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const jsonWorkflows = [];
  try {
    if (fs.existsSync(workflowsDir)) {
      const files = fs.readdirSync(workflowsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(path.join(workflowsDir, file), 'utf-8');
            const wf = JSON.parse(content);
            if (wf && wf.id && (wf.steps || (wf.tasks && Array.isArray(wf.tasks)))) {
              // 安全网：即便磁盘上残留坏文件，列表也不再展示乱码
              wf.name = stripReplacement(wf.name) || wf.id || '未命名工作流';
              if (Array.isArray(wf.tasks)) wf.tasks.forEach((t) => { if (t) t.label = stripReplacement(t.label); });
              jsonWorkflows.push(wf);
            }
          } catch (e) {
            console.warn('[Workflows] Failed to load', file, ':', e.message);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Workflows] Failed to read workflows directory:', e.message);
  }
  return jsonWorkflows;
}

// ── slugify：把名称转成安全的 ASCII id（中文等非 ASCII 会被剥离） ──
function slugify(s) {
  const base = String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base;
}

// ── Built-in Workflow Definitions ──
const BUILTIN_WORKFLOWS = [
  {
    id: 'code-review',
    name: '🔍 Code Review',
    description: 'Review code → Identify issues → Summarize findings',
    icon: '🔍',
    steps: [
      { id: 'review', label: 'Reviewing code', agentId: 'opencode', task: 'Review the code in the current project. Identify bugs, security issues, and style problems. Be thorough.' },
      { id: 'summarize', label: 'Summarizing findings', agentId: 'opencode', task: 'Summarize the code review findings in a clear bullet list. Prioritize by severity.' },
    ],
  },
  {
    id: 'test-suite',
    name: '🧪 Test Suite',
    description: 'Run tests → Analyze failures → Generate report',
    icon: '🧪',
    steps: [
      { id: 'run-tests', label: 'Running tests', agentId: 'opencode', task: 'Run the project test suite. Capture all test output including failures.' },
      { id: 'analyze', label: 'Analyzing results', agentId: 'opencode', task: 'Analyze the test results above. For each failure, explain the likely cause and suggest a fix.' },
    ],
  },
  {
    id: 'build-verify',
    name: '🔨 Build Verify',
    description: 'Build project → Check for errors → Report status',
    icon: '🔨',
    steps: [
      { id: 'build', label: 'Building project', agentId: 'opencode', task: 'Build the project. Run the build command and capture all output.' },
      { id: 'report', label: 'Reporting status', agentId: 'opencode', task: 'Report the build status: did it succeed or fail? If it failed, what errors occurred and how can they be fixed?' },
    ],
  },
  {
    id: 'explain-code',
    name: '📖 Explain Code',
    description: 'Analyze codebase → Generate documentation overview',
    icon: '📖',
    steps: [
      { id: 'explore', label: 'Exploring structure', agentId: 'opencode', task: 'Explore the project structure. List the main directories, key files, and their purposes.' },
      { id: 'explain', label: 'Generating explanation', agentId: 'opencode', task: 'Write a concise explanation of how this project works: architecture, data flow, key components, and how they interact.' },
    ],
  },
  {
    id: 'fix-issues',
    name: '🛠 Fix Issues',
    description: 'Identify issues → Generate fixes → Apply patches',
    icon: '🛠',
    steps: [
      { id: 'diagnose', label: 'Diagnosing issues', agentId: 'opencode', task: 'Scan the project for common issues: lint errors, type errors, security vulnerabilities, and deprecated API usage.' },
      { id: 'fix', label: 'Generating fixes', agentId: 'opencode', task: 'For each issue found above, provide a specific fix. Output the fix as a clear diff or code change.' },
    ],
  },
  // ── Collaboration Workflows (Parallel Agents) ──
  {
    id: 'multi-review',
    name: '👥 Multi-Agent Review',
    description: 'Multiple AI agents review code in parallel, then merge findings',
    icon: '👥',
    collaboration: true,
    steps: [
      {
        id: 'parallel-review',
        label: 'Parallel Review',
        mode: 'parallel',
        agents: [
          { agentId: 'opencode', task: 'Review the codebase for bugs, logic errors, and edge cases. Be very thorough.' },
          { agentId: 'codebuff', task: 'Review the same codebase for style issues, best practices, and performance improvements.' },
        ],
        mergeLabel: 'Merging reviews',
      },
    ],
  },
  {
    id: 'multi-debug',
    name: '🐛 Multi-Agent Debug',
    description: 'Multiple AI agents analyze bugs in parallel, combine insights',
    icon: '🐛',
    collaboration: true,
    steps: [
      {
        id: 'parallel-debug',
        label: 'Parallel Analysis',
        mode: 'parallel',
        agents: [
          { agentId: 'opencode', task: 'Analyze the project for potential bugs, crashes, and runtime errors. Look at error handling.' },
          { agentId: 'codebuff', task: 'Analyze the same project for type errors, null safety, and memory issues.' },
        ],
        mergeLabel: 'Combining diagnostics',
      },
    ],
  },
  {
    id: 'multi-architecture',
    name: '🏗 Multi-Agent Architecture',
    description: 'Multiple AI agents analyze architecture in parallel, merge into unified doc',
    icon: '🏗',
    collaboration: true,
    steps: [
      {
        id: 'parallel-arch',
        label: 'Parallel Architecture Analysis',
        mode: 'parallel',
        agents: [
          { agentId: 'opencode', task: 'Analyze the project architecture: directory structure, component hierarchy, data flow, and key dependencies.' },
          { agentId: 'codebuff', task: 'Analyze the same project from a different angle: module boundaries, API design, configuration, and build system.' },
        ],
        mergeLabel: 'Merging architecture docs',
      },
    ],
  },

    {
      id: "ensemble-consensus",
      name: "🧠 AI Ensemble — Consensus",
      description: "Multiple agents analyze the same task in parallel, then merge into a unified consensus",
      icon: "🧠",
      ensemble: true,
      steps: [
        {
          id: "parallel-analysis",
          label: "Parallel Agent Analysis",
          mode: 'parallel',
          agents: [
            { agentId: "opencode", task: "Analyze the current project thoroughly. Focus on: code structure, architecture patterns, data flow, and key components. Be detailed and specific." },
            { agentId: "freebuff", task: "Analyze the same project from a different perspective. Focus on: potential bugs, security concerns, performance bottlenecks, and areas for improvement. Be critical and thorough." },
          ],
          mergeLabel: "Merging agent insights",
        },
        {
          id: "consensus-summary",
          label: "Generating Consensus",
          agentId: "opencode",
          task: "Review all the agent analyses below. Create a unified consensus report that: 1) Lists findings ALL agents agree on, 2) Notes areas where agents disagree, 3) Provides a final integrated assessment. Format as a clear report with sections.",
        },
      ],
    },
    {
      id: "ensemble-debug",
      name: "🐛 AI Ensemble — Bug Hunter",
      description: "Multiple agents hunt for bugs in parallel, then combine and prioritize findings",
      icon: "🐛",
      ensemble: true,
      steps: [
        {
          id: "parallel-bug-hunt",
          label: "Parallel Bug Hunting",
          mode: 'parallel',
          agents: [
            { agentId: "opencode", task: "Scan the project for bugs, logic errors, runtime exceptions, and edge cases. Look for null pointer issues, race conditions, infinite loops, and incorrect error handling. List each bug with file location and severity." },
            { agentId: "freebuff", task: "Scan the same project for security vulnerabilities, type errors, API misuse, deprecated patterns, and dependency issues. Check for XSS, injection, auth bypass, and insecure data handling. List each issue with file location and severity." },
          ],
          mergeLabel: "Combining bug reports",
        },
        {
          id: "prioritized-fixes",
          label: "Prioritized Fix Report",
          agentId: "opencode",
          task: "Review the combined bug reports above. Create a prioritized list: CRITICAL bugs first (security, crashes), then HIGH (data loss, incorrect behavior), then MEDIUM (edge cases, minor issues), then LOW (style, best practices). For each bug, suggest a specific fix.",
        },
      ],
    },
    {
      id: "ensemble-compare",
      name: "⚖️ AI Ensemble — Comparison",
      description: "Compare two AI agents on the same task, highlighting differences and similarities",
      icon: "⚖️",
      ensemble: true,
      steps: [
        {
          id: "parallel-compare",
          label: "Parallel Analysis",
          mode: 'parallel',
          agents: [
            { agentId: "opencode", task: "Analyze the current project and provide: 1) Architecture overview, 2) Key strengths, 3) Potential improvements, 4) Overall assessment. Be thorough and specific with code references." },
            { agentId: "freebuff", task: "Analyze the same project from a different angle: 1) Code quality assessment, 2) Testing coverage analysis, 3) Performance considerations, 4) Long-term maintainability. Be critical and evidence-based." },
          ],
          mergeLabel: "Generating comparison",
        },
        {
          id: "comparison-result",
          label: "Comparison Report",
          agentId: "opencode",
          task: "Review both agent analyses below. Create a side-by-side comparison showing: 1) Areas of agreement, 2) Different perspectives, 3) Unique insights from each agent, 4) A final integrated recommendation that leverages the best from both analyses.",
        },
      ],
    },
    {
      id: "ensemble-research",
      name: "🔬 AI Ensemble — Deep Research",
      description: "Multi-perspective deep research on the codebase, merged into comprehensive documentation",
      icon: "🔬",
      ensemble: true,
      steps: [
        {
          id: "parallel-research",
          label: "Parallel Deep Research",
          mode: 'parallel',
          agents: [
            { agentId: "opencode", task: "Research the project architecture in depth. Document: directory structure, module boundaries, key classes and functions, data models, API endpoints, and configuration. Create a complete technical map." },
            { agentId: "freebuff", task: "Research the project from a developer experience perspective. Document: build system, test setup, development workflow, dependencies, documentation quality, and onboarding friction. Suggest concrete DX improvements." },
          ],
          mergeLabel: "Merging research findings",
        },
        {
          id: "comprehensive-doc",
          label: "Comprehensive Documentation",
          agentId: "opencode",
          task: "Using both research reports below, create a comprehensive project document covering: 1) Architecture overview with diagram description, 2) Component breakdown with responsibilities, 3) Data flow explanation, 4) Development setup guide, 5) Key decisions and trade-offs, 6) Future roadmap suggestions.",
        },
      ],
    },
];

/**
 * Create the workflows router.
 * @returns {Router}
 */
function createRouter() {
  const router = Router();

  // GET /api/workflows — list all available workflows (built-in + JSON)
  router.get('/workflows', (req, res) => {
    const jsonWorkflows = loadJSONWorkflows();
    res.json({ workflows: [...BUILTIN_WORKFLOWS, ...jsonWorkflows] });
  });

  // POST /api/workflows — save a custom DAG workflow definition to workflows/<id>.json
  router.post('/workflows', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ success: false, error: '请求体无效' });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const tasks = Array.isArray(body.tasks) ? body.tasks : null;
    if (!name) return res.status(400).json({ success: false, error: '缺少 name' });
    if (!tasks || tasks.length === 0) return res.status(400).json({ success: false, error: '缺少 tasks' });
    // 拒绝含乱码（U+FFFD）的名称/任务：通常是复制粘贴带来的编码损坏，避免把垃圾存盘
    if (hasReplacement(name)) {
      return res.status(400).json({ success: false, error: '名称含无法识别的字符（乱码），请重新输入名称后再导出' });
    }
    for (const t of tasks) {
      if (t && hasReplacement(t.label || '') ) {
        return res.status(400).json({ success: false, error: `任务「${  t.id || '?'  }」的标签含乱码，请修正后重试` });
      }
    }

    // 规范化并校验 tasks
    const seen = new Set();
    const normTasks = [];
    for (const t of tasks) {
      const id = typeof t.id === 'string' ? t.id.trim() : '';
      if (!id) return res.status(400).json({ success: false, error: '存在缺少 id 的任务' });
      if (seen.has(id)) return res.status(400).json({ success: false, error: `任务 id 重复：${  id}` });
      seen.add(id);
      const deps = Array.isArray(t.dependsOn)
        ? t.dependsOn.map((d) => String(d).trim()).filter(Boolean)
        : [];
      normTasks.push({
        id,
        label: (typeof t.label === 'string' && t.label.trim()) ? t.label.trim() : id,
        agentId: (typeof t.agentId === 'string' && t.agentId.trim()) ? t.agentId.trim() : 'opencode',
        dependsOn: deps,
        task: typeof t.task === 'string' ? t.task : '',
        mode: t.mode === 'parallel' ? 'parallel' : 'serial',
      });
    }

    // 解析并净化 id（仅允许 ASCII 安全字符，防路径穿越）
    let id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : slugify(name);
    if (!id) id = `workflow-${  Date.now()}`;
    id = id.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
      || (`wf-${  Date.now()}`);

    const wf = {
      id,
      name,
      description: typeof body.description === 'string' && body.description.trim()
        ? body.description.trim() : '自定义编排导出的 DAG 工作流',
      icon: (typeof body.icon === 'string' && body.icon.trim()) ? body.icon.trim() : '🤖',
      kind: 'dag',
      maxConcurrency: Number.isFinite(body.maxConcurrency) ? body.maxConcurrency : 4,
      tasks: normTasks,
    };

    try {
      const workflowsDir = path.join(__dirname, '..', 'workflows');
      if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });
      let file = `${id  }.json`;
      // 重名防覆盖：追加时间戳
      if (fs.existsSync(path.join(workflowsDir, file))) {
        file = `${id  }-${  Date.now()  }.json`;
      }
      const filePath = path.join(workflowsDir, file);
      fs.writeFileSync(filePath, JSON.stringify(wf, null, 2), 'utf-8');
      res.json({ success: true, id, file, path: filePath });
    } catch (e) {
      console.error('[Workflows] Save failed:', e);
      res.status(500).json({ success: false, error: `保存失败：${  e.message}` });
    }
  });

  return router;
}

module.exports = { createRouter, BUILTIN_WORKFLOWS };
