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

## Dan's first review (12 Nov 2026)
- Map: Street base removed (imagery only); stat tiles larger; flag outline removed. Trails shapefile around Telbel / La Joutel to be added as a map layer when Dan sends it.
- Holes: Project column first, all projects shown by default with a project filter; Checks column and the vibe-driven ⚑ flags removed (depth disagreements are now a ⚠ on Current with a tooltip); proposed pads (zone PAD, P-xx) archived; sticky header inside a scrolling table; dense cells, Objective / Result clamped to 3 lines (full text on hover and in the hole card).
- Holes inputs: "+ Add hole" is a blank row at the top; shaded cells edit in place (zone, status, rig, az, dip, planned, start depth, final, samples, vibe, dates, objective, result); Order button on planned holes sets rig + position in that rig's queue (renumbers seq); "Order by" menu (DDH, planned ID, zone, status, rig+queue, vibe best first, start date, depth).
- Rig populated for every drilled hole from the timesheet; Started / Ended fall back to the timesheet; Final depth fills when status becomes Complete (DB trigger holes_fill_on_complete); Start depth defaults 0.
- Vibe check: read-only sheet using the register's filters/sort; Export PDF (print) and Export image (html2canvas, loaded on demand).
- Timesheet: window ends yesterday; newest date on top, night shift above day shift; daily total in the date cell; no "Add shift entry" form, cells only; a new shift inherits the previous shift's hole and end depth as its start (grey hint) unless typed; fixed column widths so editing does not resize the table.
- Still to do from this round: samples from MX (needs the MX API sync), MICH-result auto text (Dan to pass his prompt), CSV import of a campaign, Daily report and later pages (Dan's memo stopped at Daily report).
