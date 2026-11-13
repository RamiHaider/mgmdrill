"""Contractor feed: RJLL daily time reports (PDF) + Spektra daily workbooks -> shift_entries on mgmdrill.

Usage:  python -I tools/contractor_sync.py [--dry-run] [--since YYYY-MM-DD] [--days N]
Login:  MGMDRILL_EMAIL / MGMDRILL_PASSWORD, or the first admin in private/accounts.json.

Sources (filed on SharePoint by Desktop/MGM/tools/file_daily_reports.py, which reads the Outlook export):
  RJLL     Joutel .../2026-2027/Timesheets/FSD-NN/YYYYMMDD-QC-56-FSD-NN.pdf  (internal-approved report)
           one row per shift: hole worked at the end of the shift, De/À of that hole, total = RJLL's "Forés"
           sum for the shift (casing included, reaming = 0 m, as RJLL counts it). Other holes touched in the
           same shift, "hole done" marks and reaming go in the comment.
  Spektra  .../Timesheets/SPEKTRA-11/1235_Maple Gold_<Mon>_<yyyy>_Drill11.xlsx, one sheet per day named
           YYYY-MM-DD: JOUR rows 7-10, NUIT rows 12-15 (B hole, E from, G to, I metres).

Rows are inserted with source 'rjll' / 'spektra'; shift_current then prefers them over manual/import rows.
A rig/date/shift whose newest contractor row already has the same hole, start, end, total and comment is
skipped, so the script can run as often as wanted. Each run is logged in sync_runs.
"""
import argparse, glob, json, os, re, sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import load_seed as L

SP = Path.home() / "MGM" / "Maple Exploration Site - General"
TS = SP / "Joutel Project/Drilling/Diamond Drill/2026-2027/Timesheets"
RJLL_PDF = re.compile(r"^(\d{8})-QC-56-(FSD-\d+)\.pdf$", re.I)
SPEKTRA_XLSX = re.compile(r"^1235_Maple Gold_.+_Drill#?11\.xlsx$", re.I)
NUM_M = re.compile(r"^\d+\.\d\d$")
HOLE = re.compile(r"^[A-Z]{2,3}-\d{2}-\d+[A-Z]?\d*$")
TYPES = {"Drilling", "Casing", "Reaming", "wedge", "Steel wedge", "Cimentation"}


def r2(x): return None if x is None else round(float(x) + 0.0, 2)


# ---------------- RJLL ----------------
def parse_rjll(pdf: Path):
    """-> dict shift -> list of line dicts (hole, type, de, a, fores, done)."""
    import pypdf
    text = pypdf.PdfReader(str(pdf)).pages[0].extract_text()
    shifts, cur = {"day": [], "night": []}, None
    for ln in text.splitlines():
        toks = ln.split()
        idx = [k for k, t in enumerate(toks) if NUM_M.match(t) and k + 1 < len(toks) and toks[k + 1] == "m"]
        if len(idx) < 3: continue
        if toks[0] in ("Jour", "Nuit"):
            cur = "day" if toks[0] == "Jour" else "night"; toks = toks[1:]; idx = [i - 1 for i in idx]
        if cur is None or not HOLE.match(toks[0]): continue
        i = idx[0]
        typ = toks[i - 2] if i >= 2 and toks[i - 2] in TYPES else ("Steel wedge" if i >= 3 and toks[i - 3:i - 1] == ["Steel", "wedge"] else "")
        shifts[cur].append({"hole": toks[0], "type": typ, "de": float(toks[idx[0]]), "a": float(toks[idx[1]]),
                            "fores": float(toks[idx[2]]), "done": toks[-1] == "X"})
    return shifts


