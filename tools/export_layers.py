"""Export the map layers from the QField GeoPackages to GeoJSON (WGS84) and to SQL for map_layers.

Usage: python -I tools/export_layers.py [qfield_dir]
Writes supabase/seed/layers_seed.sql and private/*.geojson (both gitignored).
No GDAL needed: reads the GeoPackage with sqlite3 and converts NAD83 / UTM 17N by formula.
"""
import sys, json, math, sqlite3, struct, datetime as dt
from pathlib import Path

QF = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "QField/cloud/Maple-Gold-Mines__DouayJoutel"
ROOT = Path(__file__).resolve().parents[1]
PRIV = ROOT / "private"; PRIV.mkdir(exist_ok=True)
SEED = ROOT / "supabase/seed"; SEED.mkdir(parents=True, exist_ok=True)

# ---- UTM 17N (GRS80) -> lon/lat ----
A = 6378137.0; F = 1 / 298.257222101; E2 = F * (2 - F); EP2 = E2 / (1 - E2); K0 = 0.9996; LON0 = math.radians(-81)
def utm_to_ll(x, y):
    m = (y) / K0
    mu = m / (A * (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    phi1 = (mu + (3*e1/2 - 27*e1**3/32) * math.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32) * math.sin(4*mu)
            + (151*e1**3/96) * math.sin(6*mu) + (1097*e1**4/512) * math.sin(8*mu))
    n1 = A / math.sqrt(1 - E2 * math.sin(phi1)**2)
    t1 = math.tan(phi1)**2
    c1 = EP2 * math.cos(phi1)**2
    r1 = A * (1 - E2) / (1 - E2 * math.sin(phi1)**2) ** 1.5
    d = (x - 500000) / (n1 * K0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (d**2/2 - (5 + 3*t1 + 10*c1 - 4*c1**2 - 9*EP2) * d**4/24
          + (61 + 90*t1 + 298*c1 + 45*t1**2 - 252*EP2 - 3*c1**2) * d**6/720)
    lon = LON0 + (d - (1 + 2*t1 + c1) * d**3/6 + (5 - 2*c1 + 28*t1 - 3*c1**2 + 8*EP2 + 24*t1**2) * d**5/120) / math.cos(phi1)
    return round(math.degrees(lon), 7), round(math.degrees(lat), 7)

# ---- GeoPackage binary -> coordinates ----
def gp_wkb(blob):
    flags = blob[3]
    env = (flags >> 1) & 7
    env_len = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[env]
    return blob[8 + env_len:]

def parse_wkb(b):
    def rd(fmt, off):
        return struct.unpack_from(fmt, b, off)
    def geom(off):
        bo = "<" if b[off] == 1 else ">"
        raw = rd(bo + "I", off + 1)[0]; off += 5
        iso = (raw & 0x0FFFFFFF) // 1000                        # ISO: 1=Z, 2=M, 3=ZM
        has_z = bool(raw & 0x80000000) or iso in (1, 3)
        has_m = bool(raw & 0x40000000) or iso in (2, 3)
        if raw & 0x20000000: off += 4                            # EWKB SRID
        t = (raw & 0x0FFFFFFF) % 1000
        dims = 2 + (1 if has_z else 0) + (1 if has_m else 0)
        if t == 1:
            c = rd(bo + f"{dims}d", off); return "Point", list(c[:2]), off + 8 * dims
        if t == 2:
            n = rd(bo + "I", off)[0]; off += 4
            pts = []
            for _ in range(n):
                c = rd(bo + f"{dims}d", off); pts.append(list(c[:2])); off += 8 * dims
            return "LineString", pts, off
        if t == 3:
            n = rd(bo + "I", off)[0]; off += 4
            rings = []
            for _ in range(n):
                m = rd(bo + "I", off)[0]; off += 4
                ring = []
                for _ in range(m):
                    c = rd(bo + f"{dims}d", off); ring.append(list(c[:2])); off += 8 * dims
                rings.append(ring)
            return "Polygon", rings, off
        if t in (4, 5, 6, 7):
            n = rd(bo + "I", off)[0]; off += 4
            parts = []
            for _ in range(n):
                k, c, off = geom(off); parts.append((k, c))
            name = {4: "MultiPoint", 5: "MultiLineString", 6: "MultiPolygon", 7: "GeometryCollection"}[t]
            return name, [c for _, c in parts], off
        raise ValueError(f"wkb type {t}")
    k, c, _ = geom(0)
    return k, c

def to_ll(kind, coords):
    if kind == "Point": return utm_to_ll(*coords)
    if kind in ("LineString", "MultiPoint"): return [utm_to_ll(*p) for p in coords]
    if kind in ("Polygon", "MultiLineString"): return [[utm_to_ll(*p) for p in ring] for ring in coords]
    if kind == "MultiPolygon": return [[[utm_to_ll(*p) for p in ring] for ring in poly] for poly in coords]
    raise ValueError(kind)

def read_layer(gpkg, table, props):
    c = sqlite3.connect(QF / gpkg)
    cols = [r[1] for r in c.execute(f'pragma table_info("{table}")')]
    feats = []
    for row in c.execute(f'select * from "{table}"'):
        rec = dict(zip(cols, row))
        blob = rec.get("geom") or rec.get("geometry")
        if not blob: continue
        kind, coords = parse_wkb(gp_wkb(blob))
        p = {}
        for src, dst in props.items():
            v = rec.get(src)
            if isinstance(v, float) and v.is_integer() and dst not in ("elev",): v = int(v)
            p[dst] = v
        feats.append({"type": "Feature", "geometry": {"type": kind, "coordinates": to_ll(kind, coords)}, "properties": p})
    c.close()
    return {"type": "FeatureCollection", "features": feats}

LAYERS = [
    # id, name, kind, gpkg, table, property map, style, default_on, sort
    ("boundary", "Property outline", "boundary", "MGMClaimContourregion.gpkg", "MGMClaimContourregion", {"Propriete": "name"},
     {"color": "#d7b973", "weight": 2, "fill": False, "dashArray": "6 4"}, True, 1),
    ("historic_joutel", "Historic Joutel collars (3,466)", "points", "JoutelCollars.gpkg", "JoutelCollars",
     {"hole_numbe": "hole", "maxdepth": "depth", "Elevation": "elev"}, {"radius": 2.5, "color": "#898781"}, False, 5),
    ("mx_collars", "MX Deposit collars", "points", "DrillingCollar.gpkg", "DrillingCollar",
     {"Hole numbe": "hole", "Hole statu": "status", "Type": "type", "End Of Hol": "eoh", "Zone": "zone"},
     {"radius": 3, "color": "#52514e"}, False, 6),
    ("planned_traces", "Planned traces (QGIS)", "lines", "2526PlannedTraces.gpkg", "2526PlannedTraces",
     {"CollarID": "hole", "SegLength": "length"}, {"color": "#9085e9", "weight": 1.5}, False, 4),
]

def q(v): return "'" + json.dumps(v, separators=(",", ":")).replace("'", "''") + "'"

sql = ["-- generated by tools/export_layers.py on " + dt.date.today().isoformat(), "begin;"]
for lid, name, kind, gpkg, table, props, style, on, sort in LAYERS:
    fc = read_layer(gpkg, table, props)
    # drop junk MX placeholders
    if lid == "mx_collars":
        fc["features"] = [f for f in fc["features"] if f["properties"].get("hole") not in (None, "", "temporary", "MX-000")]
    (PRIV / f"{lid}.geojson").write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    sql.append(f"insert into map_layers (id, name, kind, geojson, style, default_on, sort) values ('{lid}', '{name}', '{kind}', {q(fc)}::jsonb, {q(style)}::jsonb, {'true' if on else 'false'}, {sort}) "
               "on conflict (id) do update set name = excluded.name, geojson = excluded.geojson, style = excluded.style, updated_at = now();")
    print(f"{lid}: {len(fc['features'])} features")
sql.append("commit;")
(SEED / "layers_seed.sql").write_text("\n".join(sql), encoding="utf-8")
print("wrote", SEED / "layers_seed.sql")
