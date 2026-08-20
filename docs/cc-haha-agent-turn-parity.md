# cc-haha Agent Turn 对齐矩阵

本文以本地 `../cc-haha/src` 的 `main@d52bbec707246f807416c2bc6b1cd67445cfe622` 为行为基线，记录 Zenme Project Agent 的源码级行为覆盖情况。Agent Runtime 的权威能力定义、模型自治权和 Runtime 硬边界见 [`agent-runtime-capabilities.md`](agent-runtime-capabilities.md)。工具/Hook 名称对齐本身不构成“Agent 会自主解决问题”的完成证明。

## 当前结论（2026-08-18）

当前源码级审计与行为验证表明：**Zenme 已完成 cc-haha 当前外部默认、模型可达 Agent Turn 能力的迁移，并通过 Agent Autonomy 行为契约验证，同时保持节点 + 无限画布的交互模型。** 这里的“完成”不再仅依据工具/Hook 名称或生命周期覆盖，而要求 Runtime 不用固定流程、关键词路由、强制诊断、旧 Session guidance 或重复结果停止规则替模型做问题求解决策；该要求已经由自动化契约和真实 `gpt-5.3-codex-spark` Live Autonomy 轨迹共同证明。

本结论只覆盖当前外部默认、实际可达的 Agent Turn 语义。`USER_TYPE=ant`、compile-time feature gate（例如 KAIROS、AGENT_TRIGGERS、CONTEXT_COLLAPSE、SKILL_IMPROVEMENT）或当前源码仅有 dormant 类型/检查但没有 parser/schema 入口的能力，不作为外部默认基线。真实第三方 MCP/LSP、特定云服务商、macOS Keychain、远程 MDM/企业下发属于后续平台/集成认证；下表保留这些认证备注，但它们不代表当前 Agent Turn Runtime 缺少对应语义。

既有 parity 证据：

- cc-haha `HOOK_EVENTS` 27 项与 Zenme `PROJECT_AGENT_HOOK_EVENTS` 逐项一致；command/prompt/agent/http Hook 及 once/async/asyncRewake 均有生产触发边界，其中 `agent` Hook 已是最多 50 轮、可调用受限 Workspace 工具的隐藏 Agent，而不是一次性 prompt。
- 默认工具池、ToolSearch/deferred tools、Task/Plan、Workflow、Skills/Commands、MCP Resources、Worktree、Image、Web、Shell、Team/SendMessage 均完成源码级可达性审计；Brief/Cron/Sleep/Monitor/KAIROS 等非默认工具按其真实 gate 排除。
- `AgentTool` 的外部可达参数已对齐：普通 Agent 可省略 `name`、默认同步；显式后台/Agent `background:true`/Team 成员异步；Team 成员要求稳定名称；`mode=plan`、`isolation=worktree`、模型继承与同 Execution resume 已接通；`SendMessage` 可按名称或 raw agentId 恢复普通后台 Agent。
- sampling/context 默认语义已接通：context overflow 响应式压缩、microcompact、手动 `/compact`、`max_output_tokens` 64K 提升与同 Turn 有界 continuation；PostSampling 的当前外部消费者均受 ant/默认关闭 gate 约束，因此不构成默认缺口。
- 新增自治行为回归覆盖：无效工具参数自修正、重复 observation 不强停、主/子 Agent completion 不被强制 diagnostics 改写、模型主动选择 diagnostics、历史工具协议迁移与退休策略工具隐藏，以及历史后台任务跨 Turn 收束。当前 `npm run check` 已通过：251/252 个 Vitest 文件、1444/1445 项测试通过，唯一跳过项是默认不消耗在线额度的 Live Autonomy；Desktop Node tests 23/23。真实 `gpt-5.3-codex-spark` Live Autonomy 已再次显式执行 1/1、exit 0。
- 2026-08-18 验证快照中 `npm run verify` 完整 exit 0；clean standalone 输出 `standalone-trace-clean`；Windows `npm run desktop:pack` 与 `npm run desktop:smoke` 均 exit 0。该记录不自动代表后续工作树仍通过相同门禁。

## 默认工具池审计

