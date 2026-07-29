# Hesi 代码产权与侵权风险审计报告

- **审计日期**：2026-07-29
- **审计范围**：全仓库 1826 个已跟踪文件（源码约 588 个：415 `.js` + 117 `.mjs` + 51 `.py` + 5 `.ts`）
- **审计目标**：评估抄袭/侵权风险，建立商业化所需的「自主创作」证据链
- **交付层级**：全量审计 + 产权文件（LICENSE/NOTICE/溯源文档）+ 逐文件版权头

## 一、审计方法与局限（如实告知）

| 方法 | 覆盖 |
|------|------|
| 依赖许可证字段读取（node_modules） | 24 个 npm 依赖逐一核实 |
| vendor/connectors 逐包审查（子代理只读扫描） | 62 个连接器全部 |
| 源码第三方标记扫描（license 头/项目名/依赖外 require） | 全量 |
| git 作者/提交证据 | 248 提交 |

**局限**：无法在离线环境将每段代码与全互联网逐一比对以「证明零抄袭」。AI 辅助代码最大的真实风险
是「训练数据复述」（AI 无意吐出某段受版权保护的原文），此类靠静态扫描不可全验。
本审计通过「可检测风险清零 + 完整人类创作证据链」使法律层面站得住，而非声称已穷尽比对。

## 二、关键结论

| 维度 | 结论 | 风险等级 |
|------|------|---------|
| 原创代码权属 | 全部提交作者为 qiuqiukof-oss 本人身份，人类主导明确 | ✅ 低 |
| 依赖许可证（23/24） | 均为 MIT/BSD/ISC/Apache，可商用 | ✅ 低 |
| **依赖许可证（edge-tts-universal）** | **AGPL-3.0，运行时硬依赖** | 🔴 高（阻断项） |
| vendor 连接器（51/62） | 纯配置型原创封装，无第三方代码 | ✅ 低 |
| vendor 连接器（netease-mail） | 内嵌 MIT 库源码但缺 LICENSE | 🟡 中 |
| vendor 连接器（awesun） | 含 Oray「保留所有权利」文件，疑似未授权 | 🔴 高 |
| vendor 连接器（feishu/tencentads/dingtalk） | 官方样例/SDK，需补署名或确认许可 | 🟡 中 |
| 源码外来标记 | 原创源码未扫到外来 license 头 | ✅ 低 |

## 三、已采取的动作（本轮交付）

1. **LICENSE**：版权署名由 `Hesi Contributors` 改为 **qiuqiukof-oss**（MIT 不变）。
2. **THIRD-PARTY-LICENSES.md（新建）**：登记全部依赖许可证 + vendor 第三方代码 + AGPL 阻断项标注。
3. **DEVELOPMENT-PROVENANCE.md（新建）**：权属主张、AI 辅助与著作权法律依据、git 证据、维护指引。
4. **逐文件版权头**：为约 588 个原创源文件（`.js/.mjs/.ts/.py/.sh/.css/.html`）幂等加入
   `Copyright (c) 2026 qiuqiukof-oss / MIT` 标准头；保留 shebang；
   **排除**：node_modules、生成产物（bundle.js）、data、.workbuddy，以及下列第三方派生连接器
   （保留其自身版权声明，不冒充原创）：`awesun`、`netease-mail`、`tencentads`、`feishu`、`dingtalk`。

## 四、残留风险与处理建议（需人工/法务决策，未自动改动）

| 项 | 风险 | 建议 |
|----|------|------|
| **edge-tts-universal (AGPL-3.0)** | 闭源商业化阻断 | 替换/隔离/移除该依赖，TTS 改走浏览器 Web Speech 或自有 MIT 方案 |
| **awesun/coordinates.py (Oray 专有)** | 疑似未授权拷贝 | 获得 Oray 授权，或自研替换该文件 |
| netease-mail 内嵌库缺 LICENSE | MIT 署名缺失 | 在 `vendor/connectors/netease-mail/NOTICE` 补齐各库 MIT 声明 |
| feishu 样例缺完整 MIT 文本 | MIT 署名缺失 | 补齐 Lark MIT 许可全文 |
| tencentads 依赖外部 tencentads-cli | 许可待确认 | 确认该包许可证与商用合规性，或改为可选外部依赖 |

## 五、商业化前清单

- [ ] 处置 AGPL 依赖（edge-tts-universal）—— 最关键
- [ ] 处置 awesun Oray 文件（获权/替换）
- [ ] 补齐 netease-mail / feishu 的 MIT 署名文件
- [ ] 确认 tencentads-cli 许可证
- [ ] 由知识产权律师结合目标市场做最终确权
- [ ] 保留开发对话与评审记录作为人类主导旁证

> 注：除上列第三方事项外，Hesi 原创代码已具备清晰的 qiuqiukof-oss 权属与 MIT 许可，
> 可支撑「自主创作」主张。
