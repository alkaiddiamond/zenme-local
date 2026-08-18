# Zenme Agent Runtime 能力与自治边界

本文是 Zenme Project Agent Runtime 的**权威能力模型**。`docs/cc-haha-agent-turn-parity.md` 用于记录与 cc-haha 当前源码的行为对照，`docs/ai-project-workspace-verification.md` 用于记录工程证据；两者都不能覆盖本文定义的自治边界。

当前参考基线：本地 `../cc-haha` 的默认外部 Agent Turn 行为。产品目标不是复制终端 UI，而是在保留 **节点 + 无限画布** 交互的前提下，让一次 Zenme AI Reply Node 承载完整 Agent Turn。

## 1. 核心原则

Zenme 的目标不是“用 Runtime 编排一套固定工具流程”，而是：

> **模型负责问题求解；Runtime 负责提供能力、执行真实动作并守住硬边界。**

一次正常 Turn 应当遵循以下闭环：

1. 模型理解用户目标、当前状态和成功条件。
2. 模型自主选择下一项 observation 或 action。
3. Runtime 校验工具协议、权限、Workspace 和安全边界。
4. Runtime 执行真实动作并返回真实结果或具体失败。
5. 模型基于新 observation 重新判断，而不是沿固定流程继续。
6. 模型自主决定换策略、继续调查、验证、询问用户或完成。

Runtime 可以阻止**不安全、不授权、不合法或超预算**的动作，但不能因为产品启发式规则替模型决定“下一步应该调用什么”或“现在应该结束”。

## 2. 责任边界

| 决策/能力 | Agent Model | Runtime |
| --- | --- | --- |
| 理解用户真正目标 | **负责** | 提供上下文 |
| 分解问题、形成假设 | **负责** | 不接管 |
| 选择工具与调用顺序 | **负责** | 只暴露当前有效工具并校验 |
| 判断失败原因、改变策略 | **负责** | 返回可行动 observation |
| 是否需要搜索、诊断、测试、构建、预览 | **负责** | 提供这些能力 |
| 是否需要 Sub-agent/Team/Task/Workflow | **负责** | 执行并限制范围 |
| 判断证据是否足以完成 | **负责** | 可执行事实完整性检查 |
| 最终回答与完成时机 | **负责** | Hook/安全/资源硬边界可阻止 |
| 工具 JSON Schema / 协议兼容 | 不应猜历史实现 | **负责** |
| Workspace Root / path scope | 不得绕过 | **负责** |
| 权限、审批、Hook | 不得绕过 | **负责** |
| 进程生命周期、后台通知 | 使用语义 | **负责** |
| Context compact / token budget | 使用压缩后上下文 | **负责** |
| 持久化、恢复、幂等 | 不应手工模拟 | **负责** |
| Canvas 最终投影 | 输出结果语义 | **负责** |

## 3. 允许的 Runtime 硬边界

以下逻辑不是 heuristic，可以由 Runtime 确定执行：

- **工具协议边界**：名称、JSON Schema、互斥字段、MCP Schema。
- **安全边界**：敏感路径、路径逃逸、UNC、符号链接、破坏性命令、浏览器 URL 范围。
- **权限边界**：Workspace read/write/execute/gitWrite、用户审批、managed policy、Hook deny。
- **副作用顺序**：写入/命令/交互工具互斥；只读且声明 concurrency-safe 的工具可并行。
- **资源上限**：Turn 最大工具轮数、Sub-agent 最大轮数、命令最大时间、输出大小、Context window。
- **持久化一致性**：ChangeSet 原子应用、Execution 状态机、消息去重、后台任务所有权。
- **显式协议状态机**：Plan approval、MCP Elicitation、Team shutdown、Workflow 结构化结果 schema。
- **事实完整性约束**：如果回答声称引用网页 URL，URL 必须来自实际读取过的页面；不能把 `web_search` 列表冒充已读证据。
- **模型服务恢复**：context overflow compact、`max_output_tokens` 有界 continuation、失效 OAuth token 自动刷新。

这些硬边界只限制“什么不能做”或保证系统一致性，不能替模型制定求解策略。

## 4. 明确禁止的 Runtime heuristic

以下逻辑不得重新进入 Project Agent / Sub-agent 主循环：

1. **关键词路由用户意图**
   - 例如看到“最新/新闻”就强制规定搜索次数或来源数量。
   - 例如看到“启动服务”就自动进入固定 restart 流程。

