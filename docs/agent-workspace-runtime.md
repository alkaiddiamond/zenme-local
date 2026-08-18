# Agent Workspace Runtime

本文记录 AI Project Workspace Phase 4 的工程契约。Agent 复用现有 `Execution → NodeRun → Attempt` 证据链；工具调用、审批命令和阶段日志保存在独立的 Agent Execution Detail 中，不写入 Canvas Snapshot。

## 统一 Project Agent Turn

- 每个画布对应一个持久化 Project Agent Session，聊天和任务共用 `/api/projects/{projectId}/agent-session/turns` 单一入口。
- 普通问题直接形成 assistant 事件；需要读取、搜索、提案或命令时，同一个 Turn 在服务端进入工具循环，不再由前端分别判断“聊天”或“执行”。
- Session 保存完整瀑布事件；发给模型的是独立投影，可清理旧工具正文并在阈值处压缩，不改写用户可见历史。
- 画布只提供一种面向用户的 Agent 入口：创建 `textGeneration` 输入节点，并在其下游创建带 Turn 瀑布流的 AI 回复节点。浮动按钮、单节点动作和多选工具栏都只是在创建同一种输入节点；用户不需要预先区分聊天、Workspace Agent 或 Global Agent，统一 Project Agent 根据任务自主决定是否调用工具或 `delegate_tasks`。运行中只展开当前阶段并显示已完成步数，完成后收起工具、思考、状态与压缩事件为“执行记录”。旧 Agent Execution 与 Global Orchestration 节点继续兼容读取和渲染，但不再作为新任务入口。
- 失败或主动停止的 AI 回复节点提供显式“重试”。重试复用原 `turnId/resultNodeId` 并在原 AI 回复节点中恢复运行，读取原 user event 持久化的提示、模型、`canvasContext`、`selectedNodeIds` 与 `fileDocumentIds` 快照；失败状态和旧工具证据在同一 Turn 审计历史中保留，不再创建新的下游 AI 回复节点。
- 同一项目同一时刻只运行一个 Turn。不同项目可独立运行。
- GPT-5.6/OpenAI-compatible Chat Completions 与 Responses 服务商使用原生 function/tool calling；Responses 事件会转换为统一工具调用流，再进入同一 Session、权限和执行循环。一次响应中的多个原生工具调用按 provider index 完整保留，主 Agent 和 Sub-agent 会处理完整批次后才再次请求模型，不再静默丢弃第二个及后续调用。模型只被允许批量发出相互独立的读取工具；写入、命令和交互动作仍逐次经过原有权限与顺序边界。不支持原生工具的服务商保留严格 JSON 决策协议作为兼容层，该协议不是第二个用户入口。
- 历史 Workspace Agent / Global Agent 画布节点只保留既有记录读取、审计和必要停止操作，不再重新进入模型运行时。新任务只从 Project Agent Turn 创建；画布客户端只负责启动、恢复、轮询与展示当前 Turn，不解析模型决策，也不维护第二套权限、聊天消息或命令状态。
- Project Agent Turn 的启动请求只负责注册项目级服务端作业并立即返回 `202`；实际模型循环不绑定渲染器请求信号。AI 回复节点轮询持久化事件，切换项目或刷新后会恢复瀑布流。旧 `agentExecution/globalAgent` 画布节点只保留查询、审计、ChangeSet 回看与停止仍在运行的历史任务，不再提供独立创建、规划、批准、重试或续跑入口。
- 模型正文不再等完整响应结束才显示。Provider 的文本 delta 会合并到当前 Turn 唯一的 `assistantDraft` Item，并以 250ms 级活动轮询更新 AI 回复节点；最终答复原子替换草稿，进入工具调用、审批、失败或停止时草稿被清理。兼容层的 JSON 工具协议不会作为正文闪现，草稿也不进入模型上下文、Memory 或压缩摘要。
- 后台命令是 `shell_command` 的执行模式，不是模型需要枚举或轮询的第二套工作流。Shell 默认前台执行，2 秒后在同一工具事件节流更新进度，15 秒仍未退出时将同一进程转为后台；显式 `run_in_background=true` 则立即返回。结果包含稳定 `taskId`、有界预览和保存完整输出的 `outputFilePath`，后续可按已知 ID 调用 `task_output/task_stop`，也可用 `read_file` 按行读取该精确输出文件。任务进入终态时，运行时向原 Agent 注入一次内部通知；`task_list` 只列出共享开发任务，不枚举后台进程，最终答复中的明确 loopback URL 由界面投影为用户可点击的预览入口。
- 前台 Turn 完成后，仍在运行的后台命令作为运行时投影显示独立的“后台任务运行中”项目、命令和停止按钮；停止请求由服务端按 `projectId + taskId` 校验并终止进程树。任务终态后活动项消失，内部通知不会作为普通聊天正文长期铺开，完整记录仍保留在执行证据中。
- 每个 Turn 持久化真实的 `规划 → 思考 → 工具 → 思考` 阶段转换；运行界面只突出当前活动，完成后折叠临时状态。内置工具与动态 MCP 工具统一使用面向用户的活动标签，内部工具标识仅保留在执行证据中。
- 后台任务契约以本节为准：模型侧 `task_list` 对齐 cc-haha 的 TaskList，只处理共享开发任务；它不是后台进程列表。后台进程内部列表仅供运行时恢复和管理界面使用。
- 工具名称、描述、权限类别、Workspace 依赖、参数示例和运行时校验集中在 `lib/agent/tool-registry.ts`。Project Agent 与 Workspace/Sub-agent 共享该注册表，禁止分别维护不同的硬编码工具名单。
- 所有已开始执行的内置工具、MCP 调用和 Sub-agent 协作消息统一经过 `lib/agent/tool-execution-pipeline.ts`：参数校验后依次运行 PreToolUse Hook、硬权限判断、实际执行以及 PostToolUse/PostToolUseFailure Hook。Pre Hook 可以改写参数或收紧为询问/拒绝，但 `allow` 不能覆盖 Workspace、MCP 或命令的硬权限拒绝；执行一旦开始，Execution 中的 Tool Call 必须且只能结束一次。用户、项目、local、管理员托管设置和显式启用插件都可以声明持久 Hook；`allowManagedHooksOnly`、`disableAllHooks` 与 `strictPluginOnlyCustomization: ["hooks"]` 在加载时执行 cc-haha 相同的来源限制。
- Project Skill 从每个可读 Workspace Root 的 `.zenme/skills`、`.claude/skills`、`.agents/skills` 和用户级技能目录发现。列表为项目 Skill 标注稳定 `rootId`；不同 Root 的同名 Skill 同时可见，主 Agent 通过 `rootId` 精确加载，Sub-agent 的 `skill` 工具则自动绑定到其任务 Root 并拒绝跨根切换。Root 内优先级保持 `.zenme` → `.claude` → `.agents`，项目 Skill 优先于同名用户 Skill。
- 当前交互会话与 cc-haha 的 Task V2 一致，只向模型暴露 `task_create`、`task_get`、`task_list`、`task_update`。最新结构化任务计划独立保存在 Project Agent Session 中，跨 Turn、重启和上下文压缩继续进入模型上下文；每次创建或更新同时形成 `todo` 瀑布投影，运行中展示当前进度，Turn 结束后保留最新快照。`todo_write` 仅保留在旧 Execution / Session 的持久化类型、审计展示和模型上下文迁移层；当前 Tool Registry 不向模型暴露，通用 Agent Tool API 也拒绝执行，新 Sub-agent 默认工具池同样不会包含它。
- 长任务和多 Agent 协作使用项目级共享任务对象。Task V2 任务拥有稳定 ID、完整描述、负责人、状态和依赖；更新在 Project Session 锁内原子提交，循环依赖和删除仍被依赖的任务会被拒绝。主 Agent 与长期 Team 成员读取同一列表；一次性 Orchestration Sub-agent 只执行父 Agent 已分配的任务，不获得共享任务或 `send_message` 工具。后台进程由 Shell 返回的稳定 ID、终态通知以及主 Agent 针对已知 ID 的 `task_output/task_stop` 管理；进程枚举只供运行时与管理界面使用，不进入模型工具集。
- 多 Agent 同时提供两种明确语义：`delegate_tasks` 是一次性、可带依赖的并行批次；`team_create/agent_spawn/send_message/team_delete` 是参照 cc-haha 的持续团队。每个 Project Session 同时只允许一个未关闭团队，成员名称在团队内唯一；主 Agent 可按名称定向发送、广播或发出结构化 `shutdown_request`。成员完成后保留同一 Execution 与会话历史，再次收到消息时重新唤醒而不是创建同名副本。成员终态由运行时主动写入父 Turn 的后台通知，模型不通过列表工具轮询。团队仍有活动或等待成员时禁止删除，成功删除只归档审计记录，不抹除 Execution 和消息证据。
- 每个新 Turn 在第一次模型调用前，会以当前用户请求对已就绪的 Project Knowledge 执行一次本地、有限的混合召回。最多注入 8 条、16000 字符预算内的文件/符号/画布/Execution/ChangeSet/Memory 证据，只包含标题、路径、评分、关系依据和匹配片段，不注入实体完整正文。索引缺失、暂停、过期或不可读时安静降级，不阻断普通对话；模型需要更深证据时仍可显式调用 `search_knowledge`。
- 运行中的 Turn 接受同一输入框追加指令。补充指令先作为 `user/source=steering` 事件持久化，再递增运行时版本；若旧模型响应随后返回，Runtime 会丢弃旧决策并用包含补充指令的最新 Project Session 上下文继续，而不会新建平行 Turn。追加指令必须携带持久化 `turnId`，Runtime 会拒绝把旧节点的输入误投到同项目另一个活动 Turn。AI 回复节点自身保持运行态；渲染器刷新或面板重开后，停止与追加指令会从节点恢复 `turnId`，不依赖已丢失的前端 `AbortController`。工具或后台进程执行期间收到的指令在当前不可中断步骤结束后消费，空输入仍保留停止入口。
- 主 Turn 最多允许 200 次工具决策作为异常服务商的最终保险，不再用较小轮数截断正常的复杂开发任务。普通工具成功或失败都像 cc-haha 一样作为结果返回下一轮模型，由 Agent 诊断、改道或完成；Runtime 不再用“三次相同结果”生成伪回答，也不在主循环中识别或复用所谓“相同服务启动命令”。Sub-agent 同样遵循这一规则，并只受自身最大轮数、权限边界和进程安全上限约束。
- 长 Turn 的完整工具事件始终保存在 Session 和可追溯执行记录中。提交模型前的 microcompact 投影对齐 cc-haha 的工具边界：只处理 `read_file`、Shell、Glob/Grep、WebSearch/WebFetch、Edit/Write/ApplyPatch/NotebookEdit 等可重建结果；审批、任务、记忆、浏览器、MCP 和其他持久状态永不因“太旧”而被清掉。策略至少保留最近五个可压缩工具结果，并按原始事件与占位符的实际 token 估算差值判断，新增释放不足 4,000 tokens 时不触发。触发后 Session 追加一次 `compact/kind=microcompact` 边界，画布显示释放量；完整原始事件不改写，后续模型投影复用已记录 ID，不重复压缩或刷屏。正在运行、待审批和等待输入的事件同样受保护，因此提升循环容量不会牺牲恢复与审计能力。
- 主 Agent 和并行 Sub-agent 自动加载每个可读 Workspace Root 中的 `AGENTS.md`、`CLAUDE.md`、`CLAUDE.local.md`、`.claude/CLAUDE.md` 与 `.claude/rules/*.md`。根目录规则从第一次模型调用起生效；Agent 的工具参数触及某个 Root 的子目录后，下次模型调用只按该 `rootId` 从根到子目录加入更具体规则，不会把主根同名目录的规则误用于附加根。这些项目指令在上下文中带稳定 Root 标识，属于 system context 的受控组成部分，但不能扩大 Workspace 能力、改变会话权限或绕过 ChangeSet/命令审批。
- `code_diagnostics` 是模型可自主选择的结构化 observation，不由 Runtime 在完成前强制插入。诊断器读取 Workspace 内的 `tsconfig.json`/`jsconfig.json`，返回结构化文件、行列、错误码与严重级别；对尚未应用的 Agent/Sub-agent ChangeSet 使用内存覆盖层分析提案后的代码，不会为了诊断提前写盘。没有支持的配置时明确返回 `available=false`，该结果不等同于测试通过，Agent 仍需按风险运行相关项目检查。

