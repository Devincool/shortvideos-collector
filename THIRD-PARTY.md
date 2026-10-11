# 第三方组件声明 / Third-Party Notices

> **适用范围**：仓库根目录的 LICENSE（MIT）**仅适用于本仓库的原创代码**——
> scripts/ 下的脚本与各文档文件。它**不适用于**你另行安装以扩展本工具的第三方组件。

本仓库**不包含任何第三方源代码**，全部为原创实现，按 MIT 许可发布。

This repository **contains no third-party source code**. Everything is original
work, released under the MIT license.

但本工具的设计参考了以下开源项目，其中一部分可作为**可选的外部依赖**由你自行安装。
以下声明既是对这些项目的致谢，也是对你（使用者）的义务提示。

However, the design references the projects below. Some can be installed
separately as **optional external dependencies**. This notice is both an
acknowledgement and a compliance reminder for you as a user.

---

## 1. ShilongLee/Crawler

- 项目：https://github.com/ShilongLee/Crawler
- 许可：**非商业使用许可证 1.0**（版权所有 2024，lishilong0101@gmail.com）
- 与本仓库的关系：**仅参考了其接口设计思路**（游标翻页、设备指纹参数的取用方式）。
  本仓库**未包含**其源代码。

### 如果你打算自行取用它的代码

该许可的授权范围是「使用、复制、修改、合并」，**但仅限非商业目的**，并且是
**非独占、不可转让**的。使用它必须同时满足：

1. **在软件及其副本的所有合理显著位置，保留版权声明与本许可声明**；
2. **不得用于任何商业目的**（包括销售、营利、商业竞争）；
3. 未经版权所有者书面同意，不得商用。

该许可**没有授予你转授权（sublicense）的权利** —— 也就是说，
**你不能把它的代码以 MIT 或任何其他许可重新发布**。

---

## 2. parse.shenzjd.com

- 项目：https://github.com/wu529778790/parse.shenzjd.com
- 许可：**该仓库没有 LICENSE 文件**。README 中写有 "MIT License"，
  但 package.json 里也没有 license 字段。
- 与本仓库的关系：本工具的下载功能支持把它作为**可选外部依赖**使用
  （通过 PARSER_CORE_DIR 环境变量指向你自己克隆的副本）。
  本仓库**未包含**其任何代码。

### 重要提示

按著作权法，**没有许可证文件的仓库默认「保留所有权利」**。
README 里的一句 "MIT License" 表达了作者意向，但不构成正式的许可授予，
法律效力弱得多。**在把它用于任何需要授权的场景前，建议直接联系作者取得明确许可。**

---

## 3. 652036/video-unwatermark（经由上游间接涉及）

- 项目：https://github.com/652036/video-unwatermark
- 许可：**Apache-2.0**
- 与本仓库的关系：**无直接关系**。该项目的代码出现在 **parse.shenzjd.com** 内部
  （其 douyinFallback.js 明确标注「移植自 video-unwatermark webparser.py」）。
  本仓库不包含该代码。

如果你通过 PARSER_CORE_DIR 使用了那一份解析器，请注意其内部含有
Apache-2.0 代码，届时**你**需要履行 Apache-2.0 的义务：
保留版权与许可声明、附上许可副本、**并声明你对文件做过哪些修改**。

---

## 4. 其他运行时依赖（不随本仓库分发）

| 组件 | 用途 | 许可 |
|---|---|---|
| faster-whisper | 本地语音转写 | MIT |
| Whisper 模型权重 | 转写模型 | MIT |
| FFmpeg | 音视频处理（可选） | LGPL/GPL（取决于构建） |
| Quark / Chromium 系浏览器 | CDP 采集载体 | 各自许可 |

这些组件由你自行安装，各自遵循其原始许可。

---

## 小结 / Summary

| 问题 | 回答 |
|---|---|
| 本仓库是否包含第三方代码？ | **否**，全部原创 |
| 是否可以按 MIT 发布本仓库？ | **可以** |
| 使用时是否必须署名第三方？ | 本仓库不含其代码，故无此义务；但若你自行引入，则必须按各自许可署名 |
| 商业使用本仓库是否受限？ | 原创部分为 MIT，**不限制商用**；但若你自行引入非商业许可的组件，该部分不得商用 |
