/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// DSH Home 初始化（零 C 盘依赖）
//
// 把 DSH 的用户数据目录锚定到 Hesi 项目内（data/dsh-home/），
// 通过 DSH_HOME 环境变量覆盖默认的 ~/.dsh。
//
// 目录结构：
//   <hesi_root>/data/dsh-home/
//     .credentials.yaml        ← 凭证（由 Hesi 设置页 / 旧 ~/.dsh/ 迁移写入）
//     settings.yaml            ← DSH 设置（首次引导式创建）
//     profiles/                ← DSH profile 目录（按需自动生成）
//     sessions/                ← 会话持久化
//     storages/                ← 运行时存储
//
// DSH 更新不影响此目录：只替换 node_modules/@deepseek-ai/dsh，
// data/dsh-home/ 全程保留。
// ============================================================

const fs = require('fs');
const path = require('path');

const { getConfig, getCustomProviders, getAllDefs } = require('./llm-provider/provider-config');

const DSH_HOME_DIR_NAME = 'dsh-home';

/** 解析 DSH_HOME 绝对路径（project-relative，不依赖 cwd）。本文件在 <root>/lib/ 下，故向上 1 级即项目根。 */
function resolveDshHomeDir() {
  const root = path.resolve(__dirname, '..');
  return path.join(root, 'data', DSH_HOME_DIR_NAME);
}

/**
 * 从 Hesi 模型配置生成 DSH .credentials.yaml 内容。
 * DSH 格式要求顶层每个 key → string（value 即 API Key 值）。
 * Key 名取 provider id（如 qq / deepseek / qwen），值为对应 apiKey。
 * 通用化：自定义 provider 显式写入；内置 provider 仅当用户实际配置了 key 才写入。
 */
function buildCredentialsYaml() {
  const lines = [];
  const seen = new Set();
  // 自定义 provider（显式 apiKey）
  const customProviders = getCustomProviders();
  for (const cp of customProviders) {
    if (cp.apiKey) {
      const safeKey = cp.apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      lines.push(`${cp.id}: ${safeKey}`);
      seen.add(cp.id);
    }
  }
  // 内置 provider：仅当 getConfig(id) 返回真实 apiKey 才写（避免空 key 污染）
  for (const def of getAllDefs()) {
    if (seen.has(def.id)) continue;
    const cfg = getConfig(def.id);
    if (cfg && cfg.apiKey) {
      const safeKey = cfg.apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      lines.push(`${def.id}: ${safeKey}`);
    }
  }
  // 回退：内置 deepseek provider（如果有 env 中的 key）
  const deepseekCfg = getConfig('deepseek');
  if (deepseekCfg.apiKey && !lines.some(l => l.startsWith('deepseek:'))) {
    const safeKey = deepseekCfg.apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines.push(`deepseek: ${safeKey}`);
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

/**
 * 原子迁移旧 ~/.dsh/.credentials.yaml → 新 data/dsh-home/.credentials.yaml。
 * 旧文件保留不动（方便手动 dsh CLI 仍可用），仅在新位置写入 Hesi 当前配置。
 */
function migrateCredentials(dshHomeDir) {
  const credsFile = path.join(dshHomeDir, '.credentials.yaml');
  if (fs.existsSync(credsFile)) return; // 已初始化，跳过

  // 尝试从旧位置迁移（用户可能有已保存的凭证）
  const oldCreds = path.join(require('os').homedir(), '.dsh', '.credentials.yaml');
  if (fs.existsSync(oldCreds)) {
    try {
      const raw = fs.readFileSync(oldCreds, 'utf8');
      // 旧格式可能是 version: refs: QQ_API_KEY: ...，需要提取有效凭证行
      const cleaned = raw
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('version:') && !l.startsWith('refs:'))
        .map(l => l.replace(/^\s+/, '')) // 去缩进
        .join('\n');
      if (cleaned.trim()) {
        const tmp = `${credsFile}.tmp`;
        fs.writeFileSync(tmp, cleaned + '\n', 'utf8');
        fs.renameSync(tmp, credsFile);
        console.log(`[dsh-init] 已迁移旧凭证至 ${credsFile}`);
        return;
      }
    } catch (e) {
      console.warn('[dsh-init] 迁移旧凭证失败:', e.message);
    }
  }

  // 从无到有：用 Hesi 当前配置写入
  const content = buildCredentialsYaml();
  if (!content) return; // 无可用凭证，留空等用户设置
  fs.writeFileSync(credsFile, content, 'utf8');
  console.log(`[dsh-init] 已初始化 DSH 凭证（${content.split('\n').length} 个 key）`);
}

/** 写入基础 settings.yaml（若不存在）。 */
function ensureSettings(dshHomeDir) {
  const settingsFile = path.join(dshHomeDir, 'settings.yaml');
  if (fs.existsSync(settingsFile)) return;
  const defaultSettings = `# DSH 设置（由 Hesi 自动生成，勿手改）
# 完整设置项见 https://github.com/deepseek-ai/deepseek-harness
ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
`;
  fs.writeFileSync(settingsFile, defaultSettings, 'utf8');
}

/**
 * 初始化 DSH 用户数据目录（幂等，每次 Hesi 启动调用无副作用）。
 * - 设置 DSH_HOME 环境变量
 * - 创建必要子目录
 * - 迁移/写入凭证
 * - 创建基础 settings.yaml
 */
function init() {
  const dshHomeDir = resolveDshHomeDir();
  // 幂等：确保 env 在进程启动早期就设置（不影响已经读取过它的子进程，但保证后续 spawn 继承）
  if (!process.env.DSH_HOME) {
    process.env.DSH_HOME = dshHomeDir;
  }
  // 首次启动才打日志（消除每次启动的噪音）；目录已存在时静默幂等
  const firstRun = !fs.existsSync(dshHomeDir);
  // 创建目录
  fs.mkdirSync(dshHomeDir, { recursive: true });
  fs.mkdirSync(path.join(dshHomeDir, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(dshHomeDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dshHomeDir, 'storages'), { recursive: true });
  // 迁移/写入凭证
  migrateCredentials(dshHomeDir);
  // 基础设置
  ensureSettings(dshHomeDir);
  if (firstRun) console.log(`[dsh-init] DSH_HOME=${dshHomeDir}（已初始化）`);
}

module.exports = { init, resolveDshHomeDir };
