# Editable File 与 ChangeSet

本文记录 AI Project Workspace Phase 2–3 的工程契约。Workspace 授权与路径边界见 [Workspace Foundation](workspace-foundation.md)，File Document 身份与外部同步见 [Live File](live-files.md)。

## 编辑状态与磁盘真相源

- Workspace 文件始终是已保存内容的真相源；编辑 Buffer 只存在于共享 File Document 客户端状态中，不写入 Canvas Snapshot。
- 同一 File Document 的多个节点共享 `buffer`、`baseline`、`dirty`、`conflict` 和 `saving` 状态。
- 保存请求携带读取时的 `contentHash`。服务端在写入前重新计算哈希；不一致时拒绝写入并保留本地 Buffer。
- 保存使用目标文件同目录临时文件、`fsync` 和原子重命名。失败不会截断最后一个磁盘有效版本。
- UTF-8 文本上限为 1 MiB；空文件与 CRLF/LF 按原始 Buffer 精确保存，不做隐式换行转换。
- `Reload` 放弃本地 Buffer 并读取磁盘；`Keep Mine` 只保留 Buffer，不跳过下一次版本校验；`Revert` 将 Buffer 恢复为当前基线，不等同于画布撤销。

## ChangeSet 边界

ChangeSet 是一组需要整体审阅的 Workspace 文件变更，不是聊天文本或画布节点正文。记录独立保存在：

```text
projects/{projectId}/workspace/change-sets.json
```

每个操作保存：

- `create | modify | delete | rename` 类型与规范化相对路径。
- 创建时观测到的基线哈希及必要的应用前文本。
- 提议文本、应用后哈希和可选 File Document ID。
- 可选 Task、Execution 与 Agent 来源 ID。

每个 ChangeSet 还固定保存目标 `rootId`。旧记录没有该字段时只迁移为主根；新记录不会仅凭相对路径跨根匹配。同一 ChangeSet 当前只作用于一个根，从而让基线哈希、权限检查、原子应用和中断恢复始终落在同一文件系统边界内。

状态机：

```text
proposed → approved → applying → applied → reverting → reverted
    │          │          │                       │
    └──────────┴→ rejected└─────→ conflict ←──────┘
```

Agent 的 `write_file`、`edit_file`、`apply_patch`、`notebook_edit` 与 `propose_patch` 都只能创建 `source: agent` 的 ChangeSet，不获得绕过审批的任意文件写入。`apply_patch` 会先在内存中精确应用 Codex 补丁格式，多文件修改仍形成一个原子审阅单元；敏感路径不能进入 Agent ChangeSet。

## 权限与应用协议

- 普通编辑保存与 ChangeSet 创建/修改应用要求独立 `write` capability。
- 多根项目按 ChangeSet 的 `rootId` 检查该根自身的 `read/write/delete`，主根授权不会隐式授权附加根。
- 删除和重命名还要求 `delete` capability；它不会随绑定或写权限自动开启。
- 应用前先校验所有操作的基线与目标占用情况。任一项不一致时，整组操作在写入前进入 `conflict`。
- 应用中若普通错误发生，已完成操作按逆序回滚，并把结果写回审计记录。
- 进程在 `applying` 中断时，下次读取 ChangeSet 会逐项比较基线/目标哈希：可确认的部分全部回滚到应用前状态；任何未知外部状态均不覆盖并进入 `conflict`。
- 进程在 `reverting` 中断时，下次读取会继续恢复仍处于 applied 状态的操作；未知状态同样停止并标记冲突。
- Revert 前再次校验应用后哈希，防止覆盖 ChangeSet 应用之后的外部修改。

## API

- `PUT /api/projects/:projectId/workspace/documents/:documentId`：以预期哈希保存共享 File Document。
- `GET /api/projects/:projectId/workspace/change-sets`：加载并恢复中断事务后返回审阅列表。
- `POST /api/projects/:projectId/workspace/change-sets`：创建提案。
- `PATCH /api/projects/:projectId/workspace/change-sets/:changeSetId`：`approve | reject | apply | revert`。

所有路径仍经过 Binding `resolved` 状态、capability 和 `realpath` 根目录校验。API 错误只返回稳定错误码与脱敏消息，不回显文件内容、绝对路径或底层异常。

## 验证矩阵

| 行为 | 自动化证据 | Windows 真机证据 |
| --- | --- | --- |
| 精确保存 | UTF-8、空文件、CRLF/LF、大小限制与原子写测试 | 编辑后保存并由外部编辑器读取 |
| 外部冲突 | 预期哈希变化拒绝覆盖并保留 Buffer | 节点 Dirty 时外部修改 |
| 多节点一致 | 共享 store 与轮询释放测试 | 两个节点同时显示同一 Buffer/冲突 |
| 多文件审批 | create/modify/delete/rename 应用与 Revert 测试 | ChangeSet 面板整体批准、应用、回退 |
| 中断恢复 | `applying` 回滚、`reverting` 完成、未知状态不覆盖测试 | 应用中强制退出后重启 |

## Windows 真机验证记录

2026-08-12 在 Electron 开发版与仓库内临时 Workspace 完成以下验证：

- 打开 `sample.txt`，编辑并直接保存；PowerShell 从磁盘读取到精确 Buffer：通过。
- 保持本地 Dirty Buffer 时从外部修改磁盘；节点进入“外部冲突”，Buffer 未丢失，保存与 ChangeSet 提交被阻止：通过。
- 选择 `Keep Mine` 后保留 Buffer，并以新的磁盘版本作为审批基线：通过。
- 创建 ChangeSet、整体批准并应用到 Workspace；磁盘内容变为提案内容：通过。
- 应用后共享 File Document 立即接受与 Buffer 相同的受控写入，显示“已同步”，未误报外部冲突：通过。
- Revert 已应用 ChangeSet；磁盘和 File Document 均恢复到应用前内容并保持同步：通过。
- 解除 Workspace Binding 后，节点进入可恢复的“Workspace 未绑定或不可用”状态：通过。
- 临时 Project、Binding、ChangeSet 与 Workspace 文件已精确清理；其他 Project 未修改：通过。

中断事务的进程级故障注入由自动化测试覆盖；本次真机未在写入系统调用中途强制终止 Electron。
