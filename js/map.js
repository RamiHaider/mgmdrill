/* mgmdrill map view.
   - Leaflet map (Esri imagery) of the selected project's live collars.
   - Collars come from App.projectHoles(); coordinates are NAD83 / UTM 17N (EPSG:26917) and are
     converted to WGS84 here with the inverse Transverse Mercator series (GRS80, no proj library).
   - Planned traces: straight line from the collar along the azimuth, horizontal length = depth x cos(dip).
   - Database layers (map_layers: boundary / points / lines) are loaded once and their Leaflet layers
     are built once and reused (the historic layer has ~3,500 points; it uses a canvas renderer).
   - One checkbox per hole status, same six on by default as the Holes chips, plus layer checkboxes (persisted in localStorage "mgmdrill.map.layers.v2"), stat tiles, search,
     fit buttons, and a legend. render() is idempotent: the page shell and map are created once,
     collars are rebuilt only when the hole data changes. focus(holeId) pans to a hole and opens its popup. */
(() => {
"use strict";
const { $, esc } = App;
const LS_KEY = "mgmdrill.map.layers.v2", LABEL_ZOOM = 15;
// one map layer per hole status; default-on set matches the Holes page chips
const GROUPS = App.STATUSES.map(s => ({ key: s, label: s, statuses: [s], color: s }));
const DEFAULT_ON = new Set(["Permit Pending", "Planned", "Cut", "Spotted", "In Progress", "Complete"]);
const onDflt = g => DEFAULT_ON.has(g.key);
const groupOf = s => (GROUPS.find(g => g.statuses.includes(s)) || GROUPS[0]).key;

/* ---------- NAD83 UTM 17N -> WGS84 lat/lon (inverse Transverse Mercator, Snyder 1987) ---------- */
function utmToLatLng(E, N){
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = -81 * Math.PI / 180;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), x = E - 500000, M = N / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
           + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sin = Math.sin(p1), cos = Math.cos(p1), tan = Math.tan(p1);
  const C = ep2 * cos * cos, T = tan * tan, Nn = a / Math.sqrt(1 - e2 * sin * sin);
  const R = a * (1 - e2) / Math.pow(1 - e2 * sin * sin, 1.5), D = x / (Nn * k0);
  const lat = p1 - (Nn * tan / R) * (D * D / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * ep2) * D ** 4 / 24
            + (61 + 90 * T + 298 * C + 45 * T * T - 252 * ep2 - 3 * C * C) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T + C) * D ** 3 / 6 + (5 - 2 * C + 28 * T - 3 * C * C + 8 * ep2 + 24 * T * T) * D ** 5 / 120) / cos;
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}
/* point at horizontal distance `along` metres down the hole trace (grid azimuth, grid north) */
function traceLL(h, depth){
  const dip = (Number(h.dip) || -90) * Math.PI / 180, az = (Number(h.azimuth) || 0) * Math.PI / 180;
  const L = Math.max(0, depth || 0) * Math.cos(dip);
  return utmToLatLng(Number(h.easting) + L * Math.sin(az), Number(h.northing) + L * Math.cos(az));
}
const hasXY = h => h && h.easting != null && h.northing != null && !isNaN(h.easting) && !isNaN(h.northing);

/* ---------- state (module scope, survives every render) ---------- */
let built = false, map = null, bases = {};
const groups = {};              // key -> { collars, labels, traces } layerGroups
const markers = new Map();      // hole id -> marker
const db = {};                  // map_layers id -> { row, layer }
let layersPromise = null, sig = "", fitted = false, lastProject = null;
let vis = {};
try { vis = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) { vis = {}; }
const isOn = (k, dflt = true) => (k in vis) ? !!vis[k] : dflt;
const saveVis = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(vis)); } catch (e) {} };

