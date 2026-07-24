// ============================================================
// Builtin Tool: generate_image
//
// 使用 Agnes AI API 生成图片（OpenAI 兼容接口）。
// 支持 agnes-image-v2 模型。
// 配置环境变量 AGNES_API_KEY 启用。
// ============================================================
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { GENERATED_UPLOADS_DIR } = require('../../../lib/uploads');

const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';

const SUPPORTED_MODELS = ['agnes-image-v2'];
const SUPPORTED_SIZES = ['1024x1024', '1792x1024', '1024x1792'];
const SUPPORTED_QUALITIES = ['standard', 'hd'];

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'generate_image',
    noTruncate: true,
    description: '根据文本描述生成图片。使用 Agnes AI 的 agnes-image-v2 模型。配置 AGNES_API_KEY 环境变量即可使用。返回图片 URL（可嵌入 Markdown）。中文：根据文字生成图片',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '图片描述（英文描述效果最佳，中文也支持）',
        },
        model: {
          type: 'string',
          enum: SUPPORTED_MODELS,
          description: '模型：agnes-image-v2（当前唯一图片模型）',
          default: 'agnes-image-v2',
        },
        size: {
          type: 'string',
          enum: SUPPORTED_SIZES,
          description: '图片尺寸：1024x1024（方形）, 1792x1024（横版）, 1024x1792（竖版）',
          default: '1024x1024',
        },
        quality: {
          type: 'string',
          enum: SUPPORTED_QUALITIES,
          description: '图片质量：standard（标准）, hd（高精度，消耗更多配额）',
          default: 'standard',
        },
        negativePrompt: {
          type: 'string',
          description: '负面提示词：不希望出现在图片中的内容',
        },
      },
      required: ['prompt'],
    },
    execute: async (args, broadcastFn) => {
      const apiKey = process.env.AGNES_API_KEY;
      if (!apiKey) {
        return '⚠️ 未配置 Agnes AI API Key。请设置环境变量 AGNES_API_KEY。\n\n获取 API Key: https://agnes-ai.com';
      }

      const model = (args.model || 'agnes-image-v2').toLowerCase();
      if (!SUPPORTED_MODELS.includes(model)) {
        return `❌ 不支持的模型: ${model}。可选: ${SUPPORTED_MODELS.join(', ')}`;
      }

      const prompt = (args.prompt || '').trim();
      if (!prompt) return '❌ prompt 参数不能为空';

      const size = args.size || '1024x1024';
      const quality = args.quality || 'standard';

      try {
        console.log(`[ImageGen] Calling Agnes AI ${model} with prompt: "${prompt.slice(0, 60)}..."`);
        if (broadcastFn) {
          try { broadcastFn({ type: 'mcp_metric', data: { ev: 'tool_progress', tool: 'generate_image', stage: 'calling', message: '正在调用 Agnes AI 生成图片…' } }); } catch { /* ignore */ }
        }

        // 构建请求体（OpenAI 兼容格式）
        const body = {
          model,
          prompt,
          n: 1,
          size,
          quality,
          response_format: 'b64_json',
        };

        if (args.negativePrompt) {
          // 部分模型通过修订提示实现负面提示
          body.prompt = `${prompt}\n避免: ${args.negativePrompt}`;
        }

        const response = await fetch(`${AGNES_BASE}/images/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000), // 120s timeout for generation
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          let errorMsg;
          try {
            const parsed = JSON.parse(errorText);
            errorMsg = parsed.error?.message || parsed.error || errorText.slice(0, 200);
          } catch {
            errorMsg = errorText.slice(0, 200);
          }
          if (response.status === 401 || response.status === 403) {
            return `❌ API 认证失败（HTTP ${response.status}）。请检查 AGNES_API_KEY 是否正确。\n获取 API Key: https://agnes-ai.com`;
          }
          if (response.status === 402 || response.status === 429) {
            return '❌ API 配额不足或请求过快。请在 https://agnes-ai.com 检查账户余额。';
          }
          return `❌ Agnes AI API 错误 (${response.status}): ${errorMsg}`;
        }

        const result = await response.json();

        // 检查返回数据
        if (!result.data || !result.data[0]) {
          return `❌ API 返回格式异常: ${JSON.stringify(result).slice(0, 200)}`;
        }

        const imageData = result.data[0];
        let imageBuffer;

        // 支持 b64_json 和 url 两种返回格式
        if (imageData.b64_json) {
          imageBuffer = Buffer.from(imageData.b64_json, 'base64');
        } else if (imageData.url) {
          // 从 URL 下载图片
          console.log(`[ImageGen] Downloading image from: ${imageData.url.slice(0, 80)}...`);
          const dlResp = await fetch(imageData.url, {
            signal: AbortSignal.timeout(60000),
          });
          if (!dlResp.ok) throw new Error(`Download failed: HTTP ${dlResp.status}`);
          imageBuffer = Buffer.from(await dlResp.arrayBuffer());
        } else {
          return `❌ API 返回不包含图片数据: ${JSON.stringify(imageData).slice(0, 200)}`;
        }

        // 保存到 uploads 目录
        const uploadsDir = GENERATED_UPLOADS_DIR;
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const outputFormat = (args.outputFormat || 'png').toLowerCase();
        const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
        const filename = `ai_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, imageBuffer);

        const fileSizeKB = (imageBuffer.length / 1024).toFixed(1);
        const revisedPrompt = imageData.revised_prompt || null;

        console.log(`[ImageGen] Saved: ${filename} (${fileSizeKB} KB)`);

        // 返回简洁 Markdown（降低回灌 LLM 上下文的 token 占用，结果更聚焦）
        const imageUrl = `/uploads/${filename}`;

        const summaryBits = [
          `模型 ${model}`,
          `${size}`,
          `${outputFormat.toUpperCase()}`,
          `${fileSizeKB} KB`,
        ];

        if (broadcastFn) {
          try { broadcastFn({ type: 'mcp_metric', data: { ev: 'tool_progress', tool: 'generate_image', stage: 'done', message: '图片已生成并完成本地保存' } }); } catch { /* ignore */ }
        }

        let resultStr = `🎨 图片已生成：${imageUrl}\n`;
        resultStr += `> ${summaryBits.join('｜')}\n`;
        if (revisedPrompt && revisedPrompt !== prompt) {
          resultStr += `> 优化提示：${escapePrompt(revisedPrompt.slice(0, 80))}\n`;
        }
        resultStr += `> 提示词：${escapePrompt(prompt.slice(0, 80))}`;

        return resultStr;

      } catch (err) {
        if (err.name === 'AbortError') {
          return '❌ 生成超时（超过 120 秒）。模型可能负载过高，请稍后重试。';
        }
        console.error('[ImageGen] Error:', err.message);
        return `❌ 生成失败: ${err.message}`;
      }
    },
  });
}

/**
 * 清理提示词中的特殊字符，用于 Markdown 表格
 */
function escapePrompt(str) {
  if (!str) return '';
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

module.exports = { register };
