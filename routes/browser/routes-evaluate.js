/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: /browser/evaluate (in-page JS execution).
//
// P2-11: this endpoint is an AUDIT boundary, NOT a security sandbox. The
// keyword blacklist only discourages obvious misuse and is trivially
// bypassable (window["fetch"], Function(), string splitting, etc.). It is
// kept for logging/audit only. We now make that explicit in the response and
// comments so callers do not mistake it for an isolation mechanism.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');
const { sanitizeString, checkCLIQPage } = require('./helpers');

function createEvaluateRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/browser/evaluate — 在页面中执行 JS
  // Body: { expression: string }
  //
  // ⚠️ 审计边界（非安全沙箱）：
  //   - 最大表达式长度 2000 字符
  //   - 关键字黑名单仅用于"劝退"明显滥用，可被轻易绕过（如 window["fetch"]、Function()）
  //   - 仅做调用记录（审计），不构成安全隔离；切勿将该路由暴露给不可信客户端
  // ──────────────────────────────────────────────
  router.post('/browser/evaluate', async (req, res) => {
    try {
      const { expression } = req.body;
      if (!expression || typeof expression !== 'string') {
        return res.status(400).json({ success: false, error: 'expression 参数必填' });
      }

      // ── 长度限制 ──
      if (expression.length > 2000) {
        return res.status(400).json({
          success: false,
          error: '表达式过长（最大 2000 字符）',
        });
      }

      // ── 禁止危险的关键字/模式（审计用途，非安全边界） ──
      const BLOCKED_PATTERNS = [
        /\bimport\s*[(\/]/i,
        /\brequire\s*[(\/]/i,
        /\bfetch\s*[(\/]/i,
        /\bXMLHttpRequest\b/i,
        /\bWebSocket\b/i,
        /\bnew\s+Function\b/i,
        /\bconstructor\b/,
        /__proto__/i,
        /\bimportScripts\b/i,
        /\bsharedWorker\b/i,
        /\bserviceWorker\b/i,
        /\bindexedDB\b/i,
        /\bopenDatabase\b/i,
      ];
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(expression)) {
          console.warn(`[Browser] Blocked evaluate expression containing dangerous pattern: ${pattern}`);
          return res.status(400).json({
            success: false,
            error: '表达式中包含不允许的操作',
          });
        }
      }

      // ── 审计日志 ──
      console.log(`[Browser] evaluate: ${sanitizeString(expression.slice(0, 100))}${expression.length > 100 ? '...' : ''}`);

      const page = await browserManager.getActivePage();

      // 🚨 Hesi 页面保护：禁止在 Hesi 管理页面上执行 JS
      const cliqCheck = await checkCLIQPage(page);
      if (cliqCheck.isCLIQ) {
        return res.status(400).json({
          success: false,
          error: 'Hesi 管理页面禁止操作',
          hint: '执行 JavaScript 可能会意外修改 Hesi 管理页面，导致 CDP 断开。请先用 browser_farm_create 创建新会话后再执行 browser_evaluate。',
          farmAction: 'browser_farm_create',
        });
      }

      const result = await page.evaluate((exp) => {
        try {
          // 沙箱化执行 — 在 eval 之前注入安全拦截
          const safeEval = function(expr) {
            // 再次检查（浏览器端二次防护）
            const blocked = [
              /\bimport\s*[(\/]/i, /\brequire\s*[(\/]/i,
              /\bfetch\s*[(\/]/i, /\bXMLHttpRequest\b/i,
              /\bWebSocket\b/i, /\bnew\s+Function\b/i,
              /\bconstructor\b/, /__proto__/i,
              /\bimportScripts\b/i,
            ];
            for (const p of blocked) {
              if (p.test(expr)) {
                throw new Error('Blocked: expression contains dangerous operation');
              }
            }
            return eval(expr);
          };
          return { success: true, value: safeEval(exp) };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }, expression);
      res.json({
        success: true,
        expression: expression.slice(0, 50) + (expression.length > 50 ? '...' : ''),
        // 明确告知调用方：这不是安全沙箱，仅为审计/便利端点
        sandbox: false,
        securityNote: 'browser/evaluate is an AUDIT boundary, not a security sandbox. ' +
          'The expression runs in the page context and the keyword filter is bypassable ' +
          '(e.g. window["fetch"], Function()). Do not expose this route to untrusted clients.',
        result: typeof result === 'object' ? result : { success: true, value: result },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createEvaluateRouter;
