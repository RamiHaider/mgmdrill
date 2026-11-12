"""Add or replace a map layer (GeoJSON, UTM 17N or WGS84) in the mgmdrill project.

Usage:  python -I tools/add_layer.py <file.geojson> --id trails --name "Access trails" --kind lines
        [--color "#ffb347"] [--weight 2] [--dash "6 4"] [--sort 5] [--off] [--name-prop Comments]
Coordinates in UTM 17N (EPSG:26917, x > 180) are converted to lon/lat; empty geometries are dropped.
Signs in as the first admin in private/accounts.json (or MGMDRILL_EMAIL / MGMDRILL_PASSWORD).
"""
import sys, json, math, argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import load_seed as L, sync_seed as S

A = 6378137.0; F = 1 / 298.257222101; E2 = F * (2 - F); EP2 = E2 / (1 - E2); K0 = 0.9996; LON0 = math.radians(-81)
def utm_to_ll(x, y):
    m = y / K0; mu = m / (A * (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    phi1 = (mu + (3*e1/2 - 27*e1**3/32) * math.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32) * math.sin(4*mu) + (151*e1**3/96) * math.sin(6*mu) + (1097*e1**4/512) * math.sin(8*mu))
    n1 = A / math.sqrt(1 - E2 * math.sin(phi1)**2); t1 = math.tan(phi1)**2; c1 = EP2 * math.cos(phi1)**2
    r1 = A * (1 - E2) / (1 - E2 * math.sin(phi1)**2) ** 1.5; d = (x - 500000) / (n1 * K0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (d**2/2 - (5 + 3*t1 + 10*c1 - 4*c1**2 - 9*EP2) * d**4/24 + (61 + 90*t1 + 298*c1 + 45*t1**2 - 252*EP2 - 3*c1**2) * d**6/720)
    lon = LON0 + (d - (1 + 2*t1 + c1) * d**3/6 + (5 - 2*c1 + 28*t1 - 3*c1**2 + 8*EP2 + 24*t1**2) * d**5/120) / math.cos(phi1)
    return round(math.degrees(lon), 6), round(math.degrees(lat), 6)

def conv(c):
    if not c: return c
    if isinstance(c[0], (int, float)): return list(utm_to_ll(c[0], c[1])) if abs(c[0]) > 180 else [c[0], c[1]]
    return [x for x in (conv(y) for y in c) if x]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("file"); ap.add_argument("--id", required=True); ap.add_argument("--name", required=True)
    ap.add_argument("--kind", default="lines", choices=["lines", "points", "boundary"]); ap.add_argument("--color", default="#ffb347"); ap.add_argument("--weight", type=float, default=2)
    ap.add_argument("--dash"); ap.add_argument("--sort", type=int, default=5); ap.add_argument("--off", action="store_true"); ap.add_argument("--name-prop", default="name")
    a = ap.parse_args()
    d = json.loads(Path(a.file).read_text(encoding="utf-8"))
    feats, skipped = [], 0
    for f in d.get("features", []):
        g = f.get("geometry"); p = f.get("properties") or {}
        coords = conv(g["coordinates"]) if g and g.get("coordinates") else None
        if not coords: skipped += 1; continue
        feats.append({"type": "Feature", "properties": {"name": str(p.get(a.name_prop) or a.name)}, "geometry": {"type": g["type"], "coordinates": coords}})
    style = {"color": a.color, "weight": a.weight}
    if a.dash: style["dashArray"] = a.dash
    row = {"id": a.id, "name": a.name, "kind": a.kind, "geojson": {"type": "FeatureCollection", "features": feats}, "style": style, "default_on": not a.off, "sort": a.sort}
    token = S.login()
    st, body = L.req("/rest/v1/map_layers?on_conflict=id", [row], token, prefer="resolution=merge-duplicates,return=minimal")
    if st not in (200, 201): sys.exit(f"map_layers: {st} {body[:300]}")
    print(f"{a.id}: {len(feats)} features uploaded ({skipped} empty skipped), default {'on' if not a.off else 'off'}")

if __name__ == "__main__": main()