2. **强制工具序列**
   - 不得规定 `workspace_status → git_diff` 才能继续。
   - 不得在代码修改后把模型的 `complete` 偷换成 `code_diagnostics`。
   - 不得规定 Team 成员开始工作必须先 `task_list`。

3. **重复结果强制停止**
   - 相同工具、相同参数、相同结果连续出现不是充分的终止条件。
   - Runtime 只保留总轮数/时间/token 安全预算；模型可以在重复 observation 后改变工具或假设。

4. **伪造或复用业务结果**
   - 不得因命令文本相同就伪造“已复用后台任务”工具结果。
   - 不得扫描进程/端口后替 Agent 猜测预览 URL。
   - 不得用 `restart_service`、`start_dev_server`、`scan_ports`、`open_preview` 等内部捷径代替 Shell/Browser 真实能力。

5. **把历史协议当成当前能力**
   - 历史 `run_command`、旧 `task_list`、`todo_write`、旧 `background` 字段不能继续指导新模型。
   - 历史事件可以保留供 UI/审计，但进入模型前必须迁移到当前协议或隐藏。

6. **模糊失败反馈**
   - 不允许只返回“工具不存在或 schema 不匹配”。
   - 能安全兼容的字段由 Runtime 归一化；无法兼容时指出未知字段、缺失字段、互斥组合和当前示例。

## 5. 一次 Turn 与画布的映射

| cc-haha/Agent 概念 | Zenme 映射 |
| --- | --- |
| Session / Thread | Project Agent Session |
| User turn | 触发节点 + 用户事件 |
| Agent Turn | 一个 AI Reply Node 的一个持久 Turn |
| assistant/tool_use/tool_result | Project Session 结构化事件 |
| tool execution | Agent Execution / Command / MCP / Browser 等运行记录 |
| file mutation | ChangeSet + Live File |
| background process | 持久 Shell taskId + outputFilePath + completion notification |
| Sub-agent | 独立 Agent Execution |
| Team | 持久 Orchestration + 成员邮箱/任务 |
| final answer | AI Reply Node 正文 |
| execution log | 终态“执行证据”折叠区 |
| localhost result | AI Reply Node 的“打开预览”动作 |

**节点是交互单元，不是 Agent Runtime 本身。** 一次 Turn 内可以发生几十轮工具调用、多个 Sub-agent、审批、后台任务和 Context compact，但最终仍是一个 AI Reply Node。

## 6. Core Agent Loop

### 6.1 模型—工具循环

- 主 Agent 最多 200 个工具/模型轮次作为资源保险丝。
- Sub-agent 有独立最大轮次上限。
- 普通工具成功和失败都成为下一轮模型可见 observation。
- Runtime 不根据重复结果、工具名称或关键词生成伪最终答复。
- 用户 steering 会取消可取消的过期工作；不可安全取消的副作用工具先收尾，再消费新指令。

### 6.2 原生工具调用

- Provider 原生 function/tool calls 是主协议。
- 一次模型响应可以携带多个相互独立的只读调用。
- 工具调用 ID 在 assistant → tool result → 下一轮之间保持稳定。
- Provider 最终漏掉提前流出的 tool call 时，结果被标记 superseded，不进入有效上下文。

### 6.3 无效工具调用恢复

Runtime 的目标是让 Agent 能自修正，而不是因接口细节失败：

- 旧 `background:true` → `run_in_background:true`。
- `run_command` 历史语义 → `shell_command`（仅模型投影）。
- 对无法归一的参数返回具体 schema observation。
- 主 Agent 和 Sub-agent 都在**同一个 Execution** 中继续下一轮推理。

## 7. Context Authority 与历史迁移

### 7.1 权威来源优先级

模型在每一轮看到的当前能力必须来自：

1. 当前 Tool Registry / 当前 MCP discovery；
2. 当前 Workspace/权限/Policy；
3. 当前 Agent/Skill/Plugin 定义；
4. 当前 Project Session 经迁移后的有效历史。

历史事件**不能覆盖当前 Tool Registry**。

### 7.2 Model Context Migration Layer

持久历史保持原样用于审计，模型投影执行兼容迁移：

| 历史内容 | 当前模型上下文 |
| --- | --- |
| `run_command` | `shell_command` |
| `project_task_list` | `task_list` |
| Shell `background` | `run_in_background` |
| 旧 Shell-process `task_list` + `restartCommand` | 隐藏 call + result |
| `todo_write` | 历史 UI 可见，默认不进入新模型工具上下文 |
| `run_approved_command` | 内部恢复协议，不进入模型 |
| `restart_service/start_dev_server/scan_ports/open_preview` | 隐藏，不进入当前 Agent 世界模型 |

