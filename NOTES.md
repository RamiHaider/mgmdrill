# mgmdrill — decisions and notes

Live: https://mgmdrill.com · Database: Supabase project `mgmdrill` (ref htmiinlwnojwxznpisav) · Hosting: GitHub Pages from `main`.

## Access
- Nobody sees anything without signing in. Members are rows in `members` (email + role) and need a login
  created in Supabase → Authentication → Users (welcome email, they set their own password).
- Roles: **admin** (everything, including the Admin tab), **editor** (metres, geology, holes, reports,
  consumables, vibe, sequence), **viewer** (read everything, add comments).

## Data model (see supabase/schema.sql)
- `holes` = the Joutel / Douay registers plus the Archive sheet (`archived = true`).
- `shift_entries` is append-only; the view `shift_current` returns the winning row per rig/day/shift:
  contractor sources (rjll, spektra) beat manual/import, then newest wins. Manual history is never lost.
- Current depth of a hole = deepest `end_m` in its shifts, else final depth, else the register's manual value.
- `daily_reports` + `rig_daily` + `report_modules` = the Daily Report sheet. Yellow cells = editable fields.
- `consumables` = the Consumables & Standby sheet per half-month period.
- `stats_source` = the hidden STATS Source sheet; completed holes in `holes` are unioned in by the Stats page.
- `map_layers` holds the confidential GeoJSON (property outline, historic collars, MX collars, planned traces).

## Loading data
- `python -I tools/import_tracker.py <tracker.xlsx>` → `supabase/seed/tracker_seed.sql` (gitignored).
- `python -I tools/export_layers.py` → `supabase/seed/layers_seed.sql` (gitignored).
- Paste each file into the Supabase SQL editor. Both are wrapped in one transaction.

## Not connected yet
- RJLL portal pull (noon + midnight) and Spektra timesheet import: needs portal access; writes rows with
  source `rjll` / `spektra` using the service key. Log goes to `sync_runs`.
- MX Deposit result summary (MICH = HB + F1; I3m-l is microgabbro, not MICH).

## Known limits
- Free Supabase projects pause after 7 days without traffic; click Restore in the dashboard.
- GitHub Pages caches ~10 minutes; hard refresh after a deploy.