## 通用 Agent 默认设置

- `defaultSessionPermissionMode` 只有三档：`untrusted`（采取操作前始终询问）、`onRequest`（请求提升权限时询问，默认值）、`neverAsk`（受阻动作直接失败）。所有模式都不会越过 ChangeSet 与命令一次性审批硬边界。
- 通用设置保存默认文本模型、与 Codex 一致的四档推理强度（轻 `low`、中 `medium`、高 `high`、极高 `xhigh`）和速度（`standard / fast`）。节点对话可对单个 Turn 覆盖推理强度与速度；未覆盖时使用通用默认值。GPT-5.6 Responses/Chat Completions 映射到真实 reasoning effort，快速模式映射到 Priority service tier；不支持这些参数的服务商保持默认行为。短期六档版本中的 `none` 向前迁移为“轻”，`max` 向前迁移为“极高”。
- Project Agent 的 system prompt 固定注入统一决策循环：先明确完成条件和授权范围，再选择最小充分路径，逐次读取工具真实结果，完成前核验结果与证据。该策略指导模型内部推理，但不要求暴露私有思维链。GPT-5.6 Responses 请求会启用可展示的 `reasoning.summary=auto`，摘要增量经统一模型流分批写入 `thinking` 事件；瀑布流在运行中展示简短摘要、工具记录与审批，Turn 完成后回到最终结果投影。
- 节点为本 Turn 选择的模型、推理强度（轻/中/高/极高）和速度（标准/快速）写入原始用户事件，命令审批、用户回答、后台任务通知和应用重启后的恢复均复用同一配置。`delegate_tasks` 创建的 Sub-agent 同样继承该 Turn 的推理强度和速度，不在中途退回全局默认值。
- 等待用户回答或命令审批只暂停当前 Turn，不创建第二条执行轨迹。恢复时按稳定的 `turnId/resultNodeId` 找回原父级 Agent Execution，后续工具调用、命令记录与最终答案继续写入同一 Execution；应用重启后 `waitingInput` 与 `waitingApproval` 都作为可恢复等待态保留。
- `autoDreamEnabled` 默认关闭。开启后，每累计至少 12 条新的用户/助手文本事件，会在主 Turn 完成后后台调用当前模型，生成一条带 Session 来源的候选 Project Memory；候选必须由用户确认后才能进入长期上下文。调度时先同步写入 `memory/running` 事件，再在后台写入 `candidate` 或 `failed` 终态；AI 回复节点与 Agent 面板在该终态到达前继续轮询，因此 Memory 变化不会因主 Turn 已完成而丢失。后台失败只写入 Memory 事件，不影响主会话结果。

