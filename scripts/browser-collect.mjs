/**
 * 浏览器（CDP）作品采集器 —— 签名接口失效时的可用路径。
 *
 * 为什么需要它：抖音 web 的作品列表端点要求「uifid 绑定的新签名」，
 * 上游那份 a_bogus（2024 算法）已不被接受（详见 SKILL.md 已知限制）。
 * 浏览器自己会生成正确签名，本脚本用 CDP 驱动浏览器，捕获它发出的
 * /aweme/v1/web/aweme/post/ 响应，从而拿到作品列表。
 *
 * 滚动翻页的三个关键点（踩过坑，别删）：
 *   1) Page.bringToFront + Emulation.setFocusEmulationEnabled
 *      —— 后台窗口会被 Chromium 节流，懒加载根本不触发；
 *         只加这一项就让采集量从 75 条涨到 129 条。
 *   2) Input.dispatchMouseEvent(mouseWheel)
 *      —— 真实滚轮事件能驱动任意滚动容器；window.scrollBy 对抖音无效。
 *   3) 兜底把所有可滚动容器的 scrollTop 推到底。
 *
 * 两种工作模式：
 *
 *   A) 注入模式（推荐，无需退出浏览器）
 *      node browser-collect.mjs --sec <sec_uid> --cookie-file .cookie.txt
 *      用全新临时 profile 启动独立实例，再用 CDP 注入已保存的登录 cookie。
 *      全程不碰用户正在用的浏览器，可无人值守；代价是需要一份 cookie 文件
 *      （用 extract-cookies.mjs 生成，或从 DevTools 手工复制）。
 *
 *   B) 真实 profile 模式
 *      node browser-collect.mjs --sec <sec_uid>
 *      等用户完全退出浏览器 → 用其真实 profile 带调试启动 → 采集 → 关闭实例 → 重启浏览器。
 *      好处是不需要 cookie 文件；代价是必须先退出浏览器。
 */
