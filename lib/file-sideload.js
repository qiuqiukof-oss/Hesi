// @ts-check
// ============================================================
// v0.3.1 A1 — read_file 大文件侧载（信息保全，代替截断丢失）
//
// 背景：read_file 结果 >20k 字符原先走通用 ToolResultTruncator（截到
// ~4000 token），被截掉的内容 AI 永远看不到、也不知道文件全貌。
// 侧载策略：返回「头部 N 行 + 结构摘要（纯正则零 LLM）+ 分段读取提示」，
// AI 可据此用 read_file 的 offset/limit 参数精确读取任意段。
//
// 开关：HESI_FILE_SIDELOAD=0 回落到通用截断（现状）。
// ============================================================
'use strict';

/** 触发侧载的字符阈值（与 chat/tools.js 通用截断阈值一致） */
const SIDELOAD_THRESHOLD = 20000;
/** 头部保留行数 */
const HEAD_LINES = 120;
/** 头部保留字符上限（防单行超长文件） */
const HEAD_CHARS = 8000;
/** 结构摘要条目上限 */
const MAX_OUTLINE = 80;

// 结构行匹配：代码（函数/类/方法/导出）+ 文档（markdown 标题）。
// 纯正则、宽松匹配、跨语言尽量覆盖；宁可多列不可漏关键结构。
const OUTLINE_RE = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[\w$]+/, // js/ts function
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+[\w$]+/, // class
  /^\s*(?:public|private|protected|static|def|fn|func|sub|void|int|string|bool)\s+[\w$]+\s*\(/, // 方法/多语言函数
  /^\s*def\s+\w+/, // python
  /^\s*(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/, // 箭头函数赋值
  /^\s*module\.exports/, // cjs 导出
  /^#{1,4}\s+\S/, // markdown 标题
];

/**
 * 判断 read_file 结果是否应走侧载。
 * @param {string} text 工具返回全文
 */
function shouldSideload(text) {
  if (process.env.HESI_FILE_SIDELOAD === '0') return false;
  return typeof text === 'string' && text.length > SIDELOAD_THRESHOLD;
}

/**
 * 生成结构摘要行（带行号，1-based，与 offset 参数对齐）。
 * @param {string[]} lines
 * @returns {string[]}
 */
function buildOutline(lines) {
  const out = [];
  for (let i = 0; i < lines.length && out.length < MAX_OUTLINE; i++) {
    const line = lines[i];
    if (line.length > 400) continue; // 压缩产物/超长行不算结构
    for (const re of OUTLINE_RE) {
      if (re.test(line)) {
        out.push(`L${i + 1}: ${line.trim().slice(0, 120)}`);
        break;
      }
    }
  }
  return out;
}

/**
 * 把超大 read_file 结果转为侧载形态：头部 + 结构摘要 + 分段读取提示。
 * @param {string} text 原始工具返回（含 File:/Language:/Size: 头）
 * @param {string} [filePath] 文件路径（用于提示语，可选）
 * @returns {string}
 */
function sideloadFileResult(text, filePath) {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const totalChars = text.length;

  // 头部截取：先按行、再按字符双重限制
  let head = lines.slice(0, HEAD_LINES).join('\n');
  if (head.length > HEAD_CHARS) head = head.slice(0, HEAD_CHARS);

  const outline = buildOutline(lines);
  const outlineBlock = outline.length
    ? `\n\n── 结构摘要（共 ${outline.length} 条，行号可直接用于 offset）──\n${outline.join('\n')}`
    : '';

  const pathHint = filePath ? `path="${filePath}", ` : '';
  const headerLines = Math.min(HEAD_LINES, totalLines);
  return `⚠️ 文件过大（${totalLines} 行 / ${totalChars} 字符），已启用侧载模式：下面只展示头部 ${headerLines} 行 + 结构摘要，未展示部分并未丢失。\n需要查看其余内容时，请再次调用 read_file 并携带分段参数，例如：read_file(${pathHint}offset=起始行号, limit=行数)。建议单次 limit ≤ 400。\n\n── 头部内容 ──\n${head}${outlineBlock}`;
}

module.exports = { shouldSideload, sideloadFileResult, SIDELOAD_THRESHOLD };