## 用户闭环

用户从画布选择上下文并提交任务后，系统创建一个 `agent` Execution。Agent 只能使用以下 Workspace 工具：

```text
workspace_status
list_directory
glob_files
search_files
code_diagnostics
code_intelligence
view_image
search_knowledge
web_search
web_fetch
browser
read_file
write_file
edit_file
apply_patch
notebook_edit
propose_patch
propose_memory
shell_command
task_output
task_stop
delegate_tasks
task_create
task_get
task_list
task_update
skill
tool_search
git_diff
ask_user_question
run_approved_command
```

后台进程列表只属于运行时恢复和 UI 投影，不是 Agent 工具，也不会进入 ToolSearch 或工具协议。`skill` 对齐 cc-haha 的 Skill 语义：Runtime 从 Workspace 的 `.zenme/skills`、兼容目录 `.claude/skills` / `.agents/skills`，以及 Zenme 本地数据目录的 `skills` 中发现 `SKILL.md`。系统上下文只注入有界名称与描述；匹配任务时模型显式调用 `skill` 才加载完整指令和参数。技能文件经过真实路径边界检查，单文件限制为 100 KB。

`browser` 补齐 cc-haha WebBrowser 与 Codex 开发预览验证的核心闭环。Electron 主进程为每个 Agent Execution 创建独立、无用户登录态的隐藏 Chromium 会话；顶层导航只接受 `localhost`、`127.0.0.1` 或 `::1` 的 HTTP(S) 地址，新窗口、权限请求和外部导航全部拒绝。模型不能执行任意 JavaScript 或 CSS selector，只能先读取由固定脚本生成的有界页面文本与可交互元素引用，再调用 `click/type/press` 操作该引用；引用随每次 snapshot 重建，失效时必须重新观察。`navigate` 必须接收用户或 Shell 输出提供的明确 URL，不接受后台任务 ID，也不扫描端口或等待猜测出的预览服务。`screenshot` 或 `includeScreenshot` 会把当前页面 PNG 作为下一轮原生多模态输入；Base64 只存在于当前内存推理轮次，Session、Execution 和 Canvas 仅保存尺寸、页面标题、URL、文本与元素元数据。`untrusted` 会话允许观察页面，但 `click/type/press` 会转成当前主 Turn 的一次性确认，用户批准后自动恢复同一 Execution 并只执行原精确动作；Sub-agent 无权直接向用户提问，因此在该模式下遇到交互动作会明确停止并交回主 Agent。最多保留 8 个浏览器会话，空闲 10 分钟自动销毁；桌面应用退出时统一关闭。普通 Web/CLI 开发环境没有 Electron 控制器时明确返回不可用，不伪装验证成功。

