-- Station metadata (custom name, asset owner, notes)
-- Run this query once in Supabase -> SQL Editor to enable cross-device cloud sync for station edits.

create table if not exists public.station_metadata (
  station_key text primary key,
  station_id text,
  platform text,
  custom_name text,
  asset_owner text,
  notes text,
  updated_at timestamptz not null default now()
);

grant all on table public.station_metadata to authenticated;
grant select, insert, update on table public.station_metadata to anon;

alter table public.station_metadata enable row level security;

drop policy if exists "Allow select station_metadata" on public.station_metadata;
create policy "Allow select station_metadata" on public.station_metadata
  for select using (true);

drop policy if exists "Allow insert/update station_metadata" on public.station_metadata;
create policy "Allow insert/update station_metadata" on public.station_metadata
  for all using (true) with check (true);
