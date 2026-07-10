# Zenme 本地优先改造计划

## 1. 背景与目标

本计划基于 `G:\development\zenme` 当前代码结构编写，后续实施应在 `G:\development\zenme-local` 工作区完成，避免直接改动原项目。

当前 Zenme 是 Next.js + Supabase Web 应用，项目、画布、文件、阅读资产、笔记、进度等核心数据依赖 Supabase Auth、Database、Storage 和 RLS。改造目标是把 Zenme 变成本地优先、单用户、无需登录即可独立运行的桌面应用，同时保留存储抽象，方便未来接回 Supabase、WebDAV、Git、云盘或同步服务。

最小可用版本目标：

- 断网、无 Supabase 环境变量也能启动。
- 不要求注册或登录。
- 可创建、打开、重命名、删除项目。
- 可保存并恢复画布。
- 可导入本地文件并在项目目录内管理。
- 阅读资料、进度、笔记、高亮/标注可本地保存并在重启后恢复。
- 数据目录可复制到另一台机器继续使用。

## 2. 当前代码现状

### 2.1 技术栈

- Next.js `16.2.9`
- React `19`
- Supabase：`@supabase/ssr`、`@supabase/supabase-js`
- 画布：`@xyflow/react`
- 阅读：PDF.js、EPUB/TXT parser、OCR 相关模块
- 测试：Vitest

### 2.2 主要 Supabase 耦合点

- `lib/zenme-supabase.ts`
  - 浏览器端 Supabase client。
  - 项目列表、创建项目、获取项目、重命名项目。
  - 画布 snapshot 读取/保存。
  - 项目文件与缩略图上传到 Supabase Storage。
  - 签名 URL 生成和刷新。

- `components/zenme/projects-client.tsx`
  - 通过 `getCurrentUserId()` 判断登录状态。
  - 未登录时跳转 `/auth/login`。
  - 直接调用 `listProjectsFromSupabase()` 和 `createSignedUrl()`。

- `components/zenme/canvas/persistence.ts`
  - 保存画布时直接调用 `uploadProjectThumbnailToSupabase()` 和 `saveCanvasSnapshotToSupabase()`。
  - 云端模式下刷新图片节点签名 URL。

- `lib/supabase/auth.ts`
  - `requireUser()`、`requireProjectAccess()`、`requireReadingAssetAccess()`、`requireReadingNoteAccess()` 均强依赖 Supabase Auth 和 owner 校验。

- `app/api/reading/*`
  - 阅读资料、文件、封面、进度、笔记等 API 通过 `require*Access()` 取得 `supabase` 后调用 repository。

- `lib/reading/supabase-repository.ts`
  - 汇总导出 `repositories/assets.ts`、`notes.ts`、`progress.ts` 等 Supabase repository。

- `lib/reading/storage/supabase-reading-files.ts`
  - 阅读原文件、封面文件读写依赖 Supabase Storage。

- `proxy.ts`、`lib/supabase/proxy.ts`
  - 生产环境缺 Supabase env 时拦截。
  - 未认证页面请求跳转 `/auth/login`。

### 2.3 可复用的非云模块

- `lib/zenme.ts`
  - 项目类型、画布 snapshot payload、项目排序时间、项目名生成等通用逻辑可继续使用。

- `components/zenme/canvas/persistence.ts`
  - `getPersistableCanvasNodes()`、缩略图生成逻辑可保留，只需替换后端保存调用。

- `components/zenme/reading/*`
  - 大部分阅读 UI、状态 hook 和 API client 可保留，重点改 API 后端与读写路径。

- `lib/reading/parsers/*`
  - TXT/EPUB 解析可继续用于本地导入。

- `lib/reading/progress-policy.ts`、`limits.ts`、`html-sanitize.ts`
  - 阅读业务策略与安全处理可复用。

- `lib/project-storage-paths.ts`、`lib/reading/storage-paths.ts`
  - 当前是 Supabase object key 生成器，可作为“安全文件名/相对路径”设计参考，但本地版需要新增防路径穿越的真实 filesystem resolver。

