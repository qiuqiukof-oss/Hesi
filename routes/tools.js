/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// AI Tools Route — Terminal command execution + File I/O
// These are stateless helpers that AI agents can invoke.
// ============================================================
const express = require('express');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { evaluateAiExec } = require('../mcp/security/policy');
const { getWorkspace } = require('../lib/workspace');
// Phase 2：文件写类副作用快照（挂到当前轮检查点，供多轮回滚还原）
const MemoryStore = require('../lib/memory');

// ── Config ──
// WORKSPACE is now dynamic (see lib/workspace.js) — read via getWorkspace().
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB max output
const EXEC_TIMEOUT = 120000; // 120s default timeout

/**
 * Check if a command string is considered safe to execute by an AI agent.
 *
 * Delegates to the canonical policy engine (mcp/security/policy.js) using the
 * stricter 'aiExec' profile, so the matching algorithm and blocklist live in a
 * single module shared with the terminal/PTY layer.
 * Returns { allowed: boolean, reason: string }.
 */
function isSafeCommand(command) {
  return evaluateAiExec(command);
}

/**
 * Check if a filename extension is safe for upload.
 * Returns { allowed: boolean, reason: string }.
 */
function isAllowedUploadExt(filename) {
  const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp',
    '.mp4', '.webm', '.mov',
    '.pdf',
    // 文本 / 代码文件（用户可在对话框发送给 AI 阅读）
    '.txt', '.md', '.markdown', '.json', '.csv', '.log', '.js', '.mjs', '.ts', '.tsx', '.jsx',
    '.py', '.yaml', '.yml', '.xml', '.html', '.htm', '.css', '.scss', '.sh', '.bash', '.sql',
    '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.lua',
  ]);
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Safely resolve a file path within the workspace.
 * Prevents directory traversal attacks.
 */
function safeResolve(userPath) {
  const ws = getWorkspace();
  const resolved = path.resolve(ws, userPath);
  // Ensure the resolved path is still within the workspace
  if (!resolved.startsWith(ws)) {
    throw new Error('Path traversal denied: path must be within workspace');
  }
  return resolved;
}

