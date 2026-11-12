"""Merge a freshly generated tracker_seed.sql into the live mgmdrill project without losing manual edits.

Usage:  python -I tools/sync_seed.py supabase/seed/tracker_seed.sql
Login:  MGMDRILL_EMAIL / MGMDRILL_PASSWORD, or the first admin in private/accounts.json.

Rules:
  holes          matched by project + DDH name, else project + planned ID; matched rows are PATCHed with the
                 workbook's non-null values (archived is never touched), unmatched rows are inserted.
  shift_entries  all source='import' rows are replaced by the workbook's timesheet blocks.
  daily_reports, rig_daily, consumables, stats_source   upserted on their keys.
  report_modules replaced for the report dates in the seed.
"""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import load_seed as L

def login():
    if not os.environ.get("MGMDRILL_EMAIL"):
        acc = json.loads((Path(__file__).parent.parent / "private" / "accounts.json").read_text(encoding="utf-8"))
        email, v = next((e, v) for e, v in acc.items() if v.get("role") == "admin")
        os.environ["MGMDRILL_EMAIL"], os.environ["MGMDRILL_PASSWORD"] = email, v["password"]
    return L.sign_in()

def get(path, token):
    st, body = L.req(path, token=token)
    if st != 200: sys.exit(f"GET {path}: {st} {body[:200]}")
    return json.loads(body)

def post(table, recs, token, prefer="return=minimal", extra=""):
    for i in range(0, len(recs), 50):
        chunk = recs[i:i+50]; cols = sorted({k for r in chunk for k in r})
        st, body = L.req(f"/rest/v1/{table}?columns=" + ",".join(cols) + extra, chunk, token, prefer=prefer)
        if st not in (200, 201): sys.exit(f"{table} batch {i}: {st} {body[:300]}")

def patch(table, filt, rec, token):
    st, body = L.req(f"/rest/v1/{table}?{filt}", rec, token, method="PATCH", prefer="return=minimal")
    if st not in (200, 204): sys.exit(f"PATCH {table} {filt}: {st} {body[:300]}")

def delete(table, filt, token):
    st, body = L.req(f"/rest/v1/{table}?{filt}", None, token, method="DELETE", prefer="return=minimal")
    if st not in (200, 204): sys.exit(f"DELETE {table} {filt}: {st} {body[:300]}")

def main():
    token = login()
    rows, _ = L.parse(sys.argv[1])
    norm = lambda s: (s or "").strip().lower()

    # ---- holes ----
    existing = get("/rest/v1/holes?select=id,project_id,ddh_name,planned_name,archived", token)
    by_ddh = {(h["project_id"], norm(h["ddh_name"])): h for h in existing if h["ddh_name"]}
    by_plan = {(h["project_id"], norm(h["planned_name"])): h for h in existing if h["planned_name"] and not h["ddh_name"]}
    by_plan_any = {(h["project_id"], norm(h["planned_name"])): h for h in existing if h["planned_name"]}
    ins, upd = [], 0
    for r in rows.get("holes", []):
        p = r["project_id"]
        m = by_ddh.get((p, norm(r.get("ddh_name")))) if r.get("ddh_name") else None
        if not m and r.get("planned_name"): m = by_plan.get((p, norm(r["planned_name"]))) or (None if r.get("ddh_name") else by_plan_any.get((p, norm(r["planned_name"]))))
        rec = {k: v for k, v in r.items() if k != "archived"}
        if m: patch("holes", f"id=eq.{m['id']}", rec, token); upd += 1
        else: ins.append(r)
    if ins: post("holes", ins, token)
    print(f"holes: {upd} updated, {len(ins)} inserted")

    # ---- shift entries: replace the workbook's import rows ----
    holes = get("/rest/v1/holes?select=id,ddh_name,archived&archived=eq.false", token)
    hid = {norm(h["ddh_name"]): h["id"] for h in holes if h["ddh_name"]}
    delete("shift_entries", "source=eq.import", token)
    sh = rows.get("shift_entries", [])
    for s in sh:
        if s.get("hole_name") and not s.get("hole_id"): s["hole_id"] = hid.get(norm(s["hole_name"]))
        if s.get("hole_id") is None: s.pop("hole_id", None)
    post("shift_entries", sh, token)
    print(f"shift_entries: {len(sh)} import rows replaced")

    # ---- reports ----
    post("daily_reports", rows.get("daily_reports", []), token, prefer="resolution=merge-duplicates,return=minimal")
    post("rig_daily", rows.get("rig_daily", []), token, prefer="resolution=merge-duplicates,return=minimal")
    mods = rows.get("report_modules", [])
    for d in sorted({m["report_date"] for m in mods}): delete("report_modules", f"report_date=eq.{d}", token)
    if mods: post("report_modules", mods, token)
    print(f"daily_reports {len(rows.get('daily_reports', []))}, rig_daily {len(rows.get('rig_daily', []))}, report_modules {len(mods)}")

    # ---- consumables, stats ----
    post("consumables", rows.get("consumables", []), token, prefer="resolution=merge-duplicates,return=minimal", extra="&on_conflict=period_start,rig_id,section,item,unit")
    post("stats_source", rows.get("stats_source", []), token, prefer="resolution=merge-duplicates,return=minimal", extra="&on_conflict=project_id,drill_hole")
    print(f"consumables {len(rows.get('consumables', []))}, stats_source {len(rows.get('stats_source', []))} upserted")

if __name__ == "__main__": main()
