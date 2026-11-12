-- mgmdrill.com schema. Run once on a fresh Supabase project (SQL editor).
-- Access: admin (everything), editor (operational data), viewer (read + comments).

create extension if not exists pgcrypto;

-- ---------- people ----------
create table if not exists members (
  email text primary key,
  name text not null default '',
  role text not null default 'viewer' check (role in ('admin','editor','viewer')),
  added_at timestamptz not null default now()
);

-- ---------- reference ----------
create table if not exists projects (
  id text primary key,              -- 'joutel', 'douay'
  name text not null,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists rigs (
  id text primary key,              -- 'FSD15', 'No11'
  label text not null,              -- 'RJLL FSD15'
  contractor text not null,         -- 'RJLL', 'Spektra'
  project_id text not null references projects(id),
  source text not null default 'manual' check (source in ('manual','rjll','spektra')),
  active boolean not null default true,
  sort int not null default 0,
  color text not null default '#2a78d6'
);

create table if not exists settings (
  id text primary key default 'main' check (id = 'main'),
  targets jsonb not null default '{"m_per_rig_day":60,"program_m":25000,"program_holes":75,"season_start":"2026-07-01"}'::jsonb,
  mich_codes jsonb not null default '{"mich":["HB","F1"],"microgabbro":["I3m-l"]}'::jsonb,
  flag_rule jsonb not null default '{"vibes":["Good","Excellent","Mortgage your house"]}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into settings (id) values ('main') on conflict do nothing;

-- ---------- holes (the Joutel/Douay registers + Archive) ----------
create table if not exists holes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id),
  planned_name text,
  zone text,
  ddh_name text,
  easting double precision, northing double precision, elevation double precision,
  azimuth double precision, dip double precision,
  planned_depth double precision,
  start_length double precision not null default 0,      -- wedge start depth
  current_depth_manual double precision,                 -- used when no shift rows exist
  final_depth double precision,
  n_samples int,
  vibe text check (vibe is null or vibe in ('Bad','Neutral','Ok','Good','Excellent','Mortgage your house')),
  status text not null default 'Planned' check (status in ('Permit Pending','Planned','Flagged','Cut','Spotted','In Progress','Complete','Cancelled')),
  objective text not null default '',
  result text not null default '',
  rig_id text references rigs(id),
  seq int,                                                -- order on that rig (FSD15-02 -> rig FSD15, seq 2)
  start_date date, end_date date,
  flagged boolean not null default false,
  flag_note text not null default '',
  archived boolean not null default false,                -- previous seasons (Archive sheet)
  updated_by text, updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists holes_ddh_ci on holes (project_id, lower(ddh_name)) where ddh_name is not null and ddh_name <> '';
create index if not exists holes_rig_idx on holes (rig_id, seq);

-- ---------- timesheet ----------
-- Every entry is kept. The current value for a rig/day/shift is the one with the best source,
-- then the newest. Contractor data (rjll, spektra) beats manual. Manual history survives.
create table if not exists shift_entries (
  id uuid primary key default gen_random_uuid(),
  rig_id text not null references rigs(id),
  shift_date date not null,
  shift text not null check (shift in ('day','night')),
  hole_id uuid references holes(id) on delete set null,
  hole_name text,
  start_m double precision, end_m double precision, total_m double precision,
  comment text not null default '',
  source text not null default 'manual' check (source in ('manual','import','rjll','spektra')),
  entered_by text,
  created_at timestamptz not null default now()
);
create index if not exists shift_entries_key on shift_entries (rig_id, shift_date, shift, created_at desc);

create or replace view shift_current with (security_invoker = true) as
select distinct on (rig_id, shift_date, shift) *
from shift_entries
order by rig_id, shift_date, shift,
  case source when 'rjll' then 2 when 'spektra' then 2 else 1 end desc,
  created_at desc;

-- ---------- daily report ----------
create table if not exists daily_reports (
  report_date date primary key,
  production_through date,
  to_line text not null default 'Ian Cunningham-Dunlop, Pascal Hamelin',
  from_line text not null default '',
  re_line text not null default 'Daily drilling operations',
  weather text not null default '',
  hsec text not null default '',
  highlights text not null default '',
  updated_by text, updated_at timestamptz not null default now()
);
create table if not exists rig_daily (
  report_date date not null,
  rig_id text not null references rigs(id),
  geology text not null default '',
  next_target text not null default '',
  note text not null default '',
  updated_by text, updated_at timestamptz not null default now(),
  primary key (report_date, rig_id)
);
-- Modular blocks: RC drilling, Other, anything added later. data is free-form per kind.
create table if not exists report_modules (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  kind text not null,                 -- 'rc', 'other', 'custom'
  title text not null default '',
  data jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  updated_by text, updated_at timestamptz not null default now()
);
create index if not exists report_modules_date on report_modules (report_date, sort);

-- ---------- comments (hole, or rig-shift) ----------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  hole_id uuid references holes(id) on delete cascade,
  rig_id text references rigs(id),
  shift_date date,
  shift text check (shift is null or shift in ('day','night')),
  body text not null check (length(body) between 1 and 4000),
  author text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists comments_hole on comments (hole_id, created_at);
create index if not exists comments_shift on comments (rig_id, shift_date, created_at);

-- ---------- consumables & standby (half-month billing periods) ----------
create table if not exists consumables (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  rig_id text not null references rigs(id),
  section text not null,
  item text not null,
  unit text not null default '',
  qty double precision not null default 0,
  source text not null default 'manual',
  note text not null default '',
  updated_by text, updated_at timestamptz not null default now(),
  unique (period_start, rig_id, section, item, unit)
);

-- ---------- long-running stats (hidden STATS Source sheet) ----------
create table if not exists stats_source (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id),
  drill_hole text not null,
  reporting_date date not null,
  meters double precision not null default 0,
  samples int not null default 0,
  source text not null default 'Archive',
  include boolean not null default true,
  unique (project_id, drill_hole)
);