`write_file`、`edit_file`、`notebook_edit` 与 `apply_patch` 统一先形成 ChangeSet，保留基线哈希、原子应用与回退证据；敏感路径、链接逃逸、跨 Root 和 Sub-agent 范围外路径在写盘前拒绝。`read_file` 除 400 行分页边界外，对实际返回内容采用与 cc-haha 相同的 25K token 上限，巨型单行 JSON/日志会要求缩小行范围或先搜索，不能直接灌入模型上下文。`code_diagnostics`、`code_intelligence` 与 `view_image` 分别提供编辑后诊断、语义导航和原生多模态观察，持久层不保存图片 base64。`shell_command` 对齐 cc-haha 的 Shell 生命周期：短命令前台完成，15 秒未退出时同一进程原地转后台；显式后台立即返回同一进程的稳定 `taskId` 与 `outputFilePath`。模型没有后台进程枚举、端口扫描、服务重启或 `open_preview` 工具；`task_output/task_stop` 只接受 Shell 已返回的已知 ID。后台终态进入统一消息队列；当前循环仍在运行时于下一次迭代注入，循环已经结束时自动恢复原 Turn，让模型依据终态继续完成用户目标。后台输出停滞 45 秒且末行匹配常见交互提示时只通知一次，Agent 应停止原任务并使用管道输入或非交互参数重试。开发预览仅使用用户输入、Shell 输出或最终答复中真实出现的 loopback URL；Browser 必须接收明确 URL。`glob_files/search_files/read_file` 继续受 Root 与路径边界约束。共享开发计划只使用 `task_create/task_get/task_list/task_update`。`tool_search` 只发现当前注册表中真实可调用的工具；MCP 与重型内置工具在当前 Turn 内按需激活，恢复同一 Turn 时复用激活结果。

