# -*- coding: utf-8 -*-
"""图文帖 OCR：把抖音图文帖里的图片文字提取成 .txt

为什么需要它：一个博主的作品分两类 ——
  - **视频帖** → 有音轨，走 batch_transcribe.py（whisper 转写）
  - **图文帖** → 没有音轨，只有图片，必须从图片里取字（本脚本）
抖音近年的图文帖占比不低（实测某财经博主 200 条里 107 条是图文），
不处理这块会直接丢掉一半语料。

设计要点：
  - 输出的 .txt 与 batch_transcribe.py **格式同构**，因此 build_corpus.mjs
    无需任何改动就能把视频转写和图文 OCR 一起按时间线合成
  - 顺带把图片下载到素材目录（图片本身也是有用的原始素材）
  - 零外部服务：本地 RapidOCR（onnxruntime），数据不出本机

安装: pip install rapidocr_onnxruntime

用法: python ocr_images.py <素材目录> [清单.json] [限制条数]
  素材目录   图片与 txt 的输出位置
  清单.json  默认取 <素材目录>/works.json；需要含 images 数组（browser-collect.mjs 会写入）
  限制条数   0 = 不限（默认），调试时可传 10 只跑前 10 条
"""
import os, sys, json, time, urllib.request
from pathlib import Path

# 与 batch_transcribe.py 一致：清掉代理变量，否则某些环境下会解析失败
for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    print("缺少依赖：pip install rapidocr_onnxruntime")
    sys.exit(2)

if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(2)

DIR = Path(sys.argv[1]).resolve()
WORKS = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else (DIR / "works.json")
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else 0

if not WORKS.exists():
    print("找不到清单: %s" % WORKS)
    print("提示: browser-collect.mjs --out <素材目录>/works.json，或用第 2 个参数指定")
    sys.exit(2)

w = json.loads(WORKS.read_text(encoding="utf-8"))
items = w.get("videos", w if isinstance(w, list) else [])


def safe(s, n=50):
    bad = '\\/:*?"<>|\r\n\t'
    out = "".join(("_" if c in bad else c) for c in str(s or "")).strip()
    return (out[:n] or "untitled")


# 目标识别：优先看 is_image；没有该字段时退化为「有 images 数组」
def is_image_post(v):
    if v.get("is_image") is not None:
        return bool(v.get("is_image"))
    return bool(v.get("images"))


targets = [(i, v) for i, v in enumerate(items) if is_image_post(v)]
if LIMIT:
    targets = targets[:LIMIT]
print("图文帖 %d 个（总条目 %d）" % (len(targets), len(items)), flush=True)
if not targets:
    print("没有图文帖 —— 该博主可能只发视频，转写用 batch_transcribe.py 即可。")
    sys.exit(0)

engine = RapidOCR()
summary = {}
t_all = time.time()
total_chars = 0

for n, (idx, v) in enumerate(targets, 1):
    seq = v.get("__idx", idx + 1)
    aid = str(v.get("aweme_id", ""))
    base = "%03d-%s-%s" % (seq, aid, safe(v.get("desc"), 50))
    txt_path = DIR / (base + ".txt")
    urls = v.get("images") or []

    if not urls:
        print("[%d/%d] %s 无图片直链，跳过" % (n, len(targets), aid), flush=True)
        summary[aid] = {"error": "no image urls"}
        continue
    if txt_path.exists():
        print("[%d/%d] %s 已有 txt，跳过" % (n, len(targets), aid), flush=True)
        continue

    t0 = time.time()
    chunks, ok_n, fail_n = [], 0, 0
    for k, u in enumerate(urls, 1):
        ext = ".jpg"
        for cand in (".png", ".webp", ".jpeg"):
            if cand in u.split("?")[0].lower():
                ext = cand
                break
        img = DIR / ("%s-%02d%s" % (base, k, ext))
        if not img.exists():
            try:
                req = urllib.request.Request(u, headers={
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
                                  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
                    "Referer": "https://www.douyin.com/"})
                with urllib.request.urlopen(req, timeout=60) as resp, open(img, "wb") as f:
                    f.write(resp.read())
            except Exception as e:
                fail_n += 1
                chunks.append("[图%d] 下载失败: %s" % (k, str(e)[:60]))
                continue
        try:
            res, _ = engine(str(img))
            lines = [r[1] for r in (res or []) if r and len(r) > 1 and r[1]]
            if lines:
                ok_n += 1
                chunks.append("[图%d]\n%s" % (k, "\n".join(lines)))
            else:
                chunks.append("[图%d] (无文字)" % k)
        except Exception as e:
            fail_n += 1
            chunks.append("[图%d] OCR 失败: %s" % (k, str(e)[:60]))

    body = "\n\n".join(chunks)
    txt_path.write_text(body, encoding="utf-8")
    chars = len(body.replace("\n", ""))
    total_chars += chars
    summary[aid] = {"images": len(urls), "ocr_ok": ok_n, "failed": fail_n, "chars": chars}
    print("[%d/%d] %s 图%d 成功%d 字符%d 耗时%.1fs" % (
        n, len(targets), aid, len(urls), ok_n, chars, time.time() - t0), flush=True)

(DIR / "_ocr_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
tot = time.time() - t_all
print("\n完成 %d 个图文帖, 耗时 %.1f 分钟, 提取文字约 %.0f 千字" % (
    len(targets), tot / 60, total_chars / 1000), flush=True)
