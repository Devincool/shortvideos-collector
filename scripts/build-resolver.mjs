#!/usr/bin/env node
/**
 * 从你自己的 parse.shenzjd.com 克隆构建一个可用的解析器目录。
 *
 * 为什么需要它：上游仓库里**没有** parser-core 目录，直接 clone 只能拿到 src/。
 * 本脚本把解析链路所需的模块闭包抽取出来，并生成入口 index.mjs，
 * 产出一个零依赖、可独立运行的解析器，供 download.mjs 的 PARSER_CORE_DIR 使用。
 *
 * 本脚本是原创代码，不包含任何上游源码；它只做「读取你本地的仓库 → 复制 → 重写 import」。
 * 上游仓库没有 LICENSE 文件，其代码的使用条件请自行确认。
 *
 * 用法:
 *   git clone https://github.com/wu529778790/parse.shenzjd.com.git upstream
 *   node scripts/build-resolver.mjs --source upstream --out ./resolver
 *   PARSER_CORE_DIR=./resolver node scripts/download.mjs --list works.json --out ./videos
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const SOURCE = path.resolve(argVal("--source", ""));
const OUT = path.resolve(argVal("--out", "./resolver"));
if (!SOURCE || !existsSync(SOURCE)) {
  console.error("用法: node build-resolver.mjs --source <上游仓库根目录> --out <输出目录>");
  console.error("  --source 指向你 clone 的 parse.shenzjd.com 仓库根目录（其中应有 src/）");
  process.exit(2);
}

const SRC = existsSync(path.join(SOURCE, "src")) ? path.join(SOURCE, "src") : SOURCE;
console.log("上游 src: " + SRC);
console.log("输出目录: " + OUT);

// 只需抖音链路（download.mjs 用它把 aweme_id 换成无水印直链）
const SEEDS = ["lib/parsers/douyin"];
const EXTS = [".js", ".ts", ".mjs", ".json"];
const SPEC_RE = /(from\s*|import\s*\(\s*)(["'])@\/([^"']+)\2/g;

function resolveInSrc(rel) {
  for (const e of EXTS) { const p = path.join(SRC, rel + e); if (existsSync(p)) return p; }
  for (const e of EXTS) { const p = path.join(SRC, rel, "index" + e); if (existsSync(p)) return p; }
  return null;
}

// 1) 依赖闭包
const resolved = new Map();
const missing = [];
const queue = [...SEEDS];
while (queue.length) {
  const rel = queue.pop();
  if (resolved.has(rel)) continue;
  const abs = resolveInSrc(rel);
  if (!abs) { missing.push(rel); continue; }
  resolved.set(rel, abs);
  const code = await readFile(abs, "utf8");
  for (const m of code.matchAll(SPEC_RE)) queue.push(m[3]);
}

const outPathFor = (rel, abs) => path.join(OUT, "src", rel + path.extname(abs));

// 2) 复制 + 重写 import
await rm(OUT, { recursive: true, force: true });
let rewritten = 0;
for (const [rel, abs] of resolved) {
  const code = await readFile(abs, "utf8");
  const selfOut = outPathFor(rel, abs);
  const next = code.replace(SPEC_RE, (full, prefix, _q, spec) => {
    const t = resolved.get(spec);
    if (!t) return full;
    let r = path.relative(path.dirname(selfOut), outPathFor(spec, t)).split(path.sep).join("/");
    if (!r.startsWith(".")) r = "./" + r;
    rewritten++;
    return prefix + JSON.stringify(r);
  });
  await mkdir(path.dirname(selfOut), { recursive: true });
  await writeFile(selfOut, next, "utf8");
}

// 3) 打补丁：undici 是上游的显式依赖，这里改成惰性可选，保证零依赖可跑
const bf = path.join(OUT, "src", "lib", "bilibili-fetch.js");
if (existsSync(bf)) {
  const code = await readFile(bf, "utf8");
  const from = 'import { fetch as undiciFetch, ProxyAgent } from "undici";';
  if (code.includes(from)) {
    const to = [
      "// [build-resolver patch] undici 改为惰性可选：未安装时回退内置 fetch",
      "let undiciFetch = globalThis.fetch;",
      "let ProxyAgent = null;",
      "try {",
      '  const undici = await import("undici");',
      "  undiciFetch = undici.fetch;",
      "  ProxyAgent = undici.ProxyAgent;",
      "} catch {}",
    ].join("\n");
    await writeFile(bf, code.replace(from, to), "utf8");
    console.log("已打补丁: bilibili-fetch.js（undici 可选化）");
  }
}

// 4) 生成入口 index.mjs（原创）
const entry = [
  "// 由 build-resolver.mjs 生成 —— 解析器入口",
  'import douyin from "./src/lib/parsers/douyin.js";',
  "",
  "export async function parseShare(url) {",
  '  const r = await douyin(url);',
  "  if (!r || r.code !== 200 || !r.data) {",
  '    return { ok: false, code: r && r.code, msg: (r && r.msg) || "解析失败", media: [] };',
  "  }",
  "  const d = r.data;",
  '  const media = [];',
  "  if (Array.isArray(d.images)) for (const u of d.images) if (u) media.push({ type: \"image\", url: u });",
  "  if (d.url) media.push({ type: \"video\", url: d.url });",
  "  return {",
  "    ok: media.length > 0,",
  "    code: r.code,",
  "    msg: r.msg,",
  '    kind: media.some((m) => m.type === "video") ? "video" : "images",',
  "    title: d.title, author: d.author, cover: d.cover,",
  "    media,",
  "    data: d,",
  "  };",
  "}",
  "",
];
await writeFile(path.join(OUT, "index.mjs"), entry.join("\n"), "utf8");

console.log("抽取模块 " + resolved.size + " 个，重写 import " + rewritten + " 处");
if (missing.length) console.log("闭包外引用: " + missing.join(", "));
console.log("入口已生成: " + path.join(OUT, "index.mjs"));
console.log("完成。用 PARSER_CORE_DIR=" + OUT + " 即可。");
