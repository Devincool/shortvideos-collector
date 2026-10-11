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

## Full example (DEMO)

Let's walk the whole pipeline with Douyin ID **203775400** (a finance creator).
Measured scale: **100 posts → 99 videos → 158 min of audio → ~49k characters of corpus**.

### Step 1 · Collect the works list

> **Fully quit your browser first** (tray icon → Quit, not just close the window)

```bash
$ node scripts/browser-collect.mjs --sec 203775400 --limit 100 --out ./works.json
```

```text
2026-10-11T16:41:02.113Z  Input is not a sec_uid, resolving as Douyin ID: 203775400
2026-10-11T16:41:03.402Z  Resolved: <creator>  sec_uid=MS4wLjABAAAAjoG0q686OV...
2026-10-11T16:41:03.405Z  Collector v2 waiting: browser has not exited yet...
2026-10-11T16:41:29.881Z  Browser exited
2026-10-11T16:41:30.552Z  Debug instance started, PID 28144
2026-10-11T16:41:32.109Z  Opening creator page...
2026-10-11T16:41:39.220Z  First screen: 20
2026-10-11T16:41:48.771Z    Captured a page +18 (new 18, total 38)
2026-10-11T16:42:02.330Z    Captured a page +20 (new 20, total 75)
2026-10-11T16:42:31.004Z    Captured a page +20 (new 20, total 129)
2026-10-11T16:43:05.118Z  14 rounds with no new items, stopping
2026-10-11T16:43:05.120Z  Collection finished: 129 items
2026-10-11T16:43:05.245Z  Wrote ./works.json: 100 items
2026-10-11T16:43:05.250Z  Closing debug instance and restoring browser...
2026-10-11T16:43:08.900Z  Done
```

> It saw 129 and wrote 100 because `--limit 100` truncates.
> The per-page increments confirm that wheel-scrolling pagination worked.

The resulting works.json (excerpt):

```json
{
  "nickname": "<creator>",
  "douyin_id": "203775400",
  "total": 100,
  "videos": [
    {
      "aweme_id": "7567562617562002868",
      "desc": "How to trade a weak-to-strong reversal",
      "create_time": 1762046160,
      "is_image": false,
      "duration_ms": 180034,
      "cover": "https://p11-sign.douyinpic.com/tos-cn-i-0813/...",
      "play_url_snapshot": "https://v26-web.douyinvod.com/...",
      "digg_count": 30934,
      "comment_count": 1203,
      "collect_count": 4821,
      "share_count": 892,
      "share_url": "https://www.douyin.com/video/7567562617562002868"
    }
  ]
}
```

### Step 2 · Download watermark-free videos

```bash
$ node scripts/download.mjs --list ./works.json --out ./videos --from-snapshot --concurrency 4
```

```text
Using CDN snapshot URLs from the list (no Douyin page requests)
100 items, concurrency 4, delay 3000ms, output ./videos
[1/100] OK   7567562617562002868
[2/100] OK   7617009261990681984
[3/100] OK   7611446498963244495
...
Done 99 / 100, report: videos\_download-report.json
```

> The one miss is a **long-form article post** (`aweme_type=163`, background music only,
> no video) — expected, not a failure.

### Step 3 · Batch transcription

```bash
$ python scripts/batch_transcribe.py ./videos small
```

```text
CUDA DLL paths: 27
99 videos, 99 to transcribe
Model small ready device=cuda compute=float16 (3.8s)
[1/99] 001-7562617562002868-...mp4 180s 42seg 12.3s 14.6x
[2/99] 002-7617009261990681984-...mp4 212s 51seg 14.5s 14.6x
...

Done 99 files, 158.4 min of audio, 10.8 min elapsed (14.7x realtime)
```

Each video yields a same-named `.txt` with timestamps and low-confidence flags:

```text
[0.0-3.2] Hello everyone, today is November 2nd
[3.2-8.7] Let's talk about how to trade a weak-to-strong reversal
[8.7-14.1] The previous day's broken limit-up had a 60% turnover rate ★REVIEW
```

### Step 4 · Build the timeline corpus

```bash
$ node scripts/build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
```

```text
Corpus written: ./_corpus.md
  100 entries (99 with transcript / 1 without)
  ~49k characters
```

### What you end up with

```text
videos/
├── 001-7562617562002868-....mp4    13.9 MB
├── 001-7562617562002868-....txt
├── 002-7617009261990681984-....mp4 22.6 MB
├── ...
└── _download-report.json

works.json     metadata for 100 posts (time / likes / comments / collects / shares / cover / direct URL)
_corpus.md     full timeline-ordered corpus (~49k chars, ready to read or feed to a model)
```

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

## Every stage works standalone

The four stages are **decoupled by files** — each stage's output is the next stage's input,
and the scripts share no code (they are not even the same language: 3 Node + 1 Python).
**Any single stage can be used on its own.**