迁移只影响模型视图，不篡改持久审计记录。

### 7.3 Context compact

- microcompact 只清除可重建的大型 observation 内容。
- manual/auto/reactive compact 生成持久 checkpoint/summary。
- 压缩属于资源管理，不改变工具语义或替模型做业务决策。

## 8. Workspace 与文件能力

- 多 Root Workspace，稳定 rootId。
- `workspace_status/list_directory/glob_files/search_files/read_file`。
- PDF 分页文本读取；图片通过原生多模态 `view_image`。
- `write_file/edit_file/apply_patch/notebook_edit/propose_patch`。
- 写入经过 ChangeSet、范围校验与权限边界。
- Live File 与 ChangeSet 是画布上的持久结果，不把执行日志复制成节点树。
- Git diff、Git 写权限与 worktree 独立控制。

Runtime 不规定 Agent 必须“先读哪个文件/先跑哪个诊断”；只确保观察和修改是真实且受限的。

## 9. Shell 与后台任务

- Windows PowerShell / Git Bash / npm/pnpm/yarn/bun 等受控命令。
- Windows PowerShell AST 检查、路径 scope、安全拒绝和审批。
- 普通命令前台执行，长命令可把**同一个进程**转后台；显式 `run_in_background` 立即返回。
- 后台返回稳定 taskId、outputFilePath，终态主动通知原 Turn。
- `task_output/task_stop` 只操作已知 ID；不提供后台任务枚举给模型。
- 不扫描端口、不猜 URL、不自动重启服务。
- Windows 只有 Corepack、没有 pnpm shim 时，Zenme 为命令及其孙进程提供受信 Corepack bridge；不要求修改用户全局环境。

## 10. Web 与 Browser

- `web_search`：发现候选 URL。
- `web_fetch`：读取明确网页并返回有界摘要/claims。
- Agent 自主决定需要多少来源、是否继续搜索、如何处理冲突。
- Runtime 只阻止把未读取 URL 冒充引用证据。
- `browser` 操作明确 loopback URL，不负责端口发现或进程管理。
- 页面 click/type/press 在不可信权限模式下进入用户确认。

## 11. MCP / Skill / Plugin / LSP

- MCP 延迟发现、ToolSearch、Resource list/read、工具调用。
- MCP Server 以 Workspace Root 为 cwd，受 managed policy 与权限边界。
- MCP Elicitation form/url 会暂停同一 Tool Call，用户回答后恢复，不重放调用。
- Skill/Command 使用当前发现与信任链；Agent 自主判断某项 Skill 是否有帮助。
- Plugin 可贡献 Hook、Skill、Agent、Command、MCP、LSP、Output Style。
- LSP/code intelligence/diagnostics 是 observation 能力，不是 Runtime 强制完成流程。

## 12. Agent / Sub-agent / Team

### 12.1 普通 Agent

- 默认同步：父 Turn 等待 child result 并直接继续推理。
- `run_in_background=true` 或 Agent definition `background=true` 时异步。
- 后台 Agent 终态主动通知父 Turn。
- 已完成普通 Agent 可以按名称或 raw agentId 恢复**同一个 Agent Execution/transcript**。

### 12.2 一次性 Sub-agent

- 独立 Execution、Workspace Root、路径 scope、工具 scope。
- 工具失败与无效 schema 都返回同一 Sub-agent 继续推理。
- Runtime 不强制诊断、不因重复失败强制结束。
- 不允许递归委派或直接向用户提问，这是职责边界而不是求解策略。

### 12.3 Team

- 持久具名成员、邮箱、共享 Task V2。
- `mode=plan` 是显式协议：只读计划 → `exit_plan_mode` → lead approve/reject → 同一 Execution 恢复。
- shutdown request/response 是显式协调协议。
- 负责人和成员自行决定工作策略；Runtime 只路由消息和保证状态一致。

## 13. Task V2 / Plan / Workflow

- `task_create/get/list/update` 是共享项目工作项，不是 Shell 进程列表。
- 是否创建任务、是否拆分任务由 Agent 决定。
- Plan Mode 是用户/Agent 显式进入的只读计划状态；进入后 Runtime 强制写入边界。
- Workflow 是确定性 JavaScript 编排能力，只在用户/Skill 明确要求这类确定性编排时启用；它不是普通开发任务的隐藏替代路径。
- Workflow 结构化结果 schema 是显式契约，允许有限纠正轮次。

## 14. Hook 生命周期

当前 Hook 事件与 cc-haha 默认外部事件集合保持一致，包括：