def rjll_rows(pdf: Path, rig_id: str, d: date):
    out = []
    for shift, lines in parse_rjll(pdf).items():
        if not lines: continue
        main = lines[-1]["hole"]
        mine = [l for l in lines if l["hole"] == main and l["type"] != "Reaming"]
        start = mine[0]["de"] if mine else None
        end = mine[-1]["a"] if mine else None
        total = sum(l["fores"] for l in lines)
        notes = []
        for h in dict.fromkeys(l["hole"] for l in lines if l["hole"] != main):
            hl = [l for l in lines if l["hole"] == h]
            m = sum(l["fores"] for l in hl)
            notes.append(f"{h} {hl[0]['de']:g}->{hl[-1]['a']:g} m ({m:g} m{', hole done' if any(l['done'] for l in hl) else ''})")
        for l in lines:
            if l["type"] == "Reaming": notes.append(f"reaming {l['hole']} {l['de']:g}->{l['a']:g} m")
            elif l["type"] == "Casing" and l["hole"] == main: notes.append(f"casing {l['de']:g}->{l['a']:g} m")
        if any(l["done"] for l in lines if l["hole"] == main): notes.append("hole done")
        out.append({"rig_id": rig_id, "shift_date": d.isoformat(), "shift": shift, "hole_name": main,
                    "start_m": r2(start), "end_m": r2(end), "total_m": r2(total),
                    "comment": "; ".join(notes), "source": "rjll"})
    return out


# ---------------- Spektra ----------------
def spektra_rows(xlsx: Path, since: date):
    import openpyxl
    out, checks = [], []
    wb = openpyxl.load_workbook(str(xlsx), data_only=True, read_only=True)
    for ws in wb.worksheets:
        try: d = datetime.strptime(ws.title.strip(), "%Y-%m-%d").date()
        except ValueError: continue  # template sheets ("11 mai")
        if d < since: continue
        cells = {c.coordinate: c.value for row in ws.iter_rows(min_row=6, max_row=17) for c in row if c.value not in (None, "")}
        for shift, rows, tot_cell in (("day", range(7, 11), "I11"), ("night", range(12, 16), "I16")):
            hole, lines = None, []
            for r in rows:
                h = cells.get(f"B{r}")
                if isinstance(h, str) and h.strip(): hole = h.strip().upper()
                e, g = cells.get(f"E{r}"), cells.get(f"G{r}")
                if isinstance(e, (int, float)) and isinstance(g, (int, float)) and hole:
                    i = cells.get(f"I{r}")
                    lines.append((hole, float(e), float(g), float(i) if isinstance(i, (int, float)) else float(g) - float(e)))
            if not lines: continue
            main = lines[-1][0]
            mine = [l for l in lines if l[0] == main]
            total = sum(l[3] for l in lines)
            sheet_total = cells.get(tot_cell)
            if isinstance(sheet_total, (int, float)) and abs(float(sheet_total) - total) > 0.01:
                checks.append(f"{ws.title} {shift}: lines sum {total:g} m, sheet says {sheet_total:g} m")
            notes = [f"{h} {hl[0][1]:g}->{hl[-1][2]:g} m ({sum(l[3] for l in hl):g} m)"
                     for h in dict.fromkeys(l[0] for l in lines if l[0] != main) for hl in [[l for l in lines if l[0] == h]]]
            out.append({"rig_id": "No11", "shift_date": d.isoformat(), "shift": shift, "hole_name": main,
                        "start_m": r2(mine[0][1]), "end_m": r2(mine[-1][2]), "total_m": r2(total),
                        "comment": "; ".join(notes), "source": "spektra"})
    wb.close()
    return out, checks


# ---------------- Supabase ----------------
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


