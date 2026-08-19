/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Project Analysis Route — Scan workspace & return file insights
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.idea', '.vscode',
  '__pycache__', '.cache', 'target', 'build', 'dist', '.next',
  '.turbo', 'coverage', '.nyc_output', 'bower_components',
  'vendor', '.tox', 'eggs', 'tmp', 'temp', 'uploads',
]);

const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.gitkeep', '.npmrc', '.editorconfig',
  '.gitattributes', '.gitignore',
]);

const KEY_FILES = [
  { pattern: 'package.json', label: 'npm/Node.js' },
  { pattern: 'Cargo.toml', label: 'Rust/Cargo' },
  { pattern: 'go.mod', label: 'Go Module' },
  { pattern: 'pom.xml', label: 'Maven/Java' },
  { pattern: 'build.gradle', label: 'Gradle' },
  { pattern: 'Gemfile', label: 'Ruby' },
  { pattern: 'requirements.txt', label: 'Python' },
  { pattern: 'Pipfile', label: 'Python Pipenv' },
  { pattern: 'pyproject.toml', label: 'Python Poetry' },
  { pattern: 'composer.json', label: 'PHP Composer' },
  { pattern: 'Dockerfile', label: 'Docker' },
  { pattern: 'docker-compose.yml', label: 'Docker Compose' },
  { pattern: 'docker-compose.yaml', label: 'Docker Compose' },
  { pattern: '.env', label: 'Environment' },
  { pattern: '.env.example', label: 'Env Example' },
  { pattern: 'Makefile', label: 'Make' },
  { pattern: 'README.md', label: 'README' },
  { pattern: 'LICENSE', label: 'License' },
  { pattern: 'tsconfig.json', label: 'TypeScript' },
  { pattern: '.eslintrc', label: 'ESLint' },
  { pattern: '.prettierrc', label: 'Prettier' },
  { pattern: 'webpack.config.js', label: 'Webpack' },
  { pattern: 'vite.config.ts', label: 'Vite' },
  { pattern: 'vite.config.js', label: 'Vite' },
  { pattern: 'next.config.js', label: 'Next.js' },
  { pattern: 'tailwind.config.js', label: 'Tailwind CSS' },
  { pattern: 'tailwind.config.ts', label: 'Tailwind CSS' },
  { pattern: '.github/workflows', label: 'GitHub Actions' },
];

const EXTENSION_CATEGORIES = {
  source: new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'scala', 'php', 'pl', 'pm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd']),
  markup: new Set(['html', 'htm', 'xhtml', 'xml', 'svg', 'md', 'markdown', 'rst', 'asciidoc', 'adoc']),
  style: new Set(['css', 'scss', 'sass', 'less', 'styl']),
  config: new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'editorconfig', 'npmrc', 'gitignore', 'gitattributes']),
  data: new Set(['csv', 'tsv', 'jsonl', 'sql', 'db', 'sqlite', 'parquet', 'feather', 'arrow']),
  media: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac', 'aac', 'woff', 'woff2', 'ttf', 'eot']),
  docs: new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods']),
};

/**
 * Recursively scan a directory, collecting file info.
 */
/**
 * Recursively scan a directory, collecting file info.
 * @param {string} dirPath
 * @param {number} [depth=0]
 * @returns {Array<{name:string, path:string, ext:string, size:number, mtime:number}>}
 */
function scanDirectory(dirPath, depth = 0) {
  if (depth > 4) return []; // Limit depth

  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      results.push(...scanDirectory(fullPath, depth + 1));
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;
      try {
        const stat = fs.statSync(fullPath);
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        results.push({
          name: entry.name,
          path: fullPath,
          ext,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      } catch (e) { /* ignore unreadable files */ }
    }
  }

  return results;
}

/**
 * Categorize files by extension.
 */
/**
 * Categorize files by extension.
 * @param {Array<{ext:string}>} files
 * @returns {{counts:object, topExts:Array<{ext:string, count:number}>}}
 */
function categorizeFiles(files) {
  const counts = { source: 0, markup: 0, style: 0, config: 0, data: 0, media: 0, docs: 0, other: 0 };
  const extMap = {};

  for (const file of files) {
    const ext = file.ext || '';
    extMap[ext] = (extMap[ext] || 0) + 1;

    let categorized = false;
    for (const [cat, exts] of Object.entries(EXTENSION_CATEGORIES)) {
      if (exts.has(ext)) {
        counts[cat]++;
        categorized = true;
        break;
      }
    }
    if (!categorized) counts.other++;
  }

  // Sort extensions by frequency
  const topExts = Object.entries(extMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([ext, count]) => ({ ext: ext || '(none)', count }));

  return { counts, topExts };
}

