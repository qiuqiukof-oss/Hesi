// workflow-templates 静态模板契约测试
// 保证 routes/ai-tools/workflow-templates/*.json 始终是 workflow_start 可直接消费的合法结构。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TPL_DIR = path.join(__dirname, '..', 'routes', 'ai-tools', 'workflow-templates');
const VALID_ROLES = ['coder', 'debugger', 'reviewer', 'tester', 'deployer'];
const VALID_ONFAILURE = ['stop', 'continue', 'skip-dependents'];
const EXPECTED = ['bugfix.json', 'build-deploy.json', 'code-review.json', 'roundtable.json', 'test-suite.json'];

test('模板目录包含预期的 4 个模板文件', () => {
  const files = fs.readdirSync(TPL_DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepStrictEqual(files, EXPECTED);
});

test('每个模板均为合法 JSON 且含 template/title/tasks 元数据', () => {
  for (const f of EXPECTED) {
    const data = JSON.parse(fs.readFileSync(path.join(TPL_DIR, f), 'utf8'));
    assert.strictEqual(typeof data.template, 'string', `${f}: template 字段缺失`);
    assert.strictEqual(`${data.template}.json`, f, `${f}: template 字段应与文件名一致`);
    assert.strictEqual(typeof data.title, 'string', `${f}: title 缺失`);
    assert.ok(Array.isArray(data.tasks) && data.tasks.length >= 2, `${f}: tasks 应为 ≥2 项数组`);
  }
});

test('模板任务字段符合 workflow_start 契约（role/onFailure 枚举、dependsOn 引用闭合）', () => {
  for (const f of EXPECTED) {
    const data = JSON.parse(fs.readFileSync(path.join(TPL_DIR, f), 'utf8'));
    const ids = new Set(data.tasks.map((t) => t.id).filter(Boolean));
    for (const t of data.tasks) {
      assert.strictEqual(typeof t.agentId, 'string', `${f}/${t.id}: agentId 必填`);
      assert.strictEqual(typeof t.task, 'string', `${f}/${t.id}: task 必填`);
      if (t.role !== undefined) {
        assert.ok(VALID_ROLES.includes(t.role), `${f}/${t.id}: 非法 role ${t.role}`);
      }
      if (t.onFailure !== undefined) {
        assert.ok(VALID_ONFAILURE.includes(t.onFailure), `${f}/${t.id}: 非法 onFailure ${t.onFailure}`);
      }
      if (t.dependsOn !== undefined) {
        assert.ok(Array.isArray(t.dependsOn), `${f}/${t.id}: dependsOn 应为数组`);
        for (const dep of t.dependsOn) {
          assert.ok(ids.has(dep), `${f}/${t.id}: dependsOn 引用了不存在的任务 ${dep}`);
        }
      }
      if (t.files !== undefined) {
        assert.ok(Array.isArray(t.files) && t.files.every((p) => typeof p === 'string'), `${f}/${t.id}: files 应为字符串数组`);
      }
    }
  }
});

test('模板任务链无环（拓扑可排序）', () => {
  for (const f of EXPECTED) {
    const data = JSON.parse(fs.readFileSync(path.join(TPL_DIR, f), 'utf8'));
    const indeg = new Map();
    const out = new Map();
    for (const t of data.tasks) {
      indeg.set(t.id, (t.dependsOn || []).length);
      for (const dep of t.dependsOn || []) {
        if (!out.has(dep)) out.set(dep, []);
        out.get(dep).push(t.id);
      }
    }
    const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift();
      visited++;
      for (const next of out.get(id) || []) {
        indeg.set(next, indeg.get(next) - 1);
        if (indeg.get(next) === 0) queue.push(next);
      }
    }
    assert.strictEqual(visited, data.tasks.length, `${f}: 任务依赖存在环`);
  }
});
