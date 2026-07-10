# Supabase 迁移与鉴权烟测 Runbook

更新时间：2026-06-28

本文档用于把当前项目切换到 Supabase 后的真实环境迁移、RLS 校验和端到端烟测步骤集中管理。不要在本文档中记录 service role key、数据库密码或访问令牌。

## 1. 前置条件

- 已配置部署环境变量：
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `ZHIPU_API_KEY`
  - `ZHIPU_BASE_URL`
  - `READING_OCR_PROVIDER`
  - `READING_OCR_ALLOWED_PROVIDERS`
  - 如启用腾讯云 OCR，再配置 `TENCENT_CLOUD_SECRET_ID`、`TENCENT_CLOUD_SECRET_KEY`、`TENCENT_CLOUD_REGION`
- Supabase Auth 已开启可用登录方式。
- 当前分支已通过：
  - `npm test`
  - `npm run lint`
  - `npm run build`

## 2. 需要应用的迁移

按文件名顺序应用：

1. `supabase/migrations/20260624103001_create_zenme_project_canvas_schema.sql`
2. `supabase/migrations/20260628032000_create_reading_schema.sql`
3. `supabase/migrations/20260628053000_harden_project_files_update_policy.sql`
4. `supabase/migrations/20260628054500_optimize_reading_rls_and_indexes.sql`
5. `supabase/migrations/20260628061000_restrict_anon_business_table_grants.sql`
6. `supabase/migrations/20260628061500_minimize_business_table_grants.sql`

迁移完成后需要确认：

- 表存在：
  - `projects`
  - `canvas_snapshots`
  - `project_files`
  - `reading_assets`
  - `reading_notes`
  - `reading_progress`
- Storage bucket 存在：
  - `project-assets`
- `project-assets` 为 private bucket。
- `project-assets.file_size_limit = 52428800`。

## 3. RLS 检查点

所有业务表必须启用 RLS：

- `projects`
- `canvas_snapshots`
- `project_files`
- `reading_assets`
- `reading_notes`
- `reading_progress`

策略原则：

- 所有业务表按 `owner_id = auth.uid()` 隔离。
- 带 `project_id` 的表需要确认项目归属当前用户。
- 阅读笔记和阅读进度必须通过对应 `reading_assets.owner_id = auth.uid()` 约束资源归属。
- Storage 对象路径首段必须等于 `auth.uid()`。
- `anon` 不应拥有上述 6 张业务表的 Data API 表权限。
- `authenticated` 和 `service_role` 对上述 6 张业务表只保留 `SELECT/INSERT/UPDATE/DELETE`。
- 本地迁移中的业务表与 `project-assets` Storage policy 应限定 `to authenticated`，并使用 `(select auth.uid())`，避免策略落到 `public` 角色或在每行重复计算 JWT 函数。

## 4. 未登录烟测

使用无登录态浏览器或清空 cookie 后验证：

- 访问 `/projects` 应跳转 `/auth/login`。
- 访问 `/projects/{projectId}` 应跳转 `/auth/login`。
- `GET /api/ai/models` 返回 `401`。
- `POST /api/ai/chat` 返回 `401`。
- `POST /api/reading/assets` 返回 `401`。
- `POST /api/reading/ocr` 返回 `401`。
- `GET /api/reading/assets/{assetId}` 返回 `401`。
- `GET /api/reading/assets/{assetId}/file` 返回 `401`。
- `GET /api/reading/assets/{assetId}/cover` 返回 `401`。
- `GET /api/reading/assets/{assetId}/epub-asset?path=...` 返回 `401`。
- `GET /api/reading/assets/{assetId}/notes` 返回 `401`。
- `GET /api/reading/assets/{assetId}/progress` 返回 `401`。
- `PATCH /api/reading/notes/{noteId}` 返回 `401`。
- `DELETE /api/reading/notes/{noteId}` 返回 `401`。

## 5. 登录态端到端烟测

自动化 Auth/RLS 烟测：

1. 在本地或 CI 环境配置两组已确认的测试用户：
   - `ZENME_E2E_USER_A_EMAIL`
   - `ZENME_E2E_USER_A_PASSWORD`
   - `ZENME_E2E_USER_B_EMAIL`
   - `ZENME_E2E_USER_B_PASSWORD`
2. 执行：

```bash
npm run smoke:supabase
```

该脚本会使用 Supabase Auth 真实登录两名用户，验证：

