# shortvideos-collector

[English](./README.en.md) | **中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> 抖音博主视频采集全流水线：从作品列表一路做到可分析的文字语料。

~~~text
作品列表 ──→ 无水印视频 ──→ 转写文本 ──→ 时间线语料
 CDP 采集      两条路可选       whisper       可读文档
~~~

零 npm 依赖（Node 20+ / Python 3.10+）。**不依赖任何付费 API**，转写全程本机，数据不出本地。

---

## 能做什么

| 能力 | 说明 | 需要登录 |
|---|---|---|
| **采集作品列表** | 用 CDP 驱动你自己已登录的浏览器，拿到某博主的全部作品（标题/发布时间/点赞/评论/收藏/分享/封面/直链） | 需要 |
| **批量下载无水印视频** | 两条路径可选（CDN 快照直链 / 外部解析器现取现用） | 不需要 |
| **批量转写** | 本地 faster-whisper，GPU 加速约 15 倍实时，带时间轴与低置信度标注 | 不需要 |
| **合成时间线语料** | 把元数据与转写按发布时间排序，输出可直接阅读/喂给模型的文档 | 不需要 |

---

## 快速开始

~~~bash
git clone https://github.com/Devincool/shortvideos-collector.git
cd shortvideos-collector

# 1) 采集作品列表 —— 先「完全退出」浏览器（不是关窗口！）
node scripts/browser-collect.mjs --sec 203775400 --limit 100 --out ./works.json

# 2) 下载无水印视频（用快照直链，最快且不受页面风控）
node scripts/download.mjs --list ./works.json --out ./videos --from-snapshot

# 3) 批量转写（GPU 需先装 CUDA 运行库，见下文）
python scripts/batch_transcribe.py ./videos small

# 4) 合成时间线语料
node scripts/build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
~~~

---

## 完整示例（DEMO）

以抖音号 **203775400**（财经博主「全能的野人」）为例跑一遍全流程。
实测规模：**100 条作品 → 99 个视频 → 158 分钟音频 → 约 49 千字语料**。

### 步骤 1 · 采集作品列表

> 先**完全退出浏览器**（托盘右键退出，不是关窗口）

```bash
$ node scripts/browser-collect.mjs --sec 203775400 --limit 100 --out ./works.json
```

```text
2026-10-11T16:41:02.113Z  入参不是 sec_uid，按抖音号解析: 203775400
2026-10-11T16:41:03.402Z  解析成功: 全能的野人  sec_uid=MS4wLjABAAAAjoG0q686OV...
2026-10-11T16:41:03.405Z  采集器 v2 守候启动：等待夸克完全退出...
2026-10-11T16:41:29.881Z  夸克已退出
2026-10-11T16:41:30.552Z  启动调试实例 PID 28144
2026-10-11T16:41:32.109Z  打开博主主页...
2026-10-11T16:41:39.220Z  首屏累计: 20
2026-10-11T16:41:48.771Z    捕获一页 +18（新增 18，累计 38）
2026-10-11T16:42:02.330Z    捕获一页 +20（新增 20，累计 75）
2026-10-11T16:42:31.004Z    捕获一页 +20（新增 20，累计 129）
2026-10-11T16:43:05.118Z  连续 14 轮无新增，停止
2026-10-11T16:43:05.120Z  采集结束: 129 条
2026-10-11T16:43:05.245Z  已写入 ./works.json: 100 条
2026-10-11T16:43:05.250Z  关闭调试实例并恢复夸克...
2026-10-11T16:43:08.900Z  完成
```

> 采集到 129 条、写入 100 条，是因为 `--limit 100` 会截断。
> 「捕获一页」逐页递增，说明滚轮翻页生效了。

产出的 works.json（节选）：

