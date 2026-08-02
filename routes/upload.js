/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// File Upload Routes
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { isAllowedUploadExt } = require('./tools');
const audit = require('../lib/audit');
const telemetry = require('../lib/telemetry');
// Upload directory and TTL — kept separate from discovery module
const { USER_UPLOADS_DIR } = require('../lib/uploads');

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────
// User uploads live in a hidden ./uploads/.user directory (see lib/uploads.js)
// so they are never exposed by the public static /uploads route.
const UPLOAD_DIR = USER_UPLOADS_DIR;
const UPLOAD_TTL = 60 * 60 * 1000; // 1 hour
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB per file
const MAX_UPLOAD_FILES = 10;

/**
 * multer/busboy 默认按 latin1 解码 multipart filename → 中文（UTF-8 字节）乱码
 * （如「测试文档.txt」→「æµè¯ææ¡£.txt」）。RFC 7578 规定 filename 应为 UTF-8，
 * 这里做无损转回；仅当字节确为合法 UTF-8 序列时才转换，避免破坏真正的 latin1
 * 文件名（如西欧字符 é/ü 等本就按 latin1 存储的旧客户端）。
 * @param {string} name
 * @returns {string}
 */
function decodeUtf8Filename(name) {
  if (!name || typeof name !== 'string') return name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? name : utf8;
}

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ──────────────────────────────────────────────
// Multer instance
// ──────────────────────────────────────────────
const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: MAX_UPLOAD_FILES,
  },
});

// ──────────────────────────────────────────────
// Upload file cleanup — remove files older than 1 hour
// ──────────────────────────────────────────────
function cleanupOldUploads() {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    const now = Date.now();
    let removed = 0;
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && now - stat.mtimeMs > UPLOAD_TTL) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch { /* file may have been deleted already */ }
    }
    if (removed > 0) {
      console.log(`[Cleanup] Removed ${removed} expired upload(s)`);
    }
  } catch { /* directory may not exist */ }
}

// Run cleanup every 30 minutes
setInterval(cleanupOldUploads, 30 * 60 * 1000).unref();

/**
 * Create an Express router for file upload endpoints.
 *
 * @param {{ uploadLimiter: Function }} rateLimiters
 * @returns {express.Router}
 */