import { writeFileSync, appendFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

// 所有输出都以「当前工作目录」为基准（标准 CLI 行为），也可用 --out 指定
const SEC = argVal("--sec", "");
const LIMIT = Number(argVal("--limit", "100"));
const OUT = path.resolve(argVal("--out", "./works.json"));
const LOG = path.resolve(argVal("--log", "./_collect.log"));
const PORT = Number(argVal("--port", "9227"));
// 注入模式：给了 --cookie-file 就用全新临时 profile + CDP 注入登录态，不碰用户浏览器
const COOKIE_FILE = argVal("--cookie-file", "");
const INJECT = COOKIE_FILE !== "";
const PROFILE = path.resolve(argVal("--profile", path.join(process.env.TEMP || ".", "quark-inject")));
const KEEP_PROFILE = argv.includes("--keep-profile");

if (!SEC) {
  console.error("用法:");
  console.error("  注入模式（推荐，无需退出浏览器）: node browser-collect.mjs --sec <sec_uid> --cookie-file .cookie.txt [--limit 100] [--out ./works.json]");
  console.error("  真实 profile 模式:               node browser-collect.mjs --sec <sec_uid>   （需先完全退出浏览器）");
  process.exit(2);
}

// 浏览器可执行文件与 profile 目录（换浏览器改这两个环境变量）
const QUARK = process.env.COLLECT_BROWSER || "C:\\Program Files\\Quark\\quark.exe";
const USER_DATA = process.env.COLLECT_USER_DATA || path.join(process.env.LOCALAPPDATA, "Quark", "User Data");

const log = (m) => { const l = new Date().toISOString() + "  " + m; console.log(l); try { appendFileSync(LOG, l + "\n"); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function quarkRunning() {
  try { return Number(execFileSync("powershell.exe", ["-NoProfile","-Command","@(Get-Process quark -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim()) > 0; }
  catch { return false; }
}

let launchProfile = USER_DATA;
if (INJECT) {
  // 注入模式：干净临时 profile，不与用户浏览器争锁
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  launchProfile = PROFILE;
  log("注入模式：全新临时 profile " + PROFILE);
} else {
  log("采集器 v2 守候启动：等待夸克完全退出...");
  const deadline = Date.now() + 60 * 60 * 1000;
  while (quarkRunning()) { if (Date.now() > deadline) { log("超时"); process.exit(1); } await sleep(2000); }
  log("夸克已退出");
  await sleep(2000);
}

const child = spawn(QUARK, ["--user-data-dir=" + launchProfile, "--remote-debugging-port=" + PORT,
  "--no-first-run", "--no-default-browser-check", "about:blank"], { detached: true, stdio: "ignore" });
child.unref();
log("启动调试实例 PID " + child.pid);

let wsUrl = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  try { wsUrl = (await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json()).webSocketDebuggerUrl; log("CDP 就绪"); break; } catch {}
}
if (!wsUrl) { log("CDP 未就绪"); process.exit(1); }

const ws = new WebSocket(wsUrl);
let id = 1; const pend = new Map(); const trackReq = new Set();
const items = []; const seen = new Set();

function send(method, params = {}, sessionId) {
  const i = id++;
  return new Promise((res, rej) => {
    pend.set(i, { res, rej });
    const o = { id: i, method, params }; if (sessionId) o.sessionId = sessionId;
    ws.send(JSON.stringify(o));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error(method + " 超时")); } }, 30000);
  });
}
ws.addEventListener("message", async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === "Network.responseReceived" && m.params?.response?.url?.includes("/aweme/v1/web/aweme/post/")) trackReq.add(m.params.requestId);
  if (m.method === "Network.loadingFinished" && trackReq.has(m.params.requestId)) {
    const rid = m.params.requestId; trackReq.delete(rid);
    try {
      const b = await send("Network.getResponseBody", { requestId: rid }, m.sessionId);
      const j = JSON.parse(b.body);
      let added = 0;
      for (const a of (j.aweme_list || [])) { const k = String(a.aweme_id || ""); if (!k || seen.has(k)) continue; seen.add(k); items.push(a); added++; }
      log("  捕获一页 +" + (j.aweme_list||[]).length + "（新增 " + added + "，累计 " + items.length + "）");
    } catch (e) { log("  取 body 失败: " + e.message); }
  }
});
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("WS 失败"))); });

const t = await send("Target.createTarget", { url: "about:blank" });
const att = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
const S = att.sessionId;

await send("Network.enable", {}, S);
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Network.setCacheDisabled", { cacheDisabled: true }, S);

if (INJECT) {
  // 注入登录态：把 cookie 文件里的键值对逐条 setCookie 到 .douyin.com
  const raw = readFileSync(path.resolve(COOKIE_FILE), "utf8").trim();
  const cookies = raw.split(/;\s*/).map((kv) => {
    const i = kv.indexOf("=");
    return i < 0 ? null : { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim() };
  }).filter((c) => c && c.name && c.value);
  let okC = 0, badC = 0;
  for (const c of cookies) {
    try { await send("Network.setCookie", { name: c.name, value: c.value, domain: ".douyin.com", path: "/", secure: true }, S); okC++; }
    catch { badC++; }
  }
  const ck = await send("Network.getCookies", { urls: ["https://www.douyin.com/"] }, S).catch(() => ({ cookies: [] }));
  const names = (ck.cookies || []).map((c) => c.name);
  log("cookie 注入: 成功 " + okC + " 失败 " + badC + " | douyin.com 现有 " + names.length + " 条，含 sessionid: " + names.includes("sessionid"));
  if (!names.includes("sessionid")) log("⚠️ 未检测到 sessionid —— 登录态可能已失效或 cookie 文件不对，采集大概率拿不到数据");
}

// ★ 关键改进 1：让页面获得焦点，否则后台窗口的懒加载会被节流
await send("Emulation.setFocusEmulationEnabled", { enabled: true }, S).catch((e) => log("  focus 模拟失败: " + e.message));
await send("Page.bringToFront", {}, S).catch(() => {});

log("打开博主主页...");
await send("Page.navigate", { url: "https://www.douyin.com/user/" + SEC }, S);
await sleep(12000);
log("首屏累计: " + items.length);

