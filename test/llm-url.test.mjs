/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Task #41 专项测试：本地 LLM baseUrl 拼接逻辑（与 AI 助手 chat 子系统共用 lib/llm/url.js）。
// 防止 Plan 生成打到错误端点（/chat/completions 而非 /v1/chat/completions）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApiUrl, normalizeBaseUrl } from '../lib/llm/url.js';

test('buildApiUrl 自动补 /v1（本地 LLM 关键场景）', () => {
  // Ollama 默认端口，无 /v1 → 应自动补
  assert.strictEqual(
    buildApiUrl('http://localhost:11434', 'https://api.openai.com/v1', '/chat/completions'),
    'http://localhost:11434/v1/chat/completions'
  );
  // 任意本地地址
  assert.strictEqual(
    buildApiUrl('http://127.0.0.1:8080', 'https://api.openai.com/v1', '/chat/completions'),
    'http://127.0.0.1:8080/v1/chat/completions'
  );
});

test('buildApiUrl 已有 /v1 则不重复添加（幂等）', () => {
  assert.strictEqual(
    buildApiUrl('http://localhost:11434/v1', 'https://api.openai.com/v1', '/chat/completions'),
    'http://localhost:11434/v1/chat/completions'
  );
  assert.strictEqual(
    buildApiUrl('https://api.openai.com/v1', 'https://api.openai.com/v1', '/chat/completions'),
    'https://api.openai.com/v1/chat/completions'
  );
  // 尾部斜杠应被规整
  assert.strictEqual(
    buildApiUrl('http://localhost:11434/v1/', 'https://api.openai.com/v1', '/chat/completions'),
    'http://localhost:11434/v1/chat/completions'
  );
});

test('buildApiUrl 默认走 OpenAI 官方地址', () => {
  assert.strictEqual(
    buildApiUrl('', 'https://api.openai.com/v1', '/chat/completions'),
    'https://api.openai.com/v1/chat/completions'
  );
});

test('normalizeBaseUrl 归一化各种简写', () => {
  assert.strictEqual(normalizeBaseUrl('http://localhost:11434'), 'http://localhost:11434');
  assert.strictEqual(normalizeBaseUrl('localhost:1234'), 'http://localhost:1234');
  assert.strictEqual(normalizeBaseUrl('/v1'), 'http://localhost:11434/v1');
});