所有文本/JSON 工具结果还会经过统一的大结果边界：默认超过 100,000 字符（搜索结果为 20,000 字符）时，完整结果写入项目内部 `agent-tool-results`，Execution 与模型上下文只保存有界预览、原始大小和当前 Execution 可读取的精确路径。`read_file` 自身不进入该持久化流程，避免 Read→结果文件→Read 的循环；图片、Browser、Shell 和 TaskOutput 继续使用各自的二进制或输出文件协议。

统一工具注册表同时生成运行时校验与服务商原生 function schema。原生 schema 明确列出全部支持参数、必填字段、枚举、嵌套任务结构和 `additionalProperties: false`，并原样传递到 OpenAI Responses 与 OpenAI-compatible Chat Completions；不再从参数示例猜测一个“全部可选”的宽松对象。`shell_command` 通过互斥 schema 表达首选完整脚本与兼容 `executable + args` 两种协议，避免模型混用后到运行时才失败。

父 Project Agent Turn 的停止会级联到本 Turn 创建的 Global Orchestration、Sub-agent Execution 及其仍在运行的命令进程；Agent 所属命令被清理时会先标记停止意图，再由进程退出回调持久化为 `stopped`，不会误写成普通命令失败。显式停止状态在后续刷新和聚合时保持为 `stopped`，不会被终态汇总误写成 `failed`。这与 cc-haha 的父 AbortController 传播和 Agent 退出时清理 Shell 任务保持同一生命周期语义。

“启动开发服务”只映射为一次 `shell_command`。Shell 输出包含明确 loopback URL 时，模型在最终答复中原样保留，界面投影为可点击入口；没有 URL 时只报告任务已经启动、稳定 taskId 和 outputFilePath，不猜测端口、不扫描进程树、不重启命令。只有用户明确要求验证页面且已有明确 URL 时，Agent 才调用 `browser`；是否在系统浏览器中打开由用户点击决定。

`delegate_tasks` 把已有 Global Orchestration 接入同一个 Project Agent Turn：主 Agent 可以提交 1–8 个带依赖、稳定 `rootId`、最小路径范围和工具白名单的任务，服务端按并发预算创建独立 Execution，并使用与主 Agent 相同的原生 function/tool calling 适配层并行推进。每个 Sub-agent Execution 将文件、诊断、补丁、Git 与命令工具强制绑定到分配的 Root；省略 `rootId` 时自动注入，显式切换到其他 Root 会在工具落盘或命令提案前拒绝。同一相对路径只有位于同一 Root 时才构成任务冲突。Sub-agent 不能再次委派，文件操作仍形成独立 ChangeSet，命令仍由结构化策略、Root 边界与会话权限复核；`onRequest` 自动执行无需提升权限的 Workspace 内结构化开发命令，安装依赖、联网/系统管理命令和 Workspace 外目录不会被隐藏批准。主 Turn 等待调度返回后再汇总结果；运行中瀑布流展示并行完成数和当前任务，完成后若存在 ChangeSet，AI 回复节点保留统一审阅入口，因此并行 Agent 不再要求另开一个对话入口。

`delegate_tasks` 内部的命令请求不是普通工具成功结果。Runtime 将子 Execution 的待审批命令提升为当前父 Turn 的 `approval` 事件；用户批准或拒绝后，父 Turn 先恢复原 Global Orchestration，收集更新后的子任务结果，再继续同一轮模型调用。Sub-agent 不直接向用户提问，缺失信息只能上报父 Turn。

审批瀑布流按 `commandRequestId` 归并事件，只展示仍未处理的命令。某条命令后续出现批准、拒绝、失败或成功事件后，其历史 `pending` 卡片立即失效；并行 Sub-agent 的其他未决命令仍按创建顺序继续展示。

