# 历史兼容：Canvas Convergence

本文记录 Phase 8 时代独立 Agent Execution / Global Agent 画布节点的兼容行为。当前 Project Agent 已统一使用 `textGeneration → AI 回复节点` 入口，不再创建独立 `agentExecution/globalAgent` 节点，也不把本页的 Fold/Convergence Proposal 作为当前 Agent Turn UI 能力。

旧 Agent 相关节点可带有生命周期：`ephemeral`、`working`、`knowledge`、`pinned` 或 `archived`。生命周期只控制旧快照的画布呈现和普通上下文选择，不改变 Workspace、Execution、ChangeSet 或 Project Memory 的真相源。

## 用户操作

- **Fold**：仅适用于历史 `agentExecution/globalAgent` 节点，把详情缩成 168px 结果卡片；完整工具、Sub-agent、命令和审批记录仍在独立 Execution 中。
- **Promote**：将已结束结果标记为 `knowledge`，表示它是可复用的长期画布资产。
- **Pin**：标记为 `pinned`，明确保留在主画布。
- **Archive**：把节点标记为 `archived`，从主画布、画布全文搜索、普通 Agent 画布上下文和知识检索中隐藏。节点仍保存在 Canvas Snapshot，并可从左侧工具栏的归档面板恢复到归档前生命周期。

运行中的任务不能通过节点 UI 归档，必须先停止或等待终态。归档节点关联的连线在主画布渲染阶段被过滤，恢复节点后原始节点和连线仍存在。

## 历史 Global Agent 收敛建议

Global Orchestration 进入终态后生成一次可追溯的 `convergenceProposal`，包含：

- 聚合结果摘要；
- 建议 Promote 或 Archive；
- 是否折叠执行详情；
- 必须保留的 ChangeSet ID；
- 本次 Execution 产生的候选 Memory ID；
- 不删除 Workspace 文件、审批历史和 Memory 的理由。

这套确认收敛交互只保留给历史 Global Agent 节点回看；当前统一 Project Agent Turn 不再提供独立 Global Agent Dialog/节点入口。

## 证据

`components/zenme/canvas/convergence.test.ts` 验证归档不会删除节点或领域引用，且 Fold 可逆。`components/zenme/canvas/rendered-nodes.test.ts` 验证归档节点和相关边不会进入主画布。`lib/global-agent/orchestration-store.test.ts` 验证终态调度会生成保留 ChangeSet 的收敛建议。
