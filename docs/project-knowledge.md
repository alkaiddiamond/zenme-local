# Project Knowledge Graph 与向量检索

Project Knowledge 是 `derived/knowledge/index.json` 中的可删除派生索引，不是项目真相源，也不进入普通本地备份。清除索引不会修改 Workspace、Canvas、Execution、ChangeSet 或 Project Memory，并可从这些来源完整重建。

## 索引内容

- 实体：所有可读 Workspace 根中的文件与代码符号、Canvas 节点与 Task、Execution、ChangeSet、已确认 Decision 和其他 Memory。主根保留兼容 ID；附加根实体使用稳定 `rootId + relativePath`，因此同路径文件不会合并。
- 关系：文件包含符号、显式 Canvas 连线、节点触发 Execution、Execution 产出节点或 ChangeSet、ChangeSet 修改文件、Memory 来源与替代关系。
- 文本块：最多 1,600 字符、200 字符重叠；默认使用完全本地的 `zenme-local-subword-hash-v2` 向量提供器。它同时提取英文单词/标识符片段与中文单字、二字、三字子词，避免把整段汉字误当成一个不可部分匹配的 token。
- 增量：每个块以内容哈希标识；重建时复用内容未变且 Provider 相同的向量。

索引限制为 10,000 个可见文件、100 MiB 文本和 50,000 个块。`.git`、依赖/构建目录、二进制、非 UTF-8、超过 1 MiB 的文件和敏感文件不进入索引。UI 显示容量、磁盘占用、敏感排除数和向量复用数，并支持暂停、恢复、清除和重建。

## 混合召回与上下文预算

检索将路径匹配、关键词匹配、本地向量相似度和一跳图关系组合为可解释分数。每条结果返回实体来源、内容哈希、各项分数、图关系原因和命中的块；调用方必须指定或接受有限上下文预算，不因模型支持大窗口而发送整个仓库。

统一 Project Agent 会在每个新 Turn 开始时，以用户请求自动召回已就绪索引中的少量相关证据。自动上下文最多采用 8 条和 16000 字符检索预算，只包含有界匹配片段和来源元数据；不会把实体完整正文或整个向量索引塞入模型。索引不可用时普通对话继续运行，深入检索仍通过 `search_knowledge` 工具按需完成。

搜索时会重新确认全部 Workspace 根的身份、状态和读取权限，过滤已删除或内容哈希不一致的文件，并重新验证 Memory 状态。任一根新增、移除、重新关联或读取授权变化时旧索引不可用；文件变更或删除不会产生可进入上下文的幽灵结果，增量重建后新增与重命名结果才会出现。

Project Agent 与其 Sub-agent/Team Execution 会保存实际采用的检索结果及其证据。Agent 也可以通过受控 `search_knowledge` 工具继续检索；结果不直接创建 Canvas 节点。

## Embedding Provider

`EmbeddingProvider` 是可替换接口。默认 Provider 完全本地、不发送内容。Project Knowledge 对话框会列出设置中已启用且声明 `embedding` modality 的 OpenAI 兼容模型；用户可在重建时选择内置本地模型、本机服务或云端服务。

任何 `kind: "cloud"` Provider 在索引前都必须展示服务商、模型和发送范围，并取得显式 `cloudAuthorized`；未授权时在调用 Provider 前失败。授权时间只写入可删除的派生索引。查询会按索引记录的 Provider ID 自动解析同一个模型，不允许静默切换向量空间；配置被删除或返回维度变化时要求重建。API Key 仍只从本地设置读取，不进入索引、状态响应或日志。

Provider ID 与向量维度共同参与索引兼容性判断；旧的 `zenme-local-hash-v1` 索引不会与 v2 或云端查询向量混用，而会明确要求用户重建派生索引。

## 验证

`lib/knowledge/index-store.test.ts` 使用固定 Project fixture 验证：

- 图关系使“认证决策”评估集的相关实体召回率从关键词基线 `0.5` 提升到混合召回 `1.0`。
- 敏感文件排除、增量向量复用、文件删除无幽灵结果、暂停/清除/重建，以及云端 Provider 授权前零调用。
- 中文部分概念和代码标识符片段能够进入关键词与本地向量混合召回。
- `lib/knowledge/embeddings.test.ts` 与 API 回归验证兼容 Embedding 请求、乱序响应恢复、无效向量拒绝、云端授权记录和后续自动查询；状态响应不泄露 API Key。
- `lib/local/backup.test.ts` 验证派生索引不进入备份。
