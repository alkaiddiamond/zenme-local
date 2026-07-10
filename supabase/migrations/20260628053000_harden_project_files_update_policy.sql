-- Harden project_files update policy for already-migrated environments.
-- The original remote policy only checked owner_id; updates must also keep
-- project_id attached to a project owned by the current user.

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
