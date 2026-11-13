"""Core-cutting backlog: Feuille_de_scie.xlsx (SharePoint) -> samples table on mgmdrill.

Usage:  python -I tools/cutting_sync.py [--dry-run] [--file <xlsx>]
Login:  MGMDRILL_EMAIL / MGMDRILL_PASSWORD, or the first admin in private/accounts.json (same as contractor_sync.py).
Runs from tools/contractor_pipeline.cmd (Task Scheduler "mgmdrill contractor sync", 00:00 and 12:00).

Workbook: Joutel Project/Drilling/Diamond Drill/2026-2027/Samples/Feuille_de_scie.xlsx
  JO-26-NN sheets  one row per sample: Hole ID, From, To, Sample Number, Control Type, Weight (Kg), Sac [, Date Scie]
                   (sheets up to JO-26-28 have no From/To; JO-26-29 onward follow TEMPLATE). "Date Scie" = day the sample
                   was sawn, column added by the samplers; read when present.
  FA / FAWR        shipped samples: Hole ID, Sample Number, ..., Bac d'envoi#, Date d'envoi. A shipped sample is cut.
  Date Scie        daily cutting log (added by Rami 13 Nov): one row per range cut that day: Date, Sample From, Sample To.
                   Header names are matched loosely (date / from|de|début / to|à|a|fin, as a prefix or a word). A range covers the same letter
                   prefix and the numbers between the two ends, inclusive.

Rules (Rami, 13 Nov 2026):
  - everything before JO-26-25 is treated as already sent (and cut) even when the workbook has no shipping date
  - cut date = Date Scie column on the hole sheet, else the Date Scie log, else the shipping date, else assumed
  - samples without an interval (blanks, standards, old sheets) carry no length; they still count when cut/shipped
The whole table is rebuilt from the workbook on every run (upsert on sample_no, rows that vanished are deleted),
first_seen is kept from the earlier row. Each run is logged in sync_runs (kind 'cutting').
"""
import argparse, json, re, sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import load_seed as L
from contractor_sync import login, get

SP = Path.home() / "MGM" / "Maple Exploration Site - General"
XLSX = SP / "Joutel Project/Drilling/Diamond Drill/2026-2027/Samples/Feuille_de_scie.xlsx"
HOLE_SHEET = re.compile(r"^[A-Z]{2,3}-\d{2}-\d+[A-Z]?\d*$", re.I)
SAMPLE = re.compile(r"^([A-Z]+)(\d+)$", re.I)
ASSUMED_BEFORE = 25          # JO-26-NN with NN < 25: sent already


def hole_num(name):
    m = re.match(r"^JO-26-(\d+)", str(name or ""), re.I)
    return int(m.group(1)) if m else None


def as_date(v):
    if v is None or v == "": return None
    if isinstance(v, datetime): return v.date()
    if isinstance(v, date): return v
    s = str(v).strip()
    for f in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y", "%m/%d/%Y"):
        try: return datetime.strptime(s[:10], f).date()
        except ValueError: pass
    return None


def num(v):
    try: return None if v is None or v == "" else round(float(v), 2)
    except (TypeError, ValueError): return None


def col(hdr, *names):
    """index of the first header cell whose text starts with one of names, else contains one as a word (case-insensitive)."""
    cells = [str(h or "").strip().lower() for h in hdr]
    for i, t in enumerate(cells):
        if any(t.startswith(n) for n in names): return i
    for i, t in enumerate(cells):
        if any(re.search(r"(^|\s)" + re.escape(n.strip()) + r"(\s|$)", t) for n in names): return i
    return None