```json
{
  "nickname": "全能的野人",
  "douyin_id": "203775400",
  "total": 100,
  "videos": [
    {
      "aweme_id": "7567562617562002868",
      "desc": "2025年11月2日 弱转强怎么做#野人哥 #股票 #股民",
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

### 步骤 2 · 下载无水印视频

```bash
$ node scripts/download.mjs --list ./works.json --out ./videos --from-snapshot --concurrency 4
```

```text
使用清单里的 CDN 快照直链（不访问抖音页面）
待处理 100 条，并发 4，间隔 3000ms，输出 ./videos
[1/100] OK   7567562617562002868
[2/100] OK   7617009261990681984
[3/100] OK   7611446498963244495
...
完成 99 / 100，报告: videos\_download-report.json
```

> 差的 1 条是**长文帖**（`aweme_type=163`，只有背景音乐、没有视频），下不到属正常现象。

### 步骤 3 · 批量转写

```bash
$ python scripts/batch_transcribe.py ./videos small
```

```text
CUDA DLL 路径: 27 个
视频 99 个，待转写 99 个
模型 small 就绪 device=cuda compute=float16 (3.8s)
[1/99] 001-7567562617562002868-...mp4 时长180s 段42 耗时12.3s 14.6x
[2/99] 002-7617009261990681984-...mp4 时长212s 段51 耗时14.5s 14.6x
...

完成 99 个, 音频 158.4 分钟, 耗时 10.8 分钟 (14.7x 实时)
```

每个视频产出一个同名 `.txt`，带时间轴与低置信度标记：

```text
[0.0-3.2] 大家好 今天是11月2号
[3.2-8.7] 我们来讲一下弱转强怎么做
[8.7-14.1] 前一天的烂板换手率达到百分之六十 ★复核
```

### 步骤 4 · 合成时间线语料

```bash
$ node scripts/build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
```

```text
语料已生成: ./_corpus.md
  条目 100（有转写 99 / 无转写 1）
  正文约 49 千字
```

### 最终得到

```text
videos/
├── 001-7567562617562002868-2025年11月2日 弱转强怎么做.mp4    13.9 MB
├── 001-7567562617562002868-2025年11月2日 弱转强怎么做.txt
├── 002-7617009261990681984-讲解扶老太太下楼梯战法.mp4       22.6 MB
├── ...
└── _download-report.json

