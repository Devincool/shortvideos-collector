#!/usr/bin/env node
/**
 * 从 Chromium 系浏览器（Quark / Chrome / Edge …）提取 cookie，输出成一行 Cookie 头字符串，
 * 供 browser-collect.mjs 的 --cookie-file 注入模式使用。
 *
 * 为什么需要它：注入模式要一份 cookie 文件。手工 F12 复制很繁琐，本脚本自动完成。
 *
 * 零依赖：node:sqlite（Node 22+ 内置）+ node:crypto（AES-256-GCM）+ PowerShell（调用 Windows DPAPI）
 *
 * 用法:
 *   node extract-cookies.mjs --browser quark --domain douyin.com --out .cookie.txt
 *   node extract-cookies.mjs --profile "<自定义 User Data 目录>" --domain douyin.com
 *
 * 关键实现细节（踩过坑）：
 *   - v10/v11 前缀 = DPAPI 保护的主密钥 + AES-256-GCM 加密的 cookie 值
 *   - 解密后明文的前 32 字节是 SHA256(host_key) 域名绑定哈希，**必须剥掉**，否则值是垃圾
 *   - v20 前缀 = App-Bound Encryption（Edge 等新版本启用），离线解不开，脚本会明确报告
 *
 * 注意：浏览器运行时 Cookie 库是【独占锁】，连共享读都不行 —— 必须在浏览器完全退出后运行。
 *       （这与 browser-collect.mjs 的注入模式不同：注入模式本身不需要退出浏览器。）
 */
import { DatabaseSync } from "node:sqlite";
import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const DOMAIN = argVal("--domain", "douyin.com");
const OUT = path.resolve(argVal("--out", "./.cookie.txt"));
const BROWSER = argVal("--browser", "quark");

const PRESETS = {
  quark: path.join(process.env.LOCALAPPDATA || "", "Quark", "User Data"),
  chrome: path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data"),
  edge: path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "User Data"),
  brave: path.join(process.env.LOCALAPPDATA || "", "BraveSoftware", "Brave-Browser", "User Data"),
};
const USER_DATA = path.resolve(argVal("--profile", PRESETS[BROWSER] || ""));
if (!USER_DATA || !existsSync(USER_DATA)) {
  console.error("找不到 profile 目录: " + USER_DATA);
  console.error("可用 --browser <" + Object.keys(PRESETS).join("|") + "> 或 --profile <目录>");
  process.exit(2);
}

// ---- 找 Cookies 库（新版在 Default/Network/，老版在 Default/）----
const candidates = [
  path.join(USER_DATA, "Default", "Network", "Cookies"),
  path.join(USER_DATA, "Default", "Cookies"),
];
const COOKIES = candidates.find((p) => existsSync(p));
if (!COOKIES) { console.error("找不到 Cookies 库，已试：\n  " + candidates.join("\n  ")); process.exit(2); }

// ---- 独占锁检测：能打开才说明浏览器已退出 ----
try {
  const { openSync, closeSync } = await import("node:fs");
  const fd = openSync(COOKIES, "r+"); closeSync(fd);
} catch (e) {
  console.error("Cookie 库被占用（" + e.code + "）——请先【完全退出】浏览器再运行。");
  console.error("  注意：关窗口不算，要从任务栏托盘右键退出，或结束全部浏览器进程。");
  process.exit(3);
}

// ---- DPAPI：批量把 base64 输入解成 base64 输出 ----
function dpapiBatch(b64List) {
  if (!b64List.length) return [];
  // 两个 PowerShell 坑：
  //  1) ProtectedData 在 PowerShell 7 (pwsh) 里不存在，必须用 Windows PowerShell (powershell.exe)，
  //     且要先 Add-Type -AssemblyName System.Security 才有该类型
  //  2) ConvertTo-Json 对单元素数组会退化成裸字符串 —— 下面统一按数组归一化
  const ps = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$in = [Console]::In.ReadToEnd() | ConvertFrom-Json",
    "$out = New-Object System.Collections.ArrayList",
    "foreach ($b in @($in)) {",
    "  try {",
    "    $raw = [Convert]::FromBase64String($b)",
    "    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($raw, $null, 'CurrentUser')",
    "    [void]$out.Add([Convert]::ToBase64String($dec))",
    "  } catch { [void]$out.Add('') }",
    "}",
    "[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress))",
  ].join("; ");
  const res = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    input: JSON.stringify(b64List), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  }).trim();
  const j = JSON.parse(res || "[]");
  return Array.isArray(j) ? j : [j];
}