| If you only want to | Use | Input | Output |
|---|---|---|---|
| Collect a creator's works list | `browser-collect.mjs` | sec_uid / profile URL / Douyin ID | `works.json` |
| Bulk download a set of videos | `download.mjs` | any JSON containing media info | `*.mp4` |
| Turn a folder of videos into text | `batch_transcribe.py` | **any directory** of video | `*.txt` |
| Order metadata + text on a timeline | `build_corpus.mjs` | JSON + a txt directory | `_corpus.md` |

### Collector only

`browser-collect.mjs` is a complete Douyin creator works scraper on its own,
emitting plain JSON you can wire into your own analysis:

```bash
node scripts/browser-collect.mjs --sec <douyin-id> --limit 50 --out ./raw.json
```

**Recon first** — look at the data without downloading anything:

```bash
node -e "const w=require('./raw.json'); console.log(w.nickname, w.total, 'posts'); console.log('avg likes', Math.round(w.videos.reduce((a,v)=>a+v.digg_count,0)/w.total));"
```

### Transcriber only (nothing to do with Douyin)

`batch_transcribe.py` **does not care where the video came from** — any directory of
spoken Chinese video will transcribe:

```bash
python scripts/batch_transcribe.py "/path/to/my/videos" medium
python scripts/batch_transcribe.py "/path/to/my/videos" small 10   # try the first 10
```

Already-transcribed files are skipped, so it is resumable.

### Resolve without downloading

Add `--resolve-only` to export direct URLs as JSON instead of fetching files:

```bash
node scripts/download.mjs --list ./works.json --out ./out --resolve-only
```

### Downloader accepts any list

`download.mjs` takes either a **bare array** or `{ videos: [...] }`, and fields can be
trimmed — each entry needs `aweme_id` (or `share_url`), plus `play_url_snapshot` for offline mode:

```json
[
  { "aweme_id": "7567562617562002868", "desc": "first", "play_url_snapshot": "https://..." },
  { "aweme_id": "7617009261990681984", "desc": "second", "share_url": "https://www.douyin.com/video/7617009261990681984" }
]
```

```bash
node scripts/download.mjs --list my-list.json --out ./out --from-snapshot
```

### Corpus builder only

`build_corpus.mjs` needs just two things: a JSON (it reads `create_time` / `desc` /
engagement counts) and a directory of `.txt` files (whose names contain the `aweme_id`).
Your own data can be put on a timeline too:

```bash
node scripts/build_corpus.mjs --works ./my-data.json --material ./my-texts --out ./timeline.md
```

---

## Install as an Agent Skill

This repository follows the common Agent Skill convention: **one directory plus a
`SKILL.md` with YAML frontmatter**. Since `SKILL.md` sits at the repo root,
**the repository itself is the skill** — just clone it into the right directory.

### DSH (DeepSeek Harness)

DSH scans these skill roots (project scope takes precedence over user scope):

| Scope | Path |
|---|---|
| Project | `<project-root>/.dsh/skills/` |
| Project | `<project-root>/.agents/skills/` |
| User | `~/.dsh/skills/` |
| User | `~/.agents/skills/` (root overridable via `DSH_AGENTS_HOME`) |

```bash
# user-level install (recommended)
git clone https://github.com/Devincool/shortvideos-collector.git ~/.agents/skills/shortvideos-collector

# Windows PowerShell
git clone https://github.com/Devincool/shortvideos-collector.git "$env:USERPROFILE\.agents\skills\shortvideos-collector"
```

Start a **new session** to pick it up, then just ask the agent to collect a creator's works.

### Claude Code

Skill directories: user-level `~/.claude/skills/`, project-level `<project>/.claude/skills/`

```bash
git clone https://github.com/Devincool/shortvideos-collector.git ~/.claude/skills/shortvideos-collector
```

### Codex

Skill directory: `$CODEX_HOME/skills/` (defaults to `~/.codex/skills/`)

```bash
git clone https://github.com/Devincool/shortvideos-collector.git ~/.codex/skills/shortvideos-collector
```

Or use Codex's bundled installer:

```bash
python ~/.codex/skills/.system/skill-installer/install-skill-from-github.py \
    --repo Devincool/shortvideos-collector
```

### Any other agent

Any tool that understands the "directory + SKILL.md" convention will load it as-is —
no changes required. The frontmatter already follows the spec (`name` plus an
English `description` so the model can match it automatically).

### No install needed: use it as plain scripts

**Installing it as a skill is optional.** All four scripts are ordinary CLIs:

```bash
git clone https://github.com/Devincool/shortvideos-collector.git
cd shortvideos-collector
node scripts/browser-collect.mjs --sec <douyin-id> --limit 100 --out ./works.json
```

---

## Using it once installed

Once loaded, just describe what you want in natural language:

| You say | The agent runs |
|---|---|
| "Collect the last 100 posts from Douyin ID 203775400" | `browser-collect.mjs` |
| "Download those videos to D:\media" | `download.mjs` |
| "Extract the spoken text from these videos" | `batch_transcribe.py` |
| "Organize the content into a timeline-based system" | `build_corpus.mjs` plus synthesis |

> Collection is the only step needing manual cooperation: **fully quit your browser first**.
> The script waits for it, relaunches it with a debug port, and restores it afterwards.

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
