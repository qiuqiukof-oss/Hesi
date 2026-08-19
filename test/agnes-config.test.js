'use strict';
// 永久回归测试：Agnes 配置落盘（v0.7.6 持久化修复）
// 锁定「写盘失败必须返回 500」的反脆弱行为，防止回归成静默成功 / 误报 ok:true。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// config.js 在 require 时读取 AGNES_CONFIG_DIR，必须在其前设置，隔离真实 data 目录
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agnes-config-test-'));
process.env.AGNES_CONFIG_DIR = TMP;
const configHandler = require('../plugins/agnes-ai/handlers/config.js');

function makeRes() {
  const r = { _status: 200, _body: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (b) => { r._body = b; return r; };
  return r;
}

test('GET 返回空配置（未配置）', () => {
  const res = makeRes();
  configHandler({ method: 'GET', body: {} }, res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.apiKey, '');
  assert.strictEqual(res._body.configured, false);
  assert.strictEqual(typeof res._body.apiBaseUrl, 'string');
});

test('POST 正常落盘 → ok:true, configured:true', () => {
  const res = makeRes();
  configHandler(
    { method: 'POST', body: { apiKey: 'sk-abcdef1234567890', apiBaseUrl: 'https://apihub.agnes-ai.com/v1' } },
    res
  );
  assert.strictEqual(res._status, 200);
  assert.deepStrictEqual(res._body, { ok: true, configured: true });
  // 文件确实写出到隔离目录
  const written = JSON.parse(fs.readFileSync(path.join(TMP, 'config.json'), 'utf8'));
  assert.strictEqual(written.apiKey, 'sk-abcdef1234567890');
});

test('POST 空 key 保留已有 key（改 Base URL 无需重填 key）', () => {
  // 先写入
  const r1 = makeRes();
  configHandler({ method: 'POST', body: { apiKey: 'sk-first1234567890', apiBaseUrl: 'https://x.test/v1' } }, r1);
  // 再只改 baseUrl，key 留空
  const r2 = makeRes();
  configHandler({ method: 'POST', body: { apiBaseUrl: 'https://y.test/v1' } }, r2);
  assert.strictEqual(r2._status, 200);
  assert.strictEqual(r2._body.ok, true);
  const written = JSON.parse(fs.readFileSync(path.join(TMP, 'config.json'), 'utf8'));
  assert.strictEqual(written.apiKey, 'sk-first1234567890'); // 保留
  assert.strictEqual(written.apiBaseUrl, 'https://y.test/v1');
});

test('POST 写盘失败 → 返回 500（反脆弱，不静默成功）', () => {
  // 将 AGNES_CONFIG_DIR 指向一个已存在的「文件」而非目录，mkdirSync 必失败 → saveConfig 返 false
  const fileDir = path.join(TMP, 'not-a-dir');
  fs.writeFileSync(fileDir, 'i am a file');
  const prev = process.env.AGNES_CONFIG_DIR;
  process.env.AGNES_CONFIG_DIR = fileDir;
  delete require.cache[require.resolve('../plugins/agnes-ai/handlers/config.js')];
  const failHandler = require('../plugins/agnes-ai/handlers/config.js');
  process.env.AGNES_CONFIG_DIR = prev; // 还原（其它测试用的是首次 require 的实例，不受影响）

  const res = makeRes();
  failHandler({ method: 'POST', body: { apiKey: 'sk-zzz1234567890' } }, res);
  assert.strictEqual(res._status, 500, '写盘失败必须返回 500');
  assert.strictEqual(res._body.ok, false, 'body.ok 必须为 false');
  assert.ok(typeof res._body.error === 'string' && res._body.error.length > 0, '应给出错误说明');
});

test('DELETE 清除配置 → ok:true', () => {
  const res = makeRes();
  configHandler({ method: 'DELETE', body: {} }, res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
});

test('不支持的方法 → 405', () => {
  const res = makeRes();
  configHandler({ method: 'PUT', body: {} }, res);
  assert.strictEqual(res._status, 405);
});