// ---- 主密钥 ----
const ls = JSON.parse(readFileSync(path.join(USER_DATA, "Local State"), "utf8"));
const encKeyB64 = ls?.os_crypt?.encrypted_key;
if (!encKeyB64) { console.error("Local State 里没有 os_crypt.encrypted_key"); process.exit(2); }
if (ls?.os_crypt?.app_bound_encrypted_key) {
  console.error("检测到 app_bound_encrypted_key —— 该浏览器启用了 App-Bound Encryption。");
  console.error("cookie 值（v20 前缀）无法离线解密，本脚本无能为力。");
  process.exit(4);
}
const encKey = Buffer.from(encKeyB64, "base64");
if (encKey.subarray(0, 5).toString("utf8") !== "DPAPI") { console.error("encrypted_key 前缀不是 DPAPI"); process.exit(2); }
const masterKey = Buffer.from(dpapiBatch([encKey.subarray(5).toString("base64")])[0], "base64");
if (masterKey.length !== 32) { console.error("主密钥长度异常: " + masterKey.length); process.exit(2); }
console.log("主密钥: 已取得（32 字节）");

// ---- 读 Cookies ----
const db = new DatabaseSync(COOKIES, { readOnly: true });
const rows = db.prepare("SELECT host_key, name, value, encrypted_value, path, is_secure FROM cookies WHERE host_key LIKE ?").all("%" + DOMAIN + "%");
console.log("匹配 " + rows.length + " 条 cookie（域名含 " + DOMAIN + "）");

const needDpapi = [];
const out = [];
let v20 = 0, plainCount = 0, errCount = 0;

function decrypt(enc, hostKey) {
  if (!enc || enc.length === 0) return null;
  const pfx = enc.subarray(0, 3).toString("utf8");
  if (pfx === "v10" || pfx === "v11") {
    const nonce = enc.subarray(3, 15);
    const tag = enc.subarray(enc.length - 16);
    const ct = enc.subarray(15, enc.length - 16);
    const d = createDecipheriv("aes-256-gcm", masterKey, nonce);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(ct), d.final()]);
    // ★ 关键：剥掉 32 字节 SHA256(host_key) 域名绑定前缀
    const body = plain.subarray(32);
    const expect = createHash("sha256").update(hostKey).digest();
    const ok = plain.subarray(0, 32).equals(expect);
    return { value: body.toString("utf8"), prefixVerified: ok };
  }
  if (pfx === "v20") { v20++; return null; }
  return { value: enc.toString("utf8"), prefixVerified: null, legacy: true };
}

for (const r of rows) {
  if (r.value) { plainCount++; out.push({ ...r, plain: r.value }); continue; }
  try {
    const res = decrypt(Buffer.from(r.encrypted_value), r.host_key);
    if (!res) { if (v20) continue; continue; }
    out.push({ ...r, plain: res.value, verified: res.prefixVerified });
  } catch (e) { errCount++; }
}

console.log("明文直存: " + plainCount + " | 解密成功: " + out.filter((x) => x.verified !== undefined).length + " | 失败: " + errCount + (v20 ? " | v20 无法解密: " + v20 : ""));

const verified = out.filter((x) => x.verified === true).length;
const unverified = out.filter((x) => x.verified === false).length;
if (verified) console.log("域名哈希校验通过: " + verified + " 条" + (unverified ? "，未通过: " + unverified + " 条" : ""));

const usable = out.filter((x) => x.plain);
if (!usable.length) { console.error("没有提取到可用 cookie。"); process.exit(1); }
// 按过期时间升序（会话级排前），保持稳定输出
usable.sort((a, b) => (a.expires_utc || 0) - (b.expires_utc || 0));
const header = usable.map((c) => c.name + "=" + c.plain).join("; ");
writeFileSync(OUT, header, "utf8");
console.log("已写入 " + OUT + "（" + usable.length + " 条，长度 " + header.length + "）");
console.log("cookie 名: " + usable.map((c) => c.name).join(", ").slice(0, 300));
db.close();