### 2.4 cc-haha 可借鉴点

`G:\development\cc-haha` 的本地优先结构可作为工程参考：

- `desktop/` 放桌面壳，Electron 主进程负责启动本地服务。
- `src/server/` 放本地 API server。
- `src/server/services/recoverableJsonFile.ts` 提供损坏 JSON 隔离到 `.invalid-*` 的恢复策略。
- `src/server/services/settingsService.ts` 使用写锁、`.tmp.*` 临时文件和 `rename` 做原子写入。
- `desktop/electron/services/serverRuntime.ts` 管理 sidecar server 生命周期。

Zenme 不应直接复制 cc-haha 的业务代码，但应采用同类边界：桌面壳只管窗口、本地目录、服务生命周期；业务读写集中在本地 API 与 repository。

## 3. 推荐目标架构

采用“方案 B：Electron + Local API Server + Next Frontend”。

```text
Zenme Desktop App
  ├─ desktop/
  │   ├─ electron/
  │   │   ├─ main.ts
  │   │   ├─ preload.ts
  │   │   └─ services/server-runtime.ts
  │   └─ package/build scripts
  │
  ├─ local-server/
  │   ├─ index.ts
  │   ├─ router.ts
  │   ├─ api/projects.ts
  │   ├─ api/canvas.ts
  │   ├─ api/files.ts
  │   ├─ api/reading.ts
  │   └─ services/
  │       ├─ data-dir.ts
  │       ├─ atomic-json.ts
  │       ├─ path-safety.ts
  │       └─ repositories/
  │
  ├─ lib/
  │   ├─ storage/
  │   │   ├─ repository.ts
  │   │   ├─ local-json-repository.ts
  │   │   └─ supabase-repository.ts
  │   └─ reading/
  │       └─ repositories/
  │
  └─ app/ + components/
      └─ 继续作为工作台 UI
```

阶段 1 可以先在 Next Route Handler 内实现本地 repository，让 Web 形态先跑通；阶段 3 再把同一套 repository 挂到独立 local server 与 Electron sidecar。

## 4. 本地数据目录设计

默认数据目录建议：

```text
Windows: %APPDATA%\Zenme\data
macOS: ~/Library/Application Support/Zenme/data
Linux: ~/.local/share/zenme/data
```

支持通过设置页切换目录；开发期支持环境变量：

```text
ZENME_DATA_DIR=G:\development\zenme-local\data
ZENME_STORAGE_DRIVER=local
```

目录结构：

```text
zenme-data/
  settings.json
  projects/
    {projectId}/
      project.json
      canvas/
        latest.json
        snapshots/
          2026-07-08T12-30-00-000Z.json
        thumbnail.webp
      files/
        index.json
        original/
          {fileId}-{safeName}
        preview/
          {fileId}.webp
      reading/
        {assetId}/
          asset.json
          sections.json
          notes.json
          progress.json
          original/
            {safeName}
          cover.webp
          ocr-cache.json
```

`settings.json` 建议字段：

```json
{
  "version": 1,
  "dataDir": "",
  "theme": "system",
  "language": "zh-CN",
  "recentProjectIds": [],
  "autoSaveIntervalMs": 30000,
  "enableSnapshotHistory": false,
  "enableCloudSyncExperimental": false
}
```

`project.json` 建议字段：

```json
{
  "version": 1,
  "id": "uuid",
  "name": "未命名项目",
  "prompt": "",
  "model": "glm-4.5",
  "thumbnailPath": "canvas/thumbnail.webp",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "lastSavedAt": "ISO",
  "lastOpenedAt": "ISO",
  "ownerId": "local"
}
```

## 5. Repository 抽象

新增统一接口，业务组件不再直接感知 Supabase 或本地文件系统。

建议文件：

- `lib/storage/types.ts`
- `lib/storage/repository.ts`
- `lib/storage/local-json-repository.ts`
- `lib/storage/supabase-adapter.ts`
- `lib/storage/client.ts`

