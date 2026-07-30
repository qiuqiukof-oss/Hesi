/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agnes-cfg-'));
process.env.AGNES_CONFIG_DIR = tmp;

const config = (await import('../plugins/agnes-ai/handlers/config.js')).default;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    json(obj) { this.body = obj; return this; },
    status(c) { this.statusCode = c; return this; },
    setHeader() { return this; },
  };
}

test('GET 默认：未配置 + 默认 Base URL', () => {
  const res = fakeRes();
  config({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configured, false);
  assert.equal(res.body.apiKey, '');
  assert.equal(res.body.apiBaseUrl, 'https://apihub.agnes-ai.com/v1');
});

test('POST 保存 key + 模型偏好，GET 能完整恢复', () => {
  const save = fakeRes();
  config({ method: 'POST', body: {
    apiKey: 'sk-test-1234567890',
    apiBaseUrl: 'https://example.com/v1',
    chatModel: 'my-chat',
    imageModel: 'my-img',
    videoModel: 'my-video',
    temperature: 0.9,
    defaultImageSize: '512x512',
    videoResolution: '1080p',
  } }, save);
  assert.equal(save.body.ok, true);

  const get = fakeRes();
  config({ method: 'GET' }, get);
  assert.equal(get.body.apiKey, 'sk-test-1234567890');
  assert.equal(get.body.apiBaseUrl, 'https://example.com/v1');
  assert.equal(get.body.chatModel, 'my-chat');
  assert.equal(get.body.imageModel, 'my-img');
  assert.equal(get.body.videoModel, 'my-video');
  assert.equal(get.body.temperature, 0.9);
  assert.equal(get.body.defaultImageSize, '512x512');
  assert.equal(get.body.videoResolution, '1080p');
});

test('POST 空 key 不覆盖已有 key（保留现有）', () => {
  const save = fakeRes();
  config({ method: 'POST', body: { apiKey: '' } }, save);
  const get = fakeRes();
  config({ method: 'GET' }, get);
  assert.equal(get.body.apiKey, 'sk-test-1234567890');
});

test('DELETE 清空配置后 GET 回到未配置', () => {
  const del = fakeRes();
  config({ method: 'DELETE' }, del);
  assert.equal(del.body.ok, true);
  const get = fakeRes();
  config({ method: 'GET' }, get);
  assert.equal(get.body.configured, false);
  assert.equal(get.body.apiKey, '');
});

test('不支持的方法返回 405', () => {
  const res = fakeRes();
  config({ method: 'PATCH' }, res);
  assert.equal(res.statusCode, 405);
});