- cc-haha `src/tools.ts` 的通用默认主干（Agent、TaskOutput/Stop、Bash/PowerShell、Glob/Grep、Read/Edit/Write、NotebookEdit、WebSearch/WebFetch、Todo/Task CRUD、AskUserQuestion、Skill、Plan Mode、MCP Resource、ToolSearch、Team/SendMessage）均有 Zenme 统一注册表映射。cc-haha 已把 TaskOutput 标记为兼容旧会话并建议优先 Read 稳定输出文件；Zenme 采用相同提示边界。
- `ImageGen/ImageEdit` 已按 cc-haha 的关键边界补齐：从设置选择图片模型、工具参数不携带模型、结果持久化为本地文件、编辑只接受 1–3 个受信绝对路径、失败后不由运行时自动重试。
- `Workflow` 按 cc-haha 的显式 opt-in 边界接入：动态 JavaScript DSL、journal、最长未变前缀 resume、并发 Sub-agent、启动前一次审批、后台 TaskOutput/Stop 与终态通知均走统一 Project Agent Turn；它与结构化 `delegate_tasks` 保持为两种不同能力。
- `Brief` 虽出现在 `getAllBaseTools()`，但其 `isEnabled()` 受 KAIROS/KAIROS_BRIEF 与显式 opt-in 共同限制；Cron、remote trigger、monitor、push notification、PR subscription 同样属于特定产品功能或 feature-gated 通道。它们不是普通外部 Project Agent Turn 的默认开发基线；除非 Zenme 产品需求明确引入，否则不以“工具名称相同”为目标。
- cc-haha 的 Enter/ExitWorktree 受独立 feature flag 控制；Zenme 同时提供主 Agent 的 `enter_worktree/exit_worktree` 与 `agent_spawn(isolation=worktree)`，并将 WorktreeCreate/WorktreeRemove/CwdChanged Hook 接到真实目录切换边界。

## 核心循环

| 能力 | cc-haha 基线 | Zenme 当前证据 | 状态 |
| --- | --- | --- | --- |
| 模型—工具迭代 | `query.ts` 持续执行 assistant/tool_result 循环，不用关键词规则替模型决定用户意图 | `lib/agent/project-turn-runtime.ts` 最多 200 轮；用户请求先进入模型，原生工具与兼容协议汇入同一循环，不再按“Git 初始化 / Workspace 状态 / 最新新闻”等文字捷径绕过模型 | 已接通 |
| 多工具批次 | `StreamingToolExecutor` 在完整 `tool_use` 块流式到达后立即入队；仅让 `isConcurrencySafe` 的工具并行，Bash/PowerShell 只有判定为只读时才并行，变更命令独占；结果按请求顺序返回 | Responses 与 Chat Completions 都允许服务商返回并行原生工具调用；完整 Tool Call 到达时，内置读写、Shell、已激活 MCP、提问/计划、Task/Todo、图片、团队/委派和 Browser 均进入同一流式队列。只读工具与只读 MCP 并行，文件变更、可写 MCP 和控制工具独占；只读 Shell 可取消，变更 Shell 阻塞收尾。索引与签名负责和最终响应去重，服务商遗漏或流失败会关闭孤儿事件；结果按 provider 顺序回填。非信任 Browser 交互、MCP ask/deny 规则以及配置了 Tool Hook 的 MCP 会退回串行控制路径，使 PreToolUse 改写、权限询问和 Permission Hook 在执行前完成，不允许流式回调抢跑 | 统一调度主路径已接通；仍需桌面真机覆盖高延迟服务商、真实 MCP 和 Browser 人工确认交互 |
| 工具/模型失败恢复 | 普通工具错误、schema 失败、未知工具和权限拒绝作为 `tool_result` 回到模型；并行且只读的 Shell 失败可取消并行兄弟。`max_output_tokens` 不直接终止 Turn：先用更高输出上限重试同一次采样，仍触顶时保留已生成 assistant 片段并注入内部 continuation，最多有界续跑 3 次，中间错误不暴露给桌面调用方 | 普通工具、无效原生工具调用、Shell 失败及 `neverAsk` 权限拒绝都回到下一轮模型；同批有效流式工具不会被无效兄弟丢弃或重复执行；并行只读 Shell 失败会取消仍运行的 Shell 兄弟并按原顺序记录失败。OpenAI Responses/Anthropic 的输出上限会统一映射为可恢复流错误：第一次静默提升到 64K，仍触顶则把截断前正文保存为同 Turn assistant checkpoint，再注入内部 continuation 续跑，最多 3 次；中间失败不会产生新节点或用户错误卡 | 已接通主路径 |
| 中断与追加指令 | 工具有 `interruptBehavior`，可取消工具与阻塞工具分流 | 注册表与运行时已接通 `cancel/block`：追加指令会立即取消过期模型生成、只读工具和可取消的并发 Shell 批次；变更工具安全收尾后再消费新指令 | 已接通主路径 |
| 上下文压缩 | token 预算驱动，保留近期原文与可续接摘要；microcompact 只处理可重建的高体积工具结果并保留近期结果；`/compact [instructions]` 可手动压缩；服务商实际拒绝超长上下文时响应式压缩并重试；成功后以 `compact` 来源重新触发 SessionStart | Project Session 按模型窗口生成 checkpoint/summary；模型投影仅清理 Read/Shell/Grep/Glob/Web/Edit/Write 同类旧结果，实际预计释放至少 4,000 tokens 才触发，并在画布保留 compact 边界；`/compact [整理要求]` 直接进入本地压缩生命周期而不经过普通工具决策；服务商返回上下文超限时强制生成 checkpoint 并重试同一 Turn；自动、手动和响应式成功路径均以 `source=compact` 触发 SessionStart | 生产路径和定向回归已接通；服务端 prompt-cache edit 属于服务商专有优化，Zenme 不伪装实现 |