核心接口按业务域拆分：

```ts
export type StorageDriver = "local" | "supabase";

export interface ProjectRepository {
  listProjects(): Promise<ZenmeProject[]>;
  createProject(input: CreateProjectInput): Promise<ZenmeProject>;
  getProject(projectId: string): Promise<ZenmeProject | null>;
  renameProject(projectId: string, name: string): Promise<ZenmeProject>;
  deleteProject(projectId: string): Promise<void>;
  touchProject(projectId: string, input: ProjectTouchInput): Promise<void>;
}

export interface CanvasRepository {
  getLatestSnapshot(projectId: string): Promise<CanvasSnapshotRecord | null>;
  saveLatestSnapshot(input: SaveCanvasSnapshotInput): Promise<void>;
  saveSnapshotHistory?(input: SaveCanvasSnapshotInput): Promise<void>;
}

export interface ProjectFileRepository {
  listProjectFiles(projectId: string): Promise<ProjectFileRecord[]>;
  importProjectFile(input: ImportProjectFileInput): Promise<ProjectFileRecord>;
  getProjectFile(projectId: string, fileId: string): Promise<LocalFileResult | null>;
  deleteProjectFile(projectId: string, fileId: string): Promise<void>;
}

export interface ReadingRepository {
  createAsset(input: CreateReadingAssetInput): Promise<ReadingAsset>;
  getAsset(assetId: string): Promise<ReadingAsset | null>;
  getAssetFile(assetId: string): Promise<LocalFileResult | null>;
  getAssetCover(assetId: string): Promise<LocalFileResult | null>;
  getSections(assetId: string): Promise<ReadingSection[]>;
  listNotes(assetId: string): Promise<ReadingNote[]>;
  createNote(input: CreateReadingNoteInput): Promise<ReadingNote>;
  updateNote(noteId: string, input: UpdateReadingNoteInput): Promise<ReadingNote>;
  deleteNote(noteId: string): Promise<void>;
  reorderNotes(assetId: string, noteIds: string[]): Promise<ReadingNote[]>;
  getProgress(assetId: string): Promise<ReadingProgress | null>;
  saveProgress(input: SaveReadingProgressInput): Promise<ReadingProgress>;
}
```

先把现有 Supabase 实现包成 `supabase-adapter`，再新增 local adapter。这样可分批替换调用点，测试也更容易对照。

## 6. 本地写入可靠性

新增 `lib/local/atomic-json.ts` 或 `local-server/services/atomic-json.ts`：

- 所有 JSON 写入先写 `${target}.tmp.${pid}.${timestamp}.${random}`。
- 写入完成后使用文件句柄 `sync()`，再关闭。
- `rename(tmp, target)` 替换目标。
- Windows 下遇到短暂 `ENOENT`/`EPERM` 可重试一次。
- 写入失败时删除 tmp，不破坏旧文件。
- 读取 JSON 失败时把原文件改名为 `${file}.invalid-${timestamp}-${random}`，返回默认值或抛出可恢复错误。
- 关键迁移前生成 `${file}.bak-${timestamp}-${random}`。
- 同一路径写入用进程内写锁串行化。

新增 `lib/local/path-safety.ts`：

- 所有项目路径必须通过 `resolveInsideDataDir(dataDir, relativePath)`。
- 禁止 `..`、绝对路径、Windows drive prefix、UNC path。
- 删除文件前必须确认 realpath 仍在项目目录下。
- 导入文件只复制到项目目录，不保存外部绝对路径为业务数据。

## 7. API 改造计划

### 7.1 项目 API

新增或改造：

- `app/api/projects/route.ts`
  - `GET` list projects
  - `POST` create project

- `app/api/projects/[projectId]/route.ts`
  - `GET` get project
  - `PATCH` rename/touch
  - `DELETE` delete project

前端替换：

- `components/zenme/projects-client.tsx`
  - 移除 `getCurrentUserId()` 和登录跳转。
  - 改为调用本地 API client。

