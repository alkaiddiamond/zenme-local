# Zenme Local

Zenme Local 是 Zenme 的本地优先版本：默认以单用户、本地数据目录运行，不需要 Supabase 账号或登录，也可以在断网环境中创建项目、保存画布、导入文件和保存阅读资料。

完整改造计划见 [docs/local-first-migration-plan.md](docs/local-first-migration-plan.md)。

## 本地优先能力

- 无 Supabase 环境变量也能启动。
- 默认不要求注册或登录。
- 支持创建、打开、重命名、删除项目。
- 画布快照和缩略图保存到本地数据目录。
- 项目文件复制到项目目录内，由本地 API 提供访问 URL。
- PDF、EPUB、TXT 阅读资料、进度、笔记和标注保存到本地。
- 数据目录可复制到另一台机器继续使用。
- 保留 Supabase 相关代码和 smoke test，后续仍可作为云端模式或迁移来源。

## 快速启动

```bash
npm install
npm run dev
```

默认情况下，如果没有配置 Supabase 环境变量，Zenme 会自动进入本地模式，并使用：

```text
./data/local
```

也可以显式指定：

```bash
set ZENME_STORAGE_DRIVER=local
set ZENME_DATA_DIR=G:\development\zenme-local\data\local
npm run dev
```

PowerShell 写法：

```powershell
$env:ZENME_STORAGE_DRIVER="local"
$env:ZENME_DATA_DIR="G:\development\zenme-local\data\local"
npm run dev
```

## 桌面开发版

```bash
npm run desktop:dev
```

Electron 主进程会启动本地 Next 服务，强制设置：

```text
ZENME_STORAGE_DRIVER=local
ZENME_DATA_DIR=<桌面配置中的数据目录>
```

首次启动的数据目录默认为 Electron `userData` 下的 `data`。在设置页可以选择数据目录、打开数据目录、下载备份和恢复备份。

打包目录版：

```bash
npm run desktop:pack -- --publish never
```

输出目录为：

```text
dist-desktop/
```

## 数据目录结构

```text
zenme-data/
  settings.json
  projects/
    {projectId}/
      project.json
      canvas/
        latest.json
        thumbnail.webp
      files/
        index.json
        original/
        preview/
      reading/
        {assetId}/
          asset.json
          sections.json
          notes.json
          progress.json
          original/
          cover.webp
```

所有业务路径都会通过本地 path safety 工具解析，导入文件只复制到数据目录内，不在业务数据中保存外部绝对路径。

## 迁移工具

从 Supabase 导出：

```bash
npm run export:supabase -- --output-dir .\zenme-export
```

需要配置 Supabase URL 和 service role key：

```text
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

导入到本地数据目录：

```bash
npm run import:local -- --source .\zenme-export --data-dir .\data\local
```

也可以在设置页上传 Supabase 导出包进行导入。

## 备份与恢复

设置页提供两个本地数据操作：

- 下载备份：生成当前数据目录的 zip。
- 恢复备份：上传 Zenme 本地备份 zip，恢复前会把当前数据目录移动为 `.bak-*` 目录。

恢复过程会拒绝包含绝对路径、Windows drive prefix 或路径穿越的 zip entry。

## Supabase 模式

Zenme Local 默认走本地模式。需要测试保留的 Supabase/RLS 行为时，可以显式设置：

```text
ZENME_STORAGE_DRIVER=supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

然后运行：

```bash
npm run smoke:supabase
```

## 验证命令

```bash
npm run lint
npm test
npm run build
```

本地化关键路径也可以单独跑：

```bash
npm test -- lib/local/path-safety.test.ts lib/local/atomic-json.test.ts lib/local/settings.test.ts lib/local/project-repository.test.ts lib/local/project-files-repository.test.ts lib/local/reading-repository.test.ts lib/local/backup.test.ts app/api/settings/settings-api.test.ts app/api/settings/import-local/import-local-api.test.ts app/api/settings/backup/backup-api.test.ts app/api/projects/local-projects-api.test.ts app/api/projects/local-project-files-api.test.ts app/api/reading/local-reading-api.test.ts components/zenme/canvas/drop-files.test.ts scripts/import-local-data.test.mjs proxy.test.ts lib/supabase/proxy.test.ts
```

脚本语法检查：

```bash
node --check scripts/import-local-data.mjs
node --check scripts/export-supabase-data.mjs
node --check desktop/main.cjs
node --check desktop/preload.cjs
```
