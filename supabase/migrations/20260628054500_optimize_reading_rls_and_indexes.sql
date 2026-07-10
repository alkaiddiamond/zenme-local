-- Resolve Supabase advisor findings introduced by the reading schema.
-- - Add leading-column indexes for foreign keys.
-- - Use `(select auth.uid())` in RLS policies so auth is evaluated once.

create index if not exists reading_assets_project_id_idx on public.reading_assets (project_id);
create index if not exists reading_notes_asset_id_idx on public.reading_notes (asset_id);
create index if not exists reading_progress_project_id_idx on public.reading_progress (project_id);

drop policy if exists project_files_update_own on public.project_files;
create policy project_files_update_own on public.project_files
  for update to authenticated using ((select auth.uid()) = owner_id) with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
      from public.projects p
      where p.id = project_files.project_id
        and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists reading_assets_select_own on public.reading_assets;
drop policy if exists reading_assets_insert_own_project on public.reading_assets;
drop policy if exists reading_assets_update_own_project on public.reading_assets;
drop policy if exists reading_assets_delete_own on public.reading_assets;

create policy reading_assets_select_own on public.reading_assets
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy reading_assets_insert_own_project on public.reading_assets
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
      from public.projects p
      where p.id = reading_assets.project_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy reading_assets_update_own_project on public.reading_assets
  for update to authenticated using ((select auth.uid()) = owner_id) with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
      from public.projects p
      where p.id = reading_assets.project_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy reading_assets_delete_own on public.reading_assets
  for delete to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists reading_notes_select_own on public.reading_notes;
drop policy if exists reading_notes_insert_own_asset_project on public.reading_notes;
drop policy if exists reading_notes_update_own_asset_project on public.reading_notes;
drop policy if exists reading_notes_delete_own on public.reading_notes;

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
    and exists (
      select 1
      from public.projects p
      where p.id = reading_notes.project_id
        and p.owner_id = (select auth.uid())
    )
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

drop policy if exists reading_progress_select_own on public.reading_progress;
drop policy if exists reading_progress_insert_own_asset_project on public.reading_progress;
drop policy if exists reading_progress_update_own_asset_project on public.reading_progress;
drop policy if exists reading_progress_delete_own on public.reading_progress;

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
