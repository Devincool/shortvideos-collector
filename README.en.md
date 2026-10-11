# shortvideos-collector

**English** | [中文](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> An end-to-end pipeline for Douyin (TikTok China) creator videos — from a works list all the way to an analyzable text corpus.

~~~text
Works list ──→ Watermark-free video ──→ Transcript ──→ Timeline corpus
 CDP scrape      two paths available        whisper        readable doc
~~~

Zero npm dependencies (Node 20+ / Python 3.10+). **No paid API required.** Transcription runs entirely on your machine — no data leaves your computer.

---

## What it does

| Capability | Description | Login required |
|---|---|---|
| **Collect works list** | Drives your own logged-in browser via CDP to capture a creator's full works (title / publish time / likes / comments / collects / shares / cover / direct URL) | Yes |
| **Bulk download watermark-free video** | Two selectable paths (CDN snapshot URL / external resolver, resolved on the fly) | No |
| **Bulk transcription** | Local faster-whisper, ~15x realtime on GPU, with timestamps and low-confidence flags | No |
| **Build timeline corpus** | Merges metadata and transcripts in publish order into a document you can read or feed to a model | No |

---

## Quick start

~~~bash
git clone https://github.com/Devincool/shortvideos-collector.git
cd shortvideos-collector

# 1) Collect works list — FULLY QUIT your browser first (not just close the window!)
node scripts/browser-collect.mjs --sec 203775400 --limit 100 --out ./works.json

# 2) Download watermark-free videos (snapshot path: fastest, no page-level rate limiting)
node scripts/download.mjs --list ./works.json --out ./videos --from-snapshot

# 3) Batch transcribe (GPU needs CUDA runtime libs — see below)
python scripts/batch_transcribe.py ./videos small

# 4) Build the timeline corpus
node scripts/build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
~~~

---

## Requirements

- **Node.js >= 20** (uses built-in fetch and WebSocket)
- **Python >= 3.10** + faster-whisper (transcription only):
  ~~~bash
  pip install faster-whisper av
  # for GPU acceleration:
  pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
  ~~~

---

## 1. Collect the works list

~~~bash
node scripts/browser-collect.mjs --sec <sec_uid|profile-url|douyin-id> [--limit 100] [--out ./works.json]
~~~

All three input forms are accepted:

- Profile URL: ~~~https://www.douyin.com/user/MS4wLjABAAAA...~~~
- Raw sec_uid (starts with ~~~MS4wLj~~~)
- **Douyin ID** — the plain number shown on the profile, e.g. ~~~203775400~~~

### You must FULLY quit the browser first

**Closing the window is not enough.** Quark, Edge and other browsers keep background
processes alive that hold a lock on the profile and the cookie database.
Use **tray icon -> Quit**, or end the processes in Task Manager.

The script then does everything automatically:

~~~text
wait for browser exit -> launch with remote debugging (real profile) -> open profile page
-> wheel-scroll to paginate -> capture works-list API responses -> write works.json
-> kill the debug instance -> relaunch your browser normally
~~~

Collecting 100 items takes roughly 1-2 minutes.

### Why not call the official API directly

Because it does not work. Measured:

~~~text
/aweme/v1/web/user/profile/other/   -> HTTP 200  OK    (profile endpoint fine)
/aweme/v1/web/aweme/post/           -> HTTP 403  FAIL  (ArgusSecurityPlugin)
~~~

Same cookies, same headers, same signature — **only the endpoint differs**. So it is a
stale signature algorithm, not a cookie problem.

Further localization: adding ~~~uifid~~~ to the query changes the error from
~~~Uifid Not Found~~~ to ~~~Signature Not Found~~~ — meaning that endpoint demands a
**uifid-bound signature** which the publicly known a_bogus algorithm cannot produce.

**Only the browser itself can make that request.** That is why this tool uses CDP.

### Using a different browser

Defaults to Quark. Override with environment variables:

~~~bash
COLLECT_BROWSER="C:\Program Files\Google\Chrome\Application\chrome.exe" \
COLLECT_USER_DATA="$LOCALAPPDATA\Google\Chrome\User Data" \
node scripts/browser-collect.mjs --sec <...>
~~~

---

## 2. Download watermark-free video

Two paths — pick by situation:

| Path | How | URL lifetime | Speed | Rate-limit risk |
|---|---|---|---|---|
| **A snapshot** | ~~~--from-snapshot~~~ | expires after hours | fast | none |
| **B external resolver** | set ~~~PARSER_CORE_DIR~~~ | freshly resolved, does not expire | slow | yes |

**List just collected -> use A.** **List is old / snapshots return 403 -> use B.**

~~~bash
# A
node scripts/download.mjs --list ./works.json --out ./videos --from-snapshot --concurrency 4

# B — build a resolver yourself first, then point at it (3 steps)
git clone --depth 1 https://github.com/wu529778790/parse.shenzjd.com.git upstream
node scripts/build-resolver.mjs --source upstream --out ./resolver
PARSER_CORE_DIR=./resolver node scripts/download.mjs \
    --list ./works.json --out ./videos --concurrency 1 --delay 3000
~~~

> **Note**: the upstream repository contains **no ready-made resolver directory** —
> a plain clone only gives you src/. build-resolver.mjs extracts the required module
> closure and generates an entry point, producing a zero-dependency, standalone
> resolver. **The script is original code and ships none of the upstream sources**;
> it only reads your local clone, copies modules and rewrites imports.

### Watch out for rate limiting

**Path B fetches a Douyin page for every video.** Push too hard and you get throttled:

~~~text
concurrency 3 over 100 videos -> everything fails after ~41 items: egress IP throttled
~~~

Correct handling:

1. **Lower concurrency, add delay**: ~~~--concurrency 1 --delay 3000~~~
2. **Wait 1-2 hours** — egress IP throttling clears by itself
3. While throttled, switch to **path A (snapshot)** and finish the job

> Measured: retrying with cookies while throttled does not help (it is **IP-level**).
> But 1.5 hours later the exact same approach passed 10/10.
> **It is not "the method does not work" — you just pushed too hard.**

---

## 3. Batch transcription

~~~bash
python scripts/batch_transcribe.py <media-dir> [small|medium] [limit]
~~~

- The model is **loaded once** (calling the CLI per file reloads it every time — pure waste on 100 files)
- Already-transcribed files are skipped, so it is resumable
- Output carries timestamps: ~~~[start-end] text~~~, low-confidence segments marked ~~~REVIEW~~~

**Measured performance (RTX 2060 / Ryzen 7 3700X):**

| Device | Speed | 153 min of audio |
|---|---|---|
| GPU float16 | **14.7x realtime** | ~10 min |
| CPU int8 | 2.5x realtime | ~63 min |

**A 6x difference — worth installing the CUDA runtime.**

### Two environment traps it handles for you

1. **A NO_PROXY entry of ~~~[::1]~~~ crashes the HuggingFace client outright**
   ~~~Invalid port: ':1]'~~~ — nothing to do with GPU/CPU; the proxy library fails to parse no_proxy.
2. **CUDA wheels often land in the user site**, while most scripts only look at system
   site-packages. This script checks both and registers the DLL search path. Also note
   **a model that loads is not necessarily a model that runs** (CUDA loads instantly,
   then fails on missing cublas during inference) — the script falls back to CPU automatically.

---

## 4. Build the timeline corpus

~~~bash
node scripts/build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
~~~

Merges works metadata (publish time / likes / comments / collects / shares) with the
transcripts in **ascending publish order**, stripping timestamp prefixes for readability.

When the corpus reaches hundreds of thousands of characters, **do not stuff it into a
single context** — slice it per entry and have several parallel subagents digest one
slice each, then synthesize.

---

## Repository layout

~~~text
shortvideos-collector/
├── SKILL.md               Agent-facing usage guide
├── README.md              Chinese docs
├── README.en.md           English docs (this file)
├── LICENSE                MIT
└── scripts/
    ├── browser-collect.mjs  CDP works collector
    ├── download.mjs         Bulk downloader (snapshot / external resolver)
    ├── build-resolver.mjs   Build a resolver from an upstream clone
    ├── batch_transcribe.py  Batch transcription
    └── build_corpus.mjs     Corpus builder
~~~

---

## FAQ

**Q: Why must the browser be fully quit?**
A: While running, the browser holds a **hard exclusive lock** on its profile and cookie
database. Other processes simply cannot read them. This is an OS file lock, not a
permissions issue — shared reads and backup-mode copies fail too.

**Q: How accurate is the transcription?**
A: Chinese speech is broadly usable, but **homophone errors are frequent for
finance/professional jargon** (measured: "竞价" heard as "进价", "妖股" as "腰骨").
Review anything important by hand, or use the ~~~medium~~~ model. Low-confidence
segments are flagged with ~~~REVIEW~~~.

**Q: Can it collect other creators?**
A: Yes — it only scrapes public data. Still, respect the platform terms and copyright
law, and **do not redistribute other people's content**.

**Q: Other platforms?**
A: Douyin only for now. The architecture does not preclude extending it, but each
platform has entirely different signing and anti-bot mechanisms.

---

## License

This repository is **original code**, released under **MIT**, and **includes no third-party code**.

The download feature can optionally plug in an external resolver (parse.shenzjd.com).
That upstream repository has no LICENSE file; verify its terms yourself — this repository
only provides the integration mechanism and does not distribute its code.

---

## Disclaimer

- This tool only collects **public** Douyin data, for technical learning and internal analysis.
- **Copyright of collected content belongs to its original creators.** Do not redistribute or use commercially.
- Comply with Douyin's Terms of Service and applicable law. You bear all consequences of using this tool.