let stall = 0, last = items.length;
for (let round = 1; round <= 150 && items.length < LIMIT; round++) {
  // ★ 关键改进 2：真实滚轮事件
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 500, deltaX: 0, deltaY: 1600, pointerType: "mouse" }, S).catch(() => {});
  // ★ 关键改进 3：兜底推所有可滚动容器
  await send("Runtime.evaluate", { expression: "(function(){var n=0;document.querySelectorAll('*').forEach(function(e){if(e.scrollHeight>e.clientHeight+200&&e.clientHeight>0){e.scrollTop=e.scrollHeight;n++;}});return n;})()", returnByValue: true }, S).catch(() => {});
  await sleep(3500);
  if (items.length === last) stall++; else { stall = 0; last = items.length; }
  if (round % 10 === 0) log("  第 " + round + " 轮，累计 " + items.length + "（停滞 " + stall + "）");
  if (stall >= 14) { log("连续 14 轮无新增，停止"); break; }
}
log("采集结束: " + items.length + " 条");

function compact(a) {
  const play = a.video?.play_addr || {}; const s = a.statistics || {};
  const urls = Array.isArray(play.url_list) ? play.url_list : [];
  let direct = urls.find((u) => typeof u === "string" && u.startsWith("http")) || "";
  if (!direct && play.uri) direct = "https://www.iesdouyin.com/aweme/v1/play/?video_id=" + play.uri + "&ratio=1080p&line=0";
  return { aweme_id: String(a.aweme_id || ""), desc: a.desc || "", create_time: a.create_time || 0,
    aweme_type: a.aweme_type ?? null, is_image: Array.isArray(a.images) && a.images.length > 0,
    duration_ms: a.video?.duration || 0,
    cover: a.video?.cover?.url_list?.[0] || a.video?.origin_cover?.url_list?.[0] || "",
    video_uri: play.uri || "", play_url_snapshot: direct,
    digg_count: s.digg_count ?? null, comment_count: s.comment_count ?? null,
    share_count: s.share_count ?? null, collect_count: s.collect_count ?? null,
    author: a.author?.nickname || "", sec_uid: a.author?.sec_uid || SEC,
    // 图文帖：逐张图片直链（供 OCR 提取图片内文字用）
    images: Array.isArray(a.images)
      ? a.images.map((im) => im?.url_list?.[0] || "")
          .filter((u) => typeof u === "string" && u.startsWith("http"))
      : [],
    share_url: "https://www.douyin.com/video/" + String(a.aweme_id || "") };
}

const rows = items.slice(0, LIMIT).map(compact);
// 作者信息从实际采集到的数据里取，不写死 —— 否则换账号会串号
const nickname = rows.find((r) => r.author)?.author || "";
const realSecUid = rows.find((r) => r.sec_uid)?.sec_uid || SEC;
writeFileSync(OUT, JSON.stringify({
  sec_uid: realSecUid, nickname, douyin_id: argVal("--id", ""),
  collected_at: new Date().toISOString(), collected_via: "browser-cdp-v2",
  image_count: rows.filter((r) => r.is_image).length,
  total: rows.length, videos: rows,
}, null, 2), "utf8");
log("已写入 " + OUT + ": " + rows.length + " 条");

ws.close();
await sleep(1500);
log("关闭调试实例...");
try { execFileSync("powershell.exe", ["-NoProfile","-Command","Get-CimInstance Win32_Process -Filter \"Name='quark.exe'\" | Where-Object { $_.CommandLine -match 'remote-debugging-port=" + PORT + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { encoding: "utf8" }); } catch {}
await sleep(3000);

if (INJECT) {
  // 注入模式全程没动过用户的浏览器，所以只需清理临时 profile
  if (!KEEP_PROFILE) { try { rmSync(PROFILE, { recursive: true, force: true }); log("已清理临时 profile"); } catch {} }
  log("完成（用户浏览器未受影响，无需恢复）");
} else {
  spawn(QUARK, ["--user-data-dir=" + USER_DATA, "--no-first-run"], { detached: true, stdio: "ignore" }).unref();
  log("完成（已重启夸克）");
}