- `app/page.tsx`、`app/projects/page.tsx`、`app/projects/[id]/page.tsx`
  - 保留页面结构，调整新建和打开项目流程。

### 7.2 画布 API

新增或改造：

- `app/api/projects/[projectId]/canvas/route.ts`
  - `GET` latest canvas
  - `PUT` save latest canvas

- `app/api/projects/[projectId]/canvas/thumbnail/route.ts`
  - `GET` thumbnail
  - `PUT` save thumbnail

替换：

- `components/zenme/canvas/persistence.ts`
  - `saveCanvasSnapshot()` 改调用 API。
  - `refreshImageNodeUrls()` 在本地模式下不需要签名 URL；改成刷新本地 file API URL 或直接 no-op。

### 7.3 项目文件 API

新增或改造：

- `app/api/projects/[projectId]/files/route.ts`
  - `GET` list files
  - `POST` multipart import file

- `app/api/projects/[projectId]/files/[fileId]/route.ts`
  - `GET` stream original file
  - `DELETE` delete file

- `app/api/projects/[projectId]/files/[fileId]/preview/route.ts`
  - `GET` stream preview

替换：

- `lib/zenme-supabase.ts` 中 `uploadProjectFileToSupabase()`、`refreshFileSignedUrls()` 的前端调用，迁移为 `lib/zenme-api.ts`。

### 7.4 阅读 API

保留现有 URL 形态，替换内部实现：

- `app/api/reading/assets/route.ts`
- `app/api/reading/assets/[assetId]/route.ts`
- `app/api/reading/assets/[assetId]/file/route.ts`
- `app/api/reading/assets/[assetId]/cover/route.ts`
- `app/api/reading/assets/[assetId]/epub-asset/route.ts`
- `app/api/reading/assets/[assetId]/progress/route.ts`
- `app/api/reading/assets/[assetId]/notes/route.ts`
- `app/api/reading/notes/[noteId]/route.ts`

改造方式：

- `requireReadingAssetAccess()` 替换为本地 `requireLocalReadingAsset(assetId)`。
- `requireReadingNoteAccess()` 替换为本地 `requireLocalReadingNote(noteId)`。
- 本地模式只做存在性、projectId 匹配和 schema 校验，不做 owner/RLS。
- `owner_id` 可映射为兼容字段 `ownerId: "local"`。

## 8. 本地认证与路由策略

第一阶段本地模式：

- `ZENME_STORAGE_DRIVER=local` 时不要求登录。
- `proxy.ts` 在本地模式下直接 `NextResponse.next()`。
- `/auth/*` 页面可以保留但不作为核心路径入口。
- `components/auth-button.tsx`、`components/zenme/user-menu.tsx` 改为显示本地模式状态或隐藏登录入口。

保留 Supabase 模式：

- `ZENME_STORAGE_DRIVER=supabase` 或生产云部署时继续走原认证与 RLS。
- 原 Supabase 测试暂时保留，新增本地模式测试，避免云模式回归。

## 9. 桌面壳计划

第三阶段新增 Electron。推荐先做 Electron，原因是当前项目是 Next.js/Node 生态，文件系统、sidecar server、Windows 打包路径更直接。

目录：

```text
desktop/
  package.json
  electron/
    main.ts
    preload.ts
    services/
      server-runtime.ts
      data-dir.ts
```

职责：

- 启动本地服务，仅监听 `127.0.0.1`。
- 管理窗口生命周期。
- 选择数据目录。
- 打开项目目录。
- 向前端注入 local server URL。
- 关闭应用时优雅停止 server。

第一版可以运行：

```text
Electron main -> spawn Next standalone/local server -> BrowserWindow 加载 http://127.0.0.1:{port}
```

后续再优化为：

```text
Next frontend static export 或 bundled server + 独立 local-server sidecar
```

## 10. 数据迁移计划

第一阶段提供脚本，不先做 UI：

- `scripts/export-supabase-data.ts`
  - 从 Supabase 导出项目、画布、项目文件元数据、阅读资产、sections、notes、progress。
  - 下载 Storage 文件到导出包。

