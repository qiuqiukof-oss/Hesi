# 第三方许可与版权声明（THIRD-PARTY LICENSES）

本文件列出 Hesi 产品中随附的第三方组件及其许可证，用于商业化分发时的合规署名。
Hesi 本体（原创代码）采用 MIT 许可证，版权归 **qiuqiukof-oss** 所有，见 `LICENSE`。

> 说明：npm 运行时依赖的许可证文本存放于各包的 `node_modules/<pkg>/LICENSE`；
> 本文件为索引与重点标注，分发打包（如 SEA 单文件）时应将下列 MIT/BSD/Apache 组件的
> 版权与许可文本一并纳入。

## 一、npm 依赖许可证清单

| 组件 | 版本范围 | 许可证 | 类型 | 商用 |
|------|----------|--------|------|------|
| @modelcontextprotocol/sdk | ^1.29.0 | MIT | 运行时 | ✅ |
| @xterm/xterm | ^6.0.0 | MIT | 运行时 | ✅ |
| @xterm/addon-fit | ^0.11.0 | MIT | 运行时 | ✅ |
| @xterm/addon-search | ^0.16.0 | MIT | 运行时 | ✅ |
| @xterm/addon-web-links | ^0.12.0 | MIT | 运行时 | ✅ |
| @xterm/addon-webgl | ^0.19.0 | MIT | 运行时 | ✅ |
| compression | ^1.8.1 | MIT | 运行时 | ✅ |
| cors | ^2.8.5 | MIT | 运行时 | ✅ |
| dotenv | ^16.6.1 | BSD-2-Clause | 运行时 | ✅ |
| express | ^4.22.2 | MIT | 运行时 | ✅ |
| helmet | ^8.3.0 | MIT | 运行时 | ✅ |
| multer | ^2.2.0 | MIT | 运行时 | ✅ |
| uuid | ^14.0.1 | MIT | 运行时 | ✅ |
| ws | ^8.18.0 | MIT | 运行时 | ✅ |
| **edge-tts-universal** | **^1.4.0** | **AGPL-3.0** | **运行时** | **⚠️ 阻断项，见下** |
| @open-wc/testing | ^5.0.0 | MIT | 开发 | ✅ |
| @web/test-runner | ^1.0.0 | MIT | 开发 | ✅ |
| esbuild | ^0.28.1 | MIT | 开发 | ✅ |
| eslint | ^10.7.0 | MIT | 开发 | ✅ |
| globals | ^17.7.0 | MIT | 开发 | ✅ |
| husky | ^9.1.0 | MIT | 开发 | ✅ |
| lint-staged | ^15.2.0 | MIT | 开发 | ✅ |
| prettier | ^3.9.5 | MIT | 开发 | ✅ |
| strip-ansi | ^7.2.0 | MIT | 开发 | ✅ |

### ⚠️ AGPL-3.0 阻断项：`edge-tts-universal`

- 该组件为 **AGPL-3.0（强 copyleft）**，且在 `lib/tts/edge-tts.js` 中以 `require('edge-tts-universal')`
  作为运行时硬依赖被使用。
- AGPL 的「网络条款」：若 Hesi 以网络服务（含 SaaS、内部署对外提供）形式使用本组件，
  **整个派生作品必须以 AGPL-3.0 开源**，与闭源商业化目标冲突。
- **处置建议（需人工决策，未在本轮自动修改）**：
  1. 移除该依赖，TTS 仅保留浏览器端 Web Speech 兜底（已内置，无第三方依赖）；或
  2. 改用许可证友好的 TTS 方案（如直接调用微软在线 TTS 端点、或采用其他 MIT/Apache 的 TTS 库）；或
  3. 将其隔离为可选项、默认不启用，并在文档中明确 AGPL 义务。
- 在处置前，Hesi 整体许可证状态为「原创代码 MIT + 一处 AGPL 依赖」，不可直接宣称全产品 MIT。

## 二、vendor/connectors 中的第三方代码

`vendor/connectors/` 下 62 个 SaaS 连接器，绝大多数为指向官方 API/MCP 的原创薄封装或纯配置。
下列为含第三方代码或版权的连接器，需按对应许可证署名/获权：

| 连接器 | 第三方内容 | 许可证 | 状态 |
|--------|-----------|--------|------|
| netease-mail | 内嵌 nodemailer / mailparser / he / iconv-lite / punycode / encoding 源码（`.bundle.js`） | 均为 MIT | ⚠️ 缺 LICENSE/NOTICE，需补齐署名 |
| dingtalk | 钉钉官方 Python 样例（`skills/`） | Apache-2.0 | ✅ 已正确附带 LICENSE+NOTICE |
| feishu | 飞书/Lark 官方 Python 样例（`skills/`） | MIT（SPDX 头） | ⚠️ 缺完整 MIT 文本，需补齐 |
| awesun | `coordinates.py` 含 Oray Inc.「保留所有权利」声明 | 专有（Oray） | ⛔ 疑似未授权拷贝，需获权或替换 |
| tencentads | 运行时依赖外部 `tencentads-cli`（腾讯官方广告 SDK/CLI，未在 deps 声明） | 待确认 | ⚠️ 需确认其许可证与商用合规性 |

### netease-mail 内嵌库许可证（均为 MIT，需随分发署名）
- **nodemailer** — MIT © 2011-2026 Andris Reinman
- **mailparser** — MIT © 2011-2024 Andris Reinman
- **he** — MIT © 2012-2016 Mathias Bynens
- **iconv-lite** — MIT © 2011 Alexander Shtuchkin
- **punycode** — MIT © 2012-2013 BestieJS (Mathias Bynens)
- **encoding** — MIT © 2010–2016 Ebrahim Byagowi

> 上述库均为 MIT，商业化分发时只需保留其版权与许可声明（建议在
> `vendor/connectors/netease-mail/NOTICE` 中补齐），不强制开源 Hesi。

## 三、AI 辅助开发的声明

Hesi 由 **qiuqiukof-oss（人类）** 提出架构与功能构想并主导评审迭代，AI 编程助手作为受人类
指令驱动的实现工具参与代码生成与修改。原创代码的著作权归属于人类作者（详见 `DEVELOPMENT-PROVENANCE.md`）。
第三方组件权属见上表，不受影响。
