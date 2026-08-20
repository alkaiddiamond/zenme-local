# 本地数据与迁移

## 数据位置

桌面版默认在 Electron `userData/data` 下保存业务数据。用户可在设置页选择其他目录；选择结果保存在 `userData/desktop-config.json`。开发环境可用 `ZENME_DATA_DIR` 覆盖。

```text
zenme-data/
  settings.json
  app-shell-state.json
  projects/
    {projectId}/
      project.json
      workspace/
        binding.json
        documents.json
        change-sets.json
      agent/
        session.json
        message-queue.json
      canvas/latest.json
      canvas/thumbnail.webp
      files/
      reading/
        {assetId}/
          asset.json
          sections.json
          notes.json
          progress.json
```

桌面端新导入的音频默认不复制到 `files/original/`。项目文件索引保存经 Electron 明确选择并规范化后的外部绝对路径，画布仍只保存项目文件 ID 与 loopback 资源 URL。旧版本已经复制到项目目录的音频保持兼容。

阅读标注的 `notes.json` 可选保存 `ranges`，用于一条笔记跨多个分页记录各页的 `sectionIndex`、`offset` 和 `length`。没有 `ranges` 的旧标注继续使用顶层 `sectionIndex`、`offset` 和 `length`，无需迁移即可读取。

## 写入规则

- 动态路径必须通过 `lib/local/path-safety.ts` 限定在数据根目录内。
- 外部音频引用是唯一例外：只允许桌面模式登记用户明确选择的普通文件，并以不可猜测项目文件 ID 读取该精确路径；不得接受目录、相对路径或路径拼接。删除项目记录不得删除外部原文件。
- JSON 写入使用临时文件、同步和原子重命名，失败时保留最后一个有效版本。
- 备份恢复先进入临时目录完成结构与路径检查，再切换正式数据。
- 备份默认移除模型 API Key 和 OAuth Token。

## 迁移规则

任何持久化字段的删除、重命名、类型变化或默认值变化都必须：

1. 定义旧版本输入和新版本输出。
2. 保留未知字段，除非有明确删除决策。
3. 添加旧 fixture 回归测试。
4. 处理迁移中断和磁盘写入失败。
5. 在 `CHANGELOG.md` 记录用户影响。

Alpha 阶段也不得静默丢弃旧画布或项目数据。

## Project v1 → v2

Phase 0 将 `project.json` 升级为 version 2，并增加可选 `workspaceBindingId`。读取 version 1 时规范化为 version 2、默认 `workspaceBindingId: null`，再通过原子写入回写。旧项目因此保持“未绑定 Workspace”，无需访问任何外部目录即可继续使用。

规范化和后续名称、缩略图、打开时间更新必须保留未知字段。Workspace Binding 独立保存在 `workspace/binding.json`；删除 Binding 或 Project 不得删除绑定的外部 Workspace。

Phase 1 的 File Document 索引位于 `workspace/documents.json`。画布节点不保存文件正文，只保存 Document ID 与相对路径提示；文件移动时 Document 路径可在身份匹配后原子更新。详见 [Live File 与 File Document](live-files.md)。

Phase 3 的 ChangeSet 审批历史位于 `workspace/change-sets.json`。操作记录保存基线、提案和恢复所需的有限文本，但不进入 Canvas Snapshot。持久化状态 `applying` 与 `reverting` 会在下次读取时根据磁盘哈希恢复；无法确认的外部状态不得被覆盖。详见 [Editable File 与 ChangeSet](editable-files-and-change-sets.md)。

Phase 6 的 Project Memory v1 位于 `memory/index.json`。每条记录保存来源、来源版本、修订历史、确认与失效状态；它不复制或级联删除来源对象。Workspace 文件来源变化会在上下文解析前转为 `needsReview` 或 `stale`。

Phase 7 的 Project Knowledge v1 位于 `derived/knowledge/index.json`。该目录不进入备份，格式变化可直接清除并从 Workspace、Canvas、Execution、ChangeSet 与 Memory 重建，不需要把派生索引迁移成真相源。

Phase 8 历史 Agent Execution / Global Agent 画布节点曾在既有 Canvas Snapshot v3 `data` 中保存可选 `nodeLifecycle`、`nodeLifecycleBeforeArchive`、`agentDetailsFolded` 和 `agentExpandedHeight`。这些字段现在仅用于旧快照兼容读取与历史节点呈现，新 Project Agent Turn 不创建上述独立执行节点。旧节点缺失字段时按 `working` 展示，不要求快照版本升级；归档仍保留完整节点和边。

