# Global Agent 与并行 Sub-agent

本文记录 AI Project Workspace Phase 5 的工程契约。Global Agent 是一次可审计、可停止的调度，不是永久聊天进程；每个 Sub-agent 复用 Phase 4 的受控 Agent Runtime。新任务统一由 Project Agent 在当前对话 Turn 内通过 `delegate_tasks` 创建并等待调度，不再要求用户切换入口。早期独立调度节点仅保留数据兼容与结果回看。

## 调度模型

一次 Global Orchestration 独立保存在：

```text
projects/{projectId}/executions/global/{orchestrationId}.json
```

记录包括目标、Context Evidence、任务依赖、并发与数量预算、Sub-agent Execution ID、稳定 Workspace Root ID、路径和工具能力、基线哈希、ChangeSet、冲突图、应用顺序及结果汇总。工具日志仍保存在对应 Agent Execution Detail 中，不进入 Canvas Snapshot。

任务规划会列出当前项目全部可读 Workspace Root，并要求每个任务选择一个稳定 `rootId`。调度器据此读取基线、加载该根的项目指令、创建 Execution，并把文件、诊断、补丁、Git 和命令工具强制限制在同一 Root。模型省略工具参数中的 `rootId` 时由 Runtime 自动注入；显式跨根会被拒绝。冲突检测使用 `rootId + relativePath`，因此不同根中的同名文件可以安全并行。

如果任务获得 `skill` 工具，Sub-agent 只列出分配 Root 的项目 Skill 和用户级 Skill；同名项目 Skill 优先。工具调用会自动注入任务 `rootId`，因此附加 Root 的构建或发布规则不会误加载主根版本。

用户先看到 Goal Decomposer 生成的 1–8 个任务并确认，再启动调度。默认并发为 2，上限为 4；每个 Sub-agent 最多执行 32 轮工具决策。依赖任务仅在前置任务成功后调度，前置失败只停止对应下游，不影响其他分支。

依赖不仅用于解锁。后置 Sub-agent 创建 Execution 时，调度器会把前置任务的结果摘要和 ChangeSet ID 作为结构化依赖结果附加到指令中，避免后置任务在不知道前置产物的情况下重新猜测或重复工作。

统一对话入口中的 `delegate_tasks` 由主 Agent 在确有独立工作流时调用，任务计划直接作为结构化工具参数进入相同的服务端校验。服务端 Sub-agent 使用服务商原生工具调用（不支持时才使用兼容 JSON 协议），当前上限为 32 轮；主 Turn 会等待所有可运行任务完成、失败、等待审阅或触及权限边界后再总结。Sub-agent 工具列表显式排除递归委派。与 cc-haha 的派生 Agent 一致，项目已启用的 MCP 工具进入同一动态工具池：默认只提供 `tool_search` 发现能力，命中后才把 Schema 加入当前 Sub-agent Execution；激活结果保存在工具历史中，审批或重启续跑不会丢失。自定义 Agent 的 `mcpServers` 可引用项目已启用连接，也可声明仅该 Agent 可见的 stdio/http/sse Server；内联连接以 `projectId + rootId + executionId + serverId` 隔离并在 Sub-agent 结束时关闭，项目连接继续按 `projectId + rootId + serverId` 复用。所有调用仍受任务 Root 的读取/执行能力及项目 MCP Server 的只读/完全访问配置约束。

工具调用失败不会立即杀死 Sub-agent。失败作为结构化工具结果保存在 Execution，并在下一轮交给模型，使其可以修正路径、参数或选择其他工具；Runtime 不根据三次相同结果生成伪回答或擅自结束任务，最终只受模型轮数、权限与进程安全上限约束。命令失败采用相同规则，但权限拒绝仍是不可绕过的终态边界。

Sub-agent 不获得 `ask_user_question`。它获得仅在受调度 Execution 内出现的 `send_message`：可向所属父 Agent 发送 `progress`、`question` 或 `blocked` 报告，但不能指定其他项目、任务或会话，也不能广播。报告持久化在 Orchestration 中，记录进子 Execution 工具历史，投影到父 Turn 瀑布流，并随 `delegate_tasks` 的结构化结果回流给父模型；依赖任务也会收到前置任务的报告。是否向用户提问仍由统一 Project Agent 父 Turn 决定，避免产生没有界面和 API 可以回答的悬空子状态。Sub-agent 命令需要审批时，审批卡片提升到原 AI 回复节点的父 Turn；批准或拒绝后恢复同一个 `orchestrationId` 和子 Execution，不会新建一轮委派或丢失命令历史。

