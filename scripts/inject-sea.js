/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';
// ============================================================
// inject-sea.js — 纯 Node 实现的 Node SEA（Single Executable Application）注入器
//
// 背景：官方用 `postject` 注入，但它依赖 Windows 资源更新 API（BeginUpdateResource
// 系列），在部分受限/沙箱环境会被拦截。本脚本只做文件 I/O：
//   1) 解析 node.exe 现有的 .rsrc 资源树（含其 manifest / 版本信息）；
//   2) 在其中合并一个 资源类型 RT_RCDATA(10) / 名称 "NODE_SEA_BLOB" 的新条目，
//      数据即 SEA blob；
//   3) 把合并后的资源树放进一个新的 .rsea 节，把 PE 的 RESOURCE 数据目录指向它，
//      并翻转哨兵 fuse 的 `:0` -> `:1`。
// 这样既不依赖 postject/联网，又完整保留 node 原有资源，使 Node 启动时能加载内嵌 JS。
//
// 用法：
//   注入：  node scripts/inject-sea.js <exe> <blob>
//   校验：  node scripts/inject-sea.js --verify <exe> [<blob-for-compare>]
// ============================================================
const fs = require('fs');

const align = (n, a) => Math.ceil(n / a) * a;
const align4 = (n) => (n + 3) & ~3;

// ---------- PE 基础解析 ----------
function openExe(buf) {
  const e_lfanew = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(e_lfanew) !== 0x00004550) {
    throw new Error('不是有效的 PE 文件');
  }
  const coff = e_lfanew + 4;
  const numSections = buf.readUInt16LE(coff + 2);
  const sizeOfOptHdr = buf.readUInt16LE(coff + 16); // COFF 头 +16
  const optHdrStart = coff + 20;
  const magic = buf.readUInt16LE(optHdrStart);
  const isPE32Plus = magic === 0x20b;
  const sectionHdrStart = optHdrStart + sizeOfOptHdr;
  const sectionAlign = buf.readUInt32LE(optHdrStart + (isPE32Plus ? 32 : 32));
  const fileAlign = buf.readUInt32LE(optHdrStart + (isPE32Plus ? 36 : 36));
  const sizeOfImageOff = optHdrStart + (isPE32Plus ? 56 : 56);
  // IMAGE_DATA_DIRECTORY 在可选头中的偏移：PE32+ = 112，PE32 = 96
  const resDirOff = optHdrStart + (isPE32Plus ? 112 : 96);

  function section(i) {
    const sh = sectionHdrStart + i * 40;
    const name = buf.toString('ascii', sh, sh + 8).replace(/\0/g, '');
    return {
      name,
      vsize: buf.readUInt32LE(sh + 8),
      va: buf.readUInt32LE(sh + 12),
      rsize: buf.readUInt32LE(sh + 16),
      raw: buf.readUInt32LE(sh + 20),
      chars: buf.readUInt32LE(sh + 36),
    };
  }
  function rvaToFile(va) {
    for (let i = 0; i < numSections; i++) {
      const s = section(i);
      if (va >= s.va && va < s.va + s.vsize) return s.raw + (va - s.va);
    }
    return -1;
  }

  return {
    buf, e_lfanew, coff, numSections, sizeOfOptHdr, optHdrStart, magic,
    isPE32Plus, sectionHdrStart, sectionAlign, fileAlign, sizeOfImageOff, resDirOff, section, rvaToFile,
  };
}

