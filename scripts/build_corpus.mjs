#!/usr/bin/env node
/**
 * 语料合成：把 works.json 的元数据（发布时间/点赞/评论/收藏/分享）
 * 与同目录下的 *.txt 转写，按时间线排序合成一份可读语料。
 *
 * 用法:
 *   node build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
 *   node build_corpus.mjs            # 全部走默认值（当前目录）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const WORKS = path.resolve(argVal("--works", "./works.json"));
const MATERIAL = path.resolve(argVal("--material", process.env.MATERIAL_DIR || "."));
const OUT = path.resolve(argVal("--out", "./_corpus.md"));

if (!existsSync(WORKS)) {
  console.error("找不到清单文件: " + WORKS);
  console.error("先跑 browser-collect.mjs 生成，或用 --works 指定路径");
  process.exit(2);
}

const w = JSON.parse(readFileSync(WORKS, "utf8"));

// aweme_id -> 转写文件
const txts = new Map();
for (const f of readdirSync(MATERIAL)) {
  if (!f.endsWith(".txt")) continue;
  const m = f.match(/^(\d+)-(\d+)-/) || f.match(/^(\d+)-/);
  if (m && m[2]) txts.set(m[2], path.join(MATERIAL, f));
}

// 按发布时间升序（时间线）
const items = [...(w.videos || [])].sort((a, b) => (a.create_time || 0) - (b.create_time || 0));

const lines = [];
lines.push("# " + (w.nickname || "未知博主") + "（抖音号 " + (w.douyin_id || "-") + "）作品语料");
lines.push("");
lines.push("共 " + items.length + " 条，按发布时间升序。元数据来自作品列表接口，正文来自本地 whisper 转写。");
lines.push("");

let withText = 0, noText = 0, chars = 0;
for (const v of items) {
  const d = new Date((v.create_time || 0) * 1000);
  const stamp = isNaN(d) ? "未知日期" : d.toISOString().slice(0, 10);
  const txt = txts.get(String(v.aweme_id));
  lines.push("---");
  lines.push("");
  lines.push("## [" + stamp + "] " + String(v.desc || "(无标题)").replace(/\s+/g, " ").slice(0, 80));
  lines.push("");
  lines.push("- aweme_id: " + v.aweme_id);
  lines.push("- 点赞 " + (v.digg_count ?? "-") + " | 评论 " + (v.comment_count ?? "-") + " | 收藏 " + (v.collect_count ?? "-") + " | 分享 " + (v.share_count ?? "-"));
  lines.push("- 时长 " + Math.round((v.duration_ms || 0) / 1000) + "s");
  lines.push("");
  if (txt) {
    const t = readFileSync(txt, "utf8");
    // 去掉时间轴前缀，读起来更顺
    const plain = t.split("\n").map((l) => l.replace(/^\[[\d.]+-[\d.]+\]\s*/, "").replace(/ ★复核$/, "")).filter(Boolean).join("");
    chars += plain.length;
    withText++;
    lines.push(plain);
  } else {
    noText++;
    lines.push("_(无转写文本)_");
  }
  lines.push("");
}

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log("语料已生成: " + OUT);
console.log("  条目 " + items.length + "（有转写 " + withText + " / 无转写 " + noText + "）");
console.log("  正文约 " + Math.round(chars / 1000) + " 千字");
