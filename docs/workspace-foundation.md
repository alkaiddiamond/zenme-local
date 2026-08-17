# Workspace Foundation 工程规格

状态：Phase 0 实施基线

产品依据：相邻 `zenme-doc/AI Project Workspace 开发指导.md`

## 用户结果与非目标

Phase 0 建立 Project 与主 Workspace 的安全绑定、解除和重新关联。后续版本已经在同一 Binding 中加入多个稳定 Root ID；每个根独立维护目录身份、状态、权限与 Git 摘要。用户能够看到绑定目录、信任状态、权限与 Git 基础状态。

旧 Project 读取后迁移为“未绑定 Workspace”，现有 Canvas、阅读、音乐和生成能力保持不变。

## 已确认决策

1. 一个 Project 有且只有一个主 Workspace，并可显式加入多个附加根。所有跨根文件身份必须使用 `rootId + relativePath`，禁止用相对路径猜测所属根。
2. Workspace 移动或缺失后必须由用户通过桌面目录选择器重新选择。系统比较保存的目录身份、Git 信息和结构指纹；任何信号都不能在没有用户选择时自动授予新路径权限。
3. Phase 1 文件树与搜索默认遵守 `.gitignore`，并始终应用 Zenme 的敏感文件与生成目录排除规则。显式覆盖忽略规则属于后续独立设置。
4. `.env`、私钥、证书、凭据数据库和常见密钥文件默认不得进入 Agent、索引或模型上下文。未来如允许直接查看，必须使用逐文件明确授权，且不改变索引默认拒绝规则。

## 领域职责

| 对象 | 真相源 | Phase 0 职责 |
| --- | --- | --- |
| Project | `project.json` | 聚合根；保存可选的 Workspace Binding ID，不保存 Workspace 文件内容 |
| Workspace Binding | `workspace/binding.json` | 本机根目录、目录身份、权限、信任、Git 摘要与重关联历史 |
| File Document | 后续独立存储 | Workspace File 的共享身份与编辑状态；Phase 0 只定义 ID 和边界 |
| File Node | Canvas Snapshot | File Document 的画布视图；不得复制权威文件内容 |
| ChangeSet | 后续独立存储 | AI/批量文件修改、基线版本和审批状态；不得退化为聊天 Markdown |
| Execution | 既有 execution store | 一次实际执行及恢复状态；工具日志不进入 Canvas Snapshot |
| Project Memory | 后续独立存储 | 有来源、版本和失效状态的派生知识，不是文件真相源 |

## Workspace Binding 状态机

```text
unbound
   │ 用户通过桌面选择目录
   ▼
resolved ──目录消失──▶ missing
   │                     │
   │ 身份不匹配          │ 用户重新选择
   ▼                     ▼
identity_mismatch ◀── validating
   │                     │
   └──用户确认且校验通过──┘

resolved ──用户解除──▶ unbound
```

- `resolved`：路径存在、是目录、真实路径仍与保存身份一致。
- `missing`：保存路径不存在或不可访问，不尝试猜测新位置。
- `identity_mismatch`：路径存在但目录身份不匹配；所有能力暂停。
- `unbound`：不存在 Binding，旧项目默认状态。
- 解除绑定只删除 Zenme 的绑定记录，不删除 Workspace 中任何内容。

## 权限模型

权限是独立 capability，不使用“完全信任”布尔值替代：

| Capability | Phase 0 默认值 | 首次可用阶段 | 授权规则 |
| --- | --- | --- | --- |
| `read` | `true` | Phase 1 | 用户绑定并确认目录后允许 |
| `write` | `false` | Phase 2/3 | 用户直接保存或 ChangeSet 批准 |
| `delete` | `false` | Phase 3 | 每次或受控规则单独批准 |
| `execute` | `false` | Phase 4 | 命令与工作目录受控批准 |
| `gitWrite` | `false` | 已实现 | 控制目标 Root 的本地 Git 写操作；远程 Git 操作仍逐次审批，破坏性操作直接拒绝 |

Binding 的 `trustedAt` 只证明用户选择并确认过当前目录身份，不提升 capability。

## 本地持久化契约

```text
projects/{projectId}/
  project.json                 # version 2, workspaceBindingId?: string | null
  workspace/
    binding.json               # version 1
```

`binding.json` 至少包含：