除消息流外，主 Agent 与长期 Team 成员共享 Project Session 中的结构化任务列表。`task_create`、`task_get`、`task_list`、`task_update` 提供 cc-haha 风格的稳定任务 ID、负责人、状态与依赖；每次写入在项目锁内原子完成并形成 `todo` 瀑布事件。一次性批处理 Sub-agent 不获得这四个共享任务工具，也不获得 `send_message`，只执行父 Agent 已分配的任务并返回最终摘要；长期 Team 成员才拥有共享任务和具名消息协作。两类派生 Agent 都不能借此扩大路径、命令或 ChangeSet 权限。循环依赖、未知依赖以及删除仍被其他任务依赖的项目会在提交前拒绝。后台命令不会出现在 `task_list`，只由 Shell 返回的稳定 ID、主 Agent 的已知 ID 输出/停止与终态通知管理。

统一入口运行委派时，调度器以有界间隔读取每个子 Execution 的工具与命令记录，并把当前活动投影到父 Turn 的瀑布流。投影事件携带稳定的子记录 ID，重复轮询不会重复追加；委派计数也只在任务状态变化时持久化。投影仅服务 UI，不进入父模型上下文，模型仍使用 `delegate_tasks` 的结构化汇总，避免工具输出重复占用上下文。Turn 结束后，临时投影与其他运行状态一样折叠，只保留最终答复、失败结论、记忆、压缩和任务计划等持久结果。

与 cc-haha 的队友消息箱语义一致，统一 Project Agent 的运行中补充指令会持久化投递给该父 Turn 下仍活跃或排队的 Sub-agent。父消息由每个子任务原子认领一次，并在下一次模型决策上下文中注入；若消息恰好在模型调用期间到达，运行时丢弃尚未执行的旧决策，再用补充指令继续同一个 Execution。子报告与父指令使用同一持久消息流但按方向隔离，不会被子任务认领回自己。等待审批、刷新或服务重启不会丢失尚未认领的消息或未汇总的报告。当前 UI 不暴露任意 Agent 间广播；只允许父 Turn 向自己的子任务投递、子任务向所属父 Turn 报告，避免绕过任务、路径和权限边界。

历史画布 Global Agent 节点只用于读取既有 Orchestration、结果和审计证据；独立 planner/create/run API 已退役，不再恢复或重新执行旧规划入口。新任务统一由 Project Agent 调用 `delegate_tasks` 或 Team 工具创建 Orchestration；服务端调度器仍以项目级后台作业运行当前 Orchestration，关闭或刷新渲染窗口不会中断执行。当前运行时按 orchestration/execution ID 去重，停止操作会取消运行时并清理子任务进程。

## 隔离与权限

- 默认使用独立 ChangeSet 隔离；Sub-agent 不直接写主 Workspace。
- 自定义 Agent 可声明 `isolation: worktree`，或由 `agent_spawn` 显式请求。Runtime 从当前已提交 HEAD 创建 `zenme/agent-*` 临时分支与独立 worktree，把该目录注册为仅供任务使用的 Workspace Root，并继承原 Root 的能力边界。未产生改动时任务结束自动移除 worktree 和临时分支；有文件改动或新提交时保留路径、分支与起始提交供审阅，不自动合并、提交或推送。
- 自定义 Agent 可声明 `memory: user|project|local`。`MEMORY.md` 通过 `@agent-memory/MEMORY.md` 及其子路径暴露给普通 `read_file/write_file/edit_file`，不新增绕过工具生命周期的专用写入通道。user 记忆跨项目，project 记忆位于 Workspace 的 `.claude/agent-memory/<agentType>`，local 记忆仅属于当前 Zenme Project；单文件限制为 100 KiB，并拒绝路径穿越和越界链接。
- 自定义 Agent frontmatter 使用完整 YAML 解析，并可声明 `permissionMode`、`criticalSystemReminder_EXPERIMENTAL` 与 cc-haha 兼容的 `hooks`。`PreToolUse/PostToolUse/PostToolUseFailure` 进入统一工具管线；command Hook 仍受任务 Root、路径和危险命令边界约束；`SessionStart/SubagentStart/Stop/SubagentStop/SessionEnd` 进入同一 Sub-agent Execution 生命周期。Stop 验证失败会把理由回灌下一轮，而不是生成伪终态。
- 每个 Sub-agent 只有自己的 Working Memory、Execution、Workspace Root、允许路径前缀和工具集合。
- 工具执行和测试命令都再次校验路径范围；模型输出不能扩大能力。
- 获准使用 `view_image` 的 Sub-agent 可以观察自己路径范围内的界面与素材；图片只在相邻模型轮次中以原生多模态输入存在，Execution 仅记录路径和尺寸。
- 每个任务在调度前记录范围内文件的 SHA-256 基线，最多 2,000 个、单文件 4 MiB。
- 测试命令仍逐条等待用户批准，且只能消费一次。
- Git Worktree 仍是 Agent Execution 的可选隔离层，不是核心 Project 对象，也不自动获得 commit/push 权限。