function createRouter({ uploadLimiter }) {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // Serve uploaded files (images, videos, etc.)
  // ──────────────────────────────────────────────
  const MIME_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'application/pdf', 'image/avif', 'image/bmp',
  ]);

  // ──────────────────────────────────────────────
  // List uploaded files (metadata only, no file data)
  // ──────────────────────────────────────────────
  router.get('/uploads', (req, res) => {
    try {
      const files = fs.readdirSync(UPLOAD_DIR);
      const fileList = files
        .filter(f => {
          try { return fs.statSync(path.join(UPLOAD_DIR, f)).isFile(); }
          catch (e) { return false; }
        })
        .map(f => {
          const stat = fs.statSync(path.join(UPLOAD_DIR, f));
          const ext = path.extname(f).toLowerCase();
          const extMap = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
            '.mov': 'video/quicktime', '.pdf': 'application/pdf',
            '.avif': 'image/avif', '.bmp': 'image/bmp',
          };
          return {
            name: f,
            size: stat.size,
            mime: extMap[ext] || 'application/octet-stream',
            addedAt: stat.mtimeMs,
          };
        })
        .sort((a, b) => b.addedAt - a.addedAt);

      res.json({ success: true, files: fileList });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list uploads' });
    }
  });

  router.get('/uploads/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filepath = path.join(UPLOAD_DIR, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mime = req.query.mime || '';
    if (MIME_TYPES.has(mime)) {
      res.setHeader('Content-Type', mime);
    } else {
      // Auto-detect from extension
      const extMap = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
        '.mov': 'video/quicktime', '.pdf': 'application/pdf',
        '.avif': 'image/avif', '.bmp': 'image/bmp',
      };
      const ext = path.extname(filename).toLowerCase();
      res.setHeader('Content-Type', extMap[ext] || 'application/octet-stream');
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(filepath);
  });

  // ──────────────────────────────────────────────
  // Multipart file upload (streaming, efficient)
  // ──────────────────────────────────────────────
  router.post('/upload', uploadLimiter, upload.array('files', MAX_UPLOAD_FILES), (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploaded = [];
    for (const file of req.files) {
      // 中文文件名转回 UTF-8（busboy 按 latin1 解码导致乱码），影响校验与返回 name；
      // 磁盘文件名仍是 uuid+ext（safeName），不受影响。
      file.originalname = decodeUtf8Filename(file.originalname);
      // Validate file extension
      if (!isAllowedUploadExt(file.originalname)) {
        // Clean up temp file
        try { fs.unlinkSync(file.path); } catch (e) { console.warn('[Upload] cleanup temp file:', e?.message); }
        return res.status(400).json({
          error: `File type not allowed: ${path.extname(file.originalname)}. Only images, videos, and PDF are accepted.`,
        });
      }

      const ext = path.extname(file.originalname);
      const safeName = `${uuidv4()}${ext}`;
      const destPath = path.join(UPLOAD_DIR, safeName);

      // Move the temp file to a safe permanent name
      try {
        fs.renameSync(file.path, destPath);
      } catch {
        // Fallback: copy and delete
        fs.copyFileSync(file.path, destPath);
        fs.unlinkSync(file.path);
      }

      uploaded.push({
        name: file.originalname,
        path: destPath,
        // 用户上传落在 uploads/.user（隐藏目录），只能经鉴权路由 /api/uploads 取回
        // （公开静态 /uploads 仅服务 AI 生成的 artifacts，且 dotfiles:'ignore' 不暴露 .user）。
        url: `/api/uploads/${  encodeURIComponent(safeName)}`,
        size: file.size,
        mime: file.mimetype,
      });
    }

    const user = (req.user && req.user.username) || 'anonymous';
    audit.fileUpload(user, { count: uploaded.length, names: uploaded.map((u) => u.name) });
    telemetry.track('file_upload', { user, feature: 'upload' });

    res.json({ success: true, files: uploaded });
  });

  // ──────────────────────────────────────────────
  // Legacy JSON-base64 upload endpoint
  // ──────────────────────────────────────────────
  router.post('/upload-json', uploadLimiter, (req, res) => {
    if (!req.body || !req.body.files || !Array.isArray(req.body.files)) {
      return res.status(400).json({ error: 'files array required' });
    }

    if (req.body.files.length > MAX_UPLOAD_FILES) {
      return res.status(400).json({ error: `Maximum ${MAX_UPLOAD_FILES} files allowed` });
    }

    const uploaded = [];
    for (const file of req.body.files) {
      if (!file.data || !file.name) continue;

      // Validate file extension
      if (!isAllowedUploadExt(file.name)) {
        return res.status(400).json({
          error: `File type not allowed: ${path.extname(file.name)}. Only images, videos, and PDF are accepted.`,
        });
      }

      const decoded = Buffer.from(file.data, 'base64');

      if (decoded.length > MAX_UPLOAD_SIZE) {
        return res.status(400).json({ error: `File "${file.name}" exceeds maximum size of 100MB` });
      }

      // Use UUID for safe filenames
      const ext = path.extname(file.name);
      const safeName = `${uuidv4()}${ext}`;
      const destPath = path.join(UPLOAD_DIR, safeName);

      fs.writeFileSync(destPath, decoded);
      uploaded.push({ name: file.name, path: destPath, size: decoded.length });
    }

    const user = (req.user && req.user.username) || 'anonymous';
    audit.fileUpload(user, { count: uploaded.length, mode: 'json' });
    telemetry.track('file_upload', { user, feature: 'upload-json' });

    res.json({ success: true, files: uploaded });
  });

  return router;
}

module.exports = { createRouter, cleanupOldUploads };
