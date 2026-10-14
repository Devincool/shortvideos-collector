---
name: shortvideos-collector
description: End-to-end Douyin creator video pipeline — collect a creator's works list via CDP-driven browser automation, bulk download watermark-free videos, transcribe them locally with whisper, and build a timeline-ordered corpus for analysis. Use this skill when the user wants to list a Douyin creator's posts, batch download videos from a profile, transcribe those videos, or synthesize creator content into a readable text corpus.
version: 1.0.0
license: MIT
metadata:
  openclaw:
    emoji: 🎬
---

# shortvideos-collector

把一个抖音博主的作品，从「列表」一路做到「可分析的文字语料」。

~~~text
作品列表 → 无水印视频 → 转写文本 → 时间线语料
 (CDP)      (两条路可选)   (whisper)   (build_corpus)
~~~

---

## 能力与登录要求

| 段 | 脚本 | 需要登录 | 产物 |
|---|---|---|---|
| ① 取列表 | `scripts/browser-collect.mjs` | **需要**（浏览器已登录即可） | `works.json` |
| ② 下载 | `scripts/download.mjs` | 不需要 | `*.mp4` |
| ③ 转写 | `scripts/batch_transcribe.py` | 不需要 | `*.txt` |
| ④ 整理 | `scripts/build_corpus.mjs` | 不需要 | `_corpus.md` |

除①外全程不需要 Cookie；转写在本机完成，数据不出本地。

---

## 标准流程

~~~bash
# ① 取列表 —— 推荐「注入模式」：不需要退出浏览器
node scripts/extract-cookies.mjs --browser quark --domain douyin.com --out .cookie.txt   # 只需一次
node scripts/browser-collect.mjs --sec <sec_uid|主页链接|抖音号> --limit 200 --out ./works.json --cookie-file .cookie.txt

# ①' 备选：真实 profile 模式（需先「完全退出」浏览器）
node scripts/browser-collect.mjs --sec <sec_uid|主页链接|抖音号> --limit 100 --out ./works.json

# ② 下载（二选一）
#   路径 A：快照直链（列表刚采完时用，最快）
node scripts/download.mjs --list ./works.json --out ./videos --from-snapshot --concurrency 4

#   路径 B：外部解析器（列表放久了用，现取现用不过期）
git clone --depth 1 https://github.com/wu529778790/parse.shenzjd.com.git upstream
node scripts/build-resolver.mjs --source upstream --out ./resolver
PARSER_CORE_DIR=./resolver node scripts/download.mjs --list ./works.json --out ./videos --concurrency 1 --delay 3000

# ③ 转写
python scripts/batch_transcribe.py ./videos small

# ④ 语料
node scripts/build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
~~~

---

## 关键约束（不要绕过，都是踩过坑的）

### 1. 取列表只能走浏览器

抖音作品列表端点要求 **uifid 绑定的新签名**，公开的 a_bogus 算法已被拒绝：

~~~text
/aweme/v1/web/user/profile/other/  → 200 ✅
/aweme/v1/web/aweme/post/          → 403 ❌ ArgusSecurityPlugin
~~~

同一套 Cookie/头/签名只有端点不同 → 签名问题，不是 Cookie 问题。
**不要在签名逆向或 Cookie 上耗时间**，直接用 CDP 让浏览器自己发请求。

### 2. 优先用注入模式，别再等用户退浏览器

采集有两条路，**默认走注入模式**：

| 模式 | 触发 | 是否需退浏览器 | 说明 |
|---|---|---|---|
| **注入模式** | 加 `--cookie-file` | **不需要** | 全新临时 profile + CDP 注入 cookie，不碰用户浏览器；实测 24 秒采 200 条 |
| 真实 profile 模式 | 不加该参数 | 需要 | 没有 cookie 文件时的退路 |

**为什么需要 cookie 文件**：抖音作品列表必须有登录态，而浏览器运行时 Cookie 库是
**硬独占锁**（连共享读都不行），拿不到。所以流程是：
**一次性提取 cookie（需退浏览器）→ 之后反复采集（不需要退）**。

`extract-cookies.mjs` 零依赖（node:sqlite + node:crypto + PowerShell DPAPI）。
两个实现要点：ProtectedData 只在 Windows PowerShell 里（pwsh 没有），要先 `Add-Type -AssemblyName System.Security`；
解密后明文前 **32 字节是 SHA256(host_key)**，必须剥掉。

