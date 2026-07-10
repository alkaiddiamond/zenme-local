-- Zenme reading cloud schema
-- Moves reading assets, notes, and progress toward Supabase-backed storage
-- with owner-based RLS and project ownership checks.

create table if not exists public.reading_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  node_id text,
  title text not null,
  author text,
  format text not null check (format in ('epub', 'pdf', 'txt')),
  file_name text not null,
  storage_path text not null,
  cover_path text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_notes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.reading_assets(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  selected_text text not null,
  comment text not null default '',
  section_index integer not null default 0,
  chapter_title text,
  color text not null default 'yellow' check (color in ('yellow', 'red', 'blue', 'green', 'purple')),
  type text not null default 'highlight' check (type in ('highlight', 'underline', 'note', 'region')),
  "offset" integer,
  length integer,
  rect jsonb,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_progress (
  asset_id uuid primary key references public.reading_assets(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  section_index integer not null default 0,
  content_scale real not null default 1,
  scroll_ratio real not null default 0,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_reading_assets_updated_at on public.reading_assets;
create trigger set_reading_assets_updated_at before update on public.reading_assets
  for each row execute function public.set_updated_at();

drop trigger if exists set_reading_notes_updated_at on public.reading_notes;
create trigger set_reading_notes_updated_at before update on public.reading_notes
  for each row execute function public.set_updated_at();

create index if not exists reading_assets_owner_project_idx on public.reading_assets (owner_id, project_id, updated_at desc);
create index if not exists reading_notes_owner_asset_idx on public.reading_notes (owner_id, asset_id, sort_order, created_at);
create index if not exists reading_notes_project_idx on public.reading_notes (project_id);
create index if not exists reading_progress_owner_project_idx on public.reading_progress (owner_id, project_id);

alter table public.reading_assets enable row level security;
alter table public.reading_notes enable row level security;
alter table public.reading_progress enable row level security;

create policy reading_assets_select_own on public.reading_assets
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy reading_assets_insert_own_project on public.reading_assets
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = reading_assets.project_id and p.owner_id = (select auth.uid()))
  );

create policy reading_assets_update_own_project on public.reading_assets
  for update to authenticated using ((select auth.uid()) = owner_id) with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = reading_assets.project_id and p.owner_id = (select auth.uid()))
  );

create policy reading_assets_delete_own on public.reading_assets
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy reading_notes_select_own on public.reading_notes
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy reading_notes_insert_own_asset_project on public.reading_notes
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
      from public.reading_assets a
      where a.id = reading_notes.asset_id
        and a.owner_id = (select auth.uid())
        and a.project_id = reading_notes.project_id
    )
    and exists (select 1 from public.projects p where p.id = reading_notes.project_id and p.owner_id = (select auth.uid()))
  );

create policy reading_notes_update_own_asset_project on public.reading_notes
  for update to authenticated using ((select auth.uid()) = owner_id) with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
      from public.reading_assets a
      where a.id = reading_notes.asset_id
        and a.owner_id = (select auth.uid())
        and a.project_id = reading_notes.project_id
    )
  );

create policy reading_notes_delete_own on public.reading_notes
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy reading_progress_select_own on public.reading_progress
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy reading_progress_insert_own_asset_project on public.reading_progress
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
      from public.reading_assets a
      where a.id = reading_progress.asset_id
        and a.owner_id = (select auth.uid())
        and a.project_id = reading_progress.project_id
    )
  );

create policy reading_progress_update_own_asset_project on public.reading_progress
  for update to authenticated using ((select auth.uid()) = owner_id) with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
      from public.reading_assets a
      where a.id = reading_progress.asset_id
        and a.owner_id = (select auth.uid())
        and a.project_id = reading_progress.project_id
    )
  );

create policy reading_progress_delete_own on public.reading_progress
  for delete to authenticated using ((select auth.uid()) = owner_id);
