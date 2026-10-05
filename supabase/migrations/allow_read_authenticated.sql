-- Allow authenticated users to read monitoring data directly
-- Run this query once in Supabase -> SQL Editor

grant select on table public.monitoring_current to authenticated;
grant select on table public.monitoring_snapshots to authenticated;
grant select on table public.monitoring_site_daily to authenticated;
grant select on table public.monitoring_site_hourly to authenticated;

drop policy if exists "Allow select for authenticated users" on public.monitoring_current;
create policy "Allow select for authenticated users" on public.monitoring_current
  for select to authenticated using (true);

drop policy if exists "Allow select for authenticated users" on public.monitoring_snapshots;
create policy "Allow select for authenticated users" on public.monitoring_snapshots
  for select to authenticated using (true);

drop policy if exists "Allow select for authenticated users" on public.monitoring_site_daily;
create policy "Allow select for authenticated users" on public.monitoring_site_daily
  for select to authenticated using (true);

drop policy if exists "Allow select for authenticated users" on public.monitoring_site_hourly;
create policy "Allow select for authenticated users" on public.monitoring_site_hourly
  for select to authenticated using (true);
