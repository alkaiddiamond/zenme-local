# ChatGPT Codex 模型版本维护档案

## 1. 文档目的

本文记录 Zenme Local 通过 ChatGPT OAuth 调用 Codex 模型时，`client_version` 的来源、语义、历史探测结果和后续维护流程。

这份文档用于避免将以下三类版本混为一谈：

- OpenAI 公开发布的 Codex CLI 包版本；
- Zenme 请求 ChatGPT Codex 后端时声明的客户端兼容版本；
- 服务端为单个模型返回的 `minimal_client_version`。

本文不记录 access token、refresh token、API Key 或任何其他敏感信息。

## 2. 当前实现

Zenme Local 当前通过以下路径同步 ChatGPT 账号可用模型：

```text
GET https://chatgpt.com/backend-api/codex/models?client_version={client_version}
```

请求使用 ChatGPT OAuth 凭据，并声明 Codex CLI 协议身份：

- `originator: codex_exec`
- `User-Agent: codex_exec/{runtime_version}`

当前代码中的模型列表兼容版本为 `0.146.0`，请求运行时身份为 `0.146.0-alpha.3.1`，均位于 `lib/ai/openai-oauth.ts`。这些值用于服务端协议兼容，不代表 Zenme 内嵌或安装了 Codex CLI。

## 3. 版本语义

### 3.1 公开 Codex CLI 版本

公开版本是 OpenAI 在 npm 等正式渠道发布的 `@openai/codex` 版本。它用于说明真实可安装的软件版本。

截至 2026-07-14，官方 npm registry 的结果为：

- stable：`0.144.4`
- alpha：`0.145.0-alpha.10`

因此，`0.150.0` 在该日期不是公开发布的 npm Codex CLI 版本。

### 3.2 客户端兼容声明版本

`client_version` 是发送给 ChatGPT Codex 模型接口的兼容性声明。服务端会用它与模型的最低客户端要求比较。

Zenme 当前使用的 `0.146.0` 与 2026-07-29 官方公开 Codex CLI stable 版本保持一致，并高于 GPT-5.6 系列返回的最低客户端版本 `0.144.0`。

### 3.3 模型最低客户端版本

接口可为每个模型返回 `minimal_client_version`。只有当请求声明版本满足该门槛，且账号套餐、灰度范围及模型可见性同时满足要求时，模型才可能出现在返回结果中。

因此：

```text
模型可见 = 客户端版本满足门槛 + 账号具备权限 + 灰度命中 + 模型未被隐藏
```

单纯提高 `client_version` 不能绕过账号权限或灰度限制。

## 4. 历史来源追溯

### 4.1 2026-07-10 首次探测

当时 Zenme 使用 `0.142.0`，模型列表没有 GPT-5.6 系列。维护过程使用本机已有的 ChatGPT OAuth 会话，直接请求远程 ChatGPT Codex 模型接口，并依次比较以下声明值：

- `0.143.0`
- `0.150.0`
- `0.200.0`
- `1.0.0`
- `26.519.81530`

结果显示：

- `0.143.0` 仍返回旧模型集合；
- `0.150.0` 返回 GPT-5.6 Sol、Terra、Luna；
- 返回数据明确标注 GPT-5.6 系列的 `minimal_client_version` 为 `0.144.0`。

当时选择 `0.150.0`，是因为它高于已探测到的兼容门槛且已通过真实接口验证。这个数值属于测试输入，不是从本机 Codex 后端发现的版本号。

该变更随后进入 2026-07-12 的里程碑提交：

```text
aac207e87ace51d892e5852090c0ed15342e9bf0
feat: establish unified local canvas milestone
```

### 4.2 2026-07-14 顺序复测

为降低网络抖动和并发干扰，本次按编号逐个请求，每个请求完成后才继续下一个。

| 声明版本 | HTTP 结果 | 账号可见模型结果 |
| --- | --- | --- |
| `0.91.0` | 200 | 空列表 |
| `0.142.0` | 200 | GPT-5.5、GPT-5.4、GPT-5.4 Mini、GPT-5.3 Codex Spark |
| `0.143.0` | 200 | 与 `0.142.0` 相同 |
| `0.144.0` | 200 | 新增 GPT-5.6 Sol、Terra、Luna |
| `0.144.4` | 200 | 与 `0.144.0` 相同 |
| `0.145.0` | 200 | 与 `0.144.0` 相同 |
| `0.150.0` | 200 | 与 `0.144.0` 相同 |
| `0.160.0` | 200 | 与 `0.144.0` 相同 |
| `0.200.0` | 200 | 与 `0.144.0` 相同 |
| `1.0.0` | 200 | 与 `0.144.0` 相同 |

本次返回的最低版本信息：