// ---------- 解析现有资源树（深度驱动的递归） ----------
// 资源树固定 4 层目录：root -> type -> name -> lang -> data
function parseResourceTree(pe) {
  const { buf } = pe;
  let rsrc = null;
  for (let i = 0; i < pe.numSections; i++) {
    const s = pe.section(i);
    if (s.name === '.rsrc') { rsrc = s; break; }
  }
  if (!rsrc) throw new Error('未找到 .rsrc 节');

  function readName(off) {
    const o = rsrc.raw + off;
    const len = buf.readUInt16LE(o);
    return buf.toString('utf16le', o + 2, o + 2 + len * 2);
  }

  function parseDir(off, depth) {
    const node = { entries: [] };
    const named = buf.readUInt16LE(off + 12);
    const idCount = buf.readUInt16LE(off + 14);
    for (let i = 0; i < named + idCount; i++) {
      const eoff = off + 16 + i * 8;
      const noid = buf.readUInt32LE(eoff);
      const otd = buf.readUInt32LE(eoff + 4);
      const childOff = rsrc.raw + (otd & 0x7fffffff);
      const isDir = (otd & 0x80000000) !== 0;
      const name = (noid & 0x80000000) ? readName(noid & 0x7fffffff) : (noid >>> 0);
      if (depth < 3 && isDir) {
        node.entries.push({ name, isDir: true, children: parseDir(childOff, depth + 1) });
      } else {
        // 叶子：childOff 指向 IMAGE_RESOURCE_DATA_ENTRY
        const rva = buf.readUInt32LE(childOff);
        const size = buf.readUInt32LE(childOff + 4);
        // rva 是“模块基址相对的绝对 RVA”，需经节表映射到文件偏移后再读取数据
        const doff = pe.rvaToFile(rva);
        const data = doff >= 0 && size > 0
          ? Buffer.from(buf.slice(doff, doff + size))
          : Buffer.alloc(0);
        node.entries.push({ name, isDir: false, data });
      }
    }
    return node;
  }

  return { tree: parseDir(rsrc.raw, 0), rsrc };
}

// ---------- 合并 SEA blob ----------
function mergeBlob(tree, blob) {
  let rcdata = tree.entries.find((e) => e.name === 10 && e.isDir);
  if (!rcdata) {
    rcdata = { name: 10, isDir: true, children: { entries: [] } };
    tree.entries.push(rcdata);
  }
  const dup = rcdata.children.entries.find((e) => e.name === 'NODE_SEA_BLOB');
  if (dup) {
    // 已存在（理论上不会，因基底是全新 node.exe），覆盖数据
    dup.children.entries[0].data = blob;
  } else {
    rcdata.children.entries.push({
      name: 'NODE_SEA_BLOB', isDir: true,
      children: { entries: [{ name: 0x409, isDir: false, data: blob }] },
    });
  }
}

// ---------- 序列化资源树为新节内容 ----------
function serializeResourceTree(tree) {
  const parts = [];
  let pos = 0;
  const patches = []; // [byteOffset, value]

  function emit(b) { const off = pos; parts.push(b); pos += b.length; return off; }

  function buildDir(node) {
    const entries = node.entries;
    let named = 0, idCount = 0;
    for (const e of entries) { if (typeof e.name === 'string') named++; else idCount++; }
    const start = pos;
    const hdr = Buffer.alloc(16);
    hdr.writeUInt16LE(named, 12);
    hdr.writeUInt16LE(idCount, 14);
    emit(hdr);
    const slots = [];
    for (let i = 0; i < entries.length; i++) slots.push(emit(Buffer.alloc(8)));

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let nameField;
      if (typeof e.name === 'string') {
        const u = Buffer.from(e.name, 'utf16le');
        const ns = Buffer.alloc(2 + u.length);
        ns.writeUInt16LE(e.name.length, 0);
        u.copy(ns, 2);
        const nOff = emit(ns);
        const pad = align4(pos) - pos; if (pad) emit(Buffer.alloc(pad));
        nameField = (0x80000000 | nOff) >>> 0;
      } else {
        nameField = e.name >>> 0;
      }
      let offData;
      if (e.isDir) {
        const childOff = buildDir(e.children);
        offData = (0x80000000 | childOff) >>> 0;
      } else {
        const pad = align4(pos) - pos; if (pad) emit(Buffer.alloc(pad));
        const dataOff = emit(e.data);
        const de = Buffer.alloc(16);
        de.writeUInt32LE(dataOff, 0);
        de.writeUInt32LE(e.data.length, 4);
        const deOff = emit(de);
        offData = deOff; // 指向 data entry，高位为 0
      }
      patches.push([slots[i], nameField]);
      patches.push([slots[i] + 4, offData >>> 0]);
    }
    return start;
  }

  buildDir(tree);
  const out = Buffer.concat(parts);
  for (const [off, val] of patches) out.writeUInt32LE(val >>> 0, off);
  return out;
}