`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`Notification`、`UserPromptSubmit`、`SessionStart`、`SessionEnd`、`Stop`、`StopFailure`、`SubagentStart`、`SubagentStop`、`PreCompact`、`PostCompact`、`PermissionRequest`、`PermissionDenied`、`Setup`、`TeammateIdle`、`TaskCreated`、`TaskCompleted`、`Elicitation`、`ElicitationResult`、`ConfigChange`、`WorktreeCreate`、`WorktreeRemove`、`InstructionsLoaded`、`CwdChanged`、`FileChanged`。

Hook 可以构成明确的组织策略/安全约束，因为这是用户、项目或管理员显式配置；Runtime 自身不能伪造 Hook policy。

`type: agent` Hook 是独立多轮工具 Agent，而不是一次无工具分类器调用。

## 15. Sampling / Recovery

- Provider 原生 streaming。
- context overflow：compact 后在同一 Turn 重试。
- `max_output_tokens`：先提升输出预算，仍触顶则保留 partial assistant checkpoint 并有界 continuation。
- OpenAI OAuth `token_invalidated`：强制 refresh token 后重试原请求一次。
- 中间恢复不生成第二个 AI Reply Node。

cc-haha 中 Ant/KAIROS/实验 feature gate 的 PostSampling 消费者不自动视为默认外部 Agent Turn 基线。

## 16. Memory / Knowledge

- Project Memory 只有 confirmed 内容进入 Agent 上下文；Agent 推断先成为 candidate。
- Knowledge 是派生索引，可删除重建。
- 自动召回只提供相关 observation，不要求 Agent 走固定“先搜索 Knowledge”流程。
- Cloud embedding 需要显式授权。

## 17. Canvas 投影

执行中：

- AI Reply Node 只突出当前活动/审批/等待输入/后台任务。
- 不为每次工具调用创建永久画布节点。

终态：

- 正文只保留最终回答。
- 工具、审批、compact、Memory/Todo 等进入“执行证据”。
- 内部 queue/Hook/background notification 不污染正文。
- ChangeSet、Live File、图片、预览 URL 等真实结果以画布对象或结果动作存在。
- “打开预览”只打开真实出现过的 URL，不启动/扫描服务。

## 18. Agent Autonomy 验收契约

不再以“工具存在”作为完整能力证明。至少要通过以下行为场景：

| 场景 | 必须证明的行为 |
| --- | --- |
| 无效工具参数 | Runtime 返回具体 schema observation；Agent 在同 Turn 修正后成功 |
| 重复 observation | 连续相同结果不会触发 Runtime 业务终止；Agent仍可换假设/工具或自行完成 |
| 编辑代码 | Runtime 不强制 diagnostics；Agent可自行选择 diagnostics/test/build/preview |
| 主动验证 | Agent选择 diagnostics 后能看到真实错误并调整结论/实现 |
| 缺文件 | `read_file` 失败后 Agent可改查目录/搜索/另一文件，不终止 Turn |
| 历史旧协议 | 新模型看不到旧 Shell task_list/restart guidance；旧字段迁移到当前协议 |
| Package manager 缺失 | 真实错误进入 Agent；Runtime只补执行环境能力，不给模型硬编码“用 Corepack”策略 |
| 后台任务 | Agent不依赖轮询列表；终态通知后在原 Turn 继续 |
| Sub-agent 无效调用 | 子 Execution 不失败退出；获得具体反馈并继续推理 |
| 用户 steering | 旧可取消工作被中断，新指令进入同一 Turn，副作用动作不被重复执行 |
| Elicitation/审批 | 暂停后恢复同一 Tool Call/Execution，不重放副作用 |
| Canvas | 无论内部发生多少轮，最终仍投影为一个 AI Reply Node + 真实结果对象 |

`music_workbench` 的真实故障是当前重要回归样本：模型面对 package manager/工具协议失败时，应当能够基于真实 observation 自主诊断，而不是被旧 `task_list` guidance、schema 猜测或 Runtime 固定重启流程牵引。

### 18.1 自动化自治契约证据

当前自动化回归明确覆盖：

- 主 Agent 不会把模型的完成决定替换成强制 `code_diagnostics`。
- Sub-agent 不会把模型的完成决定替换成强制 `code_diagnostics`。
- 主 Agent / Sub-agent 都可以跨重复 observation 继续推理，不存在“三次相同结果”业务终止。
- provider-native 无效工具调用会返回具体、可行动的 schema observation；同批有效 sibling 不会被丢弃。
- 历史 Shell `task_list`、旧 `run_command`、`project_task_list`、旧 `background` 字段和已退休内部工具经过 Model Context Migration 后不会继续污染当前模型。

核心自治回归当前由以下测试直接证明：

- `lib/agent/project-turn-runtime.test.ts`
- `lib/global-agent/delegated-runtime.test.ts`
- `lib/agent/tool-registry.test.ts`
- `lib/agent/project-context-policy.test.ts`
- `lib/agent/project-agent-prompt.test.ts`

### 18.2 真实模型 Live Autonomy 验证

仓库提供 `lib/agent/agent-autonomy.live.test.ts`。默认跳过，避免常规 `npm run check` 消耗真实模型额度；只有显式设置 `ZENME_LIVE_AGENT_MODEL` 时才执行。

2026-08-18 Windows 使用真实 ChatGPT OAuth 与 `provider-model:chatgpt-official:gpt-5.3-codex-spark` 验证通过，Vitest **1/1，exit 0**。临时 Workspace 的修复 token 不存在于可读 Workspace 文件中，只会由第一次真实失败命令输出暴露，因此 Agent 必须消费真实失败 observation 才能继续。

同一工作树的常规 `npm run check` 也已通过：**251/252 个 Vitest 文件通过，1 个 live 文件按设计跳过；1440/1441 项测试通过，1 项 live 测试按设计跳过；Desktop Node tests 23/23 通过；ESLint 通过。** Live test 已由上面的显式真实模型命令单独执行并 1/1 通过，因此常规门禁不会偷偷消耗在线模型额度。

同一工作树随后执行 `npm run verify`，完整重复 lint/test 并完成 Next.js production build，**exit 0**。clean build 后 `.next/standalone` 通过污染检查，明确输出 `standalone-trace-clean`；Windows `npm run desktop:pack` **exit 0**；`npm run desktop:smoke` **exit 0**，启动最新 `dist-desktop/win-unpacked/Zenme.exe` 并完成 packaged Electron/standalone/Browser/临时 Workspace 冒烟链路。

实际工具轨迹：

1. `shell_command("npm run check-runtime")`：Shell 子进程 **failed**，stderr 返回 `RUNTIME_CONFIG_MISSING` 和一次性 token。
2. `read_file` / `list_directory`：Agent 自主检查当前实现与 Workspace，而不是 Runtime 指定固定恢复步骤。
3. `write_file("runtime-config.json")`：Agent 根据真实错误形成修复。
4. `shell_command("npm run check-runtime")`：Shell 子进程 **succeeded**，stdout 包含 `AUTONOMY_OK`。
5. Agent 只在第二次真实命令成功后形成最终完成答复。

验证命令示例：

```powershell
$env:ZENME_DATA_DIR = "$env:APPDATA\Zenme\data"
$env:ZENME_LIVE_AGENT_MODEL = "provider-model:chatgpt-official:gpt-5.3-codex-spark"
npx vitest run lib/agent/agent-autonomy.live.test.ts --maxWorkers=1
```

Live test 使用生产 repository 创建一次性 Project/Workspace，结束后停止其 Agent 命令、删除临时 Project 并删除临时 Workspace，不复用用户现有项目会话。

## 19. 完成定义

只有同时满足以下条件，才可宣称 Agent Runtime 能力完成：

1. 当前 cc-haha 默认外部、实际可达 Agent Turn 能力没有已知生产缺口。
2. 主 Agent 与 Sub-agent 的问题求解控制权符合本文自治边界。
3. 历史兼容只存在于持久化/投影迁移层，不进入当前模型世界模型。
4. 所有失败都是真实、具体、可行动的 observation。
5. 安全、权限、资源和协议硬边界仍然 fail-closed。
6. Autonomy 验收场景有行为测试，不以源码存在性替代。
7. `npm run check`、`npm run verify`、Windows packaged app smoke 与真实 Workspace E2E 通过。
8. 画布仍保持节点 + 无限画布体验，一次 Agent Turn 不退化成永久执行日志树。

## 20. 独立集成认证

以下项目可以影响特定部署环境，但不应与 Runtime 自治能力混为一谈；未验证时必须明确标注：

- 具体第三方 MCP Server 的兼容性。
- 具体第三方 LSP Server。
- 各云模型服务商实时行为/限额。
- macOS Keychain。
- 企业 MDM/远程 managed policy 下发。
- 其他平台打包和签名。

这些认证不能被用来掩盖 Runtime 语义缺口，也不能因为尚未覆盖某个第三方环境就错误宣称核心 Agent Loop 不存在。
