// ============================================================
// Builtin Tool: generate_video
//
// 使用 Agnes AI API 生成视频（异步任务 + 轮询）。
// 支持 agnes-video-v2.0 模型。
// 配置环境变量 AGNES_API_KEY 启用。
// ============================================================
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { GENERATED_UPLOADS_DIR } = require('../../../lib/uploads');

const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';
const AGNES_BASE_ROOT = 'https://apihub.agnes-ai.com'; // GET /agnesapi 在根路径，不在 /v1 下

const SUPPORTED_MODELS = ['agnes-video-v2.0'];
const SUPPORTED_STYLES = ['none', 'realistic', 'anime', 'cinematic', '3d-render'];
// Configurable via environment variables (for testing). Defaults: 5s poll, 5 min max.
const POLL_INTERVAL = parseInt(process.env.VIDEO_POLL_INTERVAL, 10) || 5000;
const MAX_POLL_TIME = parseInt(process.env.VIDEO_MAX_POLL_TIME, 10) || 300000;

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'generate_video',
    noTruncate: true,
    description: '根据文本描述生成视频。使用 Agnes AI 的 agnes-video-v2.0 模型。配置 AGNES_API_KEY 环境变量即可使用。生成过程异步进行，通常需要 1-5 分钟。返回视频 URL。中文：根据文字生成视频',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '视频描述（建议英文描述效果更佳，中文也支持）',
        },
        model: {
          type: 'string',
          enum: SUPPORTED_MODELS,
          description: '模型：agnes-video-v2.0（当前唯一视频模型）',
          default: 'agnes-video-v2.0',
        },
        numFrames: {
          type: 'number',
          description: '视频帧数（影响时长，默认 17 帧约 1-2 秒）',
          default: 17,
        },
        frameRate: {
          type: 'number',
          description: '帧率（fps，默认 8）',
          default: 8,
        },
        style: {
          type: 'string',
          enum: SUPPORTED_STYLES,
          description: '风格：none（无预设）, realistic（写实）, anime（动漫）, cinematic（电影感）, 3d-render（3D 渲染）',
          default: 'none',
        },
        negativePrompt: {
          type: 'string',
          description: '负面提示词：不希望出现在视频中的内容',
        },
      },
      required: ['prompt'],
    },
    execute: async (args, broadcastFn, progressFn) => {
      const apiKey = process.env.AGNES_API_KEY;
      if (!apiKey) {
        return '⚠️ 未配置 Agnes AI API Key。请设置环境变量 AGNES_API_KEY。\n\n获取 API Key: https://agnes-ai.com';
      }

      const model = (args.model || 'agnes-video-v2.0').toLowerCase();
      if (!SUPPORTED_MODELS.includes(model)) {
        return `❌ 不支持的模型: ${model}。可选: ${SUPPORTED_MODELS.join(', ')}`;
      }

      const prompt = (args.prompt || '').trim();
      if (!prompt) return '❌ prompt 参数不能为空';

      const numFrames = Math.min(Math.max(args.numFrames ?? 17, 5), 100);
      const frameRate = Math.min(Math.max(args.frameRate ?? 8, 1), 30);
      const style = args.style || 'none';

      try {
        // progressFn（第三参数）经 registry.execute 实际透传的是 requestId 字符串，
        // 直接调用会抛错；统一改为通过 broadcastFn 广播 mcp_metric 进度（best-effort）。
        const emitProgress = (p) => {
          if (!broadcastFn) return;
          try { broadcastFn({ type: 'mcp_metric', data: { ev: 'tool_progress', tool: 'generate_video', ...p } }); } catch { /* ignore */ }
        };

        console.log(`[VideoGen] Submitting Agnes AI ${model} with prompt: "${prompt.slice(0, 60)}..."`);

        // ── 增量进度通知：提交中 ──
        emitProgress({ stage: 'submitting', model, prompt: prompt.slice(0, 60) });

        // ── Step 1: Submit video generation task ──
        const body = {
          model,
          prompt,
          num_frames: numFrames,
          frame_rate: frameRate,
        };

        if (args.negativePrompt) {
          body.negative_prompt = args.negativePrompt;
        }
        if (style !== 'none') {
          body.style = style;
        }

        const submitResp = await fetch(`${AGNES_BASE}/videos`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000), // 30s timeout for submission
        });

        if (!submitResp.ok) {
          let errorMsg;
          try {
            const parsed = await submitResp.json();
            errorMsg = parsed.error?.message || parsed.error || `HTTP ${submitResp.status}`;
          } catch {
            errorMsg = `HTTP ${submitResp.status}`;
          }
          if (submitResp.status === 401 || submitResp.status === 403) {
            return `❌ API 认证失败（HTTP ${submitResp.status}）。请检查 AGNES_API_KEY 是否正确。`;
          }
          return `❌ Agnes AI API 错误 (${submitResp.status}): ${errorMsg}`;
        }

        const taskResult = await submitResp.json();
        const videoId = taskResult.video_id || taskResult.id;
        const taskId = taskResult.task_id;

        if (!videoId) {
          return `❌ 提交失败：未获取到视频任务 ID。响应: ${JSON.stringify(taskResult).slice(0, 200)}`;
        }

        console.log(`[VideoGen] Task submitted: video_id=${videoId}, task_id=${taskId}`);

        // ── Step 2: Poll for completion ──
        let result = '⏳ 视频生成任务已提交，正在等待完成...\n\n';
        result += `| 属性 | 值 |\n|------|-----|\n`;
        result += `| 模型 | ${model} |\n`;
        result += `| 提示词 | ${escapePrompt(prompt)} |\n`;
        result += `| 帧数 | ${numFrames} |\n`;
        result += `| 帧率 | ${frameRate} fps |\n`;
        result += `| 预计时长 | ~${(numFrames / frameRate).toFixed(1)}s |\n`;
        if (style !== 'none') result += `| 风格 | ${style} |\n`;
        result += `\n> ⏳ 生成中...\n\n`;

        const startTime = Date.now();
        let videoUrl = null;
        let pollCount = 0;

        // ── 增量进度通知：首次消息 ──
        emitProgress({ stage: 'queued', taskId: videoId, message: '视频生成已排队，正在等待处理...' });

        while (Date.now() - startTime < MAX_POLL_TIME) {
          pollCount++;

          // Wait before polling
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

          try {
            const pollResp = await fetch(`${AGNES_BASE_ROOT}/agnesapi?video_id=${videoId}`, {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
              signal: AbortSignal.timeout(15000),
            });

            if (!pollResp.ok) {
              console.warn(`[VideoGen] Poll attempt ${pollCount} failed: HTTP ${pollResp.status}`);
              continue;
            }

            const pollResult = await pollResp.json();
            const status = (pollResult.status || '').toLowerCase();

            console.log(`[VideoGen] Poll ${pollCount}: status=${status}`);

            // ── 增量进度通知：每 3 次轮询（~15s）报告一次进度，避免过于频繁 ──
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            if (pollCount % 3 === 0 || status === 'completed' || status === 'failed') {
              emitProgress({ stage: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'polling', taskId: videoId, attempt: pollCount, elapsedSec: elapsed, message: `视频生成中... (${elapsed}s)` });
            }

            if (status === 'completed') {
              videoUrl = pollResult.url || pollResult.video_url || pollResult.result?.url;
              emitProgress({ stage: 'completed', taskId: videoId, message: '视频生成完成，正在下载...' });
              break;
            } else if (status === 'failed') {
              const errorMsg = pollResult.error || pollResult.message || '未知错误';
              emitProgress({ stage: 'failed', taskId: videoId, error: errorMsg });
              return `❌ 视频生成失败: ${errorMsg}`;
            }
            // Otherwise: 'processing', 'queued', etc. — keep polling
          } catch (pollErr) {
            if (pollErr.name === 'AbortError') {
              console.warn(`[VideoGen] Poll ${pollCount} timed out`);
            } else {
              console.warn(`[VideoGen] Poll ${pollCount} error: ${pollErr.message}`);
            }
            // Continue polling on transient errors
          }
        }

        if (!videoUrl) {
          return `❌ 视频生成超时（超过 ${MAX_POLL_TIME / 60000} 分钟）。请稍后使用 video_id 查询：\n\`\`\`\nvideo_id: ${videoId}\n\`\`\`\nAPI: GET ${AGNES_BASE_ROOT}/agnesapi?video_id=${videoId}`;
        }

        // ── Step 3: Download and save the video ──
        console.log(`[VideoGen] Video ready, downloading from: ${videoUrl.slice(0, 80)}...`);

        let videoBuffer;
        let contentType = 'video/mp4';

        try {
          const dlResp = await fetch(videoUrl, {
            signal: AbortSignal.timeout(120000), // 2 min to download
          });
          if (!dlResp.ok) throw new Error(`Download failed: HTTP ${dlResp.status}`);
          videoBuffer = Buffer.from(await dlResp.arrayBuffer());
          contentType = dlResp.headers.get('content-type') || 'video/mp4';
        } catch (dlErr) {
          // If download fails, return the URL directly
          return buildResultWithUrl(videoUrl, model, prompt, numFrames, frameRate, videoId);
        }

        // Save to uploads directory
        const uploadsDir = GENERATED_UPLOADS_DIR;
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const extMap = {
          'video/mp4': 'mp4',
          'video/webm': 'webm',
          'video/ogg': 'ogg',
          'video/quicktime': 'mov',
        };
        const ext = extMap[contentType] || 'mp4';
        const filename = `video_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, videoBuffer);

        const fileSizeMB = (videoBuffer.length / (1024 * 1024)).toFixed(1);
        const fileSizeKB = (videoBuffer.length / 1024).toFixed(1);
        const fileSize = fileSizeMB >= 1 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`;

        console.log(`[VideoGen] Saved: ${filename} (${fileSize})`);

        const videoUrlLocal = `/uploads/${filename}`;
        const duration = (numFrames / frameRate).toFixed(1);

        // Build result
        let resultStr = `## 🎬 视频生成完成\n\n`;
        resultStr += `[🎥 点击播放视频](${videoUrlLocal})\n\n`;
        resultStr += `| 属性 | 值 |\n|------|-----|\n`;
        resultStr += `| 模型 | ${model} |\n`;
        resultStr += `| 提示词 | ${escapePrompt(prompt)} |\n`;
        resultStr += `| 时长 | ~${duration}s |\n`;
        resultStr += `| 帧数 | ${numFrames} |\n`;
        resultStr += `| 帧率 | ${frameRate} fps |\n`;
        resultStr += `| 格式 | ${ext.toUpperCase()} |\n`;
        resultStr += `| 大小 | ${fileSize} |\n`;
        resultStr += `| URL | \`${videoUrlLocal}\` |\n`;
        if (style !== 'none') resultStr += `| 风格 | ${style} |\n`;
        resultStr += `| Video ID | \`${videoId}\` |\n`;
        resultStr += `\n> 💡 提示：点击上方视频链接播放，或使用 URL 下载。`;

        return resultStr;

      } catch (err) {
        if (err.name === 'AbortError') {
          return '❌ 操作超时。请稍后重试。';
        }
        console.error('[VideoGen] Error:', err.message);
        return `❌ 生成失败: ${err.message}`;
      }
    },
  });
}

/**
 * 当本地下载失败时，返回远程 URL 结果。
 */
function buildResultWithUrl(videoUrl, model, prompt, numFrames, frameRate, videoId) {
  const duration = (numFrames / frameRate).toFixed(1);
  let result = `## 🎬 视频生成完成\n\n`;
  result += `> ⚠️ 本地暂存失败，但视频已生成完毕。\n\n`;
  result += `[🎥 点击下载视频](${videoUrl})\n\n`;
  result += `| 属性 | 值 |\n|------|-----|\n`;
  result += `| 模型 | ${model} |\n`;
  result += `| 提示词 | ${escapePrompt(prompt)} |\n`;
  result += `| 时长 | ~${duration}s |\n`;
  result += `| 帧数 | ${numFrames} |\n`;
  result += `| 帧率 | ${frameRate} fps |\n`;
  result += `| Video ID | \`${videoId}\` |\n`;
  result += `| 远程 URL | \`${videoUrl}\` |\n`;
  result += `\n> 💡 提示：复制 URL 到浏览器打开以下载视频。`;
  return result;
}

/**
 * 清理提示词中的特殊字符，用于 Markdown 表格
 */
function escapePrompt(str) {
  if (!str) return '';
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

module.exports = { register };