works.json     100 条作品元数据（发布时间/点赞/评论/收藏/分享/封面/直链）
_corpus.md     按时间线排序的完整语料（约 49 千字，可直接读或喂给模型）
```

---

## 环境要求

- **Node.js >= 20**（用到内置 fetch、WebSocket）
- **Python >= 3.10** + faster-whisper（仅转写需要）：
  ~~~bash
  pip install faster-whisper av
  # 想用 GPU 再装：
  pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
  ~~~

---

## 一、采集作品列表

~~~bash
node scripts/browser-collect.mjs --sec <sec_uid|主页链接|抖音号> [--limit 100] [--out ./works.json]
~~~

三种入参都支持：

- 主页链接 ~~~https://www.douyin.com/user/MS4wLjABAAAA...~~~
- 裸 sec_uid（~~~MS4wLj~~~ 开头）
- **抖音号**（主页上那串数字，如 ~~~203775400~~~）

### 必须先完全退出浏览器

**关掉窗口不够。** 夸克、Edge 等浏览器都有后台常驻进程，会锁住 profile 与 Cookie 库。
请从**任务栏托盘右键 → 退出**，或任务管理器结束进程。

脚本会自动完成：

~~~text
检测浏览器退出 → 带远程调试启动（真实 profile）→ 打开博主主页
→ 滚轮翻页 → 捕获作品列表接口响应 → 写 works.json
→ 关闭调试实例 → 重新正常启动浏览器还给你
~~~

采集 100 条约需 1~2 分钟。

### 为什么不用官方接口直接请求

因为**做不到**。实测：

~~~text
/aweme/v1/web/user/profile/other/   → HTTP 200  ✅ 资料端点正常
/aweme/v1/web/aweme/post/           → HTTP 403  ❌ ArgusSecurityPlugin
~~~

同一套 Cookie、请求头、签名，**只有端点不同** → 是签名算法过时，不是 Cookie 问题。

进一步定位：把 ~~~uifid~~~ 加进 query 后，报错从 ~~~Uifid Not Found~~~ 变成
~~~Signature Not Found~~~ —— 说明该端点要求一个 **uifid 绑定的新签名**，
公开的 a_bogus 算法产不出来。

**所以只能让浏览器自己发请求。** 这也是本工具选择 CDP 的原因。

### 换浏览器

默认走夸克。用环境变量切换：

~~~bash
COLLECT_BROWSER="C:\Program Files\Google\Chrome\Application\chrome.exe" \
COLLECT_USER_DATA="$LOCALAPPDATA\Google\Chrome\User Data" \
node scripts/browser-collect.mjs --sec <...>
~~~

---

## 二、下载无水印视频

两条路径，按场景选：

| 路径 | 命令 | 直链时效 | 速度 | 风控风险 |
|---|---|---|---|---|
| **A 快照直链** | ~~~--from-snapshot~~~ | 数小时后失效 | 快 | 无 |
| **B 外部解析器** | 设 ~~~PARSER_CORE_DIR~~~ | 现取现用，不过期 | 慢 | 有 |

**列表刚采集完 → 用 A**（最快，完全不走抖音页面）
**列表放久了 / 快照 403 → 用 B**（每次拿新鲜直链）

~~~bash
# A
node scripts/download.mjs --list ./works.json --out ./videos --from-snapshot --concurrency 4

# B —— 先自己构建一份解析器，再指向它（三步）
git clone --depth 1 https://github.com/wu529778790/parse.shenzjd.com.git upstream
node scripts/build-resolver.mjs --source upstream --out ./resolver
PARSER_CORE_DIR=./resolver node scripts/download.mjs \
    --list ./works.json --out ./videos --concurrency 1 --delay 3000
~~~

> **注意**：上游仓库里**没有**现成的解析器目录，直接 clone 只能拿到 src/。
> build-resolver.mjs 会把所需的模块闭包抽出来并生成入口，产出一个零依赖、
> 可独立运行的解析器。**该脚本是原创代码，不包含任何上游源码**，
> 它只做「读取你本地的仓库 → 复制 → 重写 import」。

### 注意限流

**路径 B 每个视频都要 fetch 一次抖音页面**，打太猛会被限流：

~~~text
并发 3 打 100 个 → 约 41 个之后全部失败：网络出口被限流
~~~

正确处置：

1. **降并发 + 加间隔**：~~~--concurrency 1 --delay 3000~~~
2. **等 1~2 小时**，出口 IP 的限流会自行恢复
3. 被限期间改用**路径 A（快照）** 先把活干完

> 实测：限流期间带 Cookie 重试也无效（是 **IP 级**限流），
> 但 1.5 小时后同样的做法 10/10 通过。**这不是「方法不可行」，是打太猛了。**

---

## 三、批量转写

~~~bash
python scripts/batch_transcribe.py <素材目录> [small|medium] [限制条数]
~~~

- 模型**只加载一次**（逐个调用 CLI 会重复加载，100 个文件白白浪费）
- 已转写的文件自动跳过，可中断续跑
- 输出带时间轴：~~~[起-止] 文本~~~，低置信度段落标 ~~~★复核~~~

**实测性能（RTX 2060 / Ryzen 7 3700X）**：

| 设备 | 速度 | 153 分钟音频耗时 |
|---|---|---|
| GPU float16 | **14.7× 实时** | ~10 分钟 |
| CPU int8 | 2.5× 实时 | ~63 分钟 |

**差 6 倍，值得装上 CUDA 运行库。**

### 两个必踩的环境坑（脚本已内置处理）

1. **NO_PROXY 含 ~~~[::1]~~~ 会让 HuggingFace 客户端直接崩溃**
   ~~~Invalid port: ':1]'~~~ —— 和 GPU/CPU 毫无关系，是代理库解析 no_proxy 失败。
2. **CUDA 库装到了 user site**，而多数脚本只查系统 site-packages。
   本脚本会同时检查两处并加上 DLL 搜索路径；另外 **模型加载成功 ≠ 推理可用**
   （CUDA 模型能秒加载，一推理才报缺 cublas），脚本会自动回退 CPU。

---

## 四、合成时间线语料

~~~bash
node scripts/build_corpus.mjs --works ./works.json --material ./videos --out ./_corpus.md
~~~

把作品元数据（发布时间/点赞/评论/收藏/分享）与转写文本**按发布时间升序**合成一份文档，
并去掉时间轴前缀以便阅读。

语料有几十万字时，**不要硬塞进单个上下文** —— 建议按条目切片，用多个并行子代理
各读一片做结构化提取，再汇总成体系化文档。

---

## 每个环节都能单独使用

四段流水线是**文件解耦**的 —— 上一段的产物就是下一段的输入，脚本之间没有代码依赖
（连语言都不同：3 个 Node + 1 个 Python）。**任何一段都可以单独拿出来用。**

| 只想做 | 用哪个 | 输入 | 输出 |
|---|---|---|---|
| 采集某博主的作品列表 | `browser-collect.mjs` | sec_uid / 主页链接 / 抖音号 | `works.json` |
| 批量下载一批视频 | `download.mjs` | 任意含媒体信息的 JSON | `*.mp4` |
| 把一批视频转成文字 | `batch_transcribe.py` | **任意目录**的视频 | `*.txt` |
| 把元数据 + 文本排成时间线 | `build_corpus.mjs` | JSON + txt 目录 | `_corpus.md` |

### 只用采集器

`browser-collect.mjs` 本身就是一个完整的抖音博主作品采集器，输出标准 JSON，
可以直接接进你自己的分析流程：

```bash
node scripts/browser-collect.mjs --sec <抖音号> --limit 50 --out ./raw.json
```

**先探路** —— 只看数据不下载：

```bash
node -e "const w=require('./raw.json'); console.log(w.nickname, w.total, '条'); console.log('平均点赞', Math.round(w.videos.reduce((a,v)=>a+v.digg_count,0)/w.total));"
```

### 只用转写器（跟抖音无关）

`batch_transcribe.py` **不关心视频从哪来**。任何目录的中文口播视频都能转：

```bash
python scripts/batch_transcribe.py "D:\我的视频" medium
python scripts/batch_transcribe.py "D:\我的视频" small 10   # 只转前 10 个试水
```

跳过已有转写，支持中断续跑。

### 只解析不下载

加 `--resolve-only` 可以把直链导出成 JSON 自己用：

```bash
node scripts/download.mjs --list ./works.json --out ./out --resolve-only
```

### 下载器吃任意清单

`download.mjs` 接受**裸数组**或 `{ videos: [...] }`，字段可以裁剪 ——
只要每条有 `aweme_id`（或用 `share_url`），离线下载时再带 `play_url_snapshot`：

```json
[
  { "aweme_id": "7567562617562002868", "desc": "第一条", "play_url_snapshot": "https://..." },
  { "aweme_id": "7617009261990681984", "desc": "第二条", "share_url": "https://www.douyin.com/video/7617009261990681984" }
]
```

```bash
node scripts/download.mjs --list my-list.json --out ./out --from-snapshot
```

### 只用语料合成

`build_corpus.mjs` 只认两样东西：一份 JSON（取 `create_time` / `desc` / 互动数）
和一个装着 `.txt` 的目录（文件名需含 `aweme_id`）。你自己的数据也能排成时间线：

```bash
node scripts/build_corpus.mjs --works ./my-data.json --material ./my-texts --out ./timeline.md
```

---

## 安装为 Agent Skill

本仓库遵循通用 Agent Skill 约定：**一个目录 + 一份带 YAML frontmatter 的 `SKILL.md`**。
仓库根目录就有 `SKILL.md`，所以**整个仓库本身就是一个技能**，克隆到对应目录即可。

### DSH（DeepSeek Harness）

DSH 按以下顺序扫描技能目录（项目级优先于用户级）：

| 作用域 | 路径 |
|---|---|
| 项目级 | `<项目根>/.dsh/skills/` |
| 项目级 | `<项目根>/.agents/skills/` |
| 用户级 | `~/.dsh/skills/` |
| 用户级 | `~/.agents/skills/`（可用环境变量 `DSH_AGENTS_HOME` 改根目录） |

```bash
# 用户级安装（推荐）
git clone https://github.com/Devincool/shortvideos-collector.git ~/.agents/skills/shortvideos-collector