/**
 * Detect key project configuration files.
 */
/**
 * Detect key project configuration files.
 * @param {Array<{name:string, path:string, size:number}>} files
 * @returns {Array<{name:string, label:string, size:number}>}
 */
function findKeyFiles(files) {
  const found = [];

  for (const kf of KEY_FILES) {
    const match = files.find(f => {
      const fname = f.name.toLowerCase();
      const pattern = kf.pattern.toLowerCase();
      if (pattern.includes('/')) {
        return f.path.toLowerCase().includes(pattern);
      }
      return fname === pattern;
    });
    if (match) {
      found.push({
        name: match.name,
        label: kf.label,
        size: match.size,
      });
    }
  }

  return found;
}

/**
 * Detect main programming language.
 */
/**
 * Detect main programming language.
 * @param {Array<{ext:string}>} files
 * @returns {{name:string, fileCount:number}}
 */
function detectMainLanguage(files) {
  const langExts = {
    JavaScript: ['js', 'jsx', 'mjs', 'cjs'],
    TypeScript: ['ts', 'tsx'],
    Python: ['py', 'pyw'],
    Go: ['go'],
    Rust: ['rs'],
    Java: ['java'],
    'C/C++': ['c', 'cpp', 'h', 'hpp'],
    Ruby: ['rb'],
    PHP: ['php'],
    Swift: ['swift'],
    Kotlin: ['kt', 'kts'],
    Scala: ['scala'],
    Shell: ['sh', 'bash', 'zsh'],
    CSharp: ['cs'],
  };

  let maxLang = 'Unknown';
  let maxCount = 0;

  for (const [lang, exts] of Object.entries(langExts)) {
    let count = 0;
    for (const ext of exts) {
      count += files.filter(f => f.ext === ext).length;
    }
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }

  return { name: maxLang, fileCount: maxCount };
}

/**
 * Estimate total lines of code for source files.
 */
/**
 * Estimate total lines of code for source files.
 * @param {Array<{ext:string, path:string}>} files
 * @param {string} ext - File extension to filter
 * @returns {{total:number, count:number}}
 */
function estimateLOC(files, ext) {
  let total = 0;
  let count = 0;
  for (const file of files) {
    if (file.ext === ext) {
      count++;
      try {
        const content = fs.readFileSync(file.path, 'utf-8');
        total += content.split('\n').length;
      } catch (e) { console.debug('[Project] count lines:', e?.message); }
    }
  }
  return { total, count };
}

// ============================================================
// Router
// ============================================================

/**
 * Create the project analysis router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  router.get('/project/analyze', (req, res) => {
    try {
      const projectRoot = process.cwd();
      const scanStart = Date.now();

      const files = scanDirectory(projectRoot);
      const totalFiles = files.length;
      const totalSize = files.reduce((s, f) => s + f.size, 0);

      const { counts, topExts } = categorizeFiles(files);
      const keyFiles = findKeyFiles(files);
      const mainLang = detectMainLanguage(files);

      // Calculate source lines for main language
      let sourceLOC = 0;
      if (mainLang.name !== 'Unknown') {
        const langToExt = {
          JavaScript: 'js', TypeScript: 'ts', Python: 'py',
          Go: 'go', Rust: 'rs', Java: 'java',
        };
        const ext = langToExt[mainLang.name];
        if (ext) {
          sourceLOC = estimateLOC(files, ext).total;
        }
      }

      // Directory structure (top 3 levels)
      const dirs = new Set();
      for (const file of files) {
        const dir = path.dirname(file.path);
        // Skip project root
        if (dir === projectRoot) continue;
        const relDir = path.relative(projectRoot, dir);
        const parts = relDir.split(path.sep);
        if (parts.length <= 2) {
          dirs.add(relDir);
        }
      }

      res.json({
        success: true,
        projectRoot,
        scannedMs: Date.now() - scanStart,
        stats: {
          totalFiles,
          totalSize,
          totalDirs: dirs.size,
          sourceLOC,
        },
        categories: counts,
        topExtensions: topExts,
        keyFiles,
        mainLanguage: mainLang,
        directories: Array.from(dirs).sort(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/project/path — return the server project root path
  router.get('/project/path', (req, res) => {
    res.json({ path: process.cwd() });
  });

  return router;
}

module.exports = { createRouter };