会话权限与 Codex 的三档语义对齐：`untrusted` 允许安全读取和创建仍待用户审阅的 ChangeSet，但每条命令都进入逐次审批；`onRequest` 可在 Workspace 范围内自动运行已声明且无需提升权限的项目脚本，其他命令请求审批；`neverAsk` 不弹审批，原本需要提升的操作直接失败。设置页只保存新 Session 的默认值；节点输入框中的选择持久化到当前 Project Agent Session，不会改写其他项目的默认权限。任何模式都不会让 Agent 绕过 ChangeSet 直接写 Workspace。Git 查询保持只读可用；`init/add/commit/branch/checkout/merge/rebase` 等本地写操作必须先在 Workspace 面板明确启用目标 Root 的 `gitWrite`，且执行前重新校验；`fetch/pull/push/remote/config/credential` 等联网或敏感操作即使已经启用 `gitWrite` 仍逐次审批，`reset --hard` 等破坏性命令直接拒绝。一次性授权的 Workspace 外目录只对该精确命令有效，不会静默转成项目级 Git 权限。

`web_search` 是可观测的候选来源发现工具，只把少量 URL 交给 Agent，检索服务返回的聚合正文不会进入模型上下文。`web_fetch` 必须同时提供 URL 与提取目标；它读取公开 HTTP(S) 页面后，在禁止自动联网的隔离模式中调用页面分析模型，产出页面级 `summary + claims + evidence/date`，原始正文不会进入主 Agent 会话。主 Agent 再跨页面综合、合并重复事实并处理来源冲突。“最近、新闻、影响、现状、进展、对比、核实”等开放性检索必须分析至少两个独立来源（候选充足时使用不同域名），指定单页问题可以只分析该来源。该门槛只约束后台取证，不规定最终展示多少链接；运行时还会拒绝引用未读取 URL 的回答。`web_fetch` 拒绝本机、私网、带凭据、异常端口、非文本和超限响应，并逐跳复核重定向目标。`ask_user_question` 会把结构化问题与最多三个选项写入时间线，并将 Turn 暂停为 `Waiting Input`；用户通过同一对话入口回答后恢复同一个 Turn。

Plan Mode 对齐 cc-haha 的会话状态机，而不是额外建立“只生成计划”的对话入口。普通模式仅在实现路径存在重大歧义或高影响重构时向模型暴露 `enter_plan_mode`；调用后无需用户先确认，Project Session 立即切换为 `interactionMode=plan` 并继续同一 Turn。规划模式只向模型暴露读取、搜索、观察、提问、Todo、只读 MCP 与 `exit_plan_mode`，文件写入、Shell、Sub-agent 和有外部副作用的 MCP 同时在工具暴露层与运行时边界拒绝。`exit_plan_mode` 必须携带完整计划，AI 回复节点在原时间线内展示计划并等待用户批准；批准后恢复普通工具集并继续原 Execution，拒绝或补充反馈则保留规划模式和待修订计划。计划状态随项目 Session 持久化，重启或等待输入后不会丢失。

确定性网页路由只处理明确的搜索/联网请求，或“时间词 + 易变领域”（例如最新版本、近期新闻、当前价格）。单独出现“当前”“现在”不会触发联网，因此“解释当前项目”“检查现在的代码结构”等开发请求仍由统一 Project Agent 处理；模型在确有需要时仍可通过统一工具池自主调用网页工具。

## MCP 工具扩展

- 设置页的“MCP 工具”维护本机 stdio Server。配置随本地 `settings.json` 保存，不同步到远端；首版不接收或回显环境变量密钥，Server 继承官方 SDK 的最小安全环境变量集合。
- Server 进程以调用所属的稳定 Workspace Root 为 `cwd` 启动。主 Agent 默认使用主根；Sub-agent 的 MCP 工具发现、资源读取与调用强制使用任务 `rootId`。连接缓存键包含 Project、Root 和 Server，附加根不会复用主根进程；目标 Root 未解析、不可读取或未授予命令执行能力时不启动。连接、工具发现和单次调用都有独立超时，一个 Server 失败不会阻断其他 Server，失败会写入当前 Turn 的运行记录。
- 工具发现后按 `mcp__{server}__{tool}` 规范化，但不会把全部定义预先塞入每次模型调用。模型先通过统一的 `tool_search` 按名称、Server 和描述检索；只有命中的工具会在当前 Turn 动态加入原生 function calling。激活结果随 `toolResult` 持久化，同一 Turn 暂停、审批或重启续跑时会恢复，下一 Turn 则重新按需发现。工具输入先按 Server 提供的 JSON Schema 校验，输出限制为 100,000 字符，二进制内容不会直接注入模型上下文。调用记录与内置工具一样进入 Project Agent Event 和 Agent Execution Detail。
- `list_mcp_resources` 与 `read_mcp_resource` 用于枚举、读取 Server 公开的资源。文本资源受统一上下文长度限制；二进制资源只返回 URI 与 MIME 元数据，不把 Base64 正文注入模型。
- 新 Server 默认“只读”，只暴露明确声明 `annotations.readOnlyHint=true` 的工具。用户在设置中把该 Server 切换为“完全访问”后，才会暴露可能写入或产生外部副作用的工具。MCP annotation 只是筛选提示，不会扩大 Workspace、ChangeSet、命令沙箱或桌面 IPC 的固有边界；启用不可信 Server 等同于允许运行本机第三方代码。

