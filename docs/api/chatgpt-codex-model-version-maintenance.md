# ChatGPT 模型同步兼容版本

Zenme 使用 ChatGPT 账号的 Codex 模型发现与 Responses 接口。兼容声明在 `lib/ai/openai-oauth.ts` 中维护；模型列表和上下文窗口始终以账号接口返回为准，不由公开 API 模型目录硬编码补全。

## 当前版本与验证

- 模型发现 `client_version`：`0.153.4`。
- 请求身份 `User-Agent`：`codex_exec/0.153.4`。
- 来源：本机安装的 Codex CLI `0.153.4`，并经以下远程接口验证；应用运行时不依赖本机安装 Codex。
- 2026-09-05，使用相同已登录账号分别请求模型接口：`0.146.0` 返回 HTTP 200，但没有 Astra；`0.153.4` 返回 HTTP 200，包含可见的 `gpt-6-astra`，其 `minimal_client_version` 为 `0.153.0`。
- 同一账号返回 Astra 的 `context_window=272000`。这不是所有账号或公开 API 的固定值；不要用公开 API 的 1,050,000 覆盖同步结果。
- Astra 的标准 Responses 和 Responses Lite 最小文本请求均返回 HTTP 200，并收到 `response.output_text.delta` 与 `response.completed`。验证仅发送固定测试短句，不发送项目内容。

## Astra 请求与能力

- ChatGPT Astra 文本调用复用现有 Responses Lite、原生工具和网页上下文预取路径；四档推理强度和快速模式映射沿用现有设置。
- Astra 不支持 `none` 推理强度；旧节点关闭思考时使用 `low`，并不请求思考摘要。GPT-5.6 原有兼容行为保留。
- Astra 加入 ChatGPT 托管 `image_generation` 候选集。已同步且启用的 Astra 可用于文本和图片模型选择；已有保存记录补充图片模态，不创建不存在的服务商或模型，不改变最近选用模型。
- 工具调用使用 Responses。此次不扩展自定义 Chat Completions 服务商的 Astra 工具适配。
- 图片生成/编辑及快速模式未做真实远程调用验证；图片能力依据官方文档接入既有适配器，快速参数由回归测试覆盖。

## 后续维护

本次验证记录（2026-09-05）：

- 模型同步、设置兼容及文本请求回归：48 项通过；正在运行的开发应用重新同步成功，文本和图片模型接口均返回 Astra。
- `npm run check`：lint 通过；Vitest 1543 项通过、1 项跳过、1 项失败。失败位于 `workspace-tools.test.ts` 的 Corepack pnpm 桥接用例，预期模拟程序输出却实际得到本机 pnpm `11.16.0`；单独重跑仍失败。后续被短路的桌面 Node 测试单独运行，25 项通过。
- TypeScript 检查未通过；以仅回退本次六个 TypeScript 文件的内存编译基线对照，改动前后均为 91 项错误，无新增错误。
- 未运行生产构建、平台打包或打包冒烟验证；不据此声明可发布。

1. 核对官方目标模型 ID 与参数限制，取得有来源的候选 Codex 版本，不猜测版本号。
2. 用相同账号比较旧、新版本的模型发现结果，记录状态、可见性、最低客户端版本和上下文窗口；不得记录令牌或完整请求头。
3. 验证所用 Responses 请求形状能完成最小文本请求，再更新版本常量与相应测试。
4. 执行模型同步、设置兼容和请求路由测试及 `npm run check`。在设置 → 模型配置 → ChatGPT 中重新同步模型。

官方依据：[GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[迁移与参数说明](https://developers.openai.com/api/docs/guides/latest-model)。公开 API 文档不保证所有 ChatGPT 账号具有同样权限；最终以账号同步及实际请求结果为准。