// ---------- 注入 ----------
function inject(exePath, blobPath) {
  const blob = fs.readFileSync(blobPath);
  const original = fs.readFileSync(exePath);
  const pe = openExe(original);

  const { tree } = parseResourceTree(pe);
  mergeBlob(tree, blob);
  const resBlob = serializeResourceTree(tree);

  // 新节放在文件末尾
  let last = null;
  for (let i = 0; i < pe.numSections; i++) last = pe.section(i);
  const newVA = align(last.va + last.vsize, pe.sectionAlign);
  const rawOffset = align(original.length, pe.fileAlign);
  const newVSize = resBlob.length;
  const newRSize = align(resBlob.length, pe.fileAlign);

  // 校验节表有空间容纳一个新 40 字节头
  const firstRaw = pe.section(0).raw;
  if (pe.sectionHdrStart + (pe.numSections + 1) * 40 > firstRaw) {
    throw new Error('节表空间不足，无法追加新节');
  }

  const padHead = rawOffset - original.length;
  const front = padHead > 0 ? Buffer.concat([original, Buffer.alloc(padHead)]) : Buffer.from(original);
  const outBuf = Buffer.alloc(front.length + newRSize);
  front.copy(outBuf);
  resBlob.copy(outBuf, rawOffset);

  // 更新 PE 头
  outBuf.writeUInt16LE(pe.numSections + 1, pe.coff + 2);
  outBuf.writeUInt32LE(newVA + align(newVSize, pe.sectionAlign), pe.sizeOfImageOff);
  outBuf.writeUInt32LE(newVA, pe.resDirOff);
  outBuf.writeUInt32LE(newVSize, pe.resDirOff + 4);

  // 新节头 .rsea
  const nsh = pe.sectionHdrStart + pe.numSections * 40;
  const nameBuf = Buffer.alloc(8); nameBuf.write('.rsea', 0, 'ascii');
  nameBuf.copy(outBuf, nsh);
  outBuf.writeUInt32LE(newVSize, nsh + 8);
  outBuf.writeUInt32LE(newVA, nsh + 12);
  outBuf.writeUInt32LE(newRSize, nsh + 16);
  outBuf.writeUInt32LE(rawOffset, nsh + 20);
  outBuf.writeUInt32LE(0, nsh + 24);
  outBuf.writeUInt32LE(0, nsh + 28);
  outBuf.writeUInt16LE(0, nsh + 32);
  outBuf.writeUInt16LE(0, nsh + 34);
  outBuf.writeUInt32LE(0x40000040, nsh + 36); // CNT_INITIALIZED_DATA | MEM_READ

  // 翻转哨兵 fuse `:0` -> `:1`
  const fuse = Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0', 'utf8');
  const fi = outBuf.indexOf(fuse);
  if (fi < 0) { throw new Error('未找到 SEA 哨兵 fuse，注入中止'); }
  if (outBuf[fi + fuse.length - 1] !== 0x30) {
    throw new Error('SEA fuse 最后一位不是预期的 "0"，中止以避免损坏');
  }
  outBuf[fi + fuse.length - 1] = 0x31;

  fs.writeFileSync(exePath, outBuf);
  console.log(`[inject-sea] 注入完成：新资源节 .rsea @ VA=0x${  newVA.toString(16) 
    } raw=0x${  rawOffset.toString(16)  } 大小=${  newVSize  } 字节（含 ${ 
    countLeaves(tree)  } 个资源，node 原 manifest 已保留）`);
}

function countLeaves(node) {
  let n = 0;
  for (const e of node.entries) {
    if (e.isDir) n += countLeaves(e.children); else n++;
  }
  return n;
}