## 工具与执行管线

| 能力组 | cc-haha | Zenme | 状态 |
| --- | --- | --- | --- |
| 文件与搜索 | Read 可分页读取文本、按页提取 PDF，并把图片作为模型输入；Write/Edit/Glob/Grep/NotebookEdit 走各自结构化工具 | `read_file` 分页读取文本并支持 `pages=1-5,7` 的 PDF 文本提取（单次最多 20 页）；图片由 `view_image` 进入原生多模态；`write_file/edit_file/apply_patch/glob_files/search_files/notebook_edit` 写入经过 ChangeSet | 文本、真实 PDF 提取和图片路径已有回归；扫描 PDF 只明确报告无可提取文本，不伪造 OCR |
| 结构化提问 | AskUserQuestion 一轮支持 1–4 个问题、每题 2–4 个选项、单选/多选、自由输入和可选 Markdown preview；回答作为结构化 Tool Result 恢复同一 Turn | `ask_user_question` 同时保留旧单问题记录兼容，并支持完整 `questions[]`、`multiSelect`、preview 与 `answers` 映射；节点时间线和侧栏复用同一表单，提交后恢复原 Execution | 多问题、多选、结构化回灌已有注册表与 Runtime 回归；仍需桌面键盘/焦点验收 |
| Shell | Bash/PowerShell，PowerShell 优先发现 `pwsh` 7、回退 Windows PowerShell；以原生 PowerShell AST 检查所有子命令、动态调用、重定向和解析失败；按 cmdlet 参数语义验证读写路径；继承会话子进程环境；2 秒后在同一 Tool Use 上流式更新，15 秒后可原进程后台化；只读 Shell 可并行，变更 Shell 独占 | 单一 `shell_command` 走标准 validate → PreToolUse → permission → execute → PostToolUse 生命周期；Windows 优先解析 `pwsh`、回退系统 Windows PowerShell，并用原生 Parser AST 收集完整管道/复合语句；已按常用读写 cmdlet 的路径参数、位置参数、未知参数和文件重定向验证目标，工作区内确定路径可执行，越界、UNC、`.git` 内部、链接逃逸、动态值、敏感 cmdlet 与语法失败 fail-closed；宿主 Node 目录补入安全环境，避免 PowerShell 内的 pnpm/npm shim 找不到 `node`；用户、项目和 local 的 `.claude/.zenme/settings*.json` 可声明 `permissions.allow/ask/deny`，兼容 `Bash(...)`/`PowerShell(...)`、精确、`:*` 前缀、通配符与转义括号，按 deny → ask → allow 判定；只读加载与 cc-haha 相同平台路径的 `managed-settings.json` 和按文件名排序的 `managed-settings.d/*.json`，支持 `allowManagedPermissionRulesOnly` 硬边界。Read/Write/Edit/WebFetch/WebSearch/Agent/Skill/Task 等内置工具和 MCP 工具也在实际执行前应用名称与内容规则。MCP `ask` 复用画布结构化提问暂停 Turn，批准后只恢复一次原名称与原参数，拒绝后继续交给模型；流式工具路径遇到 ask/deny 会退回串行权限路径，不能提前执行；显式 allow 不能越过外部 Workspace、文件系统和 MCP Server access 硬边界；2 秒后更新同一事件，15 秒后原进程转后台 | 主路径已接通；Zenme 为避免泄露本地服务商密钥，仍采用安全环境允许列表；cc-haha 覆盖的长尾 cmdlet 参数表、远程/MDM 托管策略、真实 MCP 服务与真实桌面进程树仍需逐项差异测试，不能宣称全面等价 |
| 后台任务 | Shell 默认前台，15 秒后同一进程自动转后台；显式后台立即返回 taskId/输出文件；进程终态主动通知；输出停滞且末行像交互提示时主动通知 Agent 改用非交互命令；不让模型轮询列表 | Shell 默认前台并在 15 秒后原地转后台；显式后台立即返回；节点内输出为 1 MiB 有界预览，稳定 `outputFilePath` 独立保留最多 64 MiB 完整输出并允许按行读取；当前服务实例以内存 completion 事件直接唤醒终态通知，不轮询 Execution Store；终态以 `later` 优先级进入持久队列，当前循环结束后自动恢复原 Turn；45 秒无输出且末行匹配 `(y/n)`、`Continue?`、`Press Enter` 等提示时，以 `next` 优先级只通知一次并恢复原 Turn。进程创建同步失败时先把 Command 持久化为 `failed` 再回灌错误；任何标记为 running 但已经失去本机进程句柄的记录都会在短启动宽限期后收敛为 `stopped`，不再永久显示运行中 | 大输出、交互停滞、启动失败和丢失句柄回归已覆盖；仍缺真实桌面父子进程退出与应用关闭后的 Windows 验收 |
| 工具循环 | 普通工具成功或失败都作为结果回灌，由 Agent 诊断并决定下一步；不因三次相同结果由运行时生成伪回答 | 主 Agent 与 Sub-agent 均不再查找“相同后台启动命令”、伪造复用结果或以三次相同 `task_list`/工具结果强制结束；只保留总工具轮数、权限和进程安全上限 | 已对齐 |
| 原生工具轨迹 | `assistant tool_use → user tool_result → assistant` 以结构化消息持续进入后续推理，工具调用 ID 在整个 Turn 内稳定关联；后台终态作为新的用户侧通知进入同一查询 | Project Session 事件在模型调用前投影为 provider 原生 function call/function output、tool call/tool message 或 Anthropic tool_use/tool_result；不再把用户、助手、工具调用和工具结果整体序列化进 system context。Anthropic Messages 的 thinking/text/input_json_delta 按上游 SSE 实时进入统一 Agent 流，而不是过滤成一次性纯文本 | 三类 provider 请求体、增量返回与 Session 投影均有契约回归；仍需各真实服务商桌面验收 |
| 派生 Agent 工具池 | 一次性 Async Agent 默认拥有 Read/Grep/Glob/Web/Shell/Edit/Write/Notebook/Skill/ToolSearch，但没有 TaskOutput/TaskStop/AskUser/递归 Agent；长期 in-process teammate 额外拥有 TaskCreate/Get/List/Update 与 SendMessage | 一次性 batch Sub-agent 默认拥有 Workspace 读取、搜索、Web、Shell、编辑、Patch、诊断、Skill 与 ToolSearch，不拥有后台任务生命周期、共享任务、提问、消息或递归委派工具；长期 Team 成员才额外获得共享任务和 `send_message` | 已对齐职责边界 |
| 自定义 Agent | 读取项目/用户/托管 Markdown Agent；托管定义具有最高优先级；`strictPluginOnlyCustomization` 可把 Agents 锁定为托管/插件来源；使用完整 YAML frontmatter，支持系统提示、tools/disallowedTools、skills、model/effort/maxTurns/background/memory/isolation/permissionMode/hooks/critical reminder/MCP 等配置 | 发现 `.zenme/agents/*.md`、`.claude/agents/*.md`、用户 Agent，以及平台托管目录 `.claude/agents`；托管同名 Agent 覆盖项目、用户和插件定义且保留管理员声明的权限与 Hook。Agents surface 锁定时跳过项目和用户定义；仅 Hooks surface 锁定时仍允许项目 Agent，但移除其 frontmatter Hook。Agent 的来源会持久传到 Sub-agent Execution，供 MCP surface 在发现和执行时再次验证。`agent_spawn.agentType` 实际继承系统提示、工具边界、模型、推理强度、持久记忆、worktree、权限、Hooks 与 MCP | 主执行配置、托管优先级、plugin-only 来源边界与私有 MCP 生命周期已接通；SDK 类型只继承 Zenme 已有连接，不伪造第三方 SDK 注册表 |
| TaskOutput/Stop | 已知 ID 读取/停止 Shell、Workflow 与后台 Agent；Shell 后台输出也可通过 Read 读取稳定文件 | `agent_spawn` 返回标准 `taskId/taskType=local_agent`；`task_output/task_stop` 可按已知 ID 读取或停止 Shell、Workflow 与单个后台 Agent。每个 Sub-agent 拥有独立取消句柄，停止一个成员会中断其进行中的模型请求，不会取消 Team 其他成员，晚到响应也不能覆盖 stopped 终态。Shell 的 `read_file` 仍只允许读取当前 Execution 返回的精确 `outputFilePath` | 已对齐主路径 |
| 大型 Tool Result | 各工具声明结果阈值；超过阈值时完整结果写入会话 `tool-results`，模型只接收预览和可由 Read 继续读取的路径；Read 自身不再持久化，避免循环 | 主 Agent、Sub-agent、MCP 统一经过 `tool-result-storage`；默认 100,000 字符、搜索结果 20,000 字符，超过阈值写入项目 `agent-tool-results`，Execution 与模型上下文保存预览/路径；`read_file`、图片、Browser、Shell/TaskOutput 使用各自有界协议 | 单元与同 Execution 回读回归通过；仍需完整桌面恢复验收 |
| Agent/团队 | Agent、SendMessage、TeamCreate/Delete、共享 Task CRUD；成员以稳定名称持续存在，完成后仍可接收新消息继续工作；具名成员可直接互发消息；`mode=plan` 成员提交计划后等待负责人结构化批准或拒绝；关闭使用 request/response 握手；后台完成主动通知负责人 | `delegate_tasks` 处理一次性并行批次；`team_create/agent_spawn/send_message/team_delete` 处理持续团队；普通 Agent 的 `name` 可省略且不会被开放 Team 误吸入，显式 Team 成员才要求稳定名称。成员拥有持久邮箱，支持负责人/成员定向、纯文本广播、结构化 shutdown request/response。`agent_spawn(mode=plan)` 在审批前只向成员暴露只读工具与 `exit_plan_mode`，计划以稳定 requestId 回到原父 Turn；负责人通过 `plan_approval_response` 批准或带反馈拒绝，成员在同一 Execution 中恢复，批准后才恢复写入与执行工具。普通后台 Agent 也可由名称或 raw agentId 定位并恢复同一 Execution；每次运行完成都通过 Project 消息队列回到原 Turn；共享 Task CRUD 保持项目级一致；自定义 Agent 可使用 user/project/local 三种持久记忆，并选择独立 Git worktree | 已对齐默认外部生命周期、寻址、计划审批和恢复语义 |
| Task V2/计划模式 | 交互会话启用 TaskCreate/Get/List/Update 时禁用 TodoWrite；EnterPlanMode 立即切换为只读规划并继续同一 Turn；ExitPlanMode 提交完整计划，批准后恢复执行，拒绝后继续修订 | 新会话只暴露 `task_create/task_get/task_list/task_update`；`todo_write` 仅作旧记录兼容；Project Session 持久化共享任务，`interactionMode/activePlan` 等运行态按 Conversation 独立持久化；`@plan/PLAN.md` 是规划态唯一可写文件；`enter_plan_mode` 无额外弹窗地进入只读模式；`exit_plan_mode` 在 AI 回复节点内等待批准并续接同一 Execution | 主路径已对齐；cc-haha 源码明确把 `allowedPrompts` 标为 Ant-only，外部开源 prompt 也主动排除，因此不把它误列为 Zenme 的外部基线缺口 |
| Web 与本地预览 | WebSearch/WebFetch/WebBrowser；每次工具结果回灌后由模型决定继续检索或完成；开发服务由 Shell 管理，最终回复中的 localhost URL 投影为可点击输出目标，不存在模型侧 `open_preview` | `web_search/web_fetch/browser`；运行时不再用关键词、固定来源数、自动换候选或第二次模型裁判强行改写 Web 工具决策，只拦截引用未经 `web_fetch` 读取的 URL；注册表与执行器均不存在 `open_preview`，不扫描端口或进程树 | 已对齐职责边界；输出卡片仍可继续丰富 |
| Skill/MCP/延迟工具 | Skill、用户直接 `/command args`、ToolSearch、MCP Resources、deferred tools；Skill/Command 使用 YAML frontmatter，托管目录具有最高优先级；`strictPluginOnlyCustomization` 可分别锁定 Skills、Hooks 与 MCP 来源；支持参数占位、`allowed-tools`、模型/effort、嵌入 Shell 与 `context: fork` | `skill/tool_search/list_mcp_resources/read_mcp_resource`；平台托管 `.claude/skills` 与 `.claude/commands` 先于项目、用户和插件加载，Windows 8.3 路径展开后仍使用规范路径生成命令名。Skills surface 锁定时只发现托管和插件 Skill/Command；Hooks surface 锁定时移除项目/用户 Skill frontmatter Hook；MCP surface 锁定时排除用户配置 Server 和不受信 Agent 私有 Server，保留插件与托管 Agent Server，并在工具发现、调用、Resource 列表/读取四条路径重复执行边界。MCP 管理策略同时支持 `allowedMcpServers`、`deniedMcpServers` 与 `allowManagedMcpServersOnly`：拒绝优先，空允许列表阻止全部服务，stdio 完整匹配命令数组，远程服务按 URL 通配符匹配，并在创建连接或子进程前生效。其余参数替换、嵌入 Shell、审批恢复与 fork 继承继续走统一 Agent 管线 | 主执行、托管优先级、plugin-only 四 surface、MCP 企业策略、Skill Hook、嵌入 Shell、fork 审批恢复与进度投影已接通；桌面审批续接仍需显式验收，不能标记全面等价 |
| LSP/图片 | 启用插件可通过 `.lsp.json` 或 manifest 声明持久 stdio Language Server，按扩展名映射语言；监听 `publishDiagnostics`，跨 Server 去重并限制诊断体积；Read 图片、ImageGen、ImageEdit 使用桌面设置中的图片模型 | `code_intelligence` 会加载显式启用插件的 `.lsp.json`/manifest 声明，完成 `initialize`、`didOpen/didChange` 与定义、引用、悬停、符号、实现和调用层级请求；`code_diagnostics` 在文件变化后发送 `didOpen/didChange/didSave`，接收插件发布诊断，与内置 TypeScript 诊断合并、去重、按文件和总量限流。ConfigChange 被接受后关闭旧 Server。LSP command/args/env 支持 `${user_config.*}`。`view_image/image_gen/image_edit` 继续走统一注册表与本地持久化边界 | 插件 LSP 导航和诊断均有模拟 Server 回归；真实第三方 Server 桌面验收仍待补 |
| Workflow | 动态 JavaScript DSL 编排 Agent/parallel/pipeline/phase，显式用户 opt-in 后后台运行并支持 resume；一次启动审批覆盖内部 Agent | `workflow` 为延迟发现工具；支持 DSL、parallel/pipeline/phase/log、受信 nested workflow、持久 journal、最长未变前缀恢复、并发上限、启动前一次审批、单卡进度、TaskOutput/Stop、父 Turn 中止和终态通知；`agent(..., { schema })` 使用 Ajv 8 执行真实 JSON Schema 校验，不合规时在同一 Sub-agent Execution 中最多纠正两次，仍不合规则明确失败 | 已接通主生命周期、schema 强制与有界自动纠错；实现位置在 Sub-agent 完成边界，而非依赖特定服务商的工具调用层 |
| 权限与 Hook | schema → validate → PreToolUse → permission → execute → PostToolUse/PostToolUseFailure；command/prompt/agent/http Hook；Session/Subagent/Stop 生命周期；Hook allow 不能覆盖权限拒绝；无内容的 deny 规则会在请求模型前移除对应工具，`mcp__server` 可隐藏整个 MCP 服务工具组 | `executeAgentToolPipeline` 是统一工具生命周期，Shell 与 MCP 均不再有绕过 Hook 的特殊分支；MCP PreToolUse 可在权限判定前改写参数，PermissionRequest/PermissionDenied 在实际边界触发，PostToolUse/PostToolUseFailure 观察真实结果。用户、项目、local、托管与显式启用插件 Hook 合并；`strictPluginOnlyCustomization: ["hooks"]` 保留托管/插件 Hook 并过滤设置、Skill 与 Agent 中不受信 Hook；`allowManagedHooksOnly` 进一步只保留托管 Hook。无条件 deny 已同时从原生内置工具池、激活的 MCP 工具池和延迟 ToolSearch 结果中剔除；带内容的 deny 仍保留工具定义并在取得真实参数后判断 | 工具、Session/Subagent/Stop/Compact、Permission、Task、Worktree、Instructions/File 主路径及模型暴露边界已接通；其余事件见下表 |

