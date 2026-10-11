# -*- coding: utf-8 -*-
"""批量转写：复用 dsh-stt 的引擎参数，模型只加载一次。
设备：优先 CUDA，推理失败（缺 cublas/cudnn）自动回退 CPU。
注意两处本机坑：
  1) NO_PROXY 含 "[::1]" 会让代理解析报 Invalid port，必须先清掉
  2) CUDA wheel 可能装在 user site，DLL 目录要手动加进搜索路径
"""
import os, sys, json, time, site
from pathlib import Path

for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ.setdefault("HF_HUB_OFFLINE", "1")

# ---- CUDA DLL 路径（系统 site 与 user site 都要找）----
cands = []
try:
    cands += [Path(p) for p in site.getsitepackages()]
except Exception:
    pass
try:
    cands.append(Path(site.getusersitepackages()))
except Exception:
    pass
cands.append(Path(sys.prefix) / "Lib" / "site-packages")
added = []
for sp in cands:
    for d in ("cublas", "cudnn", "cuda_nvrtc"):
        p = sp / "nvidia" / d / "bin"
        if p.is_dir():
            try:
                os.add_dll_directory(str(p))
            except Exception:
                pass
            os.environ["PATH"] = str(p) + os.pathsep + os.environ["PATH"]
            added.append(str(p))
print("CUDA DLL 路径: %d 个" % len(added), flush=True)

from faster_whisper import WhisperModel

DIR = Path(sys.argv[1])
MODEL = sys.argv[2] if len(sys.argv) > 2 else "small"
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else 0
FORCE_CPU = os.environ.get("STT_FORCE_CPU") == "1"

files = sorted([p for p in DIR.iterdir() if p.suffix.lower() in (".mp4", ".mov", ".mkv")])
todo = [f for f in files if not f.with_suffix(".txt").exists()]
print("视频 %d 个，待转写 %d 个" % (len(files), len(todo)), flush=True)
if LIMIT:
    todo = todo[:LIMIT]

def load(dev, ct):
    t = time.time()
    m = WhisperModel(MODEL, device=dev, compute_type=ct)
    print("模型 %s 就绪 device=%s compute=%s (%.1fs)" % (MODEL, dev, ct, time.time() - t), flush=True)
    return m

model = load("cpu", "int8") if FORCE_CPU else load("cuda", "float16")

def run(m, f):
    seg_iter, info = m.transcribe(
        str(f), language="zh", task="transcribe", beam_size=5, temperature=0,
        condition_on_previous_text=True, word_timestamps=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 250},
        hallucination_silence_threshold=2)
    segs = []
    for s in seg_iter:
        txt = (s.text or "").strip()
        if not txt:
            continue
        low = s.avg_logprob is not None and s.avg_logprob < -0.75
        segs.append({"start": round(float(s.start), 2), "end": round(float(s.end), 2),
                     "text": txt, "low_confidence": bool(low)})
    return segs, info

all_out = {}
t_all = time.time()
audio_s = 0.0
for i, f in enumerate(todo, 1):
    t0 = time.time()
    try:
        try:
            segs, info = run(model, f)
        except Exception as e1:
            msg = str(e1)
            if any(k in msg for k in ("cublas", "cudnn", "CUDA", "Library", "cuda")):
                print("  CUDA 推理不可用（%s），切换 CPU" % msg[:70], flush=True)
                model = load("cpu", "int8")
                segs, info = run(model, f)
            else:
                raise
        body = "\n".join("[%.2f-%.2f] %s%s" % (s["start"], s["end"], s["text"], " ★复核" if s["low_confidence"] else "") for s in segs)
        f.with_suffix(".txt").write_text(body, encoding="utf-8")
        dur = float(getattr(info, "duration", 0) or 0)
        audio_s += dur
        all_out[f.name] = {"duration": round(dur, 1), "segments": len(segs),
                           "low_conf": sum(1 for s in segs if s["low_confidence"]),
                           "chars": len(body.replace(chr(10), ""))}
        el = time.time() - t0
        print("[%d/%d] %s 时长%.0fs 段%d 耗时%.1fs %.1fx" % (
            i, len(todo), f.name[:38], dur, len(segs), el, (dur / el if el else 0)), flush=True)
    except Exception as e:
        print("[%d/%d] %s 失败: %s" % (i, len(todo), f.name[:38], str(e)[:120]), flush=True)
        all_out[f.name] = {"error": str(e)[:200]}

tot = time.time() - t_all
print("\n完成 %d 个, 音频 %.1f 分钟, 耗时 %.1f 分钟 (%.1fx 实时)" % (
    len(todo), audio_s / 60, tot / 60, (audio_s / tot if tot else 0)), flush=True)
(DIR / "_transcribe_summary.json").write_text(json.dumps(all_out, ensure_ascii=False, indent=1), encoding="utf-8")