## 状态与持久化

完整状态显示为：

```text
Planning → Searching → Reading → Editing → Waiting Approval | Waiting Input
        → Testing → Completed | Failed | Stopped
```

- 核心 Execution 保存在 `projects/{projectId}/executions/index.json`。
- Agent 详情保存在 `projects/{projectId}/executions/agent/{executionId}.json`。
- 新建 Agent 详情同时持久化 `resultNodeId` 与 `triggerNodeId`，用于服务重启后把后台任务终态重新关联到原始 AI 回复节点；旧详情缺少这两个可选字段时仍按原格式读取。
- 详情记录有界工具事件、ChangeSet ID、命令审批和结果摘要；Workspace 文件正文不进入 Canvas Snapshot。
- 进程重启后，无法续接的活跃工具或命令进入 `Interrupted`；等待审批和等待用户输入的记录保持等待状态，可在原 Turn 与原 Execution 上继续批准、回答或停止。
- 每次本地服务启动都有独立运行实例 ID。后台命令记录其托管实例；查询时发现所有者已变化会原子转为 `Stopped`，不再作为运行中任务注入后续 Turn。Windows 桌面退出或重启本地服务时使用进程树终止，避免 Next 服务退出后遗留 pnpm/Vite 子进程和占用端口。
- Windows 命令结束以直接子进程的 `exit` 事件为准，不等待可能被孙进程继承的 stdio `close` 事件。终止后台任务前先快照父子进程关系，按最深后代到根进程的顺序清理，再等待 Agent 命令状态持久化为终态；这避免 `npm → cmd → node` 中孙进程遗留、端口继续占用以及测试目录因句柄未释放而无法删除。
- Project Agent Turn 的轮询同时核对服务端作业注册表；事件流仍显示运行、但当前实例已无对应作业时，会补写 `Failed` 终态并提示重试，避免重启后永久停留在“Agent 正在处理”。轮询任何已有终态 Turn 时还会按稳定 `turnId/resultNodeId` 幂等对账对应的运行中 Agent Execution，因此旧版本遗留的 `running`/`waitingApproval` 幽灵记录会自愈为相同的成功、失败或停止终态，不要求破坏性数据迁移。
- 重试复用同一 Execution 并创建新的 Attempt，历史工具事件不覆盖。

## 路径与权限

- 每个文件、检索、诊断和命令工具按目标 Root ID 独立检查 `resolved` 与 capability；主根不可用不会隐式授予附加根，也不会让已授权的附加根失去独立身份。
- 文件工具路径只接受规范化 Workspace 相对路径；绝对路径、`..`、NUL 和链接逃逸均拒绝。命令可提出 Workspace 外绝对 `cwd`，但必须由用户批准单次执行或加入项目附加 root，并在执行前复核目录身份。
- 图片观察额外限制源文件为 20 MiB、输入为 4000 万像素、处理后为 8 MiB；模型每轮最多接收 4 张、合计 3200 万字符的数据 URL。原始图片与转换结果都不会写入项目持久化数据。
- 忽略目录和敏感文件不会出现在 Agent 列表、搜索、读取、Diff 或提案中。
- `apply_patch` 与 `propose_patch` 继续复用 ChangeSet 的 `write`、`delete`、基线哈希和原子应用边界；补丁解析不会直接修改 Workspace。
- 未经授权的命令不能执行；`onRequest` 下无需提升权限的结构化开发命令可在 Workspace 范围内自动执行，安装依赖、联网/系统管理命令和越界目录仍生成精确 Command Request。对需要提升权限的精确请求进行单次批准，本身构成本次执行授权。

## 命令协议

