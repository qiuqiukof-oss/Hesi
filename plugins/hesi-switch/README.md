# Hesi Switch — 模型网关插件

> 把 Hesi 的模型体系**对外暴露为 OpenAI 兼容 API**，让 Claude Code / Cline / 任何 OpenAI SDK 直接调用 Hesi 已配置的 12 家 provider（OpenAI / Anthropic / DeepSeek / 千问 / GLM / Kimi / OpenRouter / OpenCode Zen / NVIDIA NIM / Ollama / LM Studio / vLLM）。

## 与 CC-Switch（QwenPaw 版）的关系

本插件是 **CC-Switch for QwenPaw 的 Hesi 原生版**（原 Python + FastAPI 实现已重写为 Node.js）：

| 维度 | 原版（QwenPaw） | 本版（Hesi） |
|------|----------------|--------------|
| 语言 | Python + FastAPI | Node.js（Hesi 插件生态，零 Python 依赖）|
| Provider 管理 | 自带注册表 + Key | **复用模型服务页**（`🤖 模型服务`侧边栏配置一次即生效）|
| 故障转移 | 自带权重/熔断 | **复用 llm-provider** 自动降级（resolveWithFallback）|
| 配置存储 | 自带 SQLite | Hesi `data/plugin-data/hesi-switch/`（keys/usage）|
| 管理面板 | `/api/gateway/admin/ui` | `/api/plugins/hesi-switch/admin/ui` |

**核心价值不变**：给其他 Agent 一个 OpenAI 兼容网关，共享 Hesi 的模型池，省 Key 省费用。

## 安装

放入 `plugins/` 目录（目录名 `hesi-switch`），重启 Hesi 即自动加载（`[hesi-switch] 插件已加载` 日志确认）。

## 使用

### 端点（Hesi 服务 4264 端口）

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/plugins/hesi-switch/v1/chat/completions` | POST | OpenAI 兼容聊天补全（支持 `stream: true` SSE 流式）|
| `/api/plugins/hesi-switch/v1/models` | GET | 模型列表（含 `provider/model` 别名）|
| `/api/plugins/hesi-switch/health` | GET | 健康检查 + provider 状态 |
| `/api/plugins/hesi-switch/admin/ui` | GET | 管理面板（Key 管理 + 用量统计）|
| `/api/plugins/hesi-switch/admin/keys` | GET/POST/DELETE | 网关 Key 管理 |
| `/api/plugins/hesi-switch/admin/usage` | GET | 用量统计 |

### 模型名路由

- **显式**：`provider/model`（如 `deepseek/deepseek-chat`、`lmstudio/qwen3.6-35b-...`）→ 指定 provider
- **默认模型匹配**：直接写某 provider 的默认/注册模型名 → 自动匹配该 provider
- **自动**：其他模型名 → ⭐默认 provider → 已配置云端 → 本地（含健康降级）

### 示例

```bash
# Claude Code / Cline 等配置 base_url：
#   http://localhost:4264/api/plugins/hesi-switch/v1

curl http://localhost:4264/api/plugins/hesi-switch/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

### Key 校验

- 本机回环（127.0.0.1）请求**免 Key**（Hesi 内部/本地 Agent 直接可用）
- 非回环请求需 `Authorization: Bearer <key>`——Key 在管理面板生成

## 开源协议

MIT