- `scripts/import-local-data.ts`
  - 读取 `zenme-export.zip` 或展开目录。
  - 校验 schema。
  - 写入本地数据目录。
  - 迁移前备份已有目标项目目录。

导入包结构：

```text
zenme-export/
  manifest.json
  projects.json
  canvas_snapshots.json
  project_files/
  reading_assets.json
  reading_sections.json
  reading_notes.json
  reading_progress.json
  reading_files/
```

第二阶段可在设置页增加：

```text
设置 -> 数据 -> 从 Supabase 导出包导入
```

## 11. 分阶段实施清单

### Phase 0：准备工作

- 把 `G:\development\zenme` 复制或同步到 `G:\development\zenme-local`。
- 确认 `npm test`、`npm run lint` 在原始代码上基线状态。
- 新增 `ZENME_STORAGE_DRIVER`、`ZENME_DATA_DIR` 环境变量说明。

验收：

- `zenme-local` 不为空且能启动现有 Next 应用。
- 基线测试结果已记录。

### Phase 1：本地数据层抽象

- 新增 repository interface。
- 把 `lib/zenme-supabase.ts` 的项目、画布、文件方法拆成通用 API client + Supabase adapter。
- 新增 local JSON/File adapter。
- 新增 atomic JSON、recoverable JSON、path safety 工具及测试。
- 新增本地数据目录初始化。

优先改造文件：

- `lib/zenme-supabase.ts`
- `lib/zenme.ts`
- `lib/reading/supabase-repository.ts`
- `lib/reading/repositories/*.ts`
- `lib/reading/storage/supabase-reading-files.ts`

验收：

- 本地 adapter 单元测试通过。
- 无 Supabase 环境变量时，本地 repository 可创建项目、保存 canvas/latest.json、读回项目。

### Phase 2：本地模式可运行

- 新增项目 API、画布 API、文件 API。
- 改 `ProjectsClient` 取消登录跳转。
- 改画布保存调用本地 API。
- 改阅读 API 使用 repository interface。
- 本地模式下 `proxy.ts` 放行。
- 保留 Supabase adapter，但业务组件不再直接导入 `lib/zenme-supabase.ts`。

优先改造文件：

- `components/zenme/projects-client.tsx`
- `components/zenme/canvas/persistence.ts`
- `components/zenme/reading/api.ts`
- `app/api/reading/**/route.ts`
- `lib/supabase/auth.ts`
- `proxy.ts`

验收：

- 删除或清空 Supabase env 后，`npm run dev` 可打开项目页。
- 能创建项目、打开画布、保存并刷新恢复。
- 能拖拽导入文件，文件落到 `projects/{projectId}/files/original/`。
- 能导入阅读资料，进度和笔记重启后恢复。

### Phase 3：桌面壳

- 新增 `desktop/` Electron 工程。
- Electron 启动本地 server，监听 `127.0.0.1`。
- 实现数据目录选择、打开数据目录、数据目录不可写提示。
- 打包 Windows 开发版。

验收：

- 双击桌面应用可进入 Zenme。
- 首次启动自动初始化数据目录。
- 无网络、无 Supabase env 可完成核心流程。

### Phase 4：迁移工具

- 新增 Supabase export 脚本。
- 新增 local import 脚本。
- 导入时做 schema 校验和文件完整性校验。
- 迁移前备份目标目录。

验收：

- 能把导出包导入本地数据目录。
- 导入项目可打开，画布、文件、阅读数据完整。

### Phase 5：增强

- 快照历史开关。
- 设置页数据备份/恢复。
- 搜索索引。
- 可选 SQLite 评估。
- 可选云同步实验开关。

## 12. SQLite 评估结论

第一阶段不建议引入 SQLite。

原因：

- 当前需求的数据形态天然按项目目录分组，JSON + 文件夹可读、可备份、可迁移。
- 用户要求数据目录可理解，JSON 更透明。
- 当前最小目标是去 Supabase 强依赖，SQLite 会增加迁移、打包和 schema migration 成本。