/**
 * Create an Express router for AI tool endpoints.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/tools/exec — Execute a terminal command
  // Body: { command, timeout?, cwd? }
  // Returns: { stdout, stderr, exitCode, duration }
  // ──────────────────────────────────────────────
  router.post('/tools/exec', async (req, res) => {
    const { command, timeout, cwd } = req.body;

    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({ error: 'command is required' });
    }

    // Safety: check command against allowlist/blocklist
    const safety = isSafeCommand(command);
    if (!safety.allowed) {
      return res.status(403).json({ error: safety.reason, command });
    }

    const startTime = Date.now();

    try {
      const result = await new Promise((resolve, reject) => {
        const child = safety.mode === 'strict'
          ? execFile(
              safety.base,
              safety.args,
              {
                cwd: cwd ? safeResolve(cwd) : getWorkspace(),
                timeout: Math.min(timeout || EXEC_TIMEOUT, 300000),
                maxBuffer: MAX_OUTPUT_SIZE,
                windowsHide: true,
              },
              (error, stdout, stderr) => {
                resolve({
                  stdout: stdout || '',
                  stderr: stderr || '',
                  exitCode: error ? (error.code || error.status || 1) : 0,
                  error: error ? error.message : null,
                });
              }
            )
          // eslint-disable-next-line no-restricted-syntax -- P0-gated: `command` is validated by evaluateAiExec() (allowlist + destructive deny) in isSafeCommand() before reaching here; strict mode uses execFile above.
          : exec(
              command,
              {
                cwd: cwd ? safeResolve(cwd) : getWorkspace(),
                timeout: Math.min(timeout || EXEC_TIMEOUT, 300000),
                maxBuffer: MAX_OUTPUT_SIZE,
                windowsHide: true,
              },
              (error, stdout, stderr) => {
                resolve({
                  stdout: stdout || '',
                  stderr: stderr || '',
                  exitCode: error ? (error.code || error.status || 1) : 0,
                  error: error ? error.message : null,
                });
              }
            );
        // Surface process errors (e.g. ENOENT in strict mode) as a 500.
        child.on('error', (err) => reject(err));
      });

      const duration = Date.now() - startTime;

      return res.json({
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration,
        truncated: result.stdout.length + result.stderr.length >= MAX_OUTPUT_SIZE,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/tools/read-file — Read a file
  // Query: ?path=relative/path/to/file&encoding=utf8
  // ──────────────────────────────────────────────
  router.get('/tools/read-file', async (req, res) => {
    const filePath = req.query.path;
    const encoding = req.query.encoding || 'utf8';

    if (!filePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    try {
      const resolved = safeResolve(filePath);

      // Check file exists
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: `File not found: ${filePath}` });
      }

      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return res.status(400).json({ error: `Not a file: ${filePath}` });
      }

      // Size limit: 10MB for text files
      if (stat.size > 10 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large (max 10MB)' });
      }

      const content = fs.readFileSync(resolved, encoding);
      const ext = path.extname(resolved).toLowerCase();
      const language = getLanguageFromExt(ext);

      return res.json({
        path: filePath,
        resolved,
        size: stat.size,
        encoding,
        language,
        content,
      });
    } catch (err) {
      const status = err.message.includes('denied') ? 403 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/tools/write-file — Write to a file
  // Body: { path, content, encoding? }
  // ──────────────────────────────────────────────
  router.post('/tools/write-file', async (req, res) => {
    const { path: filePath, content, encoding } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'path and content are required' });
    }

    try {
      const resolved = safeResolve(filePath);

      // Ensure parent directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const enc = encoding || 'utf-8';
      // Phase 2：写前快照原文件，挂到「当前轮检查点」的 sideEffects（供多轮回滚还原文件）。
      // 仅在记忆会话下生效；失败静默降级，绝不阻断正常写文件。
      const sessionId = req.body && req.body.sessionId;
      if (sessionId && MemoryStore.enabled) {
        try {
          let isNew = false;
          let before = '';
          if (fs.existsSync(resolved)) {
            before = fs.readFileSync(resolved, enc);
          } else {
            isNew = true;
          }
          MemoryStore.recordSideEffect(sessionId, resolved, before, isNew);
        } catch (snapErr) {
          console.warn('[write-file] side-effect snapshot skipped (non-fatal):', snapErr && snapErr.message);
        }
      }
      fs.writeFileSync(resolved, String(content), enc);

      return res.json({
        path: filePath,
        resolved,
        size: Buffer.byteLength(String(content), enc),
        written: true,
      });
    } catch (err) {
      const status = err.message.includes('denied') ? 403 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/tools/list-dir — List directory contents
  // Query: ?dir=relative/path&depth=1
  // ──────────────────────────────────────────────
  router.get('/tools/list-dir', async (req, res) => {
    const dirPath = req.query.dir || '.';
    const depth = Math.min(parseInt(req.query.depth) || 1, 3); // max depth 3

    try {
      const resolved = safeResolve(dirPath);

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: `Directory not found: ${dirPath}` });
      }

      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: `Not a directory: ${dirPath}` });
      }

      const entries = listDirRecursive(resolved, depth, 0);

      return res.json({
        path: dirPath,
        resolved,
        entries,
        total: entries.length,
      });
    } catch (err) {
      const status = err.message.includes('denied') ? 403 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  return router;
}

/**
 * Recursively list directory contents up to a max depth.
 */
function listDirRecursive(dirPath, maxDepth, currentDepth) {
  const entries = [];
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      // Skip hidden files and node_modules
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;

      const fullPath = path.join(dirPath, item.name);
      const relativePath = path.relative(getWorkspace(), fullPath);

      const entry = {
        name: item.name,
        path: relativePath,
        type: item.isDirectory() ? 'directory' : 'file',
      };

      if (item.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          entry.size = stat.size;
          entry.ext = path.extname(item.name).toLowerCase();
        } catch (e) { console.debug('[Tools] stat entry:', e?.message); }
      }

      entries.push(entry);

      if (item.isDirectory() && currentDepth < maxDepth) {
        const sub = listDirRecursive(fullPath, maxDepth, currentDepth + 1);
        entries.push(...sub);
      }
    }
  } catch { /* permission denied, skip */ }
  return entries;
}

function getLanguageFromExt(ext) {
  const map = {
    '.js': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.css': 'css',
    '.scss': 'scss',
    '.html': 'html',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.sh': 'shell',
    '.bat': 'batch',
    '.ps1': 'powershell',
    '.sql': 'sql',
    '.env': 'dotenv',
    '.gitignore': 'gitignore',
  };
  return map[ext] || 'text';
}

module.exports = { createRouter, isSafeCommand, isAllowedUploadExt };
