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
- `sections` = the Long section page (button on the Map): base image as a data URL (admin sets it with "Set base image",
  resized to 2400 px wide in the browser), header / intercept list / markers / text labels as JSON. Marker x,y are
  fractions of the image, so a new base export keeps the markers. Result colour = metal factor (g/t × m) from the
  intercept text: <1 white, 1–10 green, 10–50 yellow, 50+ red, unless overridden on the marker.

## Loading data
- `python -I tools/import_tracker.py <tracker.xlsx>` → `supabase/seed/tracker_seed.sql` (gitignored).
- `python -I tools/export_layers.py` → `supabase/seed/layers_seed.sql` (gitignored).
- Paste each file into the Supabase SQL editor. Both are wrapped in one transaction.

## Feeds (13 Nov 2026)
**Cloud, every 15 min (Supabase pg_cron -> pg_net -> Edge Function `sync-feeds`, source `supabase/functions/sync-feeds/index.ts`):**
- `sync-rjll` (:07/:22/:37/:52): RJLL portal API (`https://portail.rjll.ca/api.php?type=json&token=...&dateFrom=&dateTo=`, token from
  RJLL's programmer to Dan on 30 Jun 2026), last 20 days, one `shift_entries` row per shift with source `rjll` (hole at end of
  shift, from/to, total = RJLL "Forés" incl. casing, reaming = 0 m; other holes / hole done / reaming in the comment; pending
  reports carry "RJLL pending" until approved). Unchanged shifts are skipped, so it is idempotent.
- `sync-surveys` (:00/:15/:30/:45): IMDEXHUB-IQ `/survey/v1/surveys` for one project per tick (the one synced longest ago),
  incremental with a `$deltaToken` built from the last DateUpdated (`sync_state` key `imdex:<projectId>`), all tools and all
  statuses into `surveys`. HUB-IQ's first page per call can take a minute; the function stops paging at 110 s and resumes.
  Hole cards show OMNIx42 only, Approved + Pending (PreviouslyApproved hidden), depth / dip / azimuth / status.
- Secrets live in Vault (`imdex_api_key`, `imdex_apim_key`, `rjll_api_token`, `sync_key`), read by the service-role-only RPC
  `sync_secrets()`; `run_sync(mode)` posts to the function with `x-sync-key`. Load/rotate them with
  `tools/vault_secrets_to_clipboard.ps1` (reads the user env vars, copies the SQL) or `select vault.update_secret(id, '<new>')`.
  The function writes with the service role: no member login involved. Every run is a `sync_runs` row (Admin tab).
- Free plan: 500k function invocations/month (we use ~6k), pg_cron + pg_net included. The project pauses after 7 idle days;
  the cron traffic should count as activity, Supabase emails a week before pausing.

**Laptop, 12:00 and 00:00 (Task Scheduler "mgmdrill contractor sync" -> `tools/contractor_pipeline.cmd`):**
- Spektra only now: Outlook export (`Desktop/MGM/tools/outlook_export.py`) -> file the daily workbook on SharePoint
  (`file_daily_reports.py --tidy`) -> `tools/contractor_sync.py --no-rjll` (sheets `YYYY-MM-DD`, JOUR rows 7-10, NUIT rows 12-15,
  source `spektra`). Still signs in as an admin from private/accounts.json. Log: `private/contractor_sync.log`.
- Without `--no-rjll` the script also loads RJLL (API first, filed PDFs as fallback) - kept as a manual backup path.
- Spektra sheet 2026-11-10 has T4 = 9 Nov (their typo); the sheet name is taken as the date.

## Not connected yet
- MX Deposit result summary (MICH = HB + F1; I3m-l is microgabbro, not MICH) and samples per hole.
- Laptop Spektra job signs in as the first admin in private/accounts.json whose password still works (Rami's and Dan's
  recorded passwords stopped working 13 Nov; a dedicated sync account would be cleaner).
- Rotate the HUB-IQ keys (they were pasted in chat on Oct 27 / Nov 10) and update Vault.