Project Agent Session v1 位于 `agent/session.json`。每个 Project 只创建一个稳定 Session，按严格递增序号保存用户消息、助手消息、思考、工具调用、工具结果、审批、状态、压缩和 Memory 事件；它是项目事件总账，不等价于模型的单一 Conversation。当前新 Turn 以 Conversation 作为正式的模型历史与运行状态边界：`conversations[]` 以及事件的 `conversationId/parentTurnId/sourceNodeId/resultNodeId` 记录 root node、父 Conversation、fork turn、独立 summary、compact boundary、压缩失败状态和 Conversation runtime state。只有旧 Session 可能缺少这些字段；读取时才回退到 legacy Project transcript，并在后续新节点运行时逐步建立 Conversation 元数据，不要求清空或重写旧历史。

Project 与 Conversation 使用独立模型投影和压缩边界。Project compact 只摘要未归属任何 Conversation 的 Project 级 Turn；Conversation compact 只摘要当前 Conversation lineage。Conversation 投影直接从完整事件总账读取，并应用自己的 compact boundary，因此 Project global boundary 即使在全局序号上跨过 Conversation 事件，也不会删除或截断该 Conversation 的历史。Project summary 只作为跨 Conversation 的长期背景，Conversation summary 表示当前分支的连续对话历史。所有 compact 都只更新投影元数据，不删除原始事件；读取和后续写入继续保留未知字段。新 user event 以 `contextSnapshot` 持久化当前指令、Current Node、Connected Graph、Conversation 与节点/文件引用；旧事件中的平行 `canvasContext/currentNodeContext/connectedGraphContext/selectedNodeIds/fileDocumentIds` 只作为兼容读取 fallback。Execution/Global Orchestration 仍可保留其历史 context 字段用于旧记录和子执行审计，但新建的结构化 snapshot 不再产生 `legacy.canvasContext`。轮询终态 Turn 时会幂等结束仍为 `running` 的旧 Execution，用读取修复兼容早期版本异常退出或拒绝命令后留下的非终态记录。

Project Agent Message Queue v1 位于 `agent/message-queue.json`。它只保存尚未投递到 Session 的消息：运行中补充指令为 `now`，普通用户消息为 `next`，后台任务终态为 `later`；同优先级按写入顺序消费。后台通知使用稳定 taskId 去重，消费后从队列移除并以事件写入 `session.json`，因此 Session 仍是已消费历史的唯一真相源。文件缺失视为空队列；结构损坏按统一 JSON 隔离规则处理，不得影响既有 Session。

Continuous Global Agent v1 位于 `global-agent/continuous.json`。它独立保存模式、小时预算、事件游标、active run、退避状态、运行历史和候选建议。Execution 与 ChangeSet 的业务写入先提交，再以幂等键追加观察事件；观察事件写入失败不得回滚业务数据。成功 run 才推进游标，失败、暂停或禁用均保留未处理事件以便恢复。

Global Orchestration v1 位于 `executions/global/{orchestrationId}.json`。子任务的 `messages` 是父 Turn 协调消息箱，保存稳定 ID、正文、创建时间和可选认领时间；`parentTurnId` 将统一对话 Turn 与调度关联。两者均为 v1 的向后兼容可选扩展：读取旧记录时缺失 `messages` 规范化为空数组，不改变旧任务状态、Execution 或 ChangeSet。

上下文预算按模型声明的实际窗口动态计算：摘要输出预留为“模型最大输出、20K、窗口 25%”三者的最小值，自动压缩 Buffer 为“13K、有效窗口三分之一”二者的最小值，触发阈值为有效窗口减去 Buffer。因此默认最大输出不低于 20K 时，1M、128K 和 32K 窗口分别在 967K、95K 和 16K 触发。服务商返回真实 Usage 时优先使用真实值，估算只作兜底。

完整压缩必须保留最近原始事件，默认至少 10K Token、至少 5 条用户或助手文本消息，且最多以 40K Token 为目标上限。边界按完整 Turn 移动，不得拆分 Tool Call/Result、待审批请求或运行中的工具。提交模型前允许把较旧的 Read、Search、Shell 等工具结果投影为清理标记；一个仍在执行的长 Turn 也可清理已经完成的旧工具结果及大型调用参数，但最近五个结果、未完成调用和待审批事件必须保留，且不得修改 `session.json` 中的完整瀑布流。连续三次摘要失败后停止自动重试；成功写入新检查点后清零失败计数。

Binding 保存机器相关的规范化路径与目录身份。这些字段只用于本机恢复和重新关联校验，不随备份恢复自动授予另一台机器的目录权限。恢复到新机器后 Binding 状态必须为待重新关联。
