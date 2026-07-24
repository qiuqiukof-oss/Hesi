// ============================================================
// Multimodal attachment injection for chat messages
// ------------------------------------------------------------
// Turns a user message with `attachments` (short URLs + metadata only —
// no base64 in transit or in persistence) into a provider-specific
// content array so the model can actually SEE / READ them.
//
// Why backend-side transcoding instead of frontend base64 inline?
//   - The Hesi backend (Node) runs on the same machine as the uploaded
//     files (uploads/.user), so it can read bytes locally and hand the
//     model base64. The model never needs to fetch localhost (which
//     cloud models cannot reach anyway).
//   - Conversation history persists only the short URL — base64 never
//     hits IndexedDB / localStorage, so we don't blow up storage.
// ============================================================
const fs = require('fs');
const path = require('path');
const { GENERATED_UPLOADS_DIR, USER_UPLOADS_DIR } = require('../../lib/uploads');

// ── Limits ──
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB: skip vision block if larger
const MAX_TEXT_CHARS = 12000;            // truncate text files we inline

// ── MIME map (fallback when attachment.mime is missing) ──
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogg': 'video/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv', '.log': 'text/plain',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/typescript', '.tsx': 'text/typescript',
  '.jsx': 'text/javascript', '.py': 'text/x-python', '.yaml': 'text/yaml', '.yml': 'text/yaml',
  '.xml': 'application/xml', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.sh': 'text/plain', '.bash': 'text/plain', '.sql': 'text/plain',
  '.java': 'text/plain', '.go': 'text/plain', '.rs': 'text/plain', '.c': 'text/plain',
  '.cpp': 'text/plain', '.h': 'text/plain', '.rb': 'text/plain', '.php': 'text/plain',
};

function _resolveUploadFile(filename) {
  // User uploads live in uploads/.user; AI-generated artifacts in uploads/.
  // Try both so forwarded AI-generated media is also readable.
  for (const dir of [USER_UPLOADS_DIR, GENERATED_UPLOADS_DIR]) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function _mimeForExt(ext) {
  return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Mutates `messages` in place: for each user message with attachments,
 * replaces `content` (string) with a content array of text/image/video blocks.
 *
 * @param {Array<{role:string, content:string|Array, attachments?:Array}>} messages
 * @param {string} provider - 'anthropic' | anything else (treated as OpenAI)
 */
async function injectAttachments(messages, provider) {
  if (!Array.isArray(messages)) return messages;
  const isAnthropic = provider === 'anthropic';

  for (const msg of messages) {
    if (!msg || msg.role !== 'user') continue;
    if (!Array.isArray(msg.attachments) || msg.attachments.length === 0) continue;
    if (typeof msg.content !== 'string') continue; // already a content array — don't double-inject

    const blocks = (msg.content && msg.content.trim())
      ? [{ type: 'text', text: msg.content }]
      : [];

    for (const att of msg.attachments) {
      const rawName = att.name || (att.url ? path.basename(att.url) : 'file');
      const filename = path.basename(att.url || '');
      const filePath = _resolveUploadFile(filename);

      if (!filePath) {
        blocks.push({ type: 'text', text: `[用户发送的文件「${rawName}」已过期或不存在，无法读取]` });
        continue;
      }

      const ext = path.extname(filename).toLowerCase();
      const mime = att.mime || _mimeForExt(ext);

      try {
        if (att.kind === 'image' || mime.startsWith('image/')) {
          const stat = fs.statSync(filePath);
          if (stat.size > MAX_IMAGE_BYTES) {
            blocks.push({ type: 'text', text: `[图片「${rawName}」过大 (${(stat.size / 1048576).toFixed(1)}MB)，已跳过视觉分析]` });
            continue;
          }
          const b64 = fs.readFileSync(filePath).toString('base64');
          if (isAnthropic) {
            blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
          } else {
            blocks.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
          }

        } else if (att.kind === 'video' || mime.startsWith('video/')) {
          if (isAnthropic) {
            // Claude supports video input — genuinely "sees" it.
            const b64 = fs.readFileSync(filePath).toString('base64');
            blocks.push({ type: 'video', source: { type: 'base64', media_type: mime, data: b64 } });
          } else {
            // OpenAI chat models do NOT accept video input — degrade honestly.
            blocks.push({
              type: 'text',
              text: `[用户发送了视频「${rawName}」，但当前模型（OpenAI chat）不支持直接分析视频。请基于用户的文字描述回答，不要编造你未看到的内容]`,
            });
          }

        } else {
          // text / code / pdf → inline as text
          if (ext === '.pdf') {
            // Binary; v1 does not parse PDF text. Tell the model clearly.
            blocks.push({
              type: 'text',
              text: `[用户发送了 PDF 文件「${rawName}」（二进制，暂不支持解析内容）。请基于用户的文字描述回答，不要编造未看到的内容]`,
            });
            continue;
          }
          let text = fs.readFileSync(filePath, 'utf8');
          if (text.length > MAX_TEXT_CHARS) {
            text = `${text.slice(0, MAX_TEXT_CHARS)  }\n...[已截断，原文件共 ${text.length} 字符]`;
          }
          blocks.push({ type: 'text', text: `[文件 ${rawName}]\n\`\`\`\n${text}\n\`\`\`` });
        }
      } catch (e) {
        blocks.push({ type: 'text', text: `[读取文件「${rawName}」失败：${e && e.message ? e.message : e}]` });
      }
    }

    msg.content = blocks;
  }

  return messages;
}

module.exports = { injectAttachments };
