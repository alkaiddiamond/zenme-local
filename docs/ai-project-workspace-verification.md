# AI Project Workspace 需求—证据矩阵

本文件对应 `../zenme-doc/AI Project Workspace 开发指导.md`（基线日期 2026-08-12），用于记录当前实现与验收证据。Agent Runtime 的能力定义与自治边界以 [`agent-runtime-capabilities.md`](agent-runtime-capabilities.md) 为准；本文件只记录工程映射、证据和仍待执行的门禁。

状态说明：

- **通过**：当前源码和与要求同范围的自动化或真机记录共同证明。
- **待真机**：实现和自动化已存在，但指导文件明确要求的桌面交互尚未在本轮最终回归中复验。
- **不适用**：产品指导明确为后置或当前不规划，不计入本阶段实现完成条件。

## Phase 0 — Workspace Foundation

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| 单 Workspace 绑定、解除、缺失、移动与重关联 | `lib/local/workspace-repository.ts`、Workspace API、Electron 目录选择 IPC | `lib/local/workspace-repository.test.ts`、`app/api/projects/workspace-api.test.ts`；[Workspace 真机记录](workspace-foundation.md#windows-真机验证记录) | 通过 |
| 能力化权限与可信根 | `read/write/delete/execute/git` 分离；每次访问重新校验 Binding | `lib/workspace/workspace-inspection.test.ts`、`lib/local/workspace-repository.test.ts` | 通过 |
| 路径、链接、UNC 与身份边界 | realpath、目录身份、结构指纹、Junction/符号链接封闭 | `lib/workspace/workspace-inspection.test.ts` | 通过 |
| Git 根与基础状态 | Workspace 与 Git 根关系持久化 | `lib/local/workspace-repository.test.ts`、`lib/workspace/workspace-files.test.ts` | 通过 |
| 旧项目默认未绑定且未知字段保留 | Project v1 → v2 规范化迁移 | `lib/local/project-repository.test.ts` | 通过 |

## Phase 1 — Read-only Live File

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| 文件树、路径搜索与忽略规则 | Git 标准排除或受限本地遍历；Picker 只搜索相对路径元数据 | `lib/workspace/workspace-files.test.ts` | 通过 |
| UTF-8、二进制、大文件、敏感与消失降级 | 正文 1 MiB 上限，非文本不进入 Renderer | `lib/workspace/workspace-files.test.ts` | 通过 |
| File Document 共享身份，不复制正文到 Canvas | `workspace/documents.json` 只保存身份；节点仅保存引用 | `lib/workspace/workspace-files.test.ts`、`components/zenme/canvas/node-factories.test.ts` | 通过 |
| 外部修改、删除和重命名可见 | 哈希与文件身份轮询 | `lib/workspace/workspace-files.test.ts` | 通过 |
| 多节点共享轮询且最后订阅释放 | Project + Document 键共享客户端 Store | `components/zenme/workspace-file-document-store.test.ts` | 通过 |

## Phase 2 — Editable File

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| Buffer、Dirty、Saving、Synced、Missing、Conflict、Error | 共享 File Document Store 与明确节点状态 | `components/zenme/workspace-file-document-store.test.ts` | 通过 |
| 原子保存与预期版本检查 | 临时文件、flush、原子 rename；必须携带 baseline hash | `lib/workspace/workspace-files.test.ts` | 通过 |
| Diff、Reload、Keep Mine、Revert | Live File 节点显式操作，画布撤销不承担文件撤销 | [Editable File 契约](editable-files-and-change-sets.md) | 通过 |
| 外部冲突不覆盖 Buffer | reconcile 保留本地 Buffer 并阻止保存 | `components/zenme/workspace-file-document-store.test.ts`、`lib/workspace/workspace-files.test.ts` | 通过 |
| CRLF/LF、UTF-8、空文件与大小边界 | 保存保留原换行；正文和类型边界回归 | `lib/workspace/workspace-files.test.ts` | 通过 |
| Windows 编辑、冲突、保存和恢复 | Electron 开发版真实 Workspace 流程 | [Windows 真机记录](editable-files-and-change-sets.md#windows-真机验证记录) | 通过 |

## Phase 3 — ChangeSet 与审批

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| 第一等 ChangeSet、状态机与来源关联 | 独立 `workspace/change-sets.json`，不进入聊天或 Canvas Snapshot | `lib/workspace/change-sets.test.ts` | 通过 |
| 新增、修改、删除、重命名 | 结构化操作与逐项基线 | `lib/workspace/change-sets.test.ts` | 通过 |
| 整体批准、拒绝、冲突与 Revert | 所有基线在首个写入前校验 | `lib/workspace/change-sets.test.ts` | 通过 |
| 部分失败与重启恢复可解释 | `applying/reverting` 事务恢复，未知外部状态不覆盖 | `lib/workspace/change-sets.test.ts` | 通过 |
| 真实 Workspace 应用和回退 | Electron 开发版应用、同步与回退 | [Windows 真机记录](editable-files-and-change-sets.md#windows-真机验证记录) | 通过 |

## Phase 4 — Agent Workspace Runtime

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| Project Agent Turn 形成持久 Execution 证据 | Turn 在需要工具/审批时内部创建 Agent Execution；旧 `/agent-executions` POST 创建入口已退役 | `lib/agent/project-turn-runtime.test.ts`、`lib/agent/execution-store.test.ts`、`app/api/projects/agent-executions-api.test.ts` | 通过 |
| 当前统一工具注册表 | 当前模型工具由 `tool-registry.ts` 生成；`run_approved_command` 等恢复协议只作为 internal 兼容能力存在 | `lib/agent/tool-registry.test.ts`、`lib/agent/workspace-tools.test.ts` | 通过 |
| Agent 写入只能形成 Proposed ChangeSet | `propose_patch` 不修改磁盘 | `lib/agent/workspace-tools.test.ts` | 通过 |
| Codex 风格多文件补丁 | `apply_patch` 在内存精确匹配 Add/Update/Delete/Move，合并为一个 ChangeSet；陈旧上下文、敏感路径和 Sub-agent 越界在写盘前拒绝；授权模式下原子应用后继续 Agent Turn | `lib/agent/apply-patch.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/agent/project-turn-runtime.test.ts` | 通过 |
| 路径、敏感文件、命令和任务能力受限 | realpath、路径 scope、Workspace 范围、风险分类与一次性批准 | `lib/agent/workspace-tools.test.ts` | 通过 |
| 原生多工具调用不丢失 | Chat Completions 与 Responses 流按 index 保留完整调用批次；主 Agent 在再次请求模型前执行所有独立读取 | `lib/ai/openai-responses-stream.test.ts`、`lib/agent/project-agent-model.test.ts`、`lib/agent/project-turn-runtime.test.ts` | 通过 |
| MCP 工具按需发现与续跑恢复 | MCP Schema 默认不进入模型上下文；`tool_search` 仅激活当前 Turn 的匹配工具，同一 Turn 恢复时从持久事件重建激活集合 | `lib/agent/mcp-runtime.test.ts`、`lib/agent/project-turn-runtime.test.ts`、`lib/agent/tool-registry.test.ts` | 通过 |
| 结构化代码诊断 | `code_diagnostics` 分析 tsconfig/jsconfig 并叠加尚未应用的 ChangeSet 内容；它是模型可自主选择的 observation，不再由 Runtime 在完成前强制插入 | `lib/agent/code-diagnostics.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| 语义代码导航 | `code_intelligence` 对齐 cc-haha LSP，支持 TS/JS 定义、引用、Hover、文档/工作区符号、实现与调用层级；结果限定到稳定 Root 和 Sub-agent 路径范围，并读取未应用 ChangeSet | `lib/agent/code-intelligence.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/agent/project-turn-runtime.test.ts` | 通过 |
| 本地 Web 界面验证 | `browser` 使用 Electron 隔离 Chromium 会话执行 loopback 导航、DOM snapshot、元素引用点击/输入/按键和截图；主 Agent/Sub-agent 可基于真实页面继续推理，截图正文不进入持久化审计 | `desktop/browser-control.node-test.cjs`、`lib/agent/browser-control.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| 不可信页面交互审批 | 页面观察保持可用；主 Agent 的 click/type/press 进入一次性确认并在批准后恢复原 Turn，Sub-agent 不得绕过用户确认 | `lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| Git 写权限边界 | Git 查询保持可用；本地写操作要求目标 Root 的 `gitWrite` 并在执行前复核，远程/敏感操作继续逐次审批，破坏性操作直接拒绝；桌面面板提供二次确认开关 | `lib/agent/workspace-tools.test.ts`、`app/api/projects/workspace-api.test.ts`、`desktop/workspace-ipc.node-test.cjs`、`components/zenme/workspace-binding-dialog.test.ts` | 通过 |
| 五分钟上限、停止与进程树清理 | 命令 Runtime 终止子进程树 | `lib/agent/workspace-tools.test.ts` | 通过 |
| 重启恢复与 Attempt 历史 | 活跃内部 Execution 可收束/恢复；Project Agent 节点重试复用原 `turnId/resultNodeId` 与持久上下文快照，不创建新的 AI 回复节点 | `lib/agent/execution-store.test.ts`、`components/zenme/canvas/text-generation-boundary.test.ts` | 通过 |
| Windows 节点详情与命令审批点击 | 2026-08-12 历史桌面验证记录保留；当前 AI 回复节点的持久化 Turn 恢复、精确停止/追加指令及原节点重试已有逻辑回归，命令审批 UI 尚未在本轮 cleanup 后重新真机复验 | `components/zenme/canvas/agent-turn-control.test.ts`、`components/zenme/nodes/agent-turn-timeline.test.ts`、`components/zenme/canvas/text-generation-boundary.test.ts`；[Agent Windows 记录](agent-workspace-runtime.md#2026-08-12-windows-验证记录) | 待真机 |

## Phase 5 — Global Agent 与并行 Sub-agent

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| Context Resolver、目标拆分与调度可追溯 | `delegate_tasks` 在 Project Agent Turn 内创建 Orchestration，保存证据、计划、范围、基线与应用顺序；独立 Global Agent planner UI/API 已退役 | `lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts`、`lib/global-agent/orchestration-store.test.ts` | 通过 |
| 1–8 个任务、1–4 并发、依赖与预算 | 服务端硬上限，不信任模型计划 | 同上 | 通过 |
| 独立 Working Memory、能力与 ChangeSet | 每个任务独立 Agent Execution、path scope 和基线 | `lib/global-agent/orchestration-store.test.ts` | 通过 |
| 并行、失败隔离、停止与单独重试 | 一个失败不删除其他结果；可独立重试并整体停止 | `lib/global-agent/orchestration-store.test.ts` | 通过 |
| 文件重叠检测与安全归并 | 计划范围和实际 ChangeSet 形成冲突图，不自动写主 Workspace | `lib/global-agent/orchestration-store.test.ts` | 通过 |
| 重启恢复与待审阅结果 | 复用 Agent 恢复，Orchestration 从持久记录同步 | `lib/agent/execution-store.test.ts`、`lib/global-agent/orchestration-store.test.ts` | 通过 |
| Windows 并行调度、停止和审阅交互 | 2026-08-12 Electron 开发版：两个不重叠任务同时运行并各自产生 Proposed ChangeSet；失败任务可单独重试，停止后结果仍保留 | 本文件“Windows Electron 最终回归记录” | 通过 |
| 统一 Project Agent 入口并行委派 | `delegate_tasks` 复用 Global Orchestration，服务端 Sub-agent 使用统一原生工具协议、路径/工具范围和命令权限边界；主 Turn 等待结果后汇总 | `lib/global-agent/delegated-runtime.test.ts`、`lib/agent/project-turn-runtime.test.ts` | 通过 |
| 历史个人任务计划兼容 | `todo_write/project_task_list` 只保留历史记录、类型与模型投影迁移；当前 Tool Registry 不向模型暴露，自定义 Agent frontmatter 与历史 Sub-agent `allowedTools` 会过滤这些 internal 工具，通用 Agent Tool API 也拒绝执行；新 Agent 统一使用 Task V2 | `lib/agent/project-agents.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/global-agent/delegated-runtime.test.ts`、`lib/agent/project-context-policy.test.ts`、`components/zenme/nodes/agent-turn-timeline.test.ts` | 通过 |
| 主/子 Agent 共享任务列表 | `task_create/task_get/task_list/task_update` 使用稳定 ID 原子维护描述、负责人、状态和依赖；主 Agent、独立 Execution 与真实 Orchestration Sub-agent 共享，循环依赖在写入前拒绝，且不与后台进程任务混用 | `lib/agent/project-session-store.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| Codex/cc-haha 项目指令继承 | 主 Agent 首轮自动加载每个可读 Root 的根目录 `AGENTS.md`/`CLAUDE.md`，触及子目录后按稳定 Root ID 懒加载更具体指令；并行 Sub-agent 只继承分配 Root 与允许路径的规则且不能借此扩大权限 | `lib/agent/project-instructions.test.ts`、`lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| 多 Root Sub-agent 隔离 | Global 任务显式绑定稳定 Root ID；文件、诊断、补丁、Git 与命令工具自动注入并强制校验该 Root，不同 Root 的同名路径不产生冲突，基线与 ChangeSet 不串根 | `lib/agent/workspace-tools.test.ts`、`lib/global-agent/orchestration-store.test.ts` | 通过 |
| 多 Root Sub-agent 计划绑定 | `delegate_tasks/agent_spawn` 使用稳定 Root ID 与路径范围进入服务端校验；旧 Global Agent Dialog 的启动前逐项 Root 编辑交互已随独立入口退役 | `lib/agent/workspace-tools.test.ts`、`lib/global-agent/orchestration-store.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| Sub-agent 原生读取批次 | 单个 Sub-agent 完整执行一次模型响应中的多个读取调用，再以汇总后的工具历史继续推理 | `lib/global-agent/delegated-runtime.test.ts` | 通过 |
| Sub-agent 动态 MCP 工具池 | `tool_search` 按需激活匹配 MCP Schema；原生调用经过 JSON Schema 与 Server 权限校验，Execution 续跑时从持久工具历史恢复 | `lib/global-agent/delegated-runtime.test.ts`、`lib/agent/mcp-runtime.test.ts` | 通过 |
| 多 Root MCP 隔离 | MCP 工具发现、资源和调用使用 Sub-agent 任务 Root；连接缓存按 Project/Root/Server 分区并以目标 Root 为 cwd，Root 未授权执行时在启动进程前拒绝 | `lib/agent/mcp-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| Sub-agent 工具错误恢复 | 单次执行失败或 schema 失败都作为具体 observation 回传同一 Sub-agent；Runtime 不因相同工具/参数/结果重复而强制结束，只保留总轮数资源上限 | `lib/global-agent/delegated-runtime.test.ts` | 通过 |
| Sub-agent 审批闭环 | 子命令审批提升到原 Project Agent Turn；批准执行后恢复同一编排和子 Execution，父 Turn 收到更新结果后继续回答；子 Agent 不进入无人可回答的提问状态 | `lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts`、`lib/global-agent/orchestration-store.test.ts` | 通过 |
| Turn 配置连续性 | 节点选择的模型推理强度与速度持久化到原用户事件，等待输入、命令审批、后台恢复与 Sub-agent 续跑均复用，不退回默认值 | `lib/agent/project-turn-runtime.test.ts` | 通过 |
| Turn 执行轨迹连续性 | 用户回答或命令审批后按稳定 `turnId/resultNodeId` 复用同一父 Agent Execution；不重复用户事件、命令或工具历史 | `lib/agent/project-turn-runtime.test.ts`、`lib/agent/execution-store.test.ts` | 通过 |
| Assistant 正文流式 Item | 文本 delta 合并为单条可更新草稿，节点活动轮询展示；最终答复替换，工具/失败清理，兼容 JSON 不闪现且草稿不进入模型上下文 | `lib/agent/project-agent-model.test.ts`、`lib/agent/project-session-store.test.ts`、`lib/agent/project-turn-runtime.test.ts`、`components/zenme/nodes/agent-turn-timeline.test.ts` | 通过 |
| 审批瀑布流归并 | 同一命令的后续批准/拒绝事件消除历史 pending 卡片；多个并行命令只保留真正未决的审批 | `components/zenme/nodes/agent-turn-timeline.test.ts` | 通过 |
| Sub-agent 实时活动投影 | 调度中持续读取子 Execution，把最新工具/命令活动幂等投影到父 AI 回复节点；投影不重复进入模型上下文，Turn 结束后自动折叠 | `lib/global-agent/delegated-runtime.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/agent/project-session-store.test.ts`、`components/zenme/nodes/agent-turn-timeline.test.ts` | 通过 |
| 后台任务跨 Turn 可见与可停止 | 前台 Turn 完成后仍显示运行中的项目级任务；节点可直接停止对应进程树，终态通知到达后活动项消失 | `components/zenme/nodes/agent-turn-timeline.test.ts`、`app/api/projects/project-agent-session-api.test.ts`、`lib/agent/workspace-tools.test.ts` | 通过 |
| 历史后台任务收束与终态证据归并 | Session 中曾返回 `running` 的 Shell 任务即使来自旧 Execution（缺少 `resultNodeId`、`background` 标记不可靠，或同一 taskId 被多个 Turn 观察）也会按 `turnId + taskId` 补齐终态通知；终态执行证据把 toolCall/toolResult 归并为一次工具执行，孤立 call 显示为已随 Turn 结束而不是持续 spinner；终态后台跟踪降为 2 秒刷新 | `lib/agent/project-turn-runtime.test.ts`、`components/zenme/nodes/agent-turn-timeline.test.ts`；2026-08-18 在真实 `music_workbench` Session 验证 `no-stale-running-background-tasks` | 通过 |
| 后台任务终态通知 | Shell 返回稳定 taskId/outputFilePath；模型不枚举后台任务。终态通知按 `turnId + taskId` 对每个曾观察到该后台任务的 Turn 独立去重并收束，再在 Agent 空闲时恢复对应 Turn；同一 taskId 不会因另一个 Turn 已收到通知而被错误吞掉 | `lib/agent/project-turn-runtime.test.ts`、`lib/agent/workspace-tools.test.ts`、`lib/global-agent/orchestration-store.test.ts` | 通过 |
| Continuous Agent 建议采纳闭环 | 未采纳候选保持隔离；用户明确采纳后，有界建议进入后续 Project Agent 上下文，并可由模型按相关性通过 Task V2 建立/更新共享工作项；建议不会被标记为已执行，也不绕过工具、权限、审批和 Workspace 范围校验 | `lib/global-agent/continuous-store.test.ts`、`lib/agent/project-turn-runtime.test.ts` | 通过 |
| Continuous Agent 服务重启恢复 | active run 持久化本地服务运行实例；新实例会归档旧 `running`、保持 checkpoint 不变并重新领取同批未处理事件，不会永久卡住或丢事件 | `lib/global-agent/continuous-store.test.ts`、`app/api/projects/continuous-global-agent-api.test.ts` | 通过 |
| Workspace 图片观察 | `view_image` 在真实路径与 Sub-agent 范围内读取、旋转和有界缩放图片；下一模型轮次收到原生图片输入，Session/Execution 不持久化 base64，链接逃逸被拒绝 | `lib/agent/workspace-tools.test.ts`、`lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/delegated-runtime.test.ts` | 通过 |
| Project Knowledge 自动召回 | 已就绪的图/向量索引在 Turn 首次模型调用前按当前请求执行有限召回；上下文只有来源元数据和匹配片段，不要求模型先调用工具，索引不可用时可降级 | `lib/agent/project-turn-runtime.test.ts`、`lib/knowledge/index-store.test.ts` | 通过 |
| 本地预览 URL 边界 | 不扫描端口或进程树；只接受用户、Shell 输出或最终答复中真实出现的 loopback HTTP(S) URL，Browser navigate 必须传入明确 URL | `lib/agent/tool-registry.test.ts`、`lib/agent/project-turn-runtime.test.ts`、`components/zenme/nodes/agent-turn-timeline.test.ts` | 通过 |

首版选择纯 ChangeSet 隔离；Git Worktree 是指导文件允许的可选后置实现，不阻塞本 Phase。

## Phase 6 — Project Memory

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| File、Architecture、Decision、TODO | 独立版本化 Memory Store | `lib/memory/repository.test.ts` | 通过 |
| 来源、版本、验证与失效 | 文件 SHA-256、修订、确认和失效状态 | `lib/memory/repository.test.ts` | 通过 |
| Agent 推断不能冒充事实 | `createdBy=agent` 强制 candidate | `lib/memory/repository.test.ts`、`app/api/projects/memory-knowledge-api.test.ts` | 通过 |
| 用户确认、固定、修订、拒绝与删除 | UI 与 API 生命周期完整；修订后重新候选 | `lib/memory/repository.test.ts`、`app/api/projects/memory-knowledge-api.test.ts` | 通过 |
| 进入上下文的来源和版本可追溯 | 仅 confirmed 且重新验证的快照进入 Execution/Orchestration | `lib/agent/workspace-tools.test.ts`、`lib/global-agent/orchestration-store.test.ts` | 通过 |
| Windows Memory 对话框交互 | 候选 Decision 已在 Electron 中创建、确认、固定；Timeline 同时保留 candidate/confirmed 事件 | 本文件“Windows Electron 最终回归记录” | 通过 |

## Phase 7 — Knowledge Graph 与向量检索

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| 可删除、可重建的本地派生索引 | `derived/knowledge/index.json`，备份排除 `derived/` | `lib/knowledge/index-store.test.ts`、`lib/local/backup.test.ts` | 通过 |
| 文件、符号、节点、任务、执行、ChangeSet、Decision、Memory 关系 | 版本化实体和边模型 | `lib/knowledge/index-store.test.ts` | 通过 |
| 分块、增量向量与容量限制 | 1600/200 分块、内容哈希复用、文件/字节/块硬上限 | `lib/knowledge/index-store.test.ts` | 通过 |
| 路径、关键词、图和向量混合召回 | 返回分项分数、证据、哈希和字符预算 | `lib/knowledge/index-store.test.ts` | 通过 |
| 中英文与代码标识符本地召回 | v2 子词特征覆盖中文单/双/三字片段、英文词元与 camelCase/snake_case 标识符；旧 Provider 索引要求重建，不静默混用 | `lib/knowledge/text-features.test.ts`、`lib/knowledge/index-store.test.ts` | 通过 |
| 固定评估相对基线提升 | 认证决策 fixture 召回率从 0.5 到 1.0 | `lib/knowledge/index-store.test.ts` | 通过 |
| 删除、修改、重命名、重关联无幽灵结果 | 查询时重新验证身份与来源；归档节点排除 | `lib/knowledge/index-store.test.ts` | 通过 |
| 敏感排除与 Cloud Provider 显式授权 | 默认本地 Provider；授权前零调用 | `lib/knowledge/index-store.test.ts` | 通过 |
| 设置中的 Embedding 模型可用于建库与自动检索 | 支持本机/云端 OpenAI 兼容 Embedding；索引绑定 Provider 与维度；云端先披露并授权，状态不返回密钥 | `lib/knowledge/embeddings.test.ts`、`lib/ai/provider-model-resolution.test.ts`、`app/api/projects/memory-knowledge-api.test.ts` | 通过 |
| 暂停、恢复、清除、重建和磁盘状态 | UI/API 管理派生索引 | `app/api/projects/memory-knowledge-api.test.ts` | 通过 |
| Windows Knowledge 对话框交互 | Electron 中重建为 7 实体/3 关系/7 向量块；混合检索返回路径、关键词、向量和图证据；暂停/恢复通过 | 本文件“Windows Electron 最终回归记录” | 通过 |

## Phase 8 — Canvas Convergence

| 要求 | 实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| Ephemeral、Working、Knowledge、Pinned、Archived | Agent 节点从创建起携带生命周期 | `components/zenme/canvas/node-factories.test.ts` | 通过 |
| Fold、Archive、Promote 与恢复 | 生命周期只改变呈现，不删除领域记录 | `components/zenme/canvas/convergence.test.ts` | 通过 |
| 归档默认不进入画布、搜索、上下文与知识索引 | 主画布与连线过滤；索引构建和检索过滤 | `components/zenme/canvas/rendered-nodes.test.ts`、`lib/knowledge/index-store.test.ts` | 通过 |
| Global Agent 只提出收敛方案 | 用户确认前不改画布，方案保留 ChangeSet 和 Memory ID | `lib/global-agent/orchestration-store.test.ts` | 通过 |
| 收敛不删除 Workspace、Memory 或审批历史 | 生命周期操作只更新 Canvas 节点引用 | `components/zenme/canvas/convergence.test.ts` | 通过 |
| Windows 收敛与归档恢复交互 | 终态节点展示收敛建议、保留 2 个 ChangeSet，并提供确认/Fold/Promote/Archive；最终归档与恢复点击仍待复验 | 本文件“Windows Electron 最终回归记录” | 待真机 |

## 跨阶段门禁

| 门禁 | 证据 | 状态 |
| --- | --- | --- |
| 数据版本、迁移、未知字段和临时测试目录 | `lib/local/project-repository.test.ts`、`lib/agent/execution-store.test.ts` 及各仓库测试的临时目录 fixture | 通过 |
| 原子写入、版本一致性与多视图单一真相源 | Workspace File、ChangeSet 和共享 Store 测试 | 通过 |
| 路径/链接逃逸、命令注入、敏感数据与 Renderer 边界 | Workspace/Agent/API/backup 测试；Electron 只暴露窄 IPC | 通过 |
| 文件树不读取仓库正文、执行日志不写 Canvas、容量有硬上限 | 文件发现只返回元数据；Execution 独立存储；Canvas 性能基线见 [canvas-performance.md](canvas-performance.md) | 通过 |
| 稳定 ID、失败阶段、重启恢复与安全重试 | Execution、Attempt、ChangeSet、Orchestration 测试 | 通过 |
| 父 Turn 停止级联与后台任务续接 | 停止父 Turn 后 Global Orchestration、Sub-agent Execution 和命令进程统一收束；后台终态只产生一次内部通知，不启动第二个命令，并通过恢复原 Turn 继续处理 | `lib/agent/project-turn-runtime.test.ts`、`lib/global-agent/orchestration-store.test.ts` | 通过 |
| Agent 所属命令退出语义 | Agent 结束或父级停止清理后台命令时持久化为 `stopped`，不被进程关闭回调误报为普通失败 | `lib/agent/workspace-tools.test.ts` | 通过 |
| 网页工具自治边界 | Runtime 不再按“最新/新闻/影响”等关键词替模型分类研究任务或规定来源数量；`web_search` 只发现候选，`web_fetch` 读取正文，是否继续检索由模型依据当前证据决定 | `lib/agent/project-turn-runtime.test.ts` | 通过 |
| `npm run check` | 2026-08-18 验证快照：251/252 个 Vitest 文件通过，1 个真实模型 Live Autonomy 文件按设计跳过；1444/1445 项测试通过，1 项 live 测试按设计跳过；23/23 desktop node tests 与 ESLint 全部通过，命令 exit 0。真实 `gpt-5.3-codex-spark` Live Autonomy 已另行显式执行 1/1 通过 | 历史快照 |
| `npm run verify` 等价两阶段 | 2026-08-18 验证快照已分别执行 `npm run check` 与 `npm run build`：Vitest 251/252 文件、1444/1445 项测试通过，唯一跳过项为默认不调用在线模型的 Live Autonomy；Desktop Node 23/23、ESLint、Next production build 与 TypeScript 全部通过，两个阶段均 exit 0 | 历史快照 |
| 独立运行时追踪 | `node desktop/scripts/verify-standalone-runtime.cjs` 通过；Workspace 动态目录不会把源码树打进 NFT | 通过 |
| Windows 目录包与启动冒烟 | 2026-08-18 验证快照：clean standalone 明确 `standalone-trace-clean`；`npm run desktop:pack` exit 0；`npm run desktop:smoke` exit 0，使用临时数据目录启动打包应用并完成 packaged Workspace/Browser 冒烟 | 历史快照 |
| `git diff --check`、完整 Diff 与仓库状态 | 2026-08-18 验证快照：当时 `git diff --check` exit 0；当时分支为 `codex/ai-project-workspace`、基线记录为 `6f8b793`。该行只描述当次审计，不代表后续工作树状态 | 历史快照 |

## 明确不在当前实现范围

- 持续运行、事件驱动的 Global Agent：已建立 AppShell 级 supervisor、事件存储和受控调度；长时稳定性与资源预算仍需持续验证。
- Git Worktree/更强沙箱：首版采用 ChangeSet 隔离，后续可替换执行后端。
- 多 Workspace 与 Monorepo 子工作区：稳定 Root ID、独立权限/Git、Live File、全根聚合搜索、Knowledge 索引、命令工作目录、项目指令、跨根 Skill 同名解析和 Sub-agent 隔离已接通；旧独立 Global Agent 计划确认/运行节点已退役，当前 Root 绑定由 Project Agent 的 `delegate_tasks/agent_spawn` 服务端校验承担。
- 远程执行、多人协作、账号/云同步、公网入口和移动端完整编辑：当前不规划。

## Windows Electron 最终回归记录

2026-08-12 在 Electron 开发模式中使用一次性本地项目与一次性 Workspace 执行真实交互回归：

- Workspace 通过系统目录选择器绑定；初始只有读取能力，开启文件编辑后仅增加 `write`，`delete/execute/gitWrite` 保持关闭。
- Project Memory 创建 Decision 候选、确认进入上下文并固定；Timeline 保留来源与修订事件。
- Project Knowledge 重建成功，状态为 Ready，得到 7 个实体、3 条关系、7 个本地向量块；查询 `export const a` 返回 `src/a.ts` 符号/文件、相关 Decision，以及关键词、路径、向量、图关系分项证据；暂停和恢复均生效。清除索引属于破坏性操作，本轮未在 UI 点击，API 回归已覆盖。
- Global Agent 把目标稳定拆为 `src/a.ts` 和 `src/b.ts` 两个最小路径任务，并发上限为 2；界面同时展示两个 Sub-agent 为“运行中”，随后均进入“完成”。
- 两个 Sub-agent 分别形成 Proposed ChangeSet `87550dc6-0863-4fcf-8f1a-260e3fde077b` 与 `c762992b-8c64-49cd-bea8-c0a9321b59ac`；界面进入“等待审阅”并显示“分别审阅 (2)”。磁盘中的两个源文件仍为 `= 1`，证明审批前未直接写入。
- 终态节点展示可解释结果和收敛方案，明确保留 2 个 ChangeSet。受自动化可见区域限制，最终 Archive/恢复点击仍列为待真机，不据此扩大通过范围。

本轮桌面回归发现并修复三项真实集成缺陷：项目切换后 Canvas 会话可能继续使用旧 `projectId`；读取短文件时合理的超 EOF `endLine` 被误判非法；Next.js 不同 Route Bundle 没有共享 Agent 活跃状态，导致重试立即被识别为重启中断。三项均有自动化回归证据。

## Agent Turn 可用性边界

本目标中的“可用”指基本、常见的 Agent Turn 能力可以在真实 Workspace 与桌面运行链路中完成，而不是要求通过 500+ 节点大画布容量门禁，也不是要求把所有低频管理 UI 逐个人工点击一遍。2026-08-18 的验证快照覆盖：普通读取/搜索、文件修改、Shell 执行与失败恢复、审批暂停/同 Turn 恢复、Ask User Question、Plan Mode、Task V2、后台任务终态续接、Skill、一次性及并行 Sub-agent；真实 `gpt-5.3-codex-spark` Live Autonomy 1/1、exit 0；当次源码重新打包后的 `npm run desktop:smoke` exit 0。后续改动必须重新记录自己的门禁结果，不能继承此处“历史绿灯”。

以下内容属于独立的扩展 UI / 管理 / 容量验收，不作为“常见 Agent Turn 当前可用”的阻塞项：Memory 的完整人工管理点击链路；Knowledge 清除与重建等破坏性管理操作；Global Agent Fold/Promote/Archive 的完整人工点击链路；500/1000 节点等大画布容量与性能门禁；真实第三方 MCP/LSP/MDM/macOS 等平台集成认证。它们需要单独声明和单独验收，不能与 Agent Runtime 基本可用性混为一谈。

若要声明桌面发布就绪，仍应单独执行对应平台 release gate；本轮 Windows packaged Workspace/Browser smoke 已通过，但不等同于所有平台发布认证。
