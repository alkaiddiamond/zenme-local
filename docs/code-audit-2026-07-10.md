# Zenme 代码审计报告

审计日期：2026-07-10  
基线提交：`a688413`  
范围：`app/`、`components/zenme/`、`lib/`、`desktop/`、`scripts/`、配置、测试与依赖

## 1. 审计结论

当前版本已经具备可运行的本地桌面主链路，静态检查、373 项测试和生产构建均通过。主要风险不在基础可运行性，而在“本地桌面”和“可部署 Web/Supabase”两套边界尚未完全收敛、导入恢复缺少强约束、模型配置能力超过实际适配器能力，以及少量历史节点与设置项仍处于半兼容状态。

本次只记录问题，不修改业务代码。优先级定义：

- P1：可能造成越权、敏感信息暴露、目录外写入或明显数据风险，应优先处理。
- P2：会导致已承诺功能失效、运行模式不一致或重要状态错误。
- P3：技术债、可维护性、体验一致性或尚未闭环的能力。

## 2. P1 问题

### A-01 导入包可通过项目 ID 逃逸数据目录

- 位置：`scripts/import-local-data.mjs:40`、`:233`、`:380`、`:404`。
- 现状：导入数据中的项目 ID 未通过安全路径段校验；脚本内 `resolveInside(target)` 只对已经 `path.resolve` 的绝对路径查找 `..`，不能证明目标仍位于数据目录内。恶意 `projectId` 可影响 `project.json`、画布和阅读资料的写入位置。
- 影响：导入不可信 zip 时可能覆盖数据目录之外的文件。
- 建议：复用 `lib/local/path-safety.ts` 的 `assertSafePathSegment` 与带根目录参数的 `resolveInside`；解压后先完整校验所有 ID、相对路径、条目数和总解压大小，再开始写入。
- 验收：新增包含 `../`、绝对路径、盘符、反斜杠和超长 ID 的导入测试，确认目标目录外没有任何文件变化。

### A-02 设置、备份与导入接口缺少运行模式访问边界

- 位置：`app/api/settings/route.ts:10`、`:21`，`app/api/settings/backup/route.ts:8`、`:24`，`app/api/settings/import-local/route.ts:9`。
- 现状：这些接口没有认证或“仅显式本地桌面模式”限制。`GET /api/settings` 返回完整 `modelProviders`，其中包含 API Key；备份接口可下载整个数据目录；导入与恢复可以修改本地数据。
- 影响：一旦以 Web/Supabase 方式部署，未登录访问者可能读取或修改设置、导出业务数据、恢复/导入数据。桌面随机端口和 loopback 绑定降低了远程暴露，但不能替代服务端边界。
- 建议：建立统一 `requireLocalDesktopAccess`/`requireUser` 策略；本地管理接口只在 `ZENME_STORAGE_DRIVER=local` 且明确桌面运行标记存在时开放，Web 模式必须鉴权并按用户隔离。设置 GET 默认返回脱敏密钥，保存时使用“未修改密钥”语义，避免前端回传明文。
- 验收：认证覆盖测试纳入 `settings`、`backup`、`import-local` 和 `projects`，分别验证显式本地模式与非本地模式。

### A-03 本地备份会包含明文模型密钥

- 位置：`lib/local/settings.ts:83`、`lib/local/backup.ts:12`。
- 现状：API Key 明文写入 `settings.json`，备份会递归打包整个数据目录，因此下载的 zip 同时包含业务数据和密钥。
- 影响：备份分享、云盘同步或误传时会泄露模型服务商凭据。
- 建议：产品层明确选择“备份默认排除密钥”或“备份加密并要求密码”；至少在下载前给出明确提示，并支持导入后重新填写密钥。
- 验收：检查备份包默认不出现真实 API Key；恢复后模型配置保留但密钥处于待填写状态。

### A-04 服务商模型拉取存在服务端请求伪造边界

- 位置：`app/api/ai/provider-models/route.ts:43`、`:60`。
- 现状：接口直接请求前端提交的任意 `baseUrl`，没有协议、域名、环回地址、私网地址或重定向限制。
- 影响：在 Web 部署中，已登录用户可能借服务端访问内网或云元数据地址；与 A-02 组合时风险更高。
- 建议：本地桌面可允许自定义地址但需显式提示；Web 模式使用服务商 allowlist，拒绝非 HTTPS、localhost、环回、链路本地和私网地址，并限制重定向。
- 验收：增加 localhost、`127.0.0.1`、`169.254.169.254`、RFC1918 地址、非 HTTP(S) 协议和重定向测试。

