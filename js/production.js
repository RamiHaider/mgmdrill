/* Production charts: daily metres by rig, cumulative vs programme, rolling average, metres per hole.
   One y-axis per chart; series colour = rig colour; rigs toggle on and off and everything updates. */
(() => {
"use strict";
const { $, $$, esc } = App;
const state = { rigs: new Set(JSON.parse(localStorage.getItem("mgmdrill.prod.rigs") || "[]")), win: localStorage.getItem("mgmdrill.prod.win") || "30", from: "", to: "", stack: true, target: true, table: false };
const charts = {};
const DAY = 86400000;

function window_(){
  const end = App.lastProductionDate() || App.today();
  if (state.win === "custom" && state.from && state.to) return [state.from, state.to];
  if (state.win === "month") { const d = App.parseDate(end); return [App.fmt.iso(new Date(d.getFullYear(), d.getMonth(), 1)), end]; }
  if (state.win === "season") return [App.seasonStart(), end];
  return [App.addDays(end, -(Number(state.win) - 1)), end];
}
function dates(from, to){ const out = []; for (let d = from; d <= to; d = App.addDays(d, 1)) out.push(d); return out; }
function base(){ return { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: App.cssVar("--muted"), boxWidth: 10, usePointStyle: true } }, tooltip: { backgroundColor: App.cssVar("--header"), titleColor: App.cssVar("--gold"), bodyColor: "#f5f1e6" } }, scales: { x: { grid: { color: App.cssVar("--grid") }, ticks: { color: App.cssVar("--muted"), maxRotation: 0, autoSkip: true } }, y: { grid: { color: App.cssVar("--grid") }, ticks: { color: App.cssVar("--muted") }, border: { display: false } } } }; }
const xbtns = (id, name) => `<span class="row noprint" data-xcard="${id}" data-xname="${name}"><button class="btn sm" data-x="png" title="Save this chart as a PNG">Image</button><button class="btn sm" data-x="copy" title="Copy this chart to the clipboard">Copy</button><button class="btn sm" data-x="pdf" title="Print this chart to PDF">PDF</button></span>`;
function mk(id, cfg){ if (charts[id]) charts[id].destroy(); const c = $("#" + id); if (!c) return; charts[id] = new Chart(c, cfg); }

