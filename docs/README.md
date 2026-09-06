# 工程文档

本目录只存放与源码版本绑定的工程资料。产品需求、设计资料、路线图和研究文档维护在独立 `zenme-doc` 仓库。

以下文件描述当前生产路径、持久化格式、安全边界和仍在使用的回归基线：

- [系统架构](architecture.md)
- [Workspace Foundation 工程规格](workspace-foundation.md)
- [Live File 与 File Document](live-files.md)
- [Editable File 与 ChangeSet](editable-files-and-change-sets.md)
- [Agent Workspace Runtime](agent-workspace-runtime.md)
- [Agent Runtime 能力与自治边界](agent-runtime-capabilities.md)
- [Global Agent 与并行 Sub-agent](global-agent-and-subagents.md)
- [Continuous Global Agent](continuous-global-agent.md)
- [Project Memory](project-memory.md)
- [Project Knowledge Graph 与向量检索](project-knowledge.md)
- [画布性能基线与回归](canvas-performance.md)
- [本地数据与迁移](data-and-migrations.md)
- [节点执行与恢复](execution-runtime.md)
- [安全模型](security-model.md)
- [发布手册](release.md)
- [故障排查](troubleshooting.md)
- [ChatGPT 模型同步兼容版本](api/chatgpt-codex-model-version-maintenance.md)

产品需求、设计、路线图和研究资料只维护在相邻 `../zenme-doc`。旧里程碑、一次性验收矩阵、外部项目对照和已经完成的模型维护记录不在本目录长期复制；需要审计时通过 Git 历史查看对应版本。

代码行为、持久化格式、平台要求或发布流程变化时，应在同一改动中更新对应文档。
