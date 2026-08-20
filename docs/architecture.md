# 系统架构

## 运行边界

Zenme Local 是单机桌面应用。Electron 主进程启动绑定到 `127.0.0.1` 随机端口的 Next.js 生产服务，再由受限 BrowserWindow 加载。应用不提供公网 Web 入口、账号系统、远程数据库或自动云同步。

```text
Electron main
  ├─ BrowserWindow + preload IPC
  ├─ local Next.js child process (127.0.0.1)
  └─ userData/desktop-config.json
                │
                ▼
Next.js app and API
  ├─ app/ routes
  ├─ components/ UI and canvas
  └─ lib/local repositories
                │
                ▼
User-selected Zenme data directory
```

AI Project Workspace 的 Project 还可以显式绑定一个用户选择的外部 Workspace。Workspace 文件继续留在原目录；Zenme 数据目录只保存绑定身份、权限、派生状态和审计记录。具体领域边界与 Phase 0 API/IPC 契约见 [Workspace Foundation 工程规格](workspace-foundation.md)，真实文件与稳定 File Document 身份见 [Live File 与 File Document](live-files.md)，编辑缓冲区、冲突保护和多文件审批见 [Editable File 与 ChangeSet](editable-files-and-change-sets.md)。

Agent 执行、Global Agent 调度、Continuous Global Agent 检查点和 Project Memory 都与 Canvas Snapshot 分层保存。Continuous Global Agent 只消费提交后的领域事件并产生候选建议，不拥有写入或命令工具；详见 [Continuous Global Agent](continuous-global-agent.md)。Project Memory 只承载有来源、可验证、会失效的派生知识；详见 [Project Memory](project-memory.md)。

Project Knowledge Graph 与向量库位于 `derived/`，只从现有真相源重建，并通过有限预算的混合检索向 Agent 提供可追溯上下文。详见 [Project Knowledge Graph 与向量检索](project-knowledge.md)。

历史 `agentExecution/globalAgent` 节点的生命周期和 Fold、Promote、Pin、Archive 只作用于旧 Canvas 视图；领域记录保持独立。当前统一 Project Agent Turn 不再创建这些独立节点。兼容行为见 [历史 Canvas Convergence](canvas-convergence.md)。

## 代码职责

- `desktop/`：进程、窗口、IPC、外部导航和数据目录切换。
- `app/`：页面和本地 API 边界。
- `components/zenme/`：工作区、画布、节点和阅读界面。
- `lib/ai/`：模型服务商和调用适配。
- `lib/local/`：项目、文件、设置、备份和原子持久化。
- `lib/workspace/`：外部 Workspace 的路径规范化、目录身份、Git 只读检测、File Document 与 ChangeSet 事务。
- `lib/agent/`、`lib/global-agent/`、`lib/memory/`：受控 Agent 工具、并行调度与长期记忆。
- `lib/knowledge/`：可重建的图索引、文本分块、Embedding Provider 与混合召回。
- `lib/reading/`：阅读解析与展示逻辑。
- `lib/music/`：音乐元数据与歌词能力，不包含音乐分析服务。

## 约束

- BrowserWindow 不获得 Node.js 能力，IPC 只暴露明确白名单。
- 本地 API 复用统一 loopback、同源和错误响应边界。
- 业务数据不写入源码仓库或 Next.js 构建目录。
- 外部 HTTP 导航交给系统浏览器，窗口内禁止跨 origin 导航。