function render(){
  const el = $("#view-production"), rigs = App.activeRigs();
  if (!state.rigs.size || ![...state.rigs].some(r => rigs.some(x => x.id === r))) state.rigs = new Set(rigs.map(r => r.id));
  const sel = rigs.filter(r => state.rigs.has(r.id)), [from, to] = window_(), ds = dates(from, to), by = App.dailyByRig(), t = App.targets();
  const dailyTarget = rigs.length * (Number(t.m_per_rig_day) || 60), last = App.lastProductionDate() || App.today();
  const season = App.seasonMetres(), lastDay = App.dailyTotal(last), week = App.rangeMetres(App.addDays(last, -6), last), month = App.rangeMetres(App.addDays(last, -29), last);
  el.innerHTML = `
    <div class="pagehead"><h2>Production</h2>
      <div class="seg">${[["14", "14 days"], ["30", "30 days"], ["month", "This month"], ["season", "Season"], ["custom", "Custom"]].map(([k, l]) => `<button data-win="${k}" aria-pressed="${state.win === k}">${l}</button>`).join("")}</div>
      <span class="row" ${state.win === "custom" ? "" : "hidden"}><input type="date" id="pFrom" value="${esc(state.from || from)}" style="width:auto"><input type="date" id="pTo" value="${esc(state.to || to)}" style="width:auto"></span>
    </div>
    <div class="toolbar"><div class="chips">${rigs.map(r => `<button class="chip toggle" data-rig="${esc(r.id)}" aria-pressed="${state.rigs.has(r.id)}" style="--c:${r.color}"><i></i>${esc(r.label)}</button>`).join("")}</div>
      <span class="sep"></span><label class="lyr"><input type="checkbox" id="pStack" ${state.stack ? "checked" : ""}> stack rigs</label><label class="lyr"><input type="checkbox" id="pTarget" ${state.target ? "checked" : ""}> show targets</label><label class="lyr"><input type="checkbox" id="pTable" ${state.table ? "checked" : ""}> table view</label>
      <span class="sep"></span><button class="btn sm" id="pPdf" title="Print the tiles, all charts and the totals table to PDF">Export all PDF</button><button class="btn sm" id="pPng" title="Save the tiles, all charts and the totals table as one PNG">Export all image</button></div>
    <div id="pSheet">
    <div class="tiles">
      <div class="tile"><div class="v">${App.fmt.n(season)}<small> / ${App.fmt.n(t.program_m)} m</small></div><div class="l">Season since ${App.fmt.d(App.seasonStart())}</div><div class="meter"><i style="width:${Math.min(100, season / (t.program_m || 1) * 100)}%"></i></div></div>
      <div class="tile"><div class="v">${App.fmt.n(lastDay)}<small> / ${App.fmt.n(dailyTarget)} m</small></div><div class="l">${App.fmt.d(last)}, last production day</div><div class="d ${lastDay >= dailyTarget ? "up" : "down"}">${App.fmt.pct(lastDay / (dailyTarget || 1))} of target</div></div>
      <div class="tile"><div class="v">${App.fmt.n(week)}<small> / ${App.fmt.n(dailyTarget * 7)} m</small></div><div class="l">Rolling 7 days</div><div class="d ${week >= dailyTarget * 7 ? "up" : "down"}">${App.fmt.pct(week / (dailyTarget * 7 || 1))} achieved</div></div>
      <div class="tile"><div class="v">${App.fmt.n(month / 30 / (rigs.length || 1), 1)}<small> m/rig/day</small></div><div class="l">30-day average per rig</div><div class="d ${month / 30 / (rigs.length || 1) >= (t.m_per_rig_day || 60) ? "up" : "down"}">target ${esc(t.m_per_rig_day || 60)}</div></div>
    </div>
    <div class="card"><header><h3>Daily metres by rig</h3><span class="note">${App.fmt.d(from)} – ${App.fmt.d(to)}</span>${xbtns("cDaily", "daily-metres")}</header>
      ${state.table ? tableHtml(sel, ds, by) : `<div class="chartbox"><canvas id="cDaily"></canvas></div>`}</div>
    <div class="cols-2">
      <div class="card"><header><h3>Cumulative season metres</h3>${xbtns("cCum", "cumulative-metres")}</header><div class="chartbox"><canvas id="cCum"></canvas></div></div>
      <div class="card"><header><h3>7-day rolling average, m/day per rig</h3>${xbtns("cRoll", "rolling-average")}</header><div class="chartbox"><canvas id="cRoll"></canvas></div></div>
    </div>
    <div class="card"><header><h3>Metres per hole</h3><span class="note">completed and in progress, click a bar for the hole</span>${xbtns("cHoles", "metres-per-hole")}</header><div class="chartbox tall"><canvas id="cHoles"></canvas></div></div>
    <div class="card"><header><h3>Rig totals, ${App.fmt.d(from)} – ${App.fmt.d(to)}</h3>${xbtns("tTotals", "rig-totals")}</header><div class="tablewrap"><table><thead><tr><th>Rig</th><th class="num">Days drilling</th><th class="num">Metres</th><th class="num">Avg m/day</th><th>Best day</th><th>Current hole</th></tr></thead><tbody>
      ${sel.map(r => { const d = by[r.id] || {}; const days = ds.filter(x => d[x] > 0); const m = ds.reduce((a, x) => a + (d[x] || 0), 0); const best = days.sort((a, b) => d[b] - d[a])[0]; const h = App.rigCurrentHole(r.id);
        return `<tr><td><span class="chip sm" style="--c:${r.color}"><i></i>${esc(r.label)}</span></td><td class="num">${days.length}</td><td class="num"><b>${App.fmt.n(m)}</b></td><td class="num">${App.fmt.n(m / (ds.length || 1), 1)}</td><td>${best ? `${App.fmt.d(best)} · ${App.fmt.n(d[best])} m` : "–"}</td><td>${h ? `<a href="#" data-open="${h.id}">${esc(App.holeLabel(h))}</a>` : "–"}</td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td>All selected</td><td></td><td class="num">${App.fmt.n(sel.reduce((a, r) => a + ds.reduce((b, x) => b + (by[r.id]?.[x] || 0), 0), 0))}</td><td class="num">${App.fmt.n(sel.reduce((a, r) => a + ds.reduce((b, x) => b + (by[r.id]?.[x] || 0), 0), 0) / (ds.length || 1), 1)}</td><td></td><td></td></tr></tfoot></table></div></div>
    </div>`;

  $$("[data-win]", el).forEach(b => b.onclick = () => { state.win = b.dataset.win; localStorage.setItem("mgmdrill.prod.win", state.win); render(); });
  $("#pFrom").onchange = e => { state.from = e.target.value; render(); }; $("#pTo").onchange = e => { state.to = e.target.value; render(); };
  $$("[data-rig]", el).forEach(b => b.onclick = () => { const id = b.dataset.rig; state.rigs.has(id) ? state.rigs.delete(id) : state.rigs.add(id); localStorage.setItem("mgmdrill.prod.rigs", JSON.stringify([...state.rigs])); render(); });
  $("#pStack").onchange = e => { state.stack = e.target.checked; render(); }; $("#pTarget").onchange = e => { state.target = e.target.checked; render(); }; $("#pTable").onchange = e => { state.table = e.target.checked; render(); };
  $$("[data-open]", el).forEach(a => a.onclick = e => { e.preventDefault(); App.openHole(a.dataset.open); });
  // exports: the whole block (tiles, charts, totals) or one card, as PNG / clipboard / PDF. Buttons are .noprint so they never appear in the output.
  $("#pPdf").onclick = () => App.exportPdf($("#pSheet")); $("#pPng").onclick = () => App.exportPng($("#pSheet"), "production");
  $$("[data-x]", el).forEach(b => b.onclick = () => { const w = b.closest("[data-xcard]"), card = b.closest(".card"), name = `production-${w.dataset.xname}`;
    if (b.dataset.x === "png") App.exportPng(card, name); else if (b.dataset.x === "copy") App.copyPng(card); else App.exportPdf(card); });

  const labels = ds.map(d => App.fmt.d(d)), targetLine = (v, label) => ({ label, data: ds.map(() => v), type: "line", borderColor: App.cssVar("--muted-2"), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
  // 1 daily bars
  if (!state.table) {
    const o = base(); o.scales.x.stacked = state.stack; o.scales.y.stacked = state.stack; o.scales.y.title = { display: true, text: "metres", color: App.cssVar("--muted") };
    mk("cDaily", { type: "bar", data: { labels, datasets: [...sel.map(r => ({ label: r.label, data: ds.map(d => by[r.id]?.[d] || 0), backgroundColor: r.color, borderRadius: 3, borderSkipped: "bottom", maxBarThickness: 28, borderWidth: 1, borderColor: App.cssVar("--surface") })), ...(state.target ? [targetLine(dailyTarget, "Daily target")] : [])] }, options: o });
  }
  // 2 cumulative season
  const sds = dates(App.seasonStart(), last), cum = r => { let a = 0; return sds.map(d => a += (by[r]?.[d] || 0)); };
  const all = (() => { let a = 0; return sds.map(d => a += sel.reduce((s, r) => s + (by[r.id]?.[d] || 0), 0)); })();
  const o2 = base(); o2.scales.y.title = { display: true, text: "metres", color: App.cssVar("--muted") }; o2.elements = { point: { radius: 0 } };
  const tgtDays = dailyTarget ? Math.ceil((t.program_m || 25000) / dailyTarget) : 0;
  mk("cCum", { type: "line", data: { labels: sds.map(d => App.fmt.d(d)), datasets: [{ label: "All rigs", data: all, borderColor: App.cssVar("--fg"), borderWidth: 2.5, fill: false }, ...sel.map(r => ({ label: r.label, data: cum(r.id), borderColor: r.color, borderWidth: 1.5, fill: false })),
    ...(state.target ? [{ label: "Programme pace", data: sds.map((d, i) => Math.min(t.program_m || 25000, i * dailyTarget)), borderColor: App.cssVar("--muted-2"), borderDash: [6, 4], borderWidth: 1.5, fill: false }] : [])] }, options: o2 });
  // 3 rolling 7-day avg
  const roll = r => ds.map(d => { let s = 0; for (let i = 0; i < 7; i++) s += by[r]?.[App.addDays(d, -i)] || 0; return +(s / 7).toFixed(1); });
  const o3 = base(); o3.scales.y.title = { display: true, text: "m/day", color: App.cssVar("--muted") }; o3.elements = { point: { radius: 2 } };
  mk("cRoll", { type: "line", data: { labels, datasets: [...sel.map(r => ({ label: r.label, data: roll(r.id), borderColor: r.color, borderWidth: 2, fill: false })), ...(state.target ? [targetLine(t.m_per_rig_day || 60, "Target per rig")] : [])] }, options: o3 });
  // 4 metres per hole
  const holes = App.projectHoles().filter(h => ["Complete", "In Progress"].includes(h.status) && App.holeDrilled(h) > 0).sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  const o4 = base(); o4.indexAxis = "y"; o4.plugins.legend.display = false; o4.interaction = { mode: "nearest", axis: "y", intersect: true }; o4.onClick = (e, items) => { if (items.length) App.openHole(holes[items[0].index].id); };
  o4.plugins.tooltip.callbacks = { label: c => { const h = holes[c.dataIndex]; return ` ${App.fmt.n(c.raw)} m · ${h.status} · ${App.rig(h.rig_id)?.label || "no rig"}`; } };
  mk("cHoles", { type: "bar", data: { labels: holes.map(h => App.holeLabel(h)), datasets: [{ label: "Metres drilled", data: holes.map(h => App.holeDrilled(h)), backgroundColor: holes.map(h => h.status === "In Progress" ? (App.rig(h.rig_id)?.color || "#898781") + "99" : (App.rig(h.rig_id)?.color || "#898781")), borderRadius: 3, borderSkipped: "left", maxBarThickness: 16 }] }, options: o4 });
  const box = $("#cHoles")?.parentElement; if (box) box.style.height = Math.max(260, holes.length * 22 + 60) + "px";
}
function tableHtml(sel, ds, by){
  return `<div class="tablewrap"><table><thead><tr><th>Date</th>${sel.map(r => `<th class="num">${esc(r.label)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
    ${ds.slice().reverse().map(d => `<tr><td>${App.fmt.d(d)}</td>${sel.map(r => `<td class="num">${App.fmt.n(by[r.id]?.[d] || 0)}</td>`).join("")}<td class="num"><b>${App.fmt.n(sel.reduce((a, r) => a + (by[r.id]?.[d] || 0), 0))}</b></td></tr>`).join("")}</tbody></table></div>`;
}
App.view("production", { render });
})();
