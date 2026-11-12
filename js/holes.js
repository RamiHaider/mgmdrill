/* Holes: the Joutel / Douay registers as a sortable, filterable table with inline hole editing,
   the two consistency checks from the workbook (timesheet depth vs manual depth, EOH match),
   and the Vibe check list. Register with App.view("holes", { render, edit }). */
(() => {
"use strict";
const { $, $$, esc } = App;
const state = {
  q: "", status: new Set(JSON.parse(localStorage.getItem("mgmdrill.holes.status") || "null") || ["Spotted", "In Progress", "Complete", "Flagged", "Cut", "Planned", "Permit Pending"]),
  sort: { key: "ddh_name", dir: -1 }, mode: localStorage.getItem("mgmdrill.holes.mode") || "register", editing: null, zone: "",
};
const COLS = [
  ["ddh_name", "DDH"], ["planned_name", "Planned ID"], ["zone", "Zone"], ["status", "Status"], ["rig", "Rig"], ["azimuth", "Az"], ["dip", "Dip"],
  ["planned_depth", "Planned"], ["depth", "Current"], ["drilled", "Drilled"], ["final_depth", "Final"], ["n_samples", "Samples"], ["vibe", "Vibe"],
  ["start_date", "Start"], ["end_date", "End"], ["objective", "Objective"], ["result", "Result"], ["checks", "Checks"],
];
const NUM = new Set(["azimuth", "dip", "planned_depth", "depth", "drilled", "final_depth", "n_samples"]);

/* the workbook's two checks */
function checks(h){
  const out = [];
  const fromShifts = (() => { let m = null; for (const s of App.data.shifts) if (s.hole_id === h.id && s.end_m != null) m = Math.max(m ?? 0, Number(s.end_m)); return m; })();
  if (fromShifts != null && h.current_depth_manual != null && Math.abs(fromShifts - Number(h.current_depth_manual)) > 0.5)
    out.push({ cls: "warn", t: `Timesheet ${App.fmt.n(fromShifts)} ≠ register ${App.fmt.n(h.current_depth_manual)}` });
  if (h.status === "Complete") {
    if (h.final_depth == null) out.push({ cls: "warn", t: "Final depth missing" });
    else if (fromShifts != null && Math.abs(fromShifts - Number(h.final_depth)) > 0.5) out.push({ cls: "bad", t: `EOH ${App.fmt.n(h.final_depth)} ≠ timesheet ${App.fmt.n(fromShifts)}` });
  }
  if (h.status === "In Progress" && !h.rig_id) out.push({ cls: "warn", t: "No rig assigned" });
  return out;
}
function rowValue(h, key){
  switch (key) {
    case "rig": return App.rig(h.rig_id)?.label || "";
    case "depth": return App.holeDepth(h);
    case "drilled": return App.holeDrilled(h);
    case "checks": return checks(h).length;
    default: return h[key];
  }
}
function sorted(list){
  const { key, dir } = state.sort;
  return list.slice().sort((a, b) => {
    let x = rowValue(a, key), y = rowValue(b, key);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    if (typeof x === "number" || typeof y === "number") return (Number(x) - Number(y)) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
  });
}
function filtered(){
  const q = state.q.toLowerCase();
  return App.projectHoles().filter(h => state.status.has(h.status) && (!state.zone || h.zone === state.zone) &&
    (!q || [h.ddh_name, h.planned_name, h.zone, h.objective, h.result, App.rig(h.rig_id)?.label].some(v => (v || "").toLowerCase().includes(q))));
}

function render(){
  const el = $("#view-holes"), holes = App.projectHoles();
  const counts = {}; for (const h of holes) counts[h.status] = (counts[h.status] || 0) + 1;
  const zones = [...new Set(holes.map(h => h.zone).filter(Boolean))].sort();
  const list = sorted(filtered());
  el.innerHTML = `
    <div class="pagehead"><h2>Holes <span class="tag">${holes.length}</span></h2>
      <div class="seg"><button data-mode="register" aria-pressed="${state.mode === "register"}">Register</button><button data-mode="vibe" aria-pressed="${state.mode === "vibe"}">Vibe check</button></div>
      ${App.canEdit ? `<button class="btn primary sm" id="hAdd">+ Add hole</button>` : ""}
    </div>
    <div class="toolbar">
      <input id="hQ" type="search" placeholder="Search hole, zone, objective…" value="${esc(state.q)}" style="max-width:260px">
      <select id="hZone" style="max-width:160px"><option value="">All zones</option>${zones.map(z => `<option ${state.zone === z ? "selected" : ""}>${esc(z)}</option>`).join("")}</select>
      <div class="chips">${App.STATUSES.filter(s => counts[s]).map(s => `<button class="chip toggle sm" data-st="${esc(s)}" aria-pressed="${state.status.has(s)}" style="--c:${App.STATUS_HEX[s]}"><i></i>${esc(s)} ${counts[s]}</button>`).join("")}</div>
    </div>
    <div id="hEditor"></div>
    ${state.mode === "register" ? registerHtml(list) : vibeHtml(holes)}`;
  $$("[data-mode]", el).forEach(b => b.onclick = () => { state.mode = b.dataset.mode; localStorage.setItem("mgmdrill.holes.mode", state.mode); render(); });
  $("#hQ").oninput = e => { state.q = e.target.value; renderTable(); };
  $("#hZone").onchange = e => { state.zone = e.target.value; renderTable(); };
  $$("[data-st]", el).forEach(b => b.onclick = () => { const s = b.dataset.st; state.status.has(s) ? state.status.delete(s) : state.status.add(s); localStorage.setItem("mgmdrill.holes.status", JSON.stringify([...state.status])); render(); });
  const add = $("#hAdd"); if (add) add.onclick = () => edit(null);
  wire(el);
  if (state.editing !== null) editor(state.editing);
}
function renderTable(){ const w = $("#hTable"); if (!w) return render(); w.outerHTML = registerHtml(sorted(filtered())); wire($("#view-holes")); }

function registerHtml(list){
  const { key, dir } = state.sort;
  return `<div class="tablewrap" id="hTable"><table><thead><tr>${COLS.map(([k, l]) => `<th class="sort ${NUM.has(k) ? "num" : ""} ${k === "ddh_name" ? "sticky-col" : ""}" data-sort="${k}">${l}${key === k ? `<span class="arrow">${dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${list.map(h => {
      const rig = App.rig(h.rig_id), ck = checks(h), depth = App.holeDepth(h);
      return `<tr class="clickable" data-id="${h.id}">
        <td class="sticky-col"><b>${esc(h.ddh_name || "–")}</b>${App.isFlagged(h) ? ' <span class="flag" title="Flagged: good zone">⚑</span>' : ""}</td>
        <td>${esc(h.planned_name || "")}</td><td>${esc(h.zone || "")}</td><td>${App.pill(h.status)}</td>
        <td>${rig ? `<span class="chip sm" style="--c:${rig.color}"><i></i>${esc(rig.id)}</span>${h.seq ? ` <span class="tag">#${h.seq}</span>` : ""}` : ""}</td>
        <td class="num">${App.fmt.n(h.azimuth)}</td><td class="num">${App.fmt.n(h.dip)}</td>
        <td class="num">${App.fmt.n(h.planned_depth)}</td><td class="num"><b>${App.fmt.n(depth)}</b></td><td class="num">${App.fmt.n(App.holeDrilled(h))}</td>
        <td class="num">${App.fmt.n(h.final_depth)}</td><td class="num">${App.fmt.n(h.n_samples)}</td><td>${App.vibe(h.vibe)}</td>
        <td>${App.fmt.d(h.start_date)}</td><td>${App.fmt.d(h.end_date)}</td>
        <td class="wrap-text small">${esc(h.objective || "")}</td><td class="wrap-text small">${esc(h.result || "")}</td>
        <td>${ck.length ? ck.map(c => `<span class="small" style="color:var(--${c.cls})" title="${esc(c.t)}">⚠ ${esc(c.t)}</span>`).join("<br>") : '<span class="muted small">ok</span>'}</td></tr>`; }).join("") || `<tr><td colspan="${COLS.length}" class="empty">No holes match.</td></tr>`}</tbody></table></div>
    <p class="note">Click a hole for its card and comments. Current depth comes from the timesheet, the Checks column flags disagreements with the register. ⚑ = flagged as a good zone (vibe rule set in Admin).</p>`;
}
function wire(el){
  $$("th[data-sort]", el).forEach(th => th.onclick = () => { const k = th.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (NUM.has(k) ? -1 : 1) }; renderTable(); });
  $$("tr[data-id]", el).forEach(tr => tr.onclick = () => App.openHole(tr.dataset.id));
  $$("[data-vibe]", el).forEach(s => s.onchange = async () => { try { await App.update("holes", { id: s.dataset.vibe }, { vibe: s.value || null }); App.toast("Vibe saved"); await App.reload(["holes"]); } catch (e) { App.err(e); } });
  $$("[data-flag]", el).forEach(b => b.onclick = async () => { const h = App.hole(b.dataset.flag); try { await App.update("holes", { id: h.id }, { flagged: !h.flagged }); await App.reload(["holes"]); } catch (e) { App.err(e); } });
}

/* ---- vibe check ---- */
function vibeHtml(holes){
  const list = holes.filter(h => h.ddh_name && ["In Progress", "Complete"].includes(h.status)).sort((a, b) => (b.start_date || "").localeCompare(a.start_date || "") || (b.ddh_name || "").localeCompare(a.ddh_name || "", undefined, { numeric: true }));
  const counts = {}; for (const h of list) if (h.vibe) counts[h.vibe] = (counts[h.vibe] || 0) + 1;
  return `<div class="tiles">${App.VIBES.map(v => `<div class="tile"><div class="v">${counts[v] || 0}</div><div class="l">${App.vibe(v)}</div></div>`).join("")}</div>
    <div class="tablewrap" id="hTable"><table><thead><tr><th>DDH</th><th>Target</th><th>Status</th><th>Vibe</th><th>Flag</th><th>Result</th></tr></thead><tbody>
    ${list.map(h => `<tr><td><a href="#" data-open="${h.id}"><b>${esc(h.ddh_name)}</b></a></td><td>${esc(h.zone || "")}</td><td>${App.pill(h.status)}</td>
      <td>${App.canEdit ? `<select data-vibe="${h.id}" style="width:auto"><option value="">${h.status === "In Progress" ? "In progress" : "–"}</option>${App.VIBES.map(v => `<option ${h.vibe === v ? "selected" : ""}>${v}</option>`).join("")}</select>` : App.vibe(h.vibe)}</td>
      <td>${App.canEdit ? `<button class="btn xs ${h.flagged ? "primary" : ""}" data-flag="${h.id}" title="Manual flag">${App.isFlagged(h) ? "⚑ flagged" : "flag"}</button>` : (App.isFlagged(h) ? '<span class="flag">⚑</span>' : "")}</td>
      <td class="wrap-text small">${esc(h.result || "")}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">Vibe is set by the geologist. The flag is automatic for the vibes chosen in Admin (default Good or better) and can also be set by hand.</p>`;
}

/* ---- editor ---- */
const F = [
  ["ddh_name", "DDH name", "text"], ["planned_name", "Planned ID", "text"], ["zone", "Zone", "text"], ["status", "Status", "select", App.STATUSES],
  ["rig_id", "Rig", "rig"], ["seq", "Order on rig", "number"], ["easting", "Easting", "number"], ["northing", "Northing", "number"], ["elevation", "Elevation", "number"],
  ["azimuth", "Azimuth", "number"], ["dip", "Dip", "number"], ["planned_depth", "Planned depth (m)", "number"], ["start_length", "Wedge start (m)", "number"],
  ["current_depth_manual", "Current depth, manual (m)", "number"], ["final_depth", "Final depth (m)", "number"], ["n_samples", "Samples", "number"],
  ["vibe", "Vibe", "select", ["", ...App.VIBES]], ["start_date", "Start date", "date"], ["end_date", "End date", "date"],
  ["objective", "Objective / comment", "textarea"], ["result", "Result", "textarea"], ["flag_note", "Flag note", "text"],
];
function edit(id){ state.editing = id; if (state.mode !== "register") { state.mode = "register"; } render(); $("#hEditor")?.scrollIntoView({ block: "start", behavior: "smooth" }); }
function editor(id){
  const h = id ? App.hole(id) : { project_id: App.project, status: "Planned", start_length: 0 };
  if (!h) { state.editing = null; return; }
  const box = $("#hEditor");
  box.innerHTML = `<form class="card" id="hForm"><header><h3>${id ? "Edit " + esc(App.holeLabel(h)) : "New hole"}</h3><span class="note">Orange fields are the register's user inputs.</span></header>
    <div class="form">${F.map(([k, l, t, opts]) => {
      const v = h[k] ?? "";
      let input;
      if (t === "select") input = `<select name="${k}">${opts.map(o => `<option value="${esc(o)}" ${String(v) === o ? "selected" : ""}>${esc(o || "–")}</option>`).join("")}</select>`;
      else if (t === "rig") input = `<select name="rig_id"><option value="">–</option>${App.projectRigs().map(r => `<option value="${esc(r.id)}" ${v === r.id ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>`;
      else if (t === "textarea") input = `<textarea name="${k}">${esc(v)}</textarea>`;
      else input = `<input name="${k}" type="${t}" ${t === "number" ? 'step="any"' : ""} value="${esc(v)}">`;
      return `<div class="field ${t === "textarea" ? "full" : ""}"><label>${l}</label>${input}</div>`; }).join("")}
    </div>
    <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="hCancel">Cancel</button>
      ${id && App.isAdmin ? `<button class="btn danger right" type="button" id="hDelete">Delete hole</button>` : ""}
      <label class="row small"><input type="checkbox" name="flagged" ${h.flagged ? "checked" : ""}> Flag by hand</label></div></form>`;
  $("#hCancel").onclick = () => { state.editing = null; render(); };
  const del = $("#hDelete"); if (del) del.onclick = async () => { if (!App.confirm(`Delete ${App.holeLabel(h)}? Its comments go with it.`)) return; try { await App.remove("holes", { id }); state.editing = null; App.toast("Hole deleted"); await App.reload(["holes", "comments"]); } catch (e) { App.err(e); } };
  $("#hForm").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), row = { project_id: h.project_id || App.project };
    for (const [k, , t] of F) { let v = fd.get(k); if (v === "" || v == null) v = null; else if (t === "number") v = Number(v); row[k] = v; }
    row.start_length = row.start_length ?? 0; row.objective = row.objective ?? ""; row.result = row.result ?? ""; row.flag_note = row.flag_note ?? ""; row.flagged = fd.get("flagged") === "on";
    if (!row.ddh_name && !row.planned_name) return App.toast("Give the hole a DDH name or a planned ID.");
    try {
      if (id) await App.update("holes", { id }, row); else await App.insert("holes", row);
      state.editing = null; App.toast("Saved"); await App.reload(["holes"]);
    } catch (x) { App.err(x); }
  };
}

App.view("holes", { render, edit });
})();
