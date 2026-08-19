/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Shared upload directory constants — single source of truth.
//
// Previously the codebase used TWO divergent locations for "uploads":
//   - routes/upload.js wrote user uploads to os.tmpdir()/ucli-uploads
//   - doc-convert/image-gen/video-gen wrote artifacts to <cwd>/uploads
// and image-gen/video-gen even linked artifacts via /api/uploads/ (which
// served the tmpdir), so those links 404'd.
//
// We unify under one <project>/uploads tree with a clear security boundary:
//   - GENERATED_UPLOADS_DIR: AI-generated artifacts (converted docs, images,
//     video, generated HTML reports). Served PUBLICLY at GET /uploads.
//   - USER_UPLOADS_DIR: end-user file uploads (POST /api/uploads). Served only
//     through the AUTHENTICATED GET /api/uploads route. It lives in a dot
//     directory so the public static /uploads route (express.static defaults to
//     dotfiles:'ignore') never exposes it.
// ============================================================
const path = require('path');

const GENERATED_UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const USER_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', '.user');

module.exports = { GENERATED_UPLOADS_DIR, USER_UPLOADS_DIR };