## Hook 事件逐项审计

| 事件 | cc-haha 触发边界 | Zenme 状态 |
| --- | --- | --- |
| PreToolUse / PostToolUse / PostToolUseFailure | 每次工具校验、执行成功或失败 | 已接通统一管线 |
| PermissionRequest / PermissionDenied | 展示审批前；最终权限拒绝后 | 已接通；Hook allow 不覆盖硬拒绝 |
| SessionStart / UserPromptSubmit / Stop / StopFailure / SessionEnd | Session 与回答生命周期 | 已接通。Zenme 当前把一次持久 Project Turn Execution 映射为一次 Hook Session；这是画布会话模型与 CLI Session 的显式差异 |
| SubagentStart / SubagentStop | 派生成员启动、准备结束 | 已接通 |
| TaskCreated / TaskCompleted / TeammateIdle | 共享任务创建/完成；具名 teammate 准备空闲 | 已接通。TaskCompleted/TeammateIdle 可阻止成员结束，反馈回同一 Agent Execution 后继续工作 |
| PreCompact / PostCompact | 自动、手工或响应式压缩前后；手工压缩携带 customInstructions | 已接通，事件在 Agent Turn 中留有可审计边界，手工 `/compact` 的附加要求进入 Hook 与摘要提示 |
| WorktreeCreate / WorktreeRemove / CwdChanged | worktree 生命周期和工作目录切换 | 已接通主 Agent 与隔离 Sub-agent 的真实路径变更 |
| InstructionsLoaded / FileChanged | 指令文件载入；Agent 写盘完成 | 已接通，matcher 匹配实际相对路径 |
| Notification | 独立于 REPL 的旁路 Hook；以 `notification_type` 匹配，输入为顶层 `message/title/notification_type` | Shell 后台任务、Sub-agent、Workflow 终态以及 MCP `elicitation_response` / `elicitation_complete` 均在主状态持久化之外触发相同旁路 Hook；Hook 失败不吞通知，后台任务队列仍可恢复原 Turn，且不伪造工具字段。仍需真实 MCP Server 和桌面通知交互验收 |
| Elicitation / ElicitationResult | MCP Server 主动向客户端请求输入、响应发送前；URL 模式打开页面后返回 accept，并由 completion notification 收尾；外层 MCP Tool timeout 仍覆盖完整调用 | MCP Client 声明 form/url capability；请求进入 Project Session 的持久 `waitingInput` 事件，画布节点与侧栏共用 JSON Schema 表单或 URL 两阶段交互；Hook 可预先回答及在提交前覆盖响应；原 MCP Tool Call 保持挂起且恢复时不重放；completion/response 进入 Notification Hook；调用超时沿用完整 `callTool` 预算 | 生产逻辑与定向回归已接通；仍缺真实 MCP Server 与桌面 URL/form 验收，不能宣称全面完成 |
| Setup | CLI init/maintenance，而非每轮对话 | 同一 Agent 输入入口支持显式 `/init` 与 `/maintenance`；只在精确命令下以 `init`/`maintenance` matcher 触发 Setup Hook，不调用模型，也不在普通 Turn 中隐式执行。生产逻辑与 init 回归已接通；maintenance 共用同一路径，仍需桌面验收 |
| ConfigChange | 用户/项目/local/policy/settings 与插件组件发生变更；Hook 可阻止应用新配置 | 持久 Project Session 使用 Chokidar 监测 user/project/local settings、Skills、Commands、Agents、Output Styles、已启用插件 MCP/LSP/组件路径，以及本机只读 `managed-settings.json`、`managed-settings.d` 和托管 `.claude/skills|commands|agents|output-styles`；托管 Hook 支持 `allowManagedHooksOnly` 与 `disableAllHooks`。托管 Output Style 的选择和同名定义覆盖低层配置。Hook 阻止时继续使用旧代际快照，允许时递增代际、刷新缓存并关闭旧插件 LSP 进程 | 本机 policy settings 与托管 Agent 组件的生产路径、优先级和 ConfigChange 回归已接通；远程/MDM 下发通道及托管插件安装策略尚未引入 |