/* ---------- page shell + map, created once ---------- */
function build(){
  const el = $("#view-map");
  el.innerHTML = `
    <div class="pagehead"><h2>Map</h2>
      <div class="toolbar">
        <input id="mSearch" type="search" placeholder="Find hole…" list="mHoles" style="width:170px" autocomplete="off"><datalist id="mHoles"></datalist>
        <button class="btn sm" id="mFitHoles">Fit to holes</button>
        <button class="btn sm" id="mFitProp">Fit to property</button>
        
      </div></div>
    <div class="tiles big" id="mTiles"></div>
    <div class="maplegend" id="mLyr"></div>
    <div id="map"></div>
    <div class="legend" id="mLegend"></div>`;
  map = L.map("map", { zoomControl: true }).setView([49.49, -78.35], 12);
  bases.img = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18, opacity: .82, attribution: "Esri, Maxar, Earthstar Geographics" });
  bases.img.addTo(map);
  for (const g of GROUPS) groups[g.key] = { collars: L.layerGroup(), labels: L.layerGroup(), traces: L.layerGroup() };
  map.on("zoomend", applyVisibility);
  map.on("popupopen", e => { const b = e.popup.getElement()?.querySelector("[data-hole]"); if (b) b.onclick = () => App.openHole(b.dataset.hole); });

  $("#mFitHoles").onclick = () => fitHoles(true);
  $("#mFitProp").onclick = () => fitProperty(true);
  const s = $("#mSearch");
  s.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); findHole(s.value); } };
  s.onchange = () => { const v = s.value.trim().toLowerCase(); if (v && App.projectHoles().some(h => [h.ddh_name, h.planned_name].some(n => (n || "").toLowerCase() === v))) findHole(v); };
  $("#mLyr").onchange = e => { const c = e.target.closest("input[data-k]"); if (!c) return; vis[c.dataset.k] = c.checked; saveVis(); applyVisibility(); };
  $("#mLegend").innerHTML = App.STATUSES.map(s => `<span><i style="background:${App.STATUS_HEX[s]}"></i>${esc(s)}</span>`).join("")
    + `<span>── hole trace</span><span class="muted">Labels show at zoom ${LABEL_ZOOM}+</span>`;
  built = true;
}

/* ---------- collars, labels, traces ---------- */
const holesWithXY = () => App.projectHoles().filter(hasXY);
function tipHtml(h){
  const rig = App.rig(h.rig_id);
  return `<b>${esc(App.holeLabel(h))}</b> · ${esc(h.status)}<br>${esc(h.zone || "–")} · ${App.fmt.m(App.holeDepth(h))} of ${App.fmt.m(h.planned_depth)}${rig ? `<br>${esc(rig.label)}` : ""}`;
}
function popupHtml(h){
  const rig = App.rig(h.rig_id);
  return `<b>${esc(App.holeLabel(h))}</b> ${App.pill(h.status)}
    <div>${h.planned_name && h.ddh_name ? esc(h.planned_name) + " · " : ""}${esc(h.zone || "–")}</div>
    <div>${App.fmt.m(App.holeDepth(h))} of ${App.fmt.m(h.planned_depth)} · Az ${App.fmt.n(h.azimuth)}° / ${App.fmt.n(h.dip)}°</div>
    ${rig ? `<div>${esc(rig.label)}</div>` : ""}<div style="margin-top:6px"><button class="btn xs" data-hole="${esc(h.id)}">Open hole card</button></div>`;
}
function buildCollars(){
  const holes = holesWithXY();
  const next = App.project + "|" + JSON.stringify(holes.map(h => [h.id, h.status, h.easting, h.northing, h.azimuth, h.dip, h.planned_depth,
    App.holeDepth(h), h.ddh_name, h.planned_name, h.zone, h.rig_id]));
  if (next === sig) return;
  sig = next; markers.clear();
  for (const g of Object.values(groups)) { g.collars.clearLayers(); g.labels.clearLayers(); g.traces.clearLayers(); }
  for (const h of holes) {
    const ll = utmToLatLng(Number(h.easting), Number(h.northing)), col = App.STATUS_HEX[h.status] || "#898781", g = groups[groupOf(h.status)];
    const outline = "";
    const icon = L.divIcon({ className: "", iconSize: [12, 12], iconAnchor: [6, 6], html: `<div class="collar ${App.statusClass(h.status)}" style="background:${col};${outline}"></div>` });
    const m = L.marker(ll, { icon, title: App.holeLabel(h), riseOnHover: true }).bindTooltip(tipHtml(h), { direction: "top", offset: [0, -8] });
    m.on("click", () => App.openHole(h.id));
    m.addTo(g.collars); markers.set(h.id, m);
    g.labels.addLayer(L.tooltip({ permanent: true, direction: "right", offset: [8, 0], className: "collar-label", interactive: false }).setLatLng(ll).setContent(esc(App.holeLabel(h))));
    // trace: Complete uses actual depth when known, otherwise the planned length
    const planned = Number(h.planned_depth) || 0, depth = App.holeDepth(h);
    const style = { color: "#8a8a8a", weight: 1.6, opacity: .95, interactive: false }; // thin solid grey (Rami, 12 Nov)
    if (h.status === "In Progress") {
      const d = Math.min(depth || 0, planned || depth || 0);
      if (d > 0) g.traces.addLayer(L.polyline([ll, traceLL(h, d)], style));
      if (planned > d) g.traces.addLayer(L.polyline([traceLL(h, d), traceLL(h, planned)], style));
    } else if (h.status === "Complete") {
      const d = depth || planned; if (d > 0) g.traces.addLayer(L.polyline([ll, traceLL(h, d)], style));
    } else if (planned > 0) g.traces.addLayer(L.polyline([ll, traceLL(h, planned)], style));
  }
}

