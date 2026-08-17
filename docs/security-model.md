# 安全模型

## 信任边界

- Electron 主进程和本地数据仓库属于可信应用边界。
- 渲染器、用户导入内容、模型响应、文件路径和外部 URL 均视为不可信输入。
- 本地服务只服务同一台机器上的受控桌面窗口，不作为 LAN 或公网 API。

## 固定要求

- 服务只绑定 `127.0.0.1`，请求必须通过统一 loopback 与同源校验。
- BrowserWindow 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- preload 不提供任意 IPC channel、shell 命令或文件系统访问。
- preload 只额外提供 Electron `File` 到其原始路径的单用途转换；渲染器不能借此枚举或任意读取文件系统。外部音频路径只能在桌面模式登记，服务端规范化并确认其为普通文件后，以项目内不可猜测 ID 提供 Range 读取。
- 导入文件名和路径段拒绝绝对路径、父目录、UNC 与路径分隔符。
- 主 Workspace 只能通过 Electron 系统目录选择器绑定。Agent 请求访问 Workspace 外绝对目录时，Renderer 只能展示由服务端规范化并记录身份的精确目录；用户可在 AI 回复节点中批准单次命令，或显式将该目录加入当前项目的附加 Workspace roots。Renderer 不获得通用文件系统 IPC，也不能静默建立信任。
- Workspace 内相对路径在每次访问时都要经过规范化与 `realpath` 边界校验；符号链接、Windows Junction、UNC 与大小写差异不得逃逸授权根目录。
- Workspace capability 分为读取、写入、删除、命令和 Git 写入。绑定目录不会自动授予后四项，目录身份变化会暂停全部 capability。
- Workspace 外单次授权绑定命令 ID、规范化绝对路径和目录身份，只可执行一次；“加入项目”持久化附加 root，后续仍受命令允许列表、敏感路径和目录身份复核约束。“从不请求审批”模式下越界请求直接失败。
- Agent 浏览器验证由 Electron 主进程的独立临时会话承载，只允许 loopback HTTP(S) 顶层页面；不共享主窗口或系统浏览器会话、Cookie 与登录态，不允许任意脚本/selector，不接受权限请求或新窗口。Next Runtime 通过随机桌面 Bearer Token 访问仅绑定 `127.0.0.1` 的内部控制端口；截图 Base64 不持久化。
- 不可信会话中的浏览器观察与交互分离：snapshot/screenshot 可直接读取隔离预览，click/type/press 必须由主 Turn 请求一次性用户确认；批准只恢复并执行原精确参数，Sub-agent 不能替用户确认或绕过该边界。
- Workspace 的 Git 写入是独立于普通命令执行的 Root 能力。只读 Git 查询不需要该能力；本地 Git 写操作在提案和真正执行前各校验一次，远程/敏感 Git 命令仍需逐次审批，破坏性 Git 命令不进入审批流程而是直接拒绝。权限开关只能通过带桌面 Token 的命名 IPC 修改。
- `.env`、私钥、证书、凭据数据库和常见密钥文件默认不得进入 Agent、索引、日志、错误或模型上下文。
- Agent `web_fetch` 只允许公开 HTTP(S) 文本页面；URL 不得携带凭据，只允许标准端口，并在初始请求和每次重定向前解析 DNS、拒绝 loopback、链路本地、私网、组播及本地域名。响应正文有超时、类型和 2 MiB 上限。
- API Key、OAuth Token 不进入前端 bundle、日志、错误响应和备份。
- HTML、EPUB 和模型返回内容在展示前经过既有安全处理。

## 发布检查

- 运行环境变量安全测试和路径安全测试。
- 检查安装包中不包含 `.env.local`、真实数据、日志或调试截图。
- Windows 与 macOS 正式产物必须代码签名；macOS 还必须完成 notarization。
- 依赖安全审计必须使用支持 npm audit API 的 registry，并记录未解决项。

Workspace 的完整威胁、状态、权限和重关联设计见 [Workspace Foundation 工程规格](workspace-foundation.md)。

## Windows Agent 命令边界

- 与 cc-haha 的原生 Windows 实现一致，Zenme 不额外包装 Codex Windows 沙箱运行器。Shell 使用固定 PowerShell、`shell: false` 和受控环境直接启动命令，避免改变 Vite、tsx、esbuild、Turbo 等真实开发进程树的语义。
- 安全边界由 Workspace Root、路径规范化、敏感文件过滤、命令解析与风险分类、会话权限和精确的一次性审批共同组成；未授权越界、安装依赖、联网或系统管理命令不会静默执行。
- 前台命令持续运行时保留同一个子进程，达到后台阈值后只改变任务表示，不重新启动命令。后台输出、终态通知和停止操作都绑定稳定 task ID。
- 桌面关闭、任务停止和超时会终止整棵进程树；原生 Windows 当前不提供强制的进程级文件系统隔离，因此界面和文档不得把 `workspace-write` 描述为 OS 沙箱保证。

## MCP Server 信任边界

- MCP Server 是用户显式配置并启用的本机第三方程序；只有当前 Project Workspace 同时具有读取和命令执行能力时才会启动，工作目录固定为该 Workspace。
- stdio Server 由官方 MCP SDK 管理，不经 Renderer，也不接收设置页中的密钥环境变量。SDK 仅继承运行所需的最小安全环境变量，stderr、工具结果和错误均有长度边界。
- “只读”只依据 Server 声明的 `readOnlyHint` 控制哪些工具暴露给模型，不能约束恶意 Server 进程本身。原生 Windows 不提供进程级文件系统沙箱；启用不可信 Server 等同于允许运行本机第三方代码。完全访问必须由用户在设置中显式开启。
- MCP 资源读取同样受 Server 启用状态、Workspace 执行权限和结果长度边界约束；资源 URI 由对应 Server 解释，Zenme 不会把它当作本地路径自行越权读取。二进制资源正文不会进入模型上下文。

Workspace 文件 API 只接受相对路径，读取前验证 `resolved + read` 能力并用 `realpath` 限制授权根目录。敏感文件会标记并默认排除在后续 Agent、索引和模型输入之外；文本正文还有 UTF-8、二进制和 1 MiB 限制。详见 [Live File 与 File Document](live-files.md)。

Workspace 写权限与删除/重命名权限独立授权。直接保存必须携带预期内容哈希；ChangeSet 在任何写入前校验整组基线，Agent 来源的提案拒绝敏感路径。中断恢复只处理能由基线或目标哈希确认的状态，未知内容不会被自动覆盖。详见 [Editable File 与 ChangeSet](editable-files-and-change-sets.md)。

Project Memory 的 Workspace 文件来源会在授权根内解析，拒绝敏感路径、链接逃逸和超限文件，并在进入模型上下文前重新核验内容哈希。Agent 只能创建候选，不能自行确认 Decision。详见 [Project Memory](project-memory.md)。

Project Knowledge 默认只在本机生成 Embedding；敏感、忽略、二进制与超限文件不索引。云端 Embedding Provider 必须在发送任何块之前取得显式授权，Workspace 身份变化会使旧索引拒绝检索。详见 [Project Knowledge Graph 与向量检索](project-knowledge.md)。