def read_workbook(path: Path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    samples, shipped, log, problems = {}, {}, [], []
    for ws in wb.worksheets:
        rows = [r for r in ws.iter_rows(values_only=True) if any(v is not None and v != "" for v in r)]
        if not rows: continue
        hdr, body = list(rows[0]), rows[1:]
        title = ws.title.strip()
        if title.upper() in ("FA", "FAWR"):
            ih, isn, id_, ib = col(hdr, "hole"), col(hdr, "sample n"), col(hdr, "date d'envoi", "date"), col(hdr, "bac")
            if isn is None: problems.append(f"{title}: no Sample Number column"); continue
            for r in body:
                sn = str(r[isn] or "").strip().upper()
                if not SAMPLE.match(sn): continue
                shipped[sn] = {"hole": str(r[ih] or "").strip() if ih is not None else "", "ship_date": as_date(r[id_]) if id_ is not None else None,
                               "bac": (str(r[ib]).strip() if ib is not None and r[ib] is not None else None), "sheet": title}
        elif "scie" in title.lower() and not HOLE_SHEET.match(title):
            id_, ia, ib = col(hdr, "date"), col(hdr, "from", "de", "début", "debut", "premier"), col(hdr, "to", "à", "a ", "fin", "dernier")
            if ib is None and ia is not None: ib = ia + 1
            if id_ is None or ia is None: problems.append(f"{title}: need Date / From / To columns, found {hdr}"); continue
            for r in body:
                d, a, b = as_date(r[id_]), str(r[ia] or "").strip().upper(), str(r[ib] or "").strip().upper() if ib is not None else ""
                if not d or not a: continue
                log.append((d, a, b or a))
        elif HOLE_SHEET.match(title) or title.upper() == "TEMPLATE":
            if title.upper() == "TEMPLATE": continue
            ih, isn = col(hdr, "hole"), col(hdr, "sample n")
            if isn is None: problems.append(f"{title}: no Sample Number column"); continue
            ifr, ito, ict, isac, icut = col(hdr, "from"), col(hdr, "to"), col(hdr, "control"), col(hdr, "sac"), col(hdr, "date scie", "date")
            for r in body:
                sn = str(r[isn] or "").strip().upper()
                if not SAMPLE.match(sn): continue
                hole = (str(r[ih]).strip() if ih is not None and r[ih] else title).upper()
                f, t = (num(r[ifr]) if ifr is not None else None), (num(r[ito]) if ito is not None else None)
                length = round(t - f, 2) if f is not None and t is not None and t > f else None
                if sn in samples: problems.append(f"{title}: {sn} also on {samples[sn]['sheet']}"); continue
                samples[sn] = {"sample_no": sn, "hole_name": hole, "sheet": title, "from_m": f, "to_m": t, "length_m": length,
                               "control_type": (str(r[ict]).strip() if ict is not None and r[ict] else None),
                               "sac": (str(r[isac]).strip() if isac is not None and r[isac] is not None else None),
                               "cut_date": as_date(r[icut]) if icut is not None else None, "cut_source": None, "ship_date": None, "bac": None}
                if samples[sn]["cut_date"]: samples[sn]["cut_source"] = "sheet"
    wb.close()
    # shipped samples missing from the hole sheets still exist (old sheets without intervals, FAWR whole rock)
    for sn, s in shipped.items():
        if sn not in samples:
            samples[sn] = {"sample_no": sn, "hole_name": s["hole"].upper() or "?", "sheet": s["sheet"], "from_m": None, "to_m": None, "length_m": None,
                           "control_type": "Whole Rock" if s["sheet"].upper() == "FAWR" else None, "sac": None, "cut_date": None, "cut_source": None,
                           "ship_date": None, "bac": None}
        samples[sn]["ship_date"], samples[sn]["bac"] = s["ship_date"], s["bac"]
    # daily cutting log -> cut dates (hole-sheet column wins)
    by_prefix = {}
    for sn in samples: m = SAMPLE.match(sn); by_prefix.setdefault(m.group(1), []).append((int(m.group(2)), sn))
    for d, a, b in log:
        ma, mb = SAMPLE.match(a), SAMPLE.match(b)
        if not ma or not mb or ma.group(1) != mb.group(1): problems.append(f"Date Scie: bad range {a}-{b}"); continue
        lo, hi = sorted((int(ma.group(2)), int(mb.group(2))))
        hit = 0
        for n, sn in by_prefix.get(ma.group(1), []):
            if lo <= n <= hi:
                hit += 1
                if not samples[sn]["cut_date"] or (samples[sn]["cut_source"] != "sheet" and d < samples[sn]["cut_date"]):
                    samples[sn]["cut_date"], samples[sn]["cut_source"] = d, "date_scie"
        if not hit: problems.append(f"Date Scie: {a}-{b} matches no sample")
    # shipped => cut; before JO-26-25 => assumed sent
    for s in samples.values():
        if not s["cut_date"] and s["ship_date"]: s["cut_date"], s["cut_source"] = s["ship_date"], "shipped"
        n = hole_num(s["hole_name"])
        if not s["cut_date"] and n is not None and n < ASSUMED_BEFORE: s["cut_source"] = "assumed"
    return samples, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--file", default=str(XLSX))
    a = ap.parse_args()
    path = Path(a.file)
    if not path.exists(): sys.exit(f"workbook not found: {path}")
    samples, problems = read_workbook(path)
    n_int = sum(1 for s in samples.values() if s["length_m"])
    n_cut = sum(1 for s in samples.values() if s["cut_date"] or s["cut_source"] == "assumed")
    print(f"{len(samples)} samples on {len({s['sheet'] for s in samples.values()})} sheets: {n_int} with an interval, "
          f"{sum(1 for s in samples.values() if s['ship_date'])} shipped, {n_cut} cut/assumed, {len(samples) - n_cut} waiting "
          f"({sum(s['length_m'] or 0 for s in samples.values() if not (s['cut_date'] or s['cut_source'] == 'assumed')):.1f} m)")
    for p in problems: print("  ! " + p)
    if a.dry_run: return

    token = login()
    holes = get("/rest/v1/holes?select=id,ddh_name&archived=eq.false&ddh_name=not.is.null", token)
    hid = {h["ddh_name"].strip().lower(): h["id"] for h in holes if h["ddh_name"]}
    old = {}
    for off in range(0, 1000000, 1000):                      # the API serves 1000 rows per page
        page = get(f"/rest/v1/samples?select=sample_no,first_seen&order=sample_no&limit=1000&offset={off}", token)
        old.update({r["sample_no"]: r for r in page})
        if len(page) < 1000: break
    today, now = date.today().isoformat(), datetime.now().astimezone().isoformat()
    rows, unmatched = [], set()
    for s in samples.values():
        r = dict(s); r["hole_id"] = hid.get(s["hole_name"].lower())
        if not r["hole_id"]: unmatched.add(s["hole_name"])
        r["first_seen"] = old.get(s["sample_no"], {}).get("first_seen") or today
        r["synced_at"] = now
        for k in ("cut_date", "ship_date"): r[k] = r[k].isoformat() if r[k] else None
        rows.append(r)
    gone = sorted(set(old) - set(samples))
    if unmatched: problems.append(f"holes not in the register (rows kept, no link): {', '.join(sorted(unmatched))}")
    print(f"{len(rows)} rows to upsert ({len(rows) - len(set(old) & set(samples))} new), {len(gone)} rows no longer in the workbook")
    for p in problems: print("  ! " + p)

    st, body = L.req("/rest/v1/sync_runs", {"kind": "cutting", "status": "running", "message": ""}, token, prefer="return=representation")
    run_id = json.loads(body)[0]["id"] if st == 201 else None
    status, msg = "ok", f"{len(rows)} samples, {len(rows) - n_cut} waiting"
    try:
        for i in range(0, len(rows), 200):
            chunk = rows[i:i + 200]; cols = sorted({k for r in chunk for k in r})
            st, body = L.req("/rest/v1/samples?on_conflict=sample_no&columns=" + ",".join(cols), chunk, token, prefer="resolution=merge-duplicates,return=minimal")
            if st not in (200, 201): raise RuntimeError(f"upsert batch {i}: {st} {body[:300]}")
        for i in range(0, len(gone), 100):
            st, body = L.req("/rest/v1/samples?sample_no=in.(" + ",".join(gone[i:i + 100]) + ")", token=token, method="DELETE", prefer="return=minimal")
            if st not in (200, 204): raise RuntimeError(f"delete batch {i}: {st} {body[:300]}")
    except Exception as e:
        status, msg = "error", str(e)
    if problems: msg += " · " + " · ".join(problems)
    if run_id:
        L.req(f"/rest/v1/sync_runs?id=eq.{run_id}", {"status": status, "message": msg[:2000], "finished_at": now}, token, method="PATCH", prefer="return=minimal")
    print(status, msg)
    if status != "ok": sys.exit(1)


if __name__ == "__main__": main()
