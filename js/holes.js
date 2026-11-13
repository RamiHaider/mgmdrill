/* Holes: the register (all projects, Project column first) as a dense sortable table with inline
   editing of the geologist's inputs, a blank "new hole" row, a queue-order button for planned holes,
   and a read-only Vibe check sheet that exports to PDF (print) or PNG.
   Register with App.view("holes", { render, edit }). */
(() => {
"use strict";
const { $, $$, esc } = App;
const LS = k => "mgmdrill.holes." + k;
const state = {
  q: "", proj: "", zone: "", rig: "",
  status: new Set(JSON.parse(localStorage.getItem(LS("status")) || "null") || ["Spotted", "In Progress", "Complete", "Cut", "Planned", "Permit Pending"]),
  sort: JSON.parse(localStorage.getItem(LS("sort")) || "null") || { key: "ddh_name", dir: -1 },
  mode: localStorage.getItem(LS("mode")) || "register",
  adding: false, editing: null, ordering: null, cell: null, archived: false,
};
const QUEUE_OK = new Set(["Permit Pending", "Planned", "Flagged", "Cut", "Spotted"]);
const COLS = [
  ["project_id", "Project"], ["planned_name", "Planned ID"], ["ddh_name", "DDH"], ["zone", "Zone"], ["status", "Status"], ["rig", "Rig"], ["order", "Order"],
  ["azimuth", "Az"], ["dip", "Dip"], ["planned_depth", "Planned"], ["start_length", "Start"], ["depth", "Current"], ["final_depth", "Final"], ["n_samples", "Samples"],
  ["vibe", "Vibe"], ["start_date", "Started"], ["end_date", "Ended"], ["objective", "Objective"], ["result", "Result"], ["remove", ""],
];
const NUM = new Set(["azimuth", "dip", "planned_depth", "start_length", "depth", "final_depth", "n_samples", "order"]);
const SORTS = [["ddh_name", "DDH, newest first"], ["planned_name", "Planned ID"], ["zone", "Zone / target"], ["status", "Status"], ["order", "Rig and queue order"], ["vibe", "Vibe, best first"], ["start_date", "Start date, newest"], ["depth", "Current depth"]];
/* editable cells: field -> input type */
const EDIT = { zone: "text", status: "status", rig: "rig", azimuth: "number", dip: "number", planned_depth: "number", start_length: "number", final_depth: "number", n_samples: "number", vibe: "vibe", start_date: "date", end_date: "date", objective: "text", result: "text" };

/* ---- derived values ---- */
const shiftsOf = h => App.data.shifts.filter(s => s.hole_id === h.id || (!s.hole_id && s.hole_name && h.ddh_name && s.hole_name.toLowerCase() === h.ddh_name.toLowerCase()));
function rigOf(h){
  if (h.rig_id) return App.rig(h.rig_id);
  const s = shiftsOf(h).sort((a, b) => (b.shift_date + (b.shift === "night" ? "b" : "a")).localeCompare(a.shift_date + (a.shift === "night" ? "b" : "a")))[0];
  return s ? App.rig(s.rig_id) : null;
}
function dates(h){
  const sh = shiftsOf(h).map(s => s.shift_date).sort();
  return { start: h.start_date || sh[0] || null, end: h.end_date || (h.status === "Complete" ? sh[sh.length - 1] : null) || null, derivedStart: !h.start_date && !!sh.length, derivedEnd: !h.end_date && h.status === "Complete" && !!sh.length };
}
const vibeRank = v => { const i = App.VIBES.indexOf(v); return i < 0 ? null : i; };
function rowValue(h, key){
  switch (key) {
    case "rig": return rigOf(h)?.label || null;
    case "order": return h.rig_id ? (App.rig(h.rig_id)?.sort ?? 0) * 1000 + (h.seq || 999) : null;
    case "depth": return App.holeDepth(h);
    case "vibe": return vibeRank(h.vibe);
    case "start_date": return dates(h).start;
    case "end_date": return dates(h).end;
    case "project_id": return App.data.projects.find(p => p.id === h.project_id)?.name || h.project_id;
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
const allHoles = () => App.data.holes.filter(h => h.archived === state.archived && (!state.proj || h.project_id === state.proj));
function filtered(){
  const q = state.q.toLowerCase();
  return allHoles().filter(h => state.status.has(h.status) && (!state.zone || h.zone === state.zone) && (!state.rig || rigOf(h)?.id === state.rig) &&
    (!q || [h.ddh_name, h.planned_name, h.zone, h.objective, h.result, rigOf(h)?.label].some(v => (v || "").toLowerCase().includes(q))));
}
const projName = id => App.data.projects.find(p => p.id === id)?.name || id || "";
const rigChip = r => r ? `<span class="chip sm" style="--c:${r.color}"><i></i>${esc(r.id)}</span>` : "";

/* ---- page ---- */
function render(){
  if (state.cell) return; // a cell is being edited; realtime refresh waits
  const el = $("#view-holes"), holes = allHoles();
  const counts = {}; for (const h of holes) counts[h.status] = (counts[h.status] || 0) + 1;
  const zones = [...new Set(holes.map(h => h.zone).filter(Boolean))].sort();
  const rigs = App.data.rigs.filter(r => !state.proj || r.project_id === state.proj).sort((a, b) => a.sort - b.sort);
  const list = sorted(filtered());
  const prevWrap = $("#hTable"), scroll = prevWrap ? [prevWrap.scrollTop, prevWrap.scrollLeft] : null;
  el.innerHTML = `
    <div class="pagehead"><h2>Holes <span class="tag">${list.length} of ${holes.length}</span></h2>
      <div class="seg"><button data-mode="register" aria-pressed="${state.mode === "register"}">Register</button><button data-mode="vibe" aria-pressed="${state.mode === "vibe"}">Vibe check</button></div>
      ${state.mode === "vibe" ? `<button class="btn sm" id="vPdf">Export PDF</button><button class="btn sm" id="vPng">Export image</button>` : ""}
      ${App.canEdit && state.mode === "register" ? `<button class="btn primary sm" id="hAdd">${state.adding ? "Cancel new hole" : "+ Add hole"}</button>` : ""}
    </div>
    <div class="toolbar">
      <select id="hProj" style="max-width:150px"><option value="">All projects</option>${App.data.projects.map(p => `<option value="${esc(p.id)}" ${state.proj === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <select id="hZone" style="max-width:150px"><option value="">All zones</option>${zones.map(z => `<option ${state.zone === z ? "selected" : ""}>${esc(z)}</option>`).join("")}</select>
      <select id="hRig" style="max-width:130px"><option value="">All rigs</option>${rigs.map(r => `<option value="${esc(r.id)}" ${state.rig === r.id ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
      <label class="row small muted" style="gap:4px">Order by <select id="hSort" style="width:auto">${SORTS.map(([k, l]) => `<option value="${k}" ${state.sort.key === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <input id="hQ" type="search" placeholder="Search…" value="${esc(state.q)}" style="max-width:200px">
      <label class="lyr small" title="Removed holes are kept here and can be restored"><input type="checkbox" id="hArch" ${state.archived ? "checked" : ""}> removed</label>
      <div class="chips" ${state.mode === "vibe" ? "hidden" : ""}>${App.STATUSES.filter(s => counts[s]).map(s => `<button class="chip toggle sm" data-st="${esc(s)}" aria-pressed="${state.status.has(s)}" style="--c:${App.STATUS_HEX[s]}"><i></i>${esc(s)} ${counts[s]}</button>`).join("")}</div>
    </div>
    <div id="hEditor"></div>
    ${state.mode === "register" ? registerHtml(list) : vibeHtml(list)}`;
  $$("[data-mode]", el).forEach(b => b.onclick = () => { state.mode = b.dataset.mode; localStorage.setItem(LS("mode"), state.mode); render(); });
  $("#hQ").oninput = e => { state.q = e.target.value; renderTable(); };
  $("#hProj").onchange = e => { state.proj = e.target.value; state.zone = ""; state.rig = ""; render(); };
  $("#hZone").onchange = e => { state.zone = e.target.value; renderTable(); };
  $("#hRig").onchange = e => { state.rig = e.target.value; renderTable(); };
  $("#hSort").onchange = e => { setSort(e.target.value, true); };
  $("#hArch").onchange = e => { state.archived = e.target.checked; render(); };
  $$("[data-st]", el).forEach(b => b.onclick = () => { const s = b.dataset.st; state.status.has(s) ? state.status.delete(s) : state.status.add(s); localStorage.setItem(LS("status"), JSON.stringify([...state.status])); render(); });
  const add = $("#hAdd"); if (add) add.onclick = () => { state.adding = !state.adding; render(); if (state.adding) $("#nPlanned")?.focus(); };
  const pdf = $("#vPdf"); if (pdf) pdf.onclick = exportPdf;
  const png = $("#vPng"); if (png) png.onclick = exportPng;
  wire(el);
  const wrap = $("#hTable"); if (wrap && scroll) { wrap.scrollTop = scroll[0]; wrap.scrollLeft = scroll[1]; }
  if (state.editing) editor(state.editing);
}
function renderTable(){ const w = $("#hTable"); if (!w) return render(); const sc = [w.scrollTop, w.scrollLeft]; w.outerHTML = state.mode === "register" ? registerHtml(sorted(filtered())) : vibeHtml(sorted(filtered())); wire($("#view-holes")); const n = $("#hTable"); if (n) { n.scrollTop = sc[0]; n.scrollLeft = sc[1]; } }
function setSort(key, fromMenu){
  const defaultDir = k => (k === "ddh_name" || k === "start_date" || k === "depth" || k === "planned_name") ? -1 : (k === "vibe" ? -1 : 1);
  state.sort = { key, dir: (!fromMenu && state.sort.key === key) ? -state.sort.dir : defaultDir(key) };
  localStorage.setItem(LS("sort"), JSON.stringify(state.sort)); render();
}

/* ---- register table ---- */
function registerHtml(list){
  const { key, dir } = state.sort;
  const head = COLS.map(([k, l]) => k === "remove" ? "<th></th>" : `<th class="sort ${NUM.has(k) ? "num" : ""} ${k === "project_id" ? "sticky-col" : ""}" data-sort="${k}">${l}${key === k ? `<span class="arrow">${dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("");
  return `<div class="tablewrap tall" id="hTable"><table class="dense holes"><thead><tr>${head}</tr></thead>
    <tbody>${state.adding && App.canEdit ? newRowHtml() : ""}${list.map(rowHtml).join("") || `<tr><td colspan="${COLS.length}" class="empty">No holes match.</td></tr>`}</tbody></table></div>
    <p class="note">Click a DDH or planned ID for the hole card and comments. ${App.canEdit ? "Shaded cells edit in place (Enter saves, Esc cancels). " : ""}Current depth is the deepest timesheet end; Final fills itself when a hole is marked Complete; Started / Ended fall back to the timesheet (shown in grey) until typed. Order sets a planned hole's place in a rig's queue.</p>`;
}
function rowHtml(h){
  const rig = rigOf(h), d = dates(h), ed = App.canEdit;
  const td = (k, html, cls = "") => `<td class="${cls} ${ed && EDIT[k] ? "edit" : ""}" ${ed && EDIT[k] ? `data-cell="${h.id}|${k}"` : ""}>${html}</td>`;
  const ordering = state.ordering === h.id;
  let order = "";
  if (QUEUE_OK.has(h.status)) {
    const label = h.rig_id ? `${esc(h.rig_id)} #${h.seq || "–"}` : "set order";
    order = ed ? (ordering ? orderFormHtml(h) : `<button class="btn xs ${h.rig_id ? "" : "ghost"}" data-order="${h.id}">${label}</button>`) : (h.rig_id ? `<span class="tag">${label}</span>` : "");
  } else if (h.rig_id && h.seq) order = `<span class="tag muted">#${h.seq}</span>`;
  return `<tr data-id="${h.id}">
    <td class="sticky-col">${esc(projName(h.project_id))}</td>
    <td class="open" data-open="${h.id}">${esc(h.planned_name || "")}</td>
    <td class="open" data-open="${h.id}"><b>${esc(h.ddh_name || "–")}</b></td>
    ${td("zone", esc(h.zone || ""))}
    ${td("status", App.pill(h.status))}
    ${td("rig", rigChip(rig))}
    <td class="num">${order}</td>
    ${td("azimuth", App.fmt.n(h.azimuth), "num")}${td("dip", App.fmt.n(h.dip), "num")}${td("planned_depth", App.fmt.n(h.planned_depth), "num")}
    ${td("start_length", App.fmt.n(h.start_length), "num")}
    <td class="num"><b>${App.fmt.n(App.holeDepth(h))}</b></td>
    ${td("final_depth", App.fmt.n(h.final_depth), "num")}${td("n_samples", App.fmt.n(h.n_samples), "num")}
    ${td("vibe", App.vibe(h.vibe))}
    ${td("start_date", `<span class="${d.derivedStart ? "muted" : ""}">${App.fmt.d(d.start)}</span>`)}
    ${td("end_date", `<span class="${d.derivedEnd ? "muted" : ""}">${App.fmt.d(d.end)}</span>`)}
    <td class="wrap-text ${ed ? "edit" : ""}" ${ed ? `data-cell="${h.id}|objective"` : ""} title="${esc(h.objective || "")}"><div class="clamp">${esc(h.objective || "")}</div></td><td class="wrap-text ${ed ? "edit" : ""}" ${ed ? `data-cell="${h.id}|result"` : ""} title="${esc(h.result || "")}"><div class="clamp">${esc(h.result || "")}</div></td>
    <td class="noprint">${ed ? (h.archived ? `<button class="btn xs" data-restore="${h.id}" title="Put this hole back in the register">restore</button>` : `<button class="btn xs ghost danger-text" data-remove="${h.id}" title="Remove from the register (kept under “removed”)">✕</button>`) : ""}</td></tr>`;
}
const rigOptions = (projectId, sel) => `<option value="">– no rig –</option>` + App.data.rigs.filter(r => r.project_id === projectId).sort((a, b) => a.sort - b.sort).map(r => `<option value="${esc(r.id)}" ${sel === r.id ? "selected" : ""}>${esc(r.label)}</option>`).join("");
function newRowHtml(){
  const p = state.proj || App.project;
  const inp = (id, ph, type = "text", extra = "") => `<input id="${id}" type="${type}" placeholder="${ph}" ${type === "number" ? 'step="any"' : ""} ${extra}>`;
  return `<tr class="newrow" id="hNew">
    <td class="sticky-col"><select id="nProj">${App.data.projects.map(x => `<option value="${esc(x.id)}" ${x.id === p ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></td>
    <td>${inp("nPlanned", "Planned ID")}</td><td>${inp("nDdh", "DDH (optional)")}</td><td>${inp("nZone", "Zone")}</td>
    <td><select id="nStatus">${App.STATUSES.map(s => `<option ${s === "Planned" ? "selected" : ""}>${s}</option>`).join("")}</select></td>
    <td><select id="nRig">${rigOptions(p, "")}</select></td><td></td>
    <td>${inp("nAz", "Az", "number")}</td><td>${inp("nDip", "Dip", "number")}</td><td>${inp("nPlan", "m", "number")}</td><td>${inp("nStart", "0", "number", 'value="0"')}</td>
    <td></td><td></td><td></td><td></td><td></td><td></td>
    <td>${inp("nObj", "Objective")}</td>
    <td><div class="row" style="flex-wrap:nowrap"><button class="btn primary xs" id="nSave">Save</button><button class="btn xs ghost" id="nCancel">Cancel</button></div></td></tr>`;
}
function orderFormHtml(h){
  const rigId = h.rig_id || App.data.rigs.find(r => r.project_id === h.project_id && r.active)?.id || "";
  const queue = queueFor(rigId).filter(x => x.id !== h.id);
  const cur = h.rig_id === rigId && h.seq ? Math.min(h.seq, queue.length + 1) : queue.length + 1;
  return `<div class="row" style="flex-wrap:nowrap;gap:4px" data-orderform="${h.id}">
    <select id="oRig" style="width:auto">${rigOptions(h.project_id, rigId)}</select>
    <select id="oPos" style="width:auto">${Array.from({ length: queue.length + 1 }, (_, i) => `<option value="${i + 1}" ${i + 1 === cur ? "selected" : ""}>${i + 1 === 1 ? "next" : "#" + (i + 1)}</option>`).join("")}</select>
    <button class="btn primary xs" id="oSave">Set</button><button class="btn xs ghost" id="oCancel">✕</button></div>`;
}
const queueFor = rigId => rigId ? App.data.holes.filter(h => !h.archived && h.rig_id === rigId && QUEUE_OK.has(h.status)).sort((a, b) => (a.seq || 999) - (b.seq || 999)) : [];

function wire(el){
  $$("th[data-sort]", el).forEach(th => th.onclick = () => setSort(th.dataset.sort, false));
  $$("td[data-open]", el).forEach(td => td.onclick = () => App.openHole(td.dataset.open));
  $$("td[data-cell]", el).forEach(td => td.onclick = () => startCell(td));
  $$("[data-order]", el).forEach(b => b.onclick = e => { e.stopPropagation(); state.ordering = b.dataset.order; render(); });
  $$("[data-remove]", el).forEach(b => b.onclick = async e => { e.stopPropagation(); const h = App.hole(b.dataset.remove); if (!App.confirm(`Remove ${App.holeLabel(h)} from the register? It stays under “removed” and can be restored.`)) return; try { await App.update("holes", { id: h.id }, { archived: true, rig_id: null, seq: null }); App.toast("Hole removed"); await App.reload(["holes"]); } catch (x) { App.err(x); } });
  $$("[data-restore]", el).forEach(b => b.onclick = async e => { e.stopPropagation(); try { await App.update("holes", { id: b.dataset.restore }, { archived: false }); App.toast("Hole restored"); await App.reload(["holes"]); } catch (x) { App.err(x); } });
  $$("[data-open]", el).filter(a => a.tagName === "A").forEach(a => a.onclick = e => { e.preventDefault(); App.openHole(a.dataset.open); });
  const of = $("[data-orderform]", el);
  if (of) {
    const h = App.hole(of.dataset.orderform);
    $("#oRig", of).onchange = () => { /* re-render the position list for the chosen rig */
      const rigId = $("#oRig", of).value, n = queueFor(rigId).filter(x => x.id !== h.id).length;
      $("#oPos", of).innerHTML = Array.from({ length: n + 1 }, (_, i) => `<option value="${i + 1}">${i + 1 === 1 ? "next" : "#" + (i + 1)}</option>`).join(""); $("#oPos", of).value = String(n + 1); };
    $("#oCancel", of).onclick = () => { state.ordering = null; render(); };
    $("#oSave", of).onclick = () => saveOrder(h, $("#oRig", of).value, Number($("#oPos", of).value));
  }
  const nr = $("#hNew", el);
  if (nr) {
    $("#nProj", nr).onchange = () => { $("#nRig", nr).innerHTML = rigOptions($("#nProj", nr).value, ""); };
    $("#nCancel", nr).onclick = () => { state.adding = false; render(); };
    $("#nSave", nr).onclick = saveNew;
    nr.onkeydown = e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); saveNew(); } if (e.key === "Escape") { state.adding = false; render(); } };
  }
}
async function saveNew(){
  const v = id => $("#" + id).value.trim(), n = id => { const x = v(id); return x === "" ? null : Number(x); };
  const row = { project_id: v("nProj"), planned_name: v("nPlanned") || null, ddh_name: v("nDdh") || null, zone: v("nZone") || null, status: v("nStatus"), rig_id: v("nRig") || null,
    azimuth: n("nAz"), dip: n("nDip"), planned_depth: n("nPlan"), start_length: n("nStart") ?? 0, objective: v("nObj"), result: "", flag_note: "" };
  if (!row.planned_name && !row.ddh_name) return App.toast("Give the hole a planned ID or a DDH name.");
  try { await App.insert("holes", row); state.adding = false; App.toast("Hole added"); await App.reload(["holes"]); } catch (e) { App.err(e); }
}
async function saveOrder(h, rigId, pos){
  try {
    if (!rigId) { await App.update("holes", { id: h.id }, { rig_id: null, seq: null }); }
    else {
      const queue = queueFor(rigId).filter(x => x.id !== h.id); queue.splice(Math.max(0, pos - 1), 0, h);
      for (let i = 0; i < queue.length; i++) {
        const x = queue[i], patch = { seq: i + 1 }; if (x.id === h.id) patch.rig_id = rigId;
        if (x.seq !== i + 1 || x.id === h.id) await App.update("holes", { id: x.id }, patch);
      }
    }
    state.ordering = null; App.toast("Queue updated"); await App.reload(["holes"]);
  } catch (e) { App.err(e); }
}

/* ---- inline cell editing ---- */
function startCell(td){
  if (state.cell) return;
  const [id, field] = td.dataset.cell.split("|"), h = App.hole(id); if (!h) return;
  const type = EDIT[field];
  let input;
  if (type === "status") input = sel(App.STATUSES.map(s => [s, s]), h.status);
  else if (type === "vibe") input = sel([["", "–"], ...App.VIBES.map(v => [v, v])], h.vibe || "");
  else if (type === "rig") { input = document.createElement("select"); input.innerHTML = rigOptions(h.project_id, h.rig_id || ""); }
  else { input = document.createElement("input"); input.type = type === "number" ? "text" : type; if (type === "number") input.inputMode = "decimal"; input.value = h[field] == null ? "" : String(h[field]); }
  state.cell = td.dataset.cell;
  td.onclick = null; td.innerHTML = ""; td.appendChild(input); input.focus(); if (input.select) input.select();
  let done = false;
  const finish = async save => {
    if (done) return; done = true; state.cell = null;
    let val = input.value;
    if (save) {
      const patch = {};
      if (type === "number") { val = val.trim().replace(",", "."); if (val !== "" && isNaN(Number(val))) { App.toast("Not a number: " + val); return render(); } patch[field] = val === "" ? null : Number(val); }
      else if (type === "rig") patch.rig_id = val || null;
      else if (type === "text") patch[field] = val.trim();
      else patch[field] = val || null;
      const before = type === "rig" ? h.rig_id : h[field];
      if ((patch[type === "rig" ? "rig_id" : field] ?? null) !== (before ?? null)) {
        if (field === "status" && val === "Complete" && h.final_depth == null) { const d = App.holeDepth(h); if (d != null) patch.final_depth = d; }
        try { await App.update("holes", { id }, patch); await App.reload(["holes"]); return; } catch (e) { App.err(e); }
      }
    }
    render();
  };
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
  input.onblur = () => finish(true);
  if (input.tagName === "SELECT") input.onchange = () => finish(true);
}
function sel(opts, cur){ const s = document.createElement("select"); s.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === v ? "selected" : ""}>${esc(l)}</option>`).join(""); return s; }

/* ---- vibe check: Complete and In Progress holes, colour-coded by vibe (read-only sheet) ---- */
function vibeHtml(list){
  const q = state.q.toLowerCase();
  const rows = allHoles().filter(h => h.ddh_name && ["Complete", "In Progress"].includes(h.status) && (!state.zone || h.zone === state.zone) && (!state.rig || rigOf(h)?.id === state.rig) &&
    (!q || [h.ddh_name, h.planned_name, h.zone, h.result].some(v => (v || "").toLowerCase().includes(q))));
  const sortedRows = state.sort.key === "vibe" ? sorted(rows) : rows.sort((a, b) => (b.start_date || "").localeCompare(a.start_date || "") || (b.ddh_name || "").localeCompare(a.ddh_name || "", undefined, { numeric: true }));
  const counts = {}; for (const h of rows) if (h.vibe) counts[h.vibe] = (counts[h.vibe] || 0) + 1;
  const title = `Vibe check · ${state.proj ? projName(state.proj) : "Joutel and Douay"}${state.zone ? " · " + state.zone : ""} · ${App.fmt.dl(App.today())}`;
  return `<div id="hTable" class="sheet vibesheet">
    <div class="row" style="justify-content:space-between"><h3 style="text-transform:none;font-size:15px;color:var(--fg)">${esc(title)}</h3><span class="note">${rows.length} holes</span></div>
    <div class="tiles">${App.VIBES.map(v => `<div class="tile vibe-${App.vibeClass(v)}"><div class="v">${counts[v] || 0}</div><div class="l">${App.vibe(v)}</div></div>`).join("")}</div>
    <div class="tablewrap"><table class="dense vibetable"><thead><tr><th>Hole ID</th><th>Zone</th><th>Vibe</th><th>Result</th></tr></thead><tbody>
    ${sortedRows.map(h => `<tr class="vibe-${h.vibe ? App.vibeClass(h.vibe) : "none"}"><td><a href="#" data-open="${h.id}"><b>${esc(h.ddh_name)}</b></a>${h.status === "In Progress" ? ' <span class="tag">in progress</span>' : ""}</td><td>${esc(h.zone || "")}</td><td>${App.vibe(h.vibe)}</td><td class="res">${esc(h.result || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No holes match.</td></tr>`}</tbody></table></div>
    <p class="note noprint">Completed and in-progress holes only. Vibe is set in the Register; use Order by “Vibe, best first” to rank.</p></div>`;
}
const exportPdf = () => App.exportPdf($("#hTable"));
const exportPng = () => App.exportPng($("#hTable"), "vibe-check");

/* ---- full editor (from the hole card's Edit button: coordinates and everything else) ---- */
const F = [
  ["project_id", "Project", "project"], ["ddh_name", "DDH name", "text"], ["planned_name", "Planned ID", "text"], ["zone", "Zone", "text"], ["status", "Status", "select", App.STATUSES],
  ["rig_id", "Rig", "rig"], ["seq", "Order on rig", "number"], ["easting", "Easting", "number"], ["northing", "Northing", "number"], ["elevation", "Elevation", "number"],
  ["azimuth", "Azimuth", "number"], ["dip", "Dip", "number"], ["planned_depth", "Planned depth (m)", "number"], ["start_length", "Start depth (m)", "number"],
  ["current_depth_manual", "Current depth, manual (m)", "number"], ["final_depth", "Final depth (m)", "number"], ["n_samples", "Samples", "number"],
  ["vibe", "Vibe", "select", ["", ...App.VIBES]], ["start_date", "Start date", "date"], ["end_date", "End date", "date"],
  ["objective", "Objective / comment", "textarea"], ["result", "Result", "textarea"],
];
function edit(id){ if (!id) { state.adding = true; state.mode = "register"; return render(); } state.editing = id; state.mode = "register"; render(); $("#hEditor")?.scrollIntoView({ block: "start", behavior: "smooth" }); }
function editor(id){
  const h = App.hole(id); if (!h) { state.editing = null; return; }
  const box = $("#hEditor");
  box.innerHTML = `<form class="card" id="hForm"><header><h3>Edit ${esc(App.holeLabel(h))}</h3></header>
    <div class="form">${F.map(([k, l, t, opts]) => {
      const v = h[k] ?? "";
      let input;
      if (t === "select") input = `<select name="${k}">${opts.map(o => `<option value="${esc(o)}" ${String(v) === o ? "selected" : ""}>${esc(o || "–")}</option>`).join("")}</select>`;
      else if (t === "project") input = `<select name="project_id">${App.data.projects.map(p => `<option value="${esc(p.id)}" ${v === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
      else if (t === "rig") input = `<select name="rig_id">${rigOptions(h.project_id, v)}</select>`;
      else if (t === "textarea") input = `<textarea name="${k}">${esc(v)}</textarea>`;
      else input = `<input name="${k}" type="${t}" ${t === "number" ? 'step="any"' : ""} value="${esc(v)}">`;
      return `<div class="field ${t === "textarea" ? "full" : ""}"><label>${l}</label>${input}</div>`; }).join("")}
    </div>
    <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="hCancel">Cancel</button>
      ${App.isAdmin ? `<button class="btn danger right" type="button" id="hDelete">Delete hole</button>` : ""}</div></form>`;
  $("#hCancel").onclick = () => { state.editing = null; render(); };
  const del = $("#hDelete"); if (del) del.onclick = async () => { if (!App.confirm(`Delete ${App.holeLabel(h)}? Its comments go with it.`)) return; try { await App.remove("holes", { id }); state.editing = null; App.toast("Hole deleted"); await App.reload(["holes", "comments"]); } catch (e) { App.err(e); } };
  $("#hForm").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), row = {};
    for (const [k, , t] of F) { let v = fd.get(k); if (v === "" || v == null) v = null; else if (t === "number") v = Number(v); row[k] = v; }
    row.start_length = row.start_length ?? 0; row.objective = row.objective ?? ""; row.result = row.result ?? "";
    if (!row.ddh_name && !row.planned_name) return App.toast("Give the hole a DDH name or a planned ID.");
    try { await App.update("holes", { id }, row); state.editing = null; App.toast("Saved"); await App.reload(["holes"]); } catch (x) { App.err(x); }
  };
}

App.view("holes", { render, edit });
})();
