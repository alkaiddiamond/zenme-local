-- zenme 项目数据库基线迁移
-- 从生产数据库（project enbdtvegaojvcwswfopq）逆向重建，
-- 合并原始 create_zenme_project_canvas_schema 与 harden_zenme_schema_advisor_findings 两个迁移的最终状态。
-- 新环境执行此文件即可复现完整表结构、RLS 策略、索引、触发器与 Storage 配置。

-- ============================================================================
-- 1. 表结构
-- ============================================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '未命名项目',
  prompt text not null default '',
  model text not null default 'glm-4-flash',
  thumbnail_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_saved_at timestamptz
);

create table if not exists public.canvas_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot jsonb not null default '{"version":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  original_path text not null,
  preview_path text,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 2. updated_at 自动维护函数与触发器
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists set_canvas_snapshots_updated_at on public.canvas_snapshots;
create trigger set_canvas_snapshots_updated_at before update on public.canvas_snapshots
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. 索引
-- ============================================================================

create index if not exists projects_owner_updated_idx on public.projects (owner_id, updated_at desc);
create index if not exists canvas_snapshots_owner_idx on public.canvas_snapshots (owner_id);
create index if not exists canvas_snapshots_project_idx on public.canvas_snapshots (project_id);
create index if not exists project_files_owner_idx on public.project_files (owner_id);
create index if not exists project_files_project_idx on public.project_files (project_id);

-- ============================================================================
-- 4. 行级安全（RLS）—— 所有业务表按 owner_id 隔离
-- ============================================================================

alter table public.projects enable row level security;
alter table public.canvas_snapshots enable row level security;
alter table public.project_files enable row level security;

-- projects
create policy projects_select_own on public.projects
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy projects_insert_own on public.projects
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy projects_update_own on public.projects
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy projects_delete_own on public.projects
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- canvas_snapshots（insert/update 额外校验 project_id 归属当前用户，防越权挂靠）
create policy canvas_snapshots_select_own on public.canvas_snapshots
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy canvas_snapshots_insert_own on public.canvas_snapshots
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = canvas_snapshots.project_id and p.owner_id = (select auth.uid()))
  );
create policy canvas_snapshots_update_own on public.canvas_snapshots
  for update to authenticated using ((select auth.uid()) = owner_id) with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = canvas_snapshots.project_id and p.owner_id = (select auth.uid()))
  );

-- project_files（insert/update 额外校验 project_id 归属当前用户）
create policy project_files_select_own on public.project_files
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy project_files_insert_own on public.project_files
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_files.project_id and p.owner_id = (select auth.uid()))
  );
create policy project_files_update_own on public.project_files
  for update to authenticated using ((select auth.uid()) = owner_id) with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_files.project_id and p.owner_id = (select auth.uid()))
  );
create policy project_files_delete_own on public.project_files
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ============================================================================
-- 5. Storage bucket：project-assets（私有，50MB，路径首段 = user_id 隔离）
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-assets', 'project-assets', false, 52428800)
on conflict (id) do nothing;

create policy project_assets_select_own_path on storage.objects
  for select to authenticated using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy project_assets_insert_own_path on storage.objects
  for insert to authenticated with check (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy project_assets_update_own_path on storage.objects
  for update to authenticated using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy project_assets_delete_own_path on storage.objects
  for delete to authenticated using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
