"""Load the generated seed SQL files into the mgmdrill Supabase project through the REST API,
signed in as an admin member (so row-level security applies, no service key needed).

Usage:  python -I tools/load_seed.py supabase/seed/tracker_seed.sql [more.sql ...]
Env:    MGMDRILL_EMAIL, MGMDRILL_PASSWORD   (an admin member's login)

The seed files only contain simple `insert into <table> (cols) values (...)` statements plus a few
`update`/`begin`/`commit` lines; this script parses the inserts and posts them in batches.
The update statements are printed at the end so they can be run in the SQL editor (or by hand).
"""
import os, sys, re, json, urllib.request
from pathlib import Path

URL = "https://htmiinlwnojwxznpisav.supabase.co"
KEY = "sb_publishable_5of3YmOQIUyUR6GZCCPsFA_B-meAJyp"

def req(path, data=None, token=None, method=None, prefer=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(URL + path, data=body, method=method or ("POST" if body else "GET"))
    r.add_header("apikey", KEY); r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + (token or KEY))
    if prefer: r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp: return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

def sign_in():
    email, pw = os.environ.get("MGMDRILL_EMAIL"), os.environ.get("MGMDRILL_PASSWORD")
    if not email or not pw: sys.exit("set MGMDRILL_EMAIL and MGMDRILL_PASSWORD")
    st, body = req("/auth/v1/token?grant_type=password", {"email": email, "password": pw})
    if st != 200: sys.exit(f"sign-in failed: {st} {body[:200]}")
    return json.loads(body)["access_token"]

# --- tiny SQL value parser for the generated files ---
def split_values(s):
    out, cur, i, inq = [], "", 0, False
    while i < len(s):
        c = s[i]
        if inq:
            if c == "'" and i + 1 < len(s) and s[i+1] == "'": cur += "'"; i += 2; continue
            if c == "'":
                inq = False; out.append(("str", cur)); cur = ""; i += 1
                if s.startswith("::jsonb", i): i += 7
                continue
            cur += c; i += 1; continue
        if c == "'": inq = True; cur = ""; i += 1; continue
        if c == ",":
            if cur.strip(): out.append(("raw", cur.strip()))
            cur = ""; i += 1; continue
        cur += c; i += 1
    if cur.strip(): out.append(("raw", cur.strip()))
    return out

def conv(kind, v):
    if kind == "str": return v
    if v == "null": return None
    if v == "true": return True
    if v == "false": return False
    try: return int(v) if re.fullmatch(r"-?\d+", v) else float(v)
    except ValueError: return v

INS = re.compile(r"^insert into (\w+) \(([^)]*)\) values \((.*)\)(?: on conflict.*)?;$", re.S)
def parse(path):
    rows, others = {}, []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("--") or line in ("begin;", "commit;"): continue
        m = INS.match(line)
        if not m: others.append(line); continue
        table, cols, vals = m.group(1), [c.strip() for c in m.group(2).split(",")], split_values(m.group(3))
        vals = [conv(k, v) for k, v in vals]
        TEXT = {"objective", "result", "comment", "flag_note", "note", "geology", "next_target", "to_line", "from_line", "re_line", "weather", "hsec", "highlights", "unit", "title", "source"}
        vals = [("" if v is None and c.strip() in TEXT else v) for c, v in zip([c.strip() for c in m.group(2).split(",")], vals)]
        # strip ::jsonb casts: the parser already yields the JSON text
        rec = {c: (json.loads(v) if isinstance(v, str) and c in ("data", "geojson", "style") else v) for c, v in zip(cols, vals) if v is not None}  # nulls -> column defaults
        rows.setdefault(table, []).append(rec)
    return rows, others

def main():
    token = sign_in()
    for f in sys.argv[1:]:
        rows, others = parse(f)
        skip = set(os.environ.get("MGMDRILL_SKIP", "").split(","))
        for table, recs in rows.items():
            if table in skip: print(f"{f}: {table} skipped"); continue
            n = 0
            batch = 50 if table != "map_layers" else 1
            for i in range(0, len(recs), batch):
                chunk = recs[i:i+batch]; cols = sorted({k for r in chunk for k in r})
                st, body = req(f"/rest/v1/{table}?columns=" + ",".join(cols), chunk, token, prefer="resolution=ignore-duplicates,return=minimal")
                if st not in (200, 201): sys.exit(f"{table} batch {i}: {st} {body[:300]}")
                n += len(recs[i:i+batch])
            print(f"{f}: {table} {n} rows")
        for o in others: print("RUN IN SQL EDITOR:", o[:160])

if __name__ == "__main__": main()