| 模型 | `minimal_client_version` |
| --- | --- |
| GPT-5.6 Sol / Terra / Luna | `0.144.0` |
| GPT-5.5 | `0.124.0` |
| GPT-5.4 / GPT-5.4 Mini | `0.98.0` |
| GPT-5.3 Codex Spark | `0.100.0` |
| `codex-auto-review` | `0.98.0`，且 `visibility=hide` |

结论：2026-07-10 至 2026-07-14 之间，当前账号可见模型集合没有变化。`0.150.0` 仍满足现有模型的兼容要求；继续提高声明值没有获得更多账号可见模型。

### 4.3 2026-07-29 版本对齐验证

在同一 ChatGPT 账号可通过官方 Codex 调用 GPT-5.6 Sol、但 Zenme 调用失败的情况下，将 Zenme 的兼容声明从未公开发布的 `0.150.0` 调整为当日官方 stable 版本 `0.146.0`。短请求恢复后，带 13,815 字符画布上下文的请求仍被上游拒绝，因此 GPT-5.6 文本调用同时改用官方 `0.146.0` 的 Responses Lite 请求结构。相同长上下文随后调用成功，确认版本身份与请求协议需要一并对齐。

随后再次出现统一的 `Our servers are currently overloaded` 错误。对本机 `0.146.0-alpha.3.1` 运行时进行本地抓包后确认，当前请求身份已经从旧的 `codex_cli_rs` / `codex-cli` 改为 `codex_exec` / `codex_exec`。Zenme 对齐该身份后，普通文本请求与带网页资料的 GPT-5.6 Sol 请求均恢复成功。

Responses Lite 的 `web.run` 是服务端保留工具，第三方客户端直接声明会收到 schema 校验错误。Zenme 因此不冒充该保留工具：当请求包含 URL 或明确要求当前信息时，先调用同一 OAuth 协议的独立搜索端点获取网页上下文，再将结果作为开发者上下文交给模型生成答案。该路径已用 `https://www.myvix.net/about.html` 做真实回归。

## 5. 当前产品决策

- 使用 `CODEX_CLIENT_VERSION = "0.146.0"`，与当日官方 stable 版本保持一致，并继续满足 GPT-5.6 的最低版本要求。
- 将该常量定义为“已验证的协议兼容声明版本”，不对外描述为 Zenme 使用的真实 Codex CLI 版本。
- 模型列表以远程接口实际返回为准，并继续过滤 `visibility=hide` 的内部模型。
- 不通过任意填写更大的未来版本号来猜测或强制解锁模型。
- 模型同步结果具有账号相关性，维护记录必须注明探测日期和账号权限背景，但不得记录账号令牌。

## 6. 后续维护流程

出现以下任一情况时，应重新执行版本探测：

- ChatGPT 已出现新 Codex 模型，但 Zenme 同步不到；
- 接口返回客户端版本过低或协议不兼容；
- OpenAI 更新 OAuth、模型接口或 Responses 协议；
- 当前兼容声明开始返回空列表或异常结果；
- 需要升级公开 Codex CLI，并评估 Zenme 的协议兼容性。

维护步骤：

1. 单独查询官方 npm registry，记录公开 stable 和 alpha 版本。不要把该结果直接当作后端兼容门槛。
2. 使用 Zenme 已有的本地 OAuth 凭据和统一请求头构造函数进行探测，禁止打印 Authorization 请求头或令牌内容。
3. 从当前已知可用值附近开始，按递增编号逐个请求。必须顺序执行，并为单次请求设置合理超时和重试。
4. 对每次响应记录 HTTP 状态、模型 slug、展示名、`minimal_client_version`、`visibility` 和能力信息。
5. 找出模型集合发生变化的最小声明版本，并与服务端返回的最低版本交叉验证。
6. 只有在 OAuth 登录、模型同步、文本调用、图片工具调用及相关测试均通过后，才允许修改常量。
7. 更新本文的日期、探测表、结论和变更原因；不要覆盖旧结论，应保留时间线。

## 7. 维护判断准则

- 如果公开 CLI 版本升级，但模型集合和协议没有变化：无需调整 Zenme 常量。
- 如果新模型要求更高的 `minimal_client_version`：将常量更新到不低于门槛且真实验证通过的值。
- 如果提高声明值仍没有新模型：优先判断账号权限、灰度或模型可见性，不继续盲目提高版本。
- 如果接口返回隐藏模型：保留原始数据用于诊断，但不得在产品模型选择器中展示。
- 如果服务端不再接受当前请求头或接口路径：应作为协议迁移处理，不能只修改版本号。

## 8. 相关代码与文档

- `lib/ai/openai-oauth.ts`：OAuth、模型同步和兼容声明常量。
- `lib/ai/openai-responses.ts`：ChatGPT Codex Responses 调用路线。
- `lib/local/settings.ts`：同步模型进入统一模型配置后的映射规则。
- `docs/prd.md`：模型配置、OAuth 安全和产品行为要求。