/* ---------- database layers: loaded and built once ---------- */
function ensureDbLayers(){
  if (layersPromise) return layersPromise;
  layersPromise = App.loadLayers().then(rows => {
    for (const r of rows) {
      if (db[r.id]) continue;
      const st = r.style || {};
      let layer;
      if (r.kind === "points") {
        const renderer = L.canvas({ padding: .3 });
        layer = L.geoJSON(r.geojson, { pointToLayer: (f, ll) => L.circleMarker(ll, { renderer, radius: st.radius || 3, color: st.color || "#c3c2b7", weight: st.weight ?? 1, fillColor: st.color || "#c3c2b7", fillOpacity: .8 }) });
        layer.bindPopup(l => { const p = l.feature?.properties || {}, d = p.depth ?? p.eoh;
          return `<b>${esc(p.hole ?? p.name ?? "–")}</b>${d != null && d !== "" ? `<br>Depth ${esc(App.fmt.m(Number(d)))}` : ""}`; });
      } else if (r.kind === "boundary") {
        layer = L.geoJSON(r.geojson, { interactive: false, style: () => ({ color: st.color || "#d7b973", weight: st.weight || 2, dashArray: st.dashArray || "6 4", fill: false }) });
      } else {
        layer = L.geoJSON(r.geojson, { style: () => ({ color: st.color || "#e87ba4", weight: st.weight || 2, dashArray: st.dashArray || null, fill: false }) });
        layer.bindPopup(l => esc(l.feature?.properties?.hole ?? l.feature?.properties?.name ?? r.name));
      }
      db[r.id] = { row: r, layer };
    }
    if (App.current === "map") { renderLyr(); applyVisibility(); if (!fitted) fitInitial(); }
  }).catch(e => { layersPromise = null; App.err(e); });
  return layersPromise;
}

/* ---------- visibility: groups, traces, labels (zoom), db layers ---------- */
function show(layer, on){ if (on && !map.hasLayer(layer)) layer.addTo(map); else if (!on && map.hasLayer(layer)) map.removeLayer(layer); }
function applyVisibility(){
  if (!map) return;
  const labels = map.getZoom() >= LABEL_ZOOM, traces = isOn("traces");
  for (const g of GROUPS) { const on = isOn("g:" + g.key, onDflt(g)), lg = groups[g.key]; show(lg.traces, on && traces); show(lg.collars, on); show(lg.labels, on && labels); }
  for (const { row, layer } of Object.values(db).sort((a, b) => a.row.sort - b.row.sort)) show(layer, isOn("db:" + row.id, row.default_on !== false));
}
function renderLyr(){
  const holes = holesWithXY(), cnt = k => holes.filter(h => groupOf(h.status) === k).length;
  const box = (k, label, on, dot) => `<label class="lyr"><input type="checkbox" data-k="${esc(k)}"${on ? " checked" : ""}>${dot ? `<span class="chip sm" style="--c:${dot}"><i></i>${label}</span>` : label}</label>`;
  $("#mLyr").innerHTML = GROUPS.filter(g => cnt(g.key)).map(g => box("g:" + g.key, `${esc(g.label)} (${cnt(g.key)})`, isOn("g:" + g.key, onDflt(g)), App.STATUS_HEX[g.color])).join("")
    + box("traces", "Planned traces", isOn("traces"))
    + Object.values(db).sort((a, b) => a.row.sort - b.row.sort).map(({ row }) => box("db:" + row.id, esc(row.name), isOn("db:" + row.id, row.default_on !== false))).join("");
}

