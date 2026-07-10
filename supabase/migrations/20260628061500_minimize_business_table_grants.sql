-- Minimize business table grants after legacy automatic privileges.

revoke all privileges on table public.projects from authenticated, service_role;
revoke all privileges on table public.canvas_snapshots from authenticated, service_role;
revoke all privileges on table public.project_files from authenticated, service_role;
revoke all privileges on table public.reading_assets from authenticated, service_role;
revoke all privileges on table public.reading_notes from authenticated, service_role;
revoke all privileges on table public.reading_progress from authenticated, service_role;

grant select, insert, update, delete on table public.projects to authenticated, service_role;
grant select, insert, update, delete on table public.canvas_snapshots to authenticated, service_role;
grant select, insert, update, delete on table public.project_files to authenticated, service_role;
grant select, insert, update, delete on table public.reading_assets to authenticated, service_role;
grant select, insert, update, delete on table public.reading_notes to authenticated, service_role;
grant select, insert, update, delete on table public.reading_progress to authenticated, service_role;