## 插件逐项审计

- 已接通：显式启用 + 安装登记信任链、Hooks、Skills、Agents、legacy `commands/*.md`、output styles、默认与 manifest MCP 声明、持久 stdio LSP server 声明、`${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` 展开、插件 Skill/Agent/Command 命名空间，以及受 ConfigChange 约束的代际缓存。`${user_config.*}` 可从 cc-haha 兼容 `pluginConfigs` 与 credentials 文件读取：MCP/LSP/command Hook 获得运行时值，进入模型提示的 Skill/Command/Agent/Output Style/prompt Hook 会屏蔽 sensitive 字段。manifest 的 `.mcpb/.dxt` 声明使用官方 `@anthropic-ai/mcpb` 校验与配置生成，按内容哈希解包到插件数据目录；普通 MCPB 配置来自 `pluginConfigs[pluginId].mcpServers[serverName]`，敏感配置来自 credentials 的 `${pluginId}/${serverName}` bucket。
- MCPB 安全边界：压缩包限制下载体积、条目数和解压总量，拒绝绝对路径、路径穿越与符号链接；`server.entry_point` 必须留在解包目录，平台不兼容或缺少必需配置时不会启动服务。与 cc-haha 一致，单个 MCPB 下载、解包、manifest 或配置失败只记录到该插件的发现失败中，不会让健康的同级 MCP 服务或整个 Agent 工具发现失败。生产加载、配置分仓、局部失败隔离与恶意路径回归已接通。
- 插件配置引导已接通：设置页按 manifest 的 `userConfig` 与 MCPB 配置 schema 生成表单，普通值写入 `~/.zenme/settings.json`，敏感值只进入本地 credentials 文件且 API 不回传明文；配置保存会进入同一 ConfigChange/Hook 代际刷新路径。插件 LSP diagnostics 已接入统一诊断工具。macOS Keychain 写入和真实第三方插件桌面验收仍未完成，不能用模拟 Server 回归替代真机证据。
- 安全边界：插件 Agent 的 `permissionMode/hooks/mcpServers` 不从嵌套 frontmatter 获得额外权限；Project/插件级 Hook 由已信任的设置链继承。任何插件 MCP 都必须以当前 Project Workspace Root 为 cwd 并通过现有 MCP 权限边界。

