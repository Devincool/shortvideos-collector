# shortvideos-collector

[English](./README.en.md) | **中文**

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

# B —— 先自己获取一份解析器，再指向它
PARSER_CORE_DIR=/path/to/parser-core node scripts/download.mjs \
    --list ./works.json --out ./videos --concurrency 1 --delay 3000
~~~

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

## 目录结构

~~~text
shortvideos-collector/
├── SKILL.md               Agent 使用说明（技能入口）
├── README.md              中文文档（本文件）
├── README.en.md           English docs
├── THIRD-PARTY.md         第三方组件与许可声明（重要，请读）
├── LICENSE                MIT
└── scripts/
    ├── browser-collect.mjs   CDP 作品采集
    ├── download.mjs          批量下载（快照 / 外部解析器）
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

## 第三方与许可

本仓库**全部为原创代码**，按 **MIT** 发布。

设计上参考了两个开源项目，但**未包含它们的任何代码**（详见 [THIRD-PARTY.md](./THIRD-PARTY.md)）：

- [ShilongLee/Crawler](https://github.com/ShilongLee/Crawler) —— 非商业使用许可，仅参考接口设计
- [parse.shenzjd.com](https://github.com/wu529778790/parse.shenzjd.com) —— **无 LICENSE 文件**，可作为可选外部解析器

> ⚠️ 如果你自行引入上述项目或其衍生物（后者内部含 Apache-2.0 代码），
> **署名与许可副本是强制义务**，且非商业许可的部分不得商用。

---

## 免责声明

- 本工具仅采集抖音**公开**数据，仅供技术学习与内部分析。
- 采集内容的**版权归原创作者所有**，请勿二次分发或用于商业用途。
- 请遵守抖音平台服务条款及相关法律法规。使用本工具产生的一切后果由使用者自行承担。
