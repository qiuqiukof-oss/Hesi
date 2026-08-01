/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = await import('../routes/ai-tools/run-plan.js');
const _forTest = mod.default._forTest;
const { resolvePlanOutputDir, writeStepOutput, writePlanSummary } = _forTest;

test('resolvePlanOutputDir 默认值 = data/plan-outputs', () => {
  const prev = process.env.HESI_PLAN_OUTPUT_DIR;
  delete process.env.HESI_PLAN_OUTPUT_DIR;
  try {
    const d = resolvePlanOutputDir();
    assert.ok(d.endsWith(path.join('data', 'plan-outputs')), '默认应指向 data/plan-outputs');
  } finally {
    if (prev !== undefined) process.env.HESI_PLAN_OUTPUT_DIR = prev;
  }
});

test('resolvePlanOutputDir 尊重 HESI_PLAN_OUTPUT_DIR 环境变量', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-output-'));
  const prev = process.env.HESI_PLAN_OUTPUT_DIR;
  process.env.HESI_PLAN_OUTPUT_DIR = tmp;
  try {
    assert.equal(resolvePlanOutputDir(), tmp);
  } finally {
    process.env.HESI_PLAN_OUTPUT_DIR = prev;
    fs.rmdirSync(tmp);
  }
});

test('writeStepOutput 写 .log 到指定目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-output-'));
  const prev = process.env.HESI_PLAN_OUTPUT_DIR;
  process.env.HESI_PLAN_OUTPUT_DIR = dir;
  try {
    writeStepOutput('exec-a', 'step-x', 'hello world', 'Error: boom\n  at test.js:1');
    const log = path.join(dir, 'exec-a-step-x.log');
    assert.ok(fs.existsSync(log), '.log 应被创建');
    const content = fs.readFileSync(log, 'utf8');
    assert.ok(content.includes('hello world'), '应包含输出');
    assert.ok(content.includes('Stack:'), '应包含堆栈');
    assert.ok(content.includes('Error: boom'), '应包含堆栈内容');
  } finally {
    process.env.HESI_PLAN_OUTPUT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writePlanSummary 写 plan.json 和 result.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-output-'));
  const prev = process.env.HESI_PLAN_OUTPUT_DIR;
  process.env.HESI_PLAN_OUTPUT_DIR = dir;
  try {
    const plan = { objective: 'test', steps: [{ id: 's1' }] };
    const result = { ok: true, status: 'done', steps: [{ id: 's1', status: 'done' }] };
    writePlanSummary('exec-b', plan, result);
    assert.ok(fs.existsSync(path.join(dir, 'exec-b-plan.json')));
    assert.ok(fs.existsSync(path.join(dir, 'exec-b-result.json')));
    const planJson = JSON.parse(fs.readFileSync(path.join(dir, 'exec-b-plan.json'), 'utf8'));
    assert.equal(planJson.objective, 'test');
    const resJson = JSON.parse(fs.readFileSync(path.join(dir, 'exec-b-result.json'), 'utf8'));
    assert.equal(resJson.ok, true);
  } finally {
    process.env.HESI_PLAN_OUTPUT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
