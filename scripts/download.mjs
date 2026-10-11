#!/usr/bin/env node
/**
 * 批量下载无水印视频。
 *
 * 两种解析来源：
 *
 *   A. --from-snapshot
 *      直接用 works.json 里存的 CDN 快照直链（play_url_snapshot）。
 *      快，且完全不走抖音页面，不受页面风控影响；
 *      代价：直链带时效签名，清单放太久会 403。
 *      → 适合「列表刚采集完」的场景。
 *
 *   B. 外部解析器（默认）
 *      设 PARSER_CORE_DIR 指向你自己安装的解析器副本，动态 import 它现取现用。
 *      好处：每次拿到新鲜直链，不会过期。
 *      代价：每个视频要 fetch 一次抖音页面，有风控/限流风险。
 *      → 适合「列表放久了 / 快照失效」的场景。
 *
 *     本仓库刻意不内置第三方解析器代码（许可原因，见 THIRD-PARTY.md），
 *     请自行获取并在环境变量里指向它。
 *
 * 用法:
 *   node download.mjs --list ./works.json --out ./videos --from-snapshot
 *   PARSER_CORE_DIR=/path/to/parser-core node download.mjs --list ./works.json --out ./videos
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const LIST = argVal("--list", "");
const OUT_DIR = argVal("--out", argVal("--download", "./downloads"));
const CONC = Number(argVal("--concurrency", "1"));
const DELAY = Number(argVal("--delay", "3000"));
const OVERWRITE = has("--overwrite");
const RESOLVE_ONLY = has("--resolve-only");
const QUIET = has("--quiet");
const FROM_SNAPSHOT = has("--from-snapshot");

if (!LIST || !existsSync(LIST)) {
  console.error("用法: node download.mjs --list <works.json> --out <目录> [--from-snapshot] [--concurrency 1] [--delay 3000]");
  console.error("  --from-snapshot : 用清单里的 CDN 快照直链（快，但直链有时效）");
  console.error("  不加该参数     : 用外部解析器现取现用（需设 PARSER_CORE_DIR 环境变量）");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (!QUIET) console.error(...a); };

function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }
function safeName(s, max = 50) {
  return String(s || "").replace(/[\\/:*?"<>|\r\n\t]/g, "_").replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/, "").trim().slice(0, max) || "untitled";
}
async function exists(p) { try { await statSync(p); return true; } catch { return false; } }
function extFrom(ct, url, fallback) {
  const m = { "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
  const k = String(ct || "").split(";")[0].trim().toLowerCase();
  if (m[k]) return m[k];
  try { const e = path.extname(new URL(url).pathname).toLowerCase(); if (/^\.[a-z0-9]{2,4}$/.test(e)) return e; } catch {}
  return fallback;
}

async function downloadTo(url, file, timeoutMs = 180000) {
  const res = await fetch(url, {
    headers: { "User-Agent": MOBILE_UA, Referer: "https://www.douyin.com/", Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  if (!res.body) throw new Error("响应无 body");
  await mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  const st = statSync(file);
  if (st.size === 0) throw new Error("下载到 0 字节");
  return { file, bytes: st.size };
}

// ---------- 解析来源 ----------
let resolveExternal = null;
if (!FROM_SNAPSHOT) {
  const dir = process.env.PARSER_CORE_DIR;
  if (!dir) {
    console.error("未指定解析器来源。二选一：");
    console.error("  a) 加 --from-snapshot 用清单里的 CDN 快照直链");
    console.error("  b) 设 PARSER_CORE_DIR 指向你自己安装的解析器目录（含 index.mjs）");
    process.exit(2);
  }
  try {
    const mod = await import(pathToFileURL(path.join(dir, "index.mjs")).href);
    resolveExternal = mod.parseShare;
    log("已加载外部解析器: " + dir);
  } catch (e) {
    console.error("加载外部解析器失败: " + (e && e.message));
    process.exit(2);
  }
} else {
  log("使用清单里的 CDN 快照直链（不访问抖音页面）");
}

// ---------- 主流程 ----------
const payload = JSON.parse(stripBom(readFileSync(LIST, "utf8")));
const items = Array.isArray(payload) ? payload : (payload.videos || []);
if (!items.length) { console.error("清单里没有作品"); process.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });
log("待处理 " + items.length + " 条，并发 " + CONC + "，间隔 " + DELAY + "ms，输出 " + OUT_DIR);

const results = new Array(items.length);
let cursor = 0, done = 0;

async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= items.length) return;
    const item = items[i];
    const id = String(item.aweme_id || "");
    const seq = item.__idx ?? (i + 1);
    const base = safeName([String(seq).padStart(3, "0"), id, item.desc].filter(Boolean).join("-"));
    const rec = { aweme_id: id, ok: false, files: [], msg: "" };
    try {
      let url = null, type = item.is_image ? "image" : "video";

      if (FROM_SNAPSHOT) {
        url = item.play_url_snapshot || null;
        if (!url) { rec.msg = "清单里没有快照直链"; results[i] = rec; continue; }
      } else {
        const r = await resolveExternal(item.share_url || ("https://www.douyin.com/video/" + id));
        if (!r || !r.ok) { rec.msg = (r && r.msg) || "解析失败"; results[i] = rec; continue; }
        type = r.kind === "images" ? "image" : "video";
        if (r.media && r.media.length) {
          r.media.forEach((m) => { if (m.type === "image") rec._images = (rec._images || []).concat(m.url); });
          const v = r.media.find((m) => m.type === "video");
          url = v ? v.url : (r.media[0] && r.media[0].url);
        }
        if (!url && !rec._images) { rec.msg = "解析成功但没拿到媒体直链"; results[i] = rec; continue; }
      }

      rec.resolved_type = type;

      if (RESOLVE_ONLY) { rec.ok = true; rec.url = url || null; results[i] = rec; continue; }

      // 图文：逐张下载
      if (type === "image" && Array.isArray(rec._images) && rec._images.length) {
        for (let k = 0; k < rec._images.length; k++) {
          const probe = await fetch(rec._images[k], { method: "HEAD", headers: { "User-Agent": MOBILE_UA, Referer: "https://www.douyin.com/" }, redirect: "follow", signal: AbortSignal.timeout(20000) }).catch(() => null);
          const ext = extFrom(probe && probe.headers.get("content-type"), rec._images[k], ".jpg");
          const f = path.join(OUT_DIR, base + "-" + String(k + 1).padStart(2, "0") + ext);
          if (!OVERWRITE && (await exists(f))) { rec.files.push(f); continue; }
          const out = await downloadTo(rec._images[k], f);
          rec.files.push(out.file);
        }
      } else if (url) {
        const probe = await fetch(url, { method: "HEAD", headers: { "User-Agent": MOBILE_UA, Referer: "https://www.douyin.com/" }, redirect: "follow", signal: AbortSignal.timeout(20000) }).catch(() => null);
        const ext = extFrom(probe && probe.headers.get("content-type"), url, ".mp4");
        const f = path.join(OUT_DIR, base + ext);
        if (!OVERWRITE && (await exists(f))) rec.files.push(f);
        else { const out = await downloadTo(url, f); rec.files.push(out.file); rec.bytes = out.bytes; }
      } else {
        rec.msg = "无可用直链";
        results[i] = rec;
        continue;
      }
      delete rec._images;
      rec.ok = true;
    } catch (e) {
      rec.msg = String((e && e.message) || e);
    } finally {
      results[i] = rec;
      done++;
      if (!QUIET) console.error("[" + done + "/" + items.length + "] " + (rec.ok ? "OK  " : "FAIL") + " " + id + " " + String(rec.msg || "").slice(0, 60));
      if (DELAY > 0) await sleep(DELAY);
    }
  }
}

await Promise.all(Array.from({ length: Math.max(1, Math.min(CONC, items.length)) }, worker));

const report = path.join(OUT_DIR, "_download-report.json");
writeFileSync(report, JSON.stringify({
  finished_at: new Date().toISOString(),
  source: FROM_SNAPSHOT ? "snapshot" : "external-parser",
  total: results.length,
  ok: results.filter((r) => r.ok).length,
  results,
}, null, 2), "utf8");

const ok = results.filter((r) => r.ok).length;
log("完成 " + ok + " / " + results.length + "，报告: " + report);
if (ok !== results.length) process.exitCode = 1;