// ---------- 校验 ----------
function verify(exePath, blobPath) {
  const buf = fs.readFileSync(exePath);
  const pe = openExe(buf);
  let last = null;
  for (let i = 0; i < pe.numSections; i++) last = pe.section(i);

  // 1) 找到 .rsea
  let rsea = null;
  for (let i = 0; i < pe.numSections; i++) {
    const s = pe.section(i);
    if (s.name === '.rsea') { rsea = s; break; }
  }
  if (!rsea) { console.error('[verify] 未找到 .rsea 节'); process.exit(1); }

  // 2) RESOURCE 数据目录指向 .rsea
  const resVA = buf.readUInt32LE(pe.resDirOff);
  const resSize = buf.readUInt32LE(pe.resDirOff + 4);
  console.log(`[verify] 节数=${  pe.numSections  } RESOURCE VA=0x${  resVA.toString(16) 
    } size=${  resSize  }  .rsea VA=0x${  rsea.va.toString(16)  } vsize=${  rsea.vsize}`);
  if (resVA !== rsea.va) { console.error('[verify] RESOURCE 数据目录未指向 .rsea'); process.exit(1); }
  if (resVA < rsea.va || resVA + resSize > rsea.va + rsea.vsize) {
    console.error('[verify] RESOURCE 范围超出 .rsea 节'); process.exit(1);
  }

  // 3) 在新节内解析资源树并定位 NODE_SEA_BLOB
  const rsrc = { raw: rsea.raw, va: rsea.va, vsize: rsea.vsize };
  function readName(off) {
    const o = rsrc.raw + off;
    const len = buf.readUInt16LE(o);
    return buf.toString('utf16le', o + 2, o + 2 + len * 2);
  }
  function parseDir(off, depth) {
    const node = { entries: [] };
    const named = buf.readUInt16LE(off + 12);
    const idCount = buf.readUInt16LE(off + 14);
    for (let i = 0; i < named + idCount; i++) {
      const eoff = off + 16 + i * 8;
      const noid = buf.readUInt32LE(eoff);
      const otd = buf.readUInt32LE(eoff + 4);
      const childOff = rsrc.raw + (otd & 0x7fffffff);
      const isDir = (otd & 0x80000000) !== 0;
      const name = (noid & 0x80000000) ? readName(noid & 0x7fffffff) : (noid >>> 0);
      if (depth < 3 && isDir) node.entries.push({ name, isDir: true, children: parseDir(childOff, depth + 1) });
      else {
        const rva = buf.readUInt32LE(childOff);
        const size = buf.readUInt32LE(childOff + 4);
        node.entries.push({ name, data: buf.slice(rsrc.raw + rva, rsrc.raw + rva + size) });
      }
    }
    return node;
  }
  const tree = parseDir(rsrc.raw, 0);
  const rcdata = tree.entries.find((e) => e.name === 10 && e.isDir);
  if (!rcdata) { console.error('[verify] 未找到 RT_RCDATA(10)'); process.exit(1); }
  const blobEntry = rcdata.children.entries.find((e) => e.name === 'NODE_SEA_BLOB');
  if (!blobEntry) { console.error('[verify] 未找到 NODE_SEA_BLOB 资源'); process.exit(1); }
  const langEntry = blobEntry.children.entries.find((e) => e.name === 0x409);
  if (!langEntry) { console.error('[verify] 未找到语言 0x409 的 NODE_SEA_BLOB'); process.exit(1); }
  const blob = langEntry.data;
  console.log(`[verify] NODE_SEA_BLOB 提取成功：长度=${  blob.length  } 字节`);

  // 4) blob 必须是合法 SEA blob：SEA blob 头部会内嵌脚本路径（如 "tray/tray.js"）
  const head = blob.slice(0, 200).toString('latin1');
  if (!head.includes('tray/tray.js')) {
    console.error('[verify] 提取的 blob 未内嵌脚本路径，数据可能错位'); process.exit(1);
  }
  console.log('[verify] blob 含内嵌脚本路径 "tray/tray.js"，格式正确');

  // 5) 与原 blob 比对（若提供）
  if (blobPath) {
    const orig = fs.readFileSync(blobPath);
    if (orig.length !== blob.length || orig.compare(blob) !== 0) {
      console.error(`[verify] 提取的 blob 与原 blob 不一致（长度 ${  orig.length  } vs ${  blob.length  }）`);
      process.exit(1);
    }
    console.log('[verify] 提取的 blob 与原 blob 逐字节一致');
  }

  // 6) fuse 已翻转
  const fuse = Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1', 'utf8');
  if (buf.indexOf(fuse) < 0) { console.error('[verify] SEA fuse 未翻转为 :1'); process.exit(1); }
  console.log('[verify] SEA fuse 已翻转为 :1');
  console.log('[verify] 全部校验通过 ✅');
}

// ---------- 入口 ----------
const args = process.argv.slice(2);
if (args[0] === '--verify') {
  if (!args[1]) { console.error('usage: node scripts/inject-sea.js --verify <exe> [<blob>]'); process.exit(1); }
  verify(args[1], args[2]);
} else if (args[0] && args[1]) {
  inject(args[0], args[1]);
} else {
  console.error('usage:\n  node scripts/inject-sea.js <exe> <blob>\n  node scripts/inject-sea.js --verify <exe> [<blob>]');
  process.exit(1);
}