## Known limits
- Free Supabase projects pause after 7 days without traffic; click Restore in the dashboard.
- GitHub Pages caches ~10 minutes; hard refresh after a deploy.

## Dan's first review (12 Nov 2026)
- Map: Street base removed (imagery only); stat tiles larger; flag outline removed. Trails shapefile around Telbel / La Joutel to be added as a map layer when Dan sends it.
- Holes: Project column first, all projects shown by default with a project filter; Checks column and the vibe-driven ⚑ flags removed (the ⚠ depth-disagreement flag on Current was dropped too, 13 Nov); proposed pads (zone PAD, P-xx) archived; sticky header inside a scrolling table; dense cells, Objective / Result clamped to 3 lines (full text on hover and in the hole card).
- Holes inputs: "+ Add hole" is a blank row at the top; shaded cells edit in place (zone, status, rig, az, dip, planned, start depth, final, samples, vibe, dates, objective, result); Order button on planned holes sets rig + position in that rig's queue (renumbers seq); "Order by" menu (DDH, planned ID, zone, status, rig+queue, vibe best first, start date, depth).
- Rig populated for every drilled hole from the timesheet; Started / Ended fall back to the timesheet; Final depth fills when status becomes Complete (DB trigger holes_fill_on_complete); Start depth defaults 0.
- Vibe check: read-only sheet using the register's filters/sort; Export PDF (print) and Export image (html2canvas, loaded on demand).
- Timesheet: window ends yesterday; newest date on top, night shift above day shift; daily total in the date cell; no "Add shift entry" form, cells only; a new shift inherits the previous shift's hole and end depth as its start (grey hint) unless typed; fixed column widths so editing does not resize the table.
- Still to do from this round: samples from MX (needs the MX API sync), MICH-result auto text (Dan to pass his prompt), CSV import of a campaign, Daily report and later pages (Dan's memo stopped at Daily report).

## 13 Nov 2026
- Daily report: Copy as image (PNG to clipboard, light theme, for pasting into email).
- Long section page seeded from Dan's annotated image (46 markers, 23 intercepts, Eagle / Telbel labels); positions mapped onto the clean Leapfrog export via the two dykes.
- Map: Fit to property fits the boundary holding the most collars (Joutel), not all four properties.

## Dan's second memo (12 Nov 2026, voice memo transcribed with tools/transcribe.py)
- Vibe check: only Hole ID, Zone, Vibe, Result; Complete and In Progress holes only; Result is the widest column; rows colour-coded (Mortgage your house purple, Good/Excellent green, Ok light green, Neutral grey, Bad red). Export PDF / image share App.exportPdf / App.exportPng (core.js).
- Daily report: title "MGM Daily Drilling Report", report date + production-through under it, no project line, no To/From/Re; programme KPIs right after the date; one "Drilling highlights · active drills" table with a geology/note row under each rig; Next target comes from the drill sequence (holes.rig_id + seq, App.rigNextHole), the manual rig_daily.next_target text only shows when nothing is queued.
- Stats: Export PDF and Export image.
- One programme: the Joutel/Douay header switch is gone; every page shows all projects, Holes and Stats filter by project.
- tools/transcribe.py: local faster-whisper (small model, CPU) for Dan's voice memos; memos and transcripts live in private/memos (gitignored).

## Incident, 13 Nov 2026: everyone signed out and asked for a new password
Cause: the "temporary password" flow shipped at 08:22 and `must_change_pw: true` was set on every existing account,
not only the new ones. The card then opened for Rami, Dan, Larissa, Colin, Pascal and Ian mid-session, and Cancel
signed them out. Fix: flag cleared for everyone who had already signed in; the card now only opens on a fresh
SIGNED_IN event, and "Later" just closes it. Rule: `must_change_pw` is set once, at account creation, never by a
bulk update on `auth.users`.
- Map: hole layers are now one toggle per status (only statuses present in the project), same six on by default as the Holes page (Flagged and Cancelled off); legend unchanged.
- Long section: buttons on the sheet use the app text colour (were black on black in dark mode); hovering an intercept in the header highlights that hole's markers on the figure (previously only marker to header).