def same(a, b):
    return all((a.get(k) == b.get(k)) if k in ("hole_name", "comment") else (r2(a.get(k)) == r2(b.get(k)))
               for k in ("hole_name", "start_m", "end_m", "total_m", "comment"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--since", help="first shift date to load (default: --days back)")
    ap.add_argument("--days", type=int, default=45)
    a = ap.parse_args()
    since = date.fromisoformat(a.since) if a.since else date.today() - timedelta(days=a.days)
    if not TS.exists(): sys.exit(f"SharePoint folder not synced: {TS}")

    rows, problems = [], []
    for pdf in sorted(TS.glob("FSD-*/*.pdf")):
        m = RJLL_PDF.match(pdf.name)
        if not m: continue
        d = datetime.strptime(m.group(1), "%Y%m%d").date()
        if d < since: continue
        try: rows += rjll_rows(pdf, m.group(2).replace("-", "").upper(), d)
        except Exception as e: problems.append(f"{pdf.name}: {e}")
    for xlsx in sorted((TS / "SPEKTRA-11").glob("*.xlsx")):
        if not SPEKTRA_XLSX.match(xlsx.name): continue
        try:
            r, c = spektra_rows(xlsx, since); rows += r; problems += c
        except Exception as e: problems.append(f"{xlsx.name}: {e}")
    rows.sort(key=lambda r: (r["rig_id"], r["shift_date"], r["shift"]))
    print(f"{len(rows)} contractor shifts parsed since {since} ({sum(r['source']=='rjll' for r in rows)} RJLL, {sum(r['source']=='spektra' for r in rows)} Spektra)")
    for p in problems: print("  ! " + p)

    token = login()
    rigs = {r["id"] for r in get("/rest/v1/rigs?select=id", token)}
    bad = sorted({r["rig_id"] for r in rows if r["rig_id"] not in rigs})
    if bad: problems.append(f"unknown rigs skipped: {', '.join(bad)}"); rows = [r for r in rows if r["rig_id"] in rigs]
    holes = get("/rest/v1/holes?select=id,ddh_name&archived=eq.false&ddh_name=not.is.null", token)
    hid = {h["ddh_name"].strip().lower(): h["id"] for h in holes if h["ddh_name"]}
    existing = get(f"/rest/v1/shift_entries?select=rig_id,shift_date,shift,hole_name,start_m,end_m,total_m,comment,created_at"
                   f"&source=in.(rjll,spektra)&shift_date=gte.{since.isoformat()}&order=created_at.desc", token)
    latest = {}
    for e in existing: latest.setdefault((e["rig_id"], e["shift_date"], e["shift"]), e)

    new, unmatched = [], set()
    for r in rows:
        if same(latest.get((r["rig_id"], r["shift_date"], r["shift"]), {}), r): continue
        h = hid.get(r["hole_name"].lower())
        if h: r["hole_id"] = h
        else: unmatched.add(r["hole_name"])
        new.append(r)
    if unmatched: problems.append(f"holes not in the register (rows kept, no link): {', '.join(sorted(unmatched))}")
    print(f"{len(new)} new/changed rows, {len(rows) - len(new)} already on the site")
    for r in new: print(f"  {r['rig_id']:6} {r['shift_date']} {r['shift']:5} {r['hole_name']:10} {r['start_m']}->{r['end_m']}  {r['total_m']} m  {r['comment']}")
    for p in problems: print("  ! " + p)
    if a.dry_run: return

    st, body = L.req("/rest/v1/sync_runs", {"kind": "contractor", "status": "running", "message": ""}, token, prefer="return=representation")
    run_id = json.loads(body)[0]["id"] if st == 201 else None
    status, msg = "ok", f"{len(new)} rows added ({len(rows)} parsed since {since})"
    try:
        for i in range(0, len(new), 50):
            chunk = new[i:i + 50]; cols = sorted({k for r in chunk for k in r})
            st, body = L.req("/rest/v1/shift_entries?columns=" + ",".join(cols), chunk, token, prefer="return=minimal")
            if st not in (200, 201): raise RuntimeError(f"insert batch {i}: {st} {body[:300]}")
    except Exception as e:
        status, msg = "error", str(e)
    if problems: msg += " · " + " · ".join(problems)
    if run_id:
        L.req(f"/rest/v1/sync_runs?id=eq.{run_id}", {"status": status, "message": msg[:2000], "finished_at": datetime.now().astimezone().isoformat()},
              token, method="PATCH", prefer="return=minimal")
    print(status, msg)
    if status != "ok": sys.exit(1)


if __name__ == "__main__": main()
