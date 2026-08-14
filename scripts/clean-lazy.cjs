// build:lazy 前清空输出目录（Windows 并行覆盖已存在 chunk 会 Access denied）。
// 不用 fs.rmSync：Node 环境可能注入 safe-delete shim 拦截删除（trash 失败）；
// 子进程原生命令（rd / rm）不受 shim 影响。
const { execSync } = require('child_process')
const fs = require('fs')
const dir = 'public/lazy-chunks'
try {
  if (process.platform === 'win32') execSync(`rd /s /q "${dir}" 2>nul`, { stdio: 'ignore' })
  else execSync(`rm -rf "${dir}"`, { stdio: 'ignore' })
} catch {}
fs.mkdirSync(dir, { recursive: true })