# Windows PowerShell
git clone https://github.com/Devincool/shortvideos-collector.git "$env:USERPROFILE\.agents\skills\shortvideos-collector"
```

装好后**新开一个会话**即可生效，直接对 Agent 说「采集抖音号 xxx 的作品」即可触发。

### Claude Code

技能目录：用户级 `~/.claude/skills/`，项目级 `<项目>/.claude/skills/`

```bash
git clone https://github.com/Devincool/shortvideos-collector.git ~/.claude/skills/shortvideos-collector
```

### Codex

技能目录：`$CODEX_HOME/skills/`（默认 `~/.codex/skills/`）

```bash
git clone https://github.com/Devincool/shortvideos-collector.git ~/.codex/skills/shortvideos-collector
```

也可以用它自带的安装器：

```bash
python ~/.codex/skills/.system/skill-installer/install-skill-from-github.py \
    --repo Devincool/shortvideos-collector
```

### 通用：放进任意 Agent 的技能目录

只要是认「目录 + SKILL.md」约定的工具，把仓库放进它的技能目录就行，
不需要改任何东西 —— `SKILL.md` 的 frontmatter 已按规范写好
（`name` + 英文 `description`，便于模型自动匹配）。

### 免安装：当普通脚本用

**不装成 skill 也完全可用。** 四个脚本都是标准 CLI，任何终端里直接跑：

```bash
git clone https://github.com/Devincool/shortvideos-collector.git
cd shortvideos-collector
node scripts/browser-collect.mjs --sec <抖音号> --limit 100 --out ./works.json
```

---

## 装好之后怎么用

技能加载后，直接用自然语言说需求即可，例如：

| 你说 | Agent 会做 |
|---|---|
| 「采集抖音号 203775400 的近 100 条作品」 | 跑 `browser-collect.mjs` |
| 「把这些视频下载到 D:\素材」 | 跑 `download.mjs` |
| 「把视频里的文字提取出来」 | 跑 `batch_transcribe.py` |
| 「按时间线把内容整理成体系」 | 跑 `build_corpus.mjs` 并做结构化归纳 |

> 采集环节需要**先完全退出浏览器**（script 会自己等你退出，然后带调试端口重启它、
> 采完再帮你恢复）。这是唯一需要人工配合的一步。

---

## 目录结构

~~~text
shortvideos-collector/
├── SKILL.md               Agent 使用说明（技能入口）
├── README.md              中文文档（本文件）
├── README.en.md           English docs
├── LICENSE                MIT
└── scripts/
    ├── browser-collect.mjs   CDP 作品采集
    ├── download.mjs          批量下载（快照 / 外部解析器）
    ├── build-resolver.mjs    从上游克隆构建解析器（原创抽取脚本）
    ├── batch_transcribe.py   批量转写
    └── build_corpus.mjs      语料合成
~~~

---

## 常见问题

**Q：为什么必须先退出浏览器？**
A：浏览器运行时对 profile 和 Cookie 库是**硬独占锁**，其他进程读不到。这是操作系统的文件锁，
不是权限问题 —— 共享读、备份模式复制都不行。

**Q：转写准确率如何？**
A：中文口播内容整体可用，但**金融/专业术语的同音字错误较多**
（实测：「竞价」→「进价」、「妖股」→「腰骨」、「卡异动」→「卡一栋」）。
重要内容建议人工扫一遍，或换 ~~~medium~~~ 模型。脚本会对低置信度段落标 ~~~★复核~~~。

**Q：能采别人的号吗？**
A：能，采的是公开数据。但请遵守平台条款与著作权法，**不要二次分发他人作品**。

**Q：支持别的平台吗？**
A：目前只做了抖音。架构上不排除扩展，但各平台的签名与风控机制完全不同。

---

## 许可

本仓库为**原创代码**，按 **MIT** 发布，**不包含任何第三方代码**。

下载功能可选接入外部解析器（parse.shenzjd.com）。该上游仓库没有 LICENSE 文件，
其使用条件请自行确认——本仓库只提供接入机制，不分发其代码。

---

## 免责声明

- 本工具仅采集抖音**公开**数据，仅供技术学习与内部分析。
- 采集内容的**版权归原创作者所有**，请勿二次分发或用于商业用途。
- 请遵守抖音平台服务条款及相关法律法规。使用本工具产生的一切后果由使用者自行承担。