> 若用户明确拒绝提供 cookie 文件，再退回真实 profile 模式：等其完全退出浏览器。

### 3. 下载路径按场景选

- **列表刚采完** → `--from-snapshot`（快，不走抖音页面，无限流风险；但直链几小时后失效）
- **列表放久了 / 快照 403** → 外部解析器（现取现用不过期；但每个视频 fetch 一次页面，有风控风险）
- **快照过期又不想建解析器** → 直接**重跑一次采集**（1~2 分钟），拿到新鲜快照即可

> 上游仓库里**没有**现成解析器目录，clone 只得到 src/。
> 必须先用 `build-resolver.mjs` 构建入口，否则 PARSER_CORE_DIR 指向的目录不可用。
> 构建脚本是原创代码，不含上游源码。

### 3.1 偶发 403 属正常

解析器路径下，个别视频的 CDN 直链会返回 403（与视频编码/风控有关）。
实测同一批里约 1/3 可能偶发失败，**重试即可**，不代表链路故障。

### 4. 下载限流要降速，不要下结论

并发 3 打 100 个 → 约 41 个后全部失败（网络出口被限流）。
正确处置：`--concurrency 1 --delay 3000`，**等 1~2 小时自行恢复**，或用快照路径先把活干完。
实测限流期间带 Cookie 重试也无效（IP 级）。**缓过来后同样的做法 10/10 通过。**

### 5. 转写优先用 GPU

GPU float16 约 **14.7× 实时**，CPU int8 只有 **2.5×** —— 153 分钟音频差 6 倍（10 分钟 vs 63 分钟）。
需先 `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`。

脚本已内置处理两个环境坑：
- `NO_PROXY` 含 `[::1]` 会让 HuggingFace 客户端崩溃（`Invalid port: ':1]'`）
- CUDA 库常装在 user site，需手动注册 DLL 搜索路径；且**模型能加载 ≠ 推理可用**，会自动回退 CPU

### 6. 语料大时不要硬塞上下文

几十万字语料请按条目切片，用并行子代理各读一片做结构化提取，再汇总成体系化文档。

### 7. 转写有噪声，不要当成原话直接引用

金融术语同音字错误常见（竞价→进价、妖股→腰骨、卡异动→卡一栋）。
低置信度段落已标 `★复核`。对外使用前建议人工扫一遍。

---

## 输出格式

### works.json（① 的产物）

~~~json
{
  "sec_uid": "MS4wLjABAAAA...",
  "nickname": "某博主",
  "douyin_id": "203775400",
  "total": 100,
  "videos": [{
    "aweme_id": "7636497165430394162",
    "desc": "作品文案",
    "create_time": 1780000000,
    "is_image": false,
    "duration_ms": 123456,
    "cover": "https://...",
    "play_url_snapshot": "https://...",
    "digg_count": 1234, "comment_count": 56,
    "share_count": 7, "collect_count": 89,
    "share_url": "https://www.douyin.com/video/7636497165430394162"
  }]
}
~~~

> `play_url_snapshot` 是采集当时的快照，**带时效签名会过期**，仅供 `--from-snapshot` 使用。

### 下载报告（`<out>/_download-report.json`）

~~~json
{ "total": 3, "ok": 2, "source": "snapshot", "results": [
  { "aweme_id": "...", "ok": true, "files": ["...mp4"], "bytes": 155504165 },
  { "aweme_id": "...", "ok": false, "msg": "HTTP 403" }
] }
~~~

---

## 目录结构

~~~text
shortvideos-collector/
├── SKILL.md               本文件
├── README.md / README.en.md   中英文文档
├── LICENSE                MIT
└── scripts/
    ├── browser-collect.mjs
    ├── extract-cookies.mjs
    ├── download.mjs
    ├── build-resolver.mjs
    ├── batch_transcribe.py
    └── build_corpus.mjs
~~~

---

## 合规要求

- 只采集抖音**公开**数据。采集内容的**版权归原创作者**，不得二次分发或商用。
- 本仓库为原创代码，按 **MIT** 发布，**不包含任何第三方代码**。
- 下载功能可选接入的外部解析器（parse.shenzjd.com）无 LICENSE 文件，使用条件请自行确认。