- 稳定 Binding ID 与 Project ID。
- 用户选择路径、规范化绝对路径和 `realpath`。
- 平台、文件系统 device/inode（平台可用时）与结构指纹。
- 绑定、验证、更新和解除时间。
- 独立 capability 集合。
- Git 仓库根、当前分支和工作区是否有改动的只读摘要。
- 用户在 AI 回复节点中明确加入项目的附加 Workspace roots；每项独立保存规范化路径、目录身份、授权时间和当前状态。
- 每个附加根独立保存 capability 与 Git 摘要；验证主根时同时刷新附加根状态，但绝不把主根授权复制给附加根。

目录身份字段是重关联证据，不是跨机器自动授权令牌。未知字段在规范化读写中保留。

## API 与 IPC 边界

Renderer 不能静默提交任意路径来模拟一次用户授权。主 Workspace 绑定仍必须经过系统目录选择器；Agent 产生的外部目录请求必须进入 AI 回复节点审批记录，并只能选择“本次命令”或“加入当前项目”。

1. `zenme:bind-project-workspace`：Electron 显示系统目录选择器，并由主进程使用只存在于主进程与本地服务中的启动期 secret 调用绑定 API；Renderer 不接触绝对路径或 secret。
2. `POST /api/projects/{projectId}/workspace`：只接受带正确桌面启动期 secret 的主进程请求，创建或重新关联 Binding。
3. `GET /api/projects/{projectId}/workspace`：返回脱敏 Binding、当前状态、权限和 Git 摘要。
4. `DELETE /api/projects/{projectId}/workspace`：解除绑定；不得删除外部目录。
5. 后续 capability 变更使用独立端点，不与绑定动作隐式合并。

开发/测试环境可以直接调用 repository 并传入临时目录；正式桌面 UI 只能经目录选择 IPC 获得授权。所有 API 继续经过统一 loopback 与同源校验。

## 模块依赖方向

```text
Canvas / Project UI
        ↓ typed client
local project API ← desktop selection token broker
        ↓
workspace repository
        ↓
canonical path + identity + git inspection
        ↓
user-selected external directory (read-only in Phase 0)
```

Workspace repository 不依赖 Canvas；Canvas 只消费 Workspace 摘要。Git 检测使用无 shell 的参数化子进程，失败降级为 `unavailable`，不能让绑定写入半成品。

## 需求—证据矩阵

| 要求 | 自动化证据 | 真机证据 |
| --- | --- | --- |
| 旧 Project 迁移为未绑定 | v1 fixture 读取、重写和未知字段保留测试 | 打开升级前项目 |
| 根目录不能逃逸 | 相对路径、绝对路径、`..`、链接/Junction 逃逸测试 | Windows Junction 目录 |
| 绑定可在重启后恢复 | repository/API 往返测试 | 绑定后退出并重启 |
| 缺失与身份不匹配可见 | 删除、移动、替换临时目录测试 | 移动真实开发目录 |
| 重新关联不自动提权 | capability 与身份变化测试 | 重新选择同目录和不同目录 |
| Git 只读检测 | 非 Git、正常 Git、detached、dirty fixture | 真实 Git Workspace |
| 解除不删除外部内容 | 删除 Binding 后文件仍存在测试 | 解除真实目录 |

## Phase 0 出口

- 本文、`security-model.md` 与 `data-and-migrations.md` 与代码一致。
- repository、API、IPC 和 Project UI 完成绑定、状态展示、解除、重关联。
- 路径边界、链接逃逸、迁移、缺失、身份不匹配和解除具有自动化覆盖。
- 完成一次 Windows 真机：绑定 → 重启 → 移动 → 重新关联 → 解除，并记录结果。

## Windows 真机验证记录

2026-08-12 在 Windows 开发版完成以下临时数据验证：

- 从项目菜单打开 Workspace 面板并经系统目录选择器绑定本地临时目录：通过。
- 关闭并重启 Electron 后恢复绑定路径、状态和权限：通过。
- 将已绑定目录移动到同一临时根下，重新打开面板显示 `missing`，未自动猜测位置：通过。
- 经系统目录选择器重新关联移动后的同一目录，恢复 `resolved`：通过。
- 解除 Binding 后 UI 恢复未绑定状态，外部 `README.md` 仍存在：通过。
- 临时 Project 已精确删除，临时 Workspace 已移入回收站；其他 Project 未修改。
