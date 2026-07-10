-- Restrict public business tables to signed-in users at the Data API grant layer.
-- RLS remains the row-level boundary; these grants keep anon from reaching the tables.

revoke all privileges on table public.projects from anon;
revoke all privileges on table public.canvas_snapshots from anon;
revoke all privileges on table public.project_files from anon;
revoke all privileges on table public.reading_assets from anon;
revoke all privileges on table public.reading_notes from anon;
revoke all privileges on table public.reading_progress from anon;

grant select, insert, update, delete on table public.projects to authenticated, service_role;
grant select, insert, update, delete on table public.canvas_snapshots to authenticated, service_role;
grant select, insert, update, delete on table public.project_files to authenticated, service_role;
grant select, insert, update, delete on table public.reading_assets to authenticated, service_role;
grant select, insert, update, delete on table public.reading_notes to authenticated, service_role;
grant select, insert, update, delete on table public.reading_progress to authenticated, service_role;
