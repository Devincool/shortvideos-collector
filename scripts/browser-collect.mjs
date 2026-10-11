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
 * 用法（需先完全退出浏览器，否则 profile 被锁、Cookie 库读不到）：
 *   node browser-collect.mjs [--sec <sec_uid>] [--limit 100]
 * 退出浏览器后本脚本会：检测退出 → 带调试启动 → 采集 → 关闭调试实例 → 正常重启浏览器
 */
import { writeFileSync, appendFileSync } from "node:fs";
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

if (!SEC) {
  console.error("用法: node browser-collect.mjs --sec <sec_uid|主页链接|抖音号> [--limit 100] [--out ./works.json]");
  console.error("  浏览器需先完全退出（托盘右键退出，不是关窗口）");
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

log("采集器 v2 守候启动：等待夸克完全退出...");
const deadline = Date.now() + 60 * 60 * 1000;
while (quarkRunning()) { if (Date.now() > deadline) { log("超时"); process.exit(1); } await sleep(2000); }
log("夸克已退出");
await sleep(2000);

const child = spawn(QUARK, ["--user-data-dir=" + USER_DATA, "--remote-debugging-port=" + PORT,
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
    share_url: "https://www.douyin.com/video/" + String(a.aweme_id || "") };
}

const rows = items.slice(0, LIMIT).map(compact);
writeFileSync(OUT, JSON.stringify({
  sec_uid: SEC, nickname: "全能的野人", douyin_id: "203775400",
  collected_at: new Date().toISOString(), collected_via: "browser-cdp-v2",
  total: rows.length, videos: rows,
}, null, 2), "utf8");
log("已写入 " + OUT + ": " + rows.length + " 条");

ws.close();
await sleep(1500);
log("关闭调试实例并恢复夸克...");
try { execFileSync("powershell.exe", ["-NoProfile","-Command","Get-CimInstance Win32_Process -Filter \"Name='quark.exe'\" | Where-Object { $_.CommandLine -match 'remote-debugging-port=" + PORT + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { encoding: "utf8" }); } catch {}
await sleep(3000);
spawn(QUARK, ["--user-data-dir=" + USER_DATA, "--no-first-run"], { detached: true, stdio: "ignore" }).unref();
log("完成");