- 首选 `command` 完整脚本协议，兼容旧 `executable + args`；脚本由平台固定外壳执行，但始终使用 `shell: false`，原始文本独立持久化和展示。项目普通开发操作在 Windows Root、命令策略和会话权限边界内自动执行；安装依赖、联网/系统管理命令及越界目录标记为“必须明确批准”，在“从不请求审批”模式下直接失败。直接拒绝、命令异常或工具循环异常都会同步结束对应 Agent Execution；只有真实等待审批、等待输入或仍在运行的后台任务可以保留非终态，避免重启恢复时出现幽灵 `running` 记录。
- Shell 默认以前台方式运行；2 秒后把有界输出和耗时原地更新到同一工具事件，完成后由最终 Tool Result 取代临时进度。命令持续 15 秒仍未结束时，Runtime 保留原进程并自动转成后台任务；显式 `run_in_background: true` 则立即返回。Shell 结果包含稳定 taskId 与 `outputFilePath`，Runtime 在终态主动通知；需要诊断时可用 `read_file` 读取该精确输出文件，需要停止时使用已知 taskId 调用 `task_stop`，不得列举或轮询任务。
- Command Request 以 `rootId + command? + executable + args + cwd + timeoutMs` 结构化保存；`command` 是用户可读脚本，`executable + args` 是固定的实际调用。旧记录缺少 Root ID 或 `command` 时分别按主根和旧结构化协议读取，不使用 `shell: true`。
- `cwd` 默认在 Workspace 内；外部绝对目录会触发节点内“运行一次 / 加入项目”授权，命令和参数在批准后不可修改。
- 环境变量采用最小允许列表，不继承 API Key、Token 或代理认证信息；Windows 同时保留 PowerShell/进程启动所需的系统变量，并把本地服务宿主 Node 目录加入 `Path`，使 PowerShell 内启动的 npm/pnpm shim 能找到同一 Node 运行时。PowerShell 优先使用可用的 `pwsh`，再回退系统 Windows PowerShell。Shell 提案先由该 PowerShell 的原生 Parser 解析完整 AST；权限判断遍历全部管道和复合子命令，并按常用 cmdlet 的路径参数、位置参数和重定向目标解析读写范围。工作区内确定路径可继续执行；越界、UNC、`.git` 内部、链接逃逸、未知参数、动态调用、成员调用、环境值泄漏、敏感 cmdlet、语法失败或解析器不可用均不会降级为静默自动执行。

### Windows 命令隔离

原生 Windows 默认采用与 cc-haha 一致的可用性边界：不启用进程沙箱，命令由工具白名单、声明脚本校验、Workspace 路径校验、会话权限与高风险命令审批共同约束。这样 Vite、tsx、esbuild、Turbo 等真实开发进程树可以正常工作；文件工具仍只能在已授权 Workspace Root 内操作，越界目录、安装依赖、联网或系统管理命令仍需明确批准。

应用不再打包或注入 Codex Windows 沙箱运行器。开发服务是否成功由 Shell 退出状态和项目自身输出判断；Runtime 不通过端口扫描、预览等待或自动重启改变命令生命周期。

命令记录中的 `sandboxMode` 与 `sandboxBackend` 用于区分 `workspace-write`、单次 `danger-full-access` 以及实际使用的 Windows 后端。
- stdout/stderr 有大小上限并脱敏 Workspace 绝对路径；超时、停止和客户端中断都会清理进程树。
- 每个批准只允许消费一次；失败后需要新请求或显式重试。

## 需求—证据矩阵

| 要求 | 自动化证据 | Windows 真机证据 |
| --- | --- | --- |
| 路径封闭 | 绝对路径、`..`、链接逃逸、敏感/忽略路径测试 | 真实 Workspace 读取与拒绝逃逸 |
| 只经 ChangeSet 写入 | Write/Edit/NotebookEdit 均只生成关联 Execution 的提案 | Agent 提案进入 ChangeSet 面板 |
| 命令审批 | 未批准拒绝、一次性批准、cwd/allowlist/超时测试 | 批准测试命令、查看输出与停止 |
| 阶段与日志 | 状态迁移、事件上限、Canvas 快照不含日志测试 | 执行节点阶段与详情展示 |
| 恢复 | 活跃执行转 Interrupted，等待审批保留测试 | 执行中重启与审批中重启 |

## 2026-08-12 Windows 验证记录

- 在真实 Electron 开发进程重启后，使用绑定到本仓库的临时项目创建 `agent` Execution。
- 真实调用 `list_directory`，确认工具结果、阶段和完成摘要写入独立 Agent 详情；临时项目随后已删除。
- `npm run check` 通过：177 个 Vitest 文件、797 项测试与 14 项桌面进程测试。
- `npm run build` 通过，包含 Agent API 路由、执行节点与统一服务端执行入口的 TypeScript 校验。
- 前台窗口持续被用户切换，因此本轮没有继续自动点击命令审批按钮；该交互保留到最终桌面回归，未宣称已完成真机点击验证。

## 2026-08-16 Shell 生命周期收敛

- 删除模型侧后台进程枚举、`open_preview` 以及端口/进程树预览发现器；保留 cc-haha 语义的共享开发任务 `task_list`，不再把“启动开发模式”拆成重启、枚举、扫描和打开预览等多个 Agent 工具步骤。
- Shell 只启动一次真实进程。短命令前台完成；超过交互预算后原进程后台化并返回稳定 taskId/outputFilePath；终态通过统一队列进入原 Turn，并在 Agent 空闲时自动恢复循环。
- 预览入口只来自用户输入、Shell 输出或最终答复中真实出现的 loopback HTTP(S) URL；是否打开由用户点击或明确的 Browser 请求决定，不猜测端口。