保留后续引入 SQLite 的条件：

- 项目数量或阅读笔记数量大到 JSON 列表扫描明显变慢。
- 需要全文搜索、复杂筛选、跨项目查询。
- 需要事务性批量更新多张“表”。

推荐第一阶段：

- 元数据：JSON
- 历史：JSON snapshots 或 JSONL
- 资产：本地文件夹
- UI 偏好：localStorage 或 settings.json

## 13. 测试计划

### 单元测试

- `atomic-json.test.ts`
  - 原子写入成功。
  - 写入失败不破坏旧文件。
  - 损坏 JSON 被移动到 `.invalid-*`。
  - 并发写同一路径串行化。

- `path-safety.test.ts`
  - 拒绝 `../`、绝对路径、Windows drive、UNC。
  - 删除只能发生在项目目录内。

- `local-project-repository.test.ts`
  - 创建、列表排序、重命名、删除、最近项目。

- `local-canvas-repository.test.ts`
  - 保存和读取 `canvas/latest.json`。
  - 缩略图保存。
  - 快照历史开关。

- `local-reading-repository.test.ts`
  - 导入资产。
  - sections、notes、progress CRUD。

### API 测试

- 无 Supabase env 时项目 API 正常。
- 阅读 API 不再要求 Supabase Auth。
- 文件 API 防路径穿越。
- 删除项目清理或移入回收站。

### 端到端手工验收

1. 断网启动。
2. 创建项目。
3. 添加画布节点，保存，重启后恢复。
4. 拖拽图片/PDF/EPUB/TXT。
5. 打开阅读资料。
6. 保存阅读进度。
7. 新增、编辑、删除笔记。
8. 切换数据目录。
9. 复制数据目录到另一台机器后继续使用。

## 14. 风险与处理

- 风险：现有组件直接导入 `lib/zenme-supabase.ts`。
  - 处理：先新增 `lib/zenme-api.ts`，让组件只调 API client，再由 API 后端选择 local/supabase adapter。

- 风险：当前测试强调 Supabase Auth/RLS，改造会导致测试大面积失败。
  - 处理：保留 Supabase 模式测试，新增 local 模式测试；旧的“必须认证”测试按 storage driver 分支调整。

- 风险：本地文件 URL 与 Supabase signed URL 语义不同。
  - 处理：统一返回 API URL，例如 `/api/projects/{projectId}/files/{fileId}`，前端不接触绝对路径。

- 风险：Next Route Handler 和未来 local server 重复。
  - 处理：把 repository 和 service 放在框架无关的 `lib/local` 或 `local-server/services`，Route Handler 只是薄封装。

- 风险：删除项目误删外部文件。
  - 处理：所有删除前做 realpath containment check；导入文件一律 copy 到项目目录。

## 15. 推荐执行顺序

1. 复制原项目到 `G:\development\zenme-local` 并跑基线。
2. 实现本地数据目录、atomic JSON、path safety。
3. 实现 local project/canvas repository。
4. 新增项目/画布 API，并替换项目页和画布保存。
5. 实现 project files local repository 与 API。
6. 改阅读 repository 和阅读 API。
7. 关闭本地模式登录拦截。
8. 跑完整本地验收。
9. 加 Electron 桌面壳。
10. 加 Supabase 导出/本地导入工具。

## 16. 第一批建议提交边界

建议把第一批代码提交控制在“本地模式可创建项目并保存画布”：

- 新增本地持久化基础设施。
- 新增 project/canvas local repository。
- 新增 project/canvas API。
- `ProjectsClient` 走本地 API。
- `saveCanvasSnapshot()` 走本地 API。
- 本地模式放行 proxy。
- 测试覆盖 project/canvas local repository 和 API。

这批完成后，Zenme 已经从“必须 Supabase 登录才能进入”变成“无 Supabase 可启动并保存核心项目数据”，后续文件和阅读模块可按同一模式平稳迁移。