## 后台通知与画布投影

- cc-haha 的后台任务终态进入统一消息队列，并按 agent ID 投递；模型不轮询。
- cc-haha 的 Shell 不负责“重启服务、枚举端口、猜预览 URL”这一业务流程；Zenme 同样删除主循环中的相同命令复用和三次重复结果硬停分支。开发服务只是一个 Shell 后台任务，页面入口必须来自真实命令输出或用户输入。
- 模型工具池中明确不存在 `restart_service`、`start_dev_server`、`scan_ports`、`open_preview` 或后台任务枚举工具。`openPreviewUrl` 仅是 AI 回复节点对最终明确 URL 的用户点击动作，不是 Agent 工具，也不能触发 Shell、端口发现或服务重启。
- Zenme 已使用每 Project 持久消息队列：用户追加指令以 `now`、普通用户消息以 `next`、后台终态以 `later` 入队；同优先级 FIFO。后台命令按 taskId 去重，Sub-agent 按 `agentId + completedAt` 去重，因此同一具名成员恢复后的新一轮完成不会被上一轮通知吞掉；服务实例中断后会从持久状态补投遗漏终态。终态先持久化，再以 `background_task`、`subagent_task` 或 `workflow_task` 触发 `Notification` Hook；这条旁路不允许重启任务或重新开启已完成 Turn。
- Shell 默认前台运行；模型协议与 cc-haha 一致，只有明确不依赖即时输出时才传 `run_in_background=true`，旧 `background` 字段仅保留在历史执行兼容层且不再进入模型 schema。超过交互预算时只把原进程转到后台，不重复执行。后台任务完成后主动通知，运行时不强制轮询，也不提供扫描监听端口、重启服务或猜测预览地址的专用工具。
- Shell 审批卡与后台任务卡始终展示模型提交的原始 `command`；PowerShell 的 `-NoLogo -NoProfile -NonInteractive -Command` 等宿主包装参数只存在于执行记录，不再泄露到用户主要交互。旧式 `executable + args` 请求仍按原协议显示。
- Shell 前台交互预算与 cc-haha 一致：普通长命令超过 15 秒后将同一进程转为后台；显式 `run_in_background` 立即转后台；`sleep` / `Start-Sleep` 不会被自动转后台。
- `task_create/task_get/task_list/task_update` 只表示共享开发计划，不能查询 Shell 进程；`task_output/task_stop` 只接受已知后台 taskId。cc-haha 的 `TaskList` 与 `TaskOutput` 是两套不同语义，Zenme 的提示与注册表必须保持同样边界。旧名 `project_task_list` 仅用于读取历史执行记录，不再暴露给模型。
- Shell 输出中的明确 loopback URL 会进入后续模型上下文；最终回答保留该 URL，AI 回复节点将其投影为可点击预览入口。代码块内的日志 URL 不生成入口，IPv6 loopback 会规范为 `localhost`。
- Project Session 仍是已消费消息和模型上下文的权威记录；运行态由 AI 回复节点投影，终态默认只展示最终回答，完整工具证据保留在 Execution Detail。后台终态只入队一次；若 Agent 已空闲则恢复原 Turn，由模型基于完成结果继续工作，而不是生成独立的新节点。
- `/context` 与 `/compact [整理要求]` 由同一 Project Agent 输入入口作为本地会话命令处理，不进入普通模型工具决策。`/context` 基于 compact boundary 与 microcompact 后的真实模型投影显示有效 token、模型窗口、自动压缩阈值、输出预留、checkpoint 和活动摘要；`/compact` 生成持久 checkpoint 后续接同一 Project Session。

## 完成门槛

以下完成门槛在 `main@d52bbec7` 基线上均已满足：

1. 默认外部、实际可达的表格能力均有生产实现和回归测试；ant-only、compile-time gated 与 dormant-only 路径已通过源码审计明确排除，而不是用 Zenme 的空壳功能冒充。
2. 普通对话、文件修改、测试失败恢复、后台开发服务、用户追加指令、审批、上下文压缩、Sub-agent 与工具搜索均通过 Project Agent 单入口完成。
3. 运行中画布只突出当前活动；Turn 结束后只保留最终回答、结果动作和可展开证据，不暴露内部通知或重复状态。
4. 2026-08-18 验证快照中的 `npm run check`、`npm run verify`、standalone runtime、Windows `desktop:pack`、packaged `desktop:smoke` 与真实 Spark Autonomy 验收均通过；后续工作树必须重新产生自己的验证记录。

表格中仍保留的“真实第三方服务/真机/MDM/macOS”文字是**集成认证清单**，不再作为当前外部默认 Agent Turn Runtime 的未完成项；若未来把这些平台能力纳入 Zenme 产品发布范围，应分别建立对应环境的认证门禁。