-- ---------- map layers (confidential, served only to members) ----------
create table if not exists map_layers (
  id text primary key,
  name text not null,
  kind text not null,                 -- 'boundary', 'points', 'lines'
  geojson jsonb not null,
  style jsonb not null default '{}'::jsonb,
  default_on boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------- sync log (RJLL / Spektra / MX refreshes) ----------
create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  message text not null default ''
);

-- ---------- stamps ----------
create or replace function stamp_row() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(auth.jwt()->>'email', new.updated_by);
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['holes','daily_reports','rig_daily','report_modules','consumables'] loop
    execute format('drop trigger if exists stamp on %I; create trigger stamp before insert or update on %I for each row execute function stamp_row()', t, t);
  end loop;
end $$;

create or replace function stamp_entry() returns trigger language plpgsql as $$
begin
  new.entered_by = coalesce(auth.jwt()->>'email', new.entered_by);
  return new;
end $$;
drop trigger if exists stamp on shift_entries;
create trigger stamp before insert on shift_entries for each row execute function stamp_entry();

create or replace function stamp_comment() returns trigger language plpgsql as $$
begin
  new.author = coalesce(auth.jwt()->>'email', new.author);
  return new;
end $$;
drop trigger if exists stamp on comments;
create trigger stamp before insert on comments for each row execute function stamp_comment();

-- ---------- security ----------
create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from members where lower(email) = lower(coalesce(auth.jwt()->>'email','')) limit 1;
$$;
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(my_role() = 'admin', false); $$;
create or replace function is_editor() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(my_role() in ('admin','editor'), false); $$;
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$ select my_role() is not null; $$;
revoke all on function my_role() from public, anon;   grant execute on function my_role() to authenticated;
revoke all on function is_admin() from public, anon;  grant execute on function is_admin() to authenticated;
revoke all on function is_editor() from public, anon; grant execute on function is_editor() to authenticated;
revoke all on function is_member() from public, anon; grant execute on function is_member() to authenticated;

do $$ declare t text; begin
  foreach t in array array['members','projects','rigs','settings','holes','shift_entries','daily_reports','rig_daily','report_modules','comments','consumables','stats_source','map_layers','sync_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists admin_all on %I; create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t, t);
  end loop;
  -- every member reads everything except the member list
  foreach t in array array['projects','rigs','settings','holes','shift_entries','daily_reports','rig_daily','report_modules','comments','consumables','stats_source','map_layers','sync_runs'] loop
    execute format('drop policy if exists member_read on %I; create policy member_read on %I for select to authenticated using (is_member())', t, t);
  end loop;
  -- editors write operational data
  foreach t in array array['holes','daily_reports','rig_daily','report_modules','consumables','stats_source'] loop
    execute format('drop policy if exists editor_write on %I; create policy editor_write on %I for insert to authenticated with check (is_editor())', t, t);
    execute format('drop policy if exists editor_update on %I; create policy editor_update on %I for update to authenticated using (is_editor()) with check (is_editor())', t, t);
  end loop;
  foreach t in array array['report_modules','consumables','shift_entries'] loop
    execute format('drop policy if exists editor_delete on %I; create policy editor_delete on %I for delete to authenticated using (is_editor())', t, t);
  end loop;
end $$;
-- editors enter manual shift rows only (contractor rows come from the sync job with the service key)
drop policy if exists editor_write on shift_entries;
create policy editor_write on shift_entries for insert to authenticated with check (is_editor() and source = 'manual');
-- members see their own row so the page can greet them
drop policy if exists self_read on members;
create policy self_read on members for select to authenticated using (lower(email) = lower(coalesce(auth.jwt()->>'email','')));
-- any member comments; only the author (or an admin) edits or deletes
drop policy if exists member_comment on comments;
create policy member_comment on comments for insert to authenticated with check (is_member());
drop policy if exists own_comment_update on comments;
create policy own_comment_update on comments for update to authenticated
  using (lower(author) = lower(coalesce(auth.jwt()->>'email',''))) with check (lower(author) = lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists own_comment_delete on comments;
create policy own_comment_delete on comments for delete to authenticated using (lower(author) = lower(coalesce(auth.jwt()->>'email','')));

-- live updates
do $$ declare t text; begin
  foreach t in array array['holes','shift_entries','daily_reports','rig_daily','report_modules','comments','consumables','settings','rigs'] loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ---------- reference seed ----------
insert into projects (id, name, active, sort) values ('joutel','Joutel',true,1), ('douay','Douay',true,2) on conflict do nothing;
insert into rigs (id, label, contractor, project_id, source, sort, color) values
  ('FSD15','RJLL FSD15','RJLL','joutel','rjll',1,'#2a78d6'),
  ('FSD23','RJLL FSD23','RJLL','joutel','rjll',2,'#eb6834'),
  ('FSD27','RJLL FSD27','RJLL','joutel','rjll',3,'#1baf7a'),
  ('FSD39','RJLL FSD39','RJLL','joutel','rjll',4,'#eda100'),
  ('No11','Spektra No11','Spektra','joutel','spektra',5,'#e87ba4')
on conflict do nothing;
