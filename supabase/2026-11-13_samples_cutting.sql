-- 13 Nov 2026: core-cutting backlog. One row per sample from the Feuille_de_scie workbook
-- (Joutel .../2026-2027/Samples/Feuille_de_scie.xlsx), loaded nightly by tools/cutting_sync.py.
create table if not exists samples (
  sample_no text primary key,                       -- F145641, H227781 ...
  hole_name text not null,
  hole_id uuid references holes(id) on delete set null,
  sheet text not null,                              -- workbook sheet the row came from
  from_m double precision, to_m double precision,
  length_m double precision,                        -- to - from, null for blanks / standards / rows without an interval
  control_type text,                                -- Blank, STD : CDN-CM-49, WR ...
  sac text,
  cut_date date,                                    -- day the sample was sawn
  cut_source text check (cut_source is null or cut_source in ('sheet','date_scie','shipped','assumed')),
  ship_date date,                                   -- FA / FAWR "Date d'envoi"
  bac text,                                         -- FA "Bac d'envoi#"
  first_seen date not null default current_date,    -- first sync that saw the sample
  synced_at timestamptz not null default now()
);
create index if not exists samples_hole_idx on samples (lower(hole_name));
create index if not exists samples_cut_idx on samples (cut_date);

alter table samples enable row level security;
drop policy if exists admin_all on samples;
create policy admin_all on samples for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists member_read on samples;
create policy member_read on samples for select to authenticated using (is_member());
do $$ begin
  execute 'alter publication supabase_realtime add table samples';
exception when duplicate_object then null; end $$;