## 3. P2 问题

### A-05 图片编辑未采用本地桌面免登录策略

- 位置：`app/api/ai/image-edit/route.ts:20`。
- 现状：文本对话、模型列表和模型拉取在显式本地模式会使用 `local` 用户，图片编辑仍无条件调用 `requireUser()`。
- 影响：无 Supabase 会话的本地桌面用户可能无法使用图片编辑，即使 OpenRouter 配置有效。
- 建议：与其他 AI 接口共用同一个访问策略并增加本地模式测试。

### A-06 设置页 API 格式与实际调用适配器不一致

- 位置：`components/zenme/settings-client.tsx:54`，`app/api/ai/chat/route.ts:233`，`app/api/ai/image-edit/route.ts:43`。
- 现状：UI 允许选择 OpenAI、Anthropic、OpenRouter、Zhipu 和自定义格式；文本请求始终调用 `/chat/completions`，图片请求始终调用 `/images` 且固定 Bearer 头。Anthropic Messages 和真正的自定义协议没有适配器。
- 影响：配置可保存但调用必然失败，用户难以判断是密钥、模型还是协议问题。
- 建议：按 `apiFormat` 分派独立适配器；在适配完成前隐藏或标记不可用选项。

### A-07 图片节点记录的模型与服务端实际模型可能不一致

- 位置：`components/zenme/canvas/node-factories.ts:155`，`components/zenme/nodes/image-edit-node.tsx:58`，`app/api/ai/image-edit/route.ts:113`。
- 现状：新图片编辑节点仍写死 `google/gemini-3.1-flash-image-preview`；提交请求不携带模型 ID，服务端重新按全局设置选择模型。
- 影响：用户修改默认图片模型后，节点显示、保存的元数据和实际调用可能不同，历史结果不可追溯。
- 建议：创建节点时读取当前默认图片模型，提交时传递并校验节点模型，结果元数据保存服务商、真实模型 ID、别名快照和参数。

### A-08 Supabase 项目模式不是端到端可用状态

- 位置：`app/api/projects/**`、`lib/zenme-api.ts`、`lib/zenme-supabase.ts`。
- 现状：项目 API 始终调用本地仓库，`lib/zenme-supabase.ts` 保留但未接入项目路由；阅读 API 则仍存在本地/Supabase 分支。
- 影响：设置为 `ZENME_STORAGE_DRIVER=supabase` 时，认证和阅读可能走云端，但项目、画布和文件仍走服务器本地磁盘，形成混合数据源。
- 建议：产品上二选一：明确移除可发布云端模式，或为项目 API 建立统一 repository driver 并补齐端到端测试。

### A-09 备份恢复与导入缺少资源限制和事务式切换

- 位置：`app/api/settings/backup/route.ts:27`，`app/api/settings/import-local/route.ts:24`，`lib/local/backup.ts:36`，`scripts/import-local-data.mjs:203`。
- 现状：上传文件先整体读入内存，未限制压缩包大小、条目数和解压后总大小；恢复在写入前先移动当前数据目录，后续失败会让应用面对部分恢复目录。
- 影响：大文件或 zip bomb 可造成内存/磁盘耗尽；中途失败需要人工寻找 `.bak-*` 恢复。
- 建议：限制上传与解压预算，在临时目录完整校验和恢复后再原子切换，并提供失败自动回滚。

### A-10 画布与文件接口只有浅层结构校验和统一 50 MB 上限

- 位置：`next.config.ts:5`，`app/api/projects/[projectId]/canvas/route.ts:31`，`app/api/projects/[projectId]/files/route.ts:20`。
- 现状：画布只检查顶层数组和 viewport 存在；节点/边数量、字符串长度、缩略图 MIME/尺寸以及项目文件类型没有针对性限制。
- 影响：异常快照可能导致加载性能或存储问题，错误文件可绕过 UI 直接进入项目目录。
- 建议：为画布、缩略图、阅读资料、普通文件分别建立 schema 和容量预算。

## 4. P3 问题

### A-11 多个设置项已持久化但未驱动实际行为