- `anon` 角色无法通过 Data API 查询业务表。
- 用户 A/B 均能读取自己的项目；如果测试用户没有项目，脚本会自动创建 smoke 项目。
- 用户 A/B 按对方项目 ID 查询结果为 0。
- 用户 A/B 均能读取自己的画布快照；如果项目没有快照，脚本会自动创建 smoke 快照。
- 用户 A/B 按对方画布快照 ID 查询结果为 0。
- 如用户 A 有阅读资料，用户 B 按该 asset ID 查询结果为 0。
- 如用户 B 有项目文件，用户 A 按该 file path 查询 `project_files` 结果为 0，且不能下载对应 Storage object。
  - 如果用户 B 没有项目文件，Storage object 下载隔离检查会跳过；浏览器完整流程中仍应覆盖一次真实文件上传。

浏览器完整流程：

使用测试用户 A：

1. 登录。
2. 创建项目。
3. 打开项目画布。
4. 新建文本节点并等待自动保存。
5. 刷新页面，确认节点恢复。
6. 拖入图片或普通文件，确认文件节点显示为已上传。
7. 上传 TXT、EPUB 或 PDF 阅读资料。
8. 打开阅读器，确认内容加载。
9. 创建阅读笔记。
10. 修改阅读进度并刷新页面，确认进度恢复。
11. 触发 AI 对话，确认已登录用户可调用。
12. 如启用 OCR，框选 PDF 图片区域并确认 OCR 返回结果。

使用测试用户 B：

1. 登录另一个账号。
2. 尝试直接访问用户 A 的项目 URL，应不可访问。
3. 尝试直接请求用户 A 的阅读 asset、file、cover、notes、progress API，应返回 `404` 或 RLS 隔离后的空结果，不应返回用户 A 的数据。
4. 尝试访问用户 A 的 Storage 路径，应不可读取。

## 6. 上传限制烟测

- 小于等于 `8MB` 的阅读资料走 FormData 上传。
- 大于 `8MB` 且小于等于 `50MB` 的阅读资料走 binary 上传。
- 大于 `50MB` 的阅读资料应在客户端或服务端返回“阅读资料不能超过 50MB”。
- Storage bucket 仍应拒绝超过 `50MB` 的对象。

## 7. 验收记录

执行真实环境烟测时，在下方记录日期、环境、执行人和结论：

| 日期 | 环境 | 执行人 | 结论 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-06-28 | Supabase `zenme` (`enbdtvegaojvcwswfopq`) | Codex MCP | 数据库迁移与 RLS/Storage 结构校验通过；端到端浏览器烟测待执行 | 已应用 `create_reading_schema`、`harden_project_files_update_policy`、`optimize_reading_rls_and_indexes`；确认 6 张业务表 RLS 开启，`project-assets` 为 private 且 50MB；Security Advisor 仍提示 Auth leaked password protection 未开启 |
| 2026-06-28 | Supabase `zenme` (`enbdtvegaojvcwswfopq`) | Codex MCP | Data API grant 收窄与 A/B RLS SQL 验证通过；浏览器完整 E2E 待执行 | 已应用远端迁移 `restrict_anon_business_table_grants`、`minimize_business_table_grants`；远端迁移版本为 MCP 生成时间戳。验证结果：`anon` 查询业务表被 grant 层 42501 拒绝；用户 A/B 各自能看到自己的项目/快照/文件/阅读资料，按对方具体 project/asset/file/storage path 查询均为 0；Security Advisor 仍仅提示 Auth leaked password protection，Performance Advisor 为 unused index INFO |
| 2026-06-28 | 本地工作区 | Codex | 自动化 Auth/RLS 烟测脚本已补充；前置校验通过 | 新增 `npm run smoke:supabase`，需要配置两组测试用户邮箱和密码后运行；脚本会自动确保两名测试用户各有 smoke 项目和画布快照，并验证 anon 拒绝、项目/快照隔离、阅读资料隔离和已有项目文件 Storage 隔离；当前本地环境未配置 `ZENME_E2E_USER_*` 凭据，脚本会明确列出缺失变量后退出 |
| 2026-06-28 | 本地工作区 | Codex | 本地迁移 RLS policy 写法复核并收紧 | 远端只读检查确认 `projects`、`canvas_snapshots` 已使用 `(select auth.uid())` 与 `authenticated` 角色；本地基线迁移已同步主业务表与 Storage policy 写法，reading 优化迁移和 `project_files_update_own` 重建策略也已补 `to authenticated`，避免新环境从本地迁移重建时回退到旧策略 |
