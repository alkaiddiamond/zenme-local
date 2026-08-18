# Project Memory

Project Memory 是 Project 级派生知识，不替代 Workspace 文件、Canvas Snapshot、ChangeSet 或 Execution。当前格式版本为 `1`，持久化在 `projects/{projectId}/memory/index.json`。

## 状态与确认

- `candidate`：用户或 Agent 提出的候选；Agent 创建时强制进入该状态，即使请求声称已确认。
- `confirmed`：用户明确确认，可进入 Project Agent 及其 Sub-agent/Team 上下文。
- `needsReview`：此前已确认，但来源文件已经变化、消失或无法验证；立即退出模型上下文。
- `stale`：未确认候选的来源已经失效。
- `rejected`：用户拒绝，不进入上下文。

用户可在项目菜单的 **Project Memory** 中查看来源、内容哈希、当前修订与状态，创建候选、确认、拒绝、删除或重新验证。删除 Memory 只删除派生记录，不修改任何 Workspace 文件、Canvas、ChangeSet 或 Execution。

## 来源与版本

每条 Memory 至少有一个来源。支持 Workspace 文件、Canvas 节点、Task、Execution、ChangeSet、Git Commit 与用户 Decision。Workspace 文件来源以稳定的 `rootId + relativePath` 标识；旧来源缺少 Root ID 时只解释为主根。创建、修订或确认时会在对应授权根内读取当前文件并保存 SHA-256 和 `size:mtime` 版本；敏感文件、链接逃逸、不可读文件和超过 4 MiB 的来源会被拒绝。同一路径出现在不同根时会独立验证和失效，不会串根。

用户可固定常用 Memory；固定项排在列表前面。修订会创建新的正文修订并回到 `candidate`，必须重新确认后才进入模型上下文。固定与取消固定不伪造正文修订。

每次确认上下文前会重新验证文件来源。只有仍为 `confirmed` 的记录会进入模型，并携带 Memory ID、修订号、来源 ID、路径和内容哈希。Execution 会保存本次使用的 Memory 快照，Global Orchestration 会保存对应 `projectMemory` 证据，便于追溯上下文选择。

## Agent 候选

Agent 可使用 `propose_memory` 提出 File、Architecture、Decision 或 TODO Memory。服务端会追加 Execution 来源并强制保持 `candidate`；用户确认之前不会成为事实。该工具也受 Sub-agent 的工具能力和路径范围约束。

## 恢复与容量

- 最多保存 10,000 条 Memory，每条最多 100 个来源，正文最多 200,000 字符。
- JSON 通过本地原子写入和单文件 mutation lock 更新。
- Memory 是普通 Project 数据，随 Project 数据备份；模型密钥与敏感 Workspace 内容不得写入其中。

## 自动化证据

`lib/memory/repository.test.ts` 覆盖 Agent 候选不能冒充 Decision、来源哈希、文件变化失效与上下文排除、修订、删除不影响来源、敏感和越界来源拒绝。Agent/Global Agent 测试覆盖 Memory 快照与工具能力边界。