## 冲突与结果归并

计划阶段先比较任务路径范围；执行后再按实际 ChangeSet 操作路径生成冲突边。计划冲突不会因尚未产生 ChangeSet 而消失。冲突只提示审阅和应用顺序，不自动合并，也不会静默覆盖。

所有 Sub-agent 完成后：

- 任一任务失败、超时、中断或停止，Orchestration 标为失败，但保留其他任务的 ChangeSet。
- 全部成功但仍有未审阅 ChangeSet 时进入 `waitingReview`。
- 所有关联 ChangeSet 已应用、拒绝或回退后进入 `completed`。
- Result Collector 保存每个任务的结果或错误摘要，并保留上下文选择与调度证据。

## 恢复

Orchestration 和每个 Sub-agent 都是磁盘持久化对象。应用重启后，Agent Runtime 将无法续接的工具调用标为 `interrupted`，等待审批保持可恢复；Global Orchestration 同步这些状态。排队任务保持排队，可继续调度；失败和中断任务可单独重试。

## 证据矩阵

| 要求 | 自动化证据 |
| --- | --- |
| 不重叠任务并行 | 并发派发两个独立 Execution；`lib/global-agent/delegated-runtime.test.ts` 用同步屏障证明两个 Sub-agent 同时进入首轮模型调用 |
| 不直接写主 Workspace | 提案后断言两个真实文件内容均未变化 |
| 权限最小化 | 跨任务路径读取被拒绝；工具集合在服务端再次校验 |
| 冲突可见 | 计划范围和实际 ChangeSet 路径均生成冲突边 |
| 失败隔离 | 一个任务失败时另一个任务的成功结果和 ChangeSet 保留 |
| 依赖与预算 | 前置成功后才调度下游；任务数和并发数有硬上限 |
| 依赖结果传递 | `lib/global-agent/orchestration-store.test.ts` 证明后置 Execution 获得前置结果摘要，而非只等待状态 |
| 运行中协调 | 存储测试证明父指令原子认领一次、子报告不会误投回自身且绑定真实 Execution；`delegated-runtime.test.ts` 证明调用途中到达的父消息会废弃旧决策，并证明 `send_message` 报告持久化、记录工具历史和回流父调度；`project-turn-runtime.test.ts` 证明统一入口补充指令进入运行中的 Sub-agent |
| 共享任务协作 | `project-session-store.test.ts` 证明稳定任务、依赖解锁与循环拒绝；`workspace-tools.test.ts` 证明独立 Execution 原子共享；`delegated-runtime.test.ts` 证明真实 Orchestration Sub-agent 可领取并完成父任务 |
| 父节点实时瀑布流 | `delegated-runtime.test.ts` 证明调度完成前持续报告子工具进度；`workspace-tools.test.ts` 证明投影幂等且不进入模型上下文；`agent-turn-timeline.test.ts` 证明运行时只显示最新子活动 |
| 可恢复 | 复用 Agent 中断/等待审批恢复，并由 Orchestration 状态同步 |
| 统一入口 | `lib/agent/project-turn-runtime.test.ts` 证明主 Agent 调用 `delegate_tasks`、等待结果并在同一 Turn 输出最终汇总 |
| 动态扩展工具 | `lib/global-agent/delegated-runtime.test.ts` 证明 Sub-agent 按需发现、调用 MCP 工具，并从持久化 Execution 恢复激活状态 |
| 语义代码理解 | Global 规划提示会为需要理解定义、引用、类型、实现或调用关系的 TS/JS 子任务授予 `code_intelligence`；Runtime 再按任务 Root、路径前缀和工具白名单强制校验 |
| 本地界面验证 | Global 规划只为需要验证 Web UI 且已有明确 loopback URL 的子任务授予 `browser`；Sub-agent 使用独立 Execution 浏览器会话，截图只进入当前推理，不扩大文件或 Root 权限 |
| 工具失败恢复 | 工具失败会回传模型并允许诊断或改道；重复结果不会由 Runtime 在第三次强制终止，最终只受 Agent 最大轮数与安全边界约束 |
| 自定义 Agent 持久记忆 | `lib/agent/project-agent-memory.test.ts` 覆盖 user/project/local 三种作用域、重载持久性和路径穿越；`workspace-tools.test.ts` 证明仅启用 memory 的 Agent 能通过普通文件工具维护虚拟记忆路径 |
| Worktree 隔离 | `lib/agent/project-agent-worktree.test.ts` 证明未修改自动清理、修改后保留；`workspace-tools.test.ts` 证明显式隔离的 Agent 在临时 Root 运行并在无改动时完成清理 |