- 位置：`lib/local/settings.ts:8-13`、`components/zenme/settings-client.tsx:96-98`、`components/zenme/canvas-client.tsx:1226-1253`。
- 现状：自动保存间隔在画布中固定为 5 秒；快照历史、云同步、语言、recentProjectIds 没有业务消费者；主题设置也未与本地 settings 统一。
- 建议：未实现项标记“即将推出”或暂时移除；已展示的自动保存间隔必须接入画布。

### A-12 新节点没有分别沿用上一次文本/图片模型偏好

- 位置：`components/zenme/nodes/text-node-composer.tsx:25`、`components/zenme/canvas/node-factories.ts:115`、`:155`。
- 现状：已有节点会保存自身模型，但新节点回到配置列表首项或硬编码模型；没有独立的 lastTextModel / lastImageModel 偏好。
- 建议：在本地设置中分别持久化两类最近模型，模型被禁用后回退到对应模态的默认模型。

### A-13 独立“文本生成”节点仍作为新建入口暴露

- 位置：`components/zenme/canvas/menus.tsx:32-47`、`:91-100`。
- 现状：统一文本节点已经承担下方 AI 对话，但画布双击菜单和节点加号菜单仍可创建独立文本生成节点。
- 影响：交互存在两套并行入口，与当前 PRD 的合并方向冲突。
- 建议：保留旧节点渲染与提交兼容，移除新建入口；必要时提供一次性迁移。

### A-14 Electron 未限制主窗口跨源导航

- 位置：`desktop/main.cjs:251`。
- 现状：新窗口被转交系统浏览器，但没有 `will-navigate` 拦截，也没有限制 `shell.openExternal` 协议。
- 影响：若页面内容可触发主窗口导航，外部页面仍会加载同一 preload 暴露的窗口与数据目录 IPC。
- 建议：只允许当前本地 server origin 导航，外部链接仅允许 `https:`/`http:` 并交给系统浏览器。

### A-15 核心组件体积过大，回归风险集中

- 位置：`components/zenme/canvas-client.tsx`（2421 行）、`components/zenme/settings-client.tsx`（1518 行）、`components/zenme/app-shell.tsx`（823 行）、`components/zenme/reading-workspace.tsx`（696 行）。
- 现状：状态、网络、历史、节点创建、保存和 UI 组合集中在少数客户端组件中。
- 建议：在功能稳定后按“状态机/请求适配器/节点命令/UI”边界拆分，并保持现有测试先行，避免无行为目标的大重构。

### A-16 生产依赖存在 2 个中等级别审计项

- 命令：`npm audit --omit=dev --registry=https://registry.npmjs.org`。
- 结果：`next` 内嵌的 `postcss < 8.5.10` 命中 `GHSA-qx2v-qp2m-jg93`；共 2 个 moderate、0 high、0 critical。
- 说明：当前 npm 自动修复建议异常地回退到旧 Next 主版本，不应直接执行。
- 建议：跟踪 Next.js 上游修复版本，升级前运行完整构建与桌面打包回归；若应用不处理不可信 CSS，当前实际暴露面较低但仍需登记。

## 5. 验证与测试缺口

- 已通过：ESLint、87 个测试文件/373 项测试、Next.js 生产构建。
- 未执行：Electron 打包安装与冷启动测试、真实 Zhipu/OpenRouter 端到端调用、恶意导入包与 zip bomb 测试、多数据目录切换恢复、Windows 安装升级覆盖测试。
- 当前认证覆盖测试只强制扫描 `ai` 与 `reading` 路由，未覆盖设置、备份、导入和项目管理接口。
- 当前没有覆盖率阈值；测试数量充足，但无法从 CI 阻止关键分支覆盖率下降。

## 6. 建议处理顺序

1. 修复 A-01、A-02、A-03、A-04，建立本地桌面管理 API 的统一安全边界。
2. 修复 A-05、A-06、A-07，统一模型访问策略、协议适配和节点元数据。
3. 决定 Supabase 模式去留并处理 A-08，消除混合数据源。
4. 加固备份、导入、画布和文件容量边界（A-09、A-10）。
5. 收敛设置项、模型偏好和历史文本生成入口（A-11 至 A-13）。
6. 最后处理 Electron 导航、依赖升级和组件拆分（A-14 至 A-16）。
