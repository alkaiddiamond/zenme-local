# Live File 与 File Document

文档状态：当前工程契约。

本文档记录 Workspace 文件身份与同步契约。Workspace 的授权、目录身份和能力边界见 [workspace-foundation.md](workspace-foundation.md)，编辑与审批见 [editable-files-and-change-sets.md](editable-files-and-change-sets.md)。

## 边界

- `file` 节点继续表示复制或引用到 Zenme 项目数据目录的上传附件。
- `workspaceFile` 节点表示 Workspace 中的真实文件，不复制正文，不把正文写入画布快照。
- 节点只持久化 `projectId`、稳定的 `workspaceFileDocumentId` 和用于离线展示的 `workspaceRelativePath`。
- File Document 独立保存在项目的 `workspace/documents.json`。同一路径只创建一个 Document；多个画布节点共享该身份。
- 读取能力不隐含执行、写入、删除或 Git 写操作；这些动作需要独立 capability，并遵循 ChangeSet 和命令审批契约。

## 读取与发现

- Git Workspace 使用 `git ls-files --cached --others --exclude-standard`，遵守仓库内 `.gitignore`、`.git/info/exclude` 和 Git 的标准排除规则。
- 非 Git Workspace 使用只读遍历，并解释常用 `.gitignore` 规则；始终排除 `.git`、`node_modules`、构建输出和缓存目录。
- 目录链接不被遍历，所有打开路径再次经过 realpath 根目录约束，避免链接逃逸。
- 文本上限为 1 MiB。包含 NUL、无效 UTF-8 或超过上限的文件只返回类型与元数据，不把内容传入浏览器。
- `.env*`、私钥、证书和常见凭据文件会标记为敏感。用户可以主动查看，但 Agent、索引和模型输入必须默认排除。

## 外部变化

客户端按 File Document 共享一条 2 秒轮询订阅；同一文件的多个节点不会建立重复轮询。最后一个节点卸载后定时器会立即清理。

- 内容哈希变化：`modified`
- 原路径缺失但设备号与 inode 可在 Workspace 内定位：更新同一 Document 的相对路径并报告 `renamed`
- 无法定位：`deleted`
- 文件树重新打开时会重新枚举，因此外部创建也会出现

Windows、Linux 的本地文件系统通常可提供设备号与 inode。文件系统不提供稳定身份时，删除与重建不会被自动认作重命名，以避免把另一个文件错误绑定到已授权 Document。

## API

- `GET /api/projects/:projectId/workspace/files`：返回可见目录与文件的扁平树条目。
- `POST /api/projects/:projectId/workspace/documents`：按相对路径取得或创建 File Document，并读取当前视图。
- `GET /api/projects/:projectId/workspace/documents/:documentId`：刷新正文、Git 状态和外部变更状态。
- `PUT /api/projects/:projectId/workspace/documents/:documentId`：以预期内容哈希原子保存。

所有入口都要求 Workspace 处于 `resolved` 且拥有 `read` 能力；路径只接受相对路径并限制在已授权真实根目录内。