/* ---------- tiles ---------- */
function renderTiles(){
  const holes = App.projectHoles(), t = App.targets(), m = App.seasonMetres(), pm = Number(t.program_m) || 0;
  const tile = (l, v) => `<div class="tile"><span class="l">${l}</span><span class="v">${v}</span></div>`;
  $("#mTiles").innerHTML = tile("Rigs active", App.activeRigs().length)
    + tile("Holes in progress", holes.filter(h => h.status === "In Progress").length)
    + tile("Holes complete this season", holes.filter(h => h.status === "Complete").length)
    + `<div class="tile"><span class="l">Programme metres this season</span><span class="v">${App.fmt.n(m)} <small>of ${App.fmt.n(pm)} m</small></span>
       <div class="meter"><i style="width:${pm ? Math.min(100, m / pm * 100) : 0}%"></i></div></div>`;
}

/* ---------- fitting, search, focus ---------- */
function fitHoles(manual){
  const pts = holesWithXY().map(h => utmToLatLng(Number(h.easting), Number(h.northing)));
  if (!pts.length) { if (manual) App.toast("No holes with coordinates in this project"); return false; }
  pts.length === 1 ? map.setView(pts[0], 15) : map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  return true;
}
/* Fit to the main property: the boundary feature holding the most collars (Douay / Morris sit far off
   to the side and would otherwise shrink the view to nothing). Ties go to the larger feature. */
function fitProperty(manual){
  const pts = holesWithXY().map(h => utmToLatLng(Number(h.easting), Number(h.northing)));
  let best = null, bestN = -1, bestA = -1;
  for (const { row, layer } of Object.values(db)) if (row.kind === "boundary") layer.eachLayer(f => {
    const lb = f.getBounds?.(); if (!lb || !lb.isValid()) return;
    const n = pts.filter(p => lb.contains(p)).length, a = (lb.getEast() - lb.getWest()) * (lb.getNorth() - lb.getSouth());
    if (n > bestN || (n === bestN && a > bestA)) { best = lb; bestN = n; bestA = a; }
  });
  if (!best) { if (manual) App.toast(layersPromise ? "No property boundary layer" : "Layers still loading"); return false; }
  map.fitBounds(best, { padding: [20, 20] }); return true;
}
function fitInitial(){ if (fitHoles(false) || fitProperty(false)) fitted = true; }
function findByName(q){
  q = String(q || "").trim().toLowerCase(); if (!q) return null;
  const holes = App.projectHoles(), nm = h => [(h.ddh_name || "").toLowerCase(), (h.planned_name || "").toLowerCase()];
  return holes.find(h => nm(h).includes(q)) || holes.find(h => nm(h).some(n => n && n.includes(q))) || null;
}
function findHole(q){ const h = findByName(q); if (!h) return App.toast("No hole matching “" + q + "”"); focus(h.id); }
function focus(holeId){
  if (!built) render();
  const h = App.hole(holeId);
  if (!hasXY(h)) return App.toast("That hole has no coordinates");
  const g = groupOf(h.status);
  if (!isOn("g:" + g, DEFAULT_ON.has(g))) { vis["g:" + g] = true; saveVis(); renderLyr(); applyVisibility(); }
  const ll = utmToLatLng(Number(h.easting), Number(h.northing));
  map.invalidateSize(); map.setView(ll, 16);
  L.popup({ offset: [0, -4] }).setLatLng(ll).setContent(popupHtml(h)).openOn(map);
}

/* ---------- render: idempotent ---------- */
function render(){
  if (!built) build();
  if (lastProject !== App.project) { lastProject = App.project; fitted = false; }
  renderTiles();
  buildCollars();
  renderLyr();
  applyVisibility();
  $("#mHoles").innerHTML = App.projectHoles().flatMap(h => [h.ddh_name, h.planned_name]).filter(Boolean).map(n => `<option value="${esc(n)}">`).join("");
  ensureDbLayers();
  requestAnimationFrame(() => { map.invalidateSize(); if (!fitted) fitInitial(); });
}

App.utmToLatLng = utmToLatLng;
App.view("map", { render, focus });
})();
