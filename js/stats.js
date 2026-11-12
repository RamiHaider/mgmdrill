/* Stats: monthly drilling production since January 2025 (hidden STATS Source sheet + completed holes). */
(() => {
"use strict";
const { $, $$, esc } = App;
const state = { year: "all", project: "all", sort: { key: "reporting_date", dir: -1 }, open: false, table: false };
const charts = {};
const PCOL = { joutel: "#2a78d6", douay: "#eb6834" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function rows(){
  const m = new Map();
  for (const s of App.data.stats) if (s.include) m.set(s.project_id + "|" + s.drill_hole.toLowerCase(), { project_id: s.project_id, drill_hole: s.drill_hole, reporting_date: s.reporting_date, meters: Number(s.meters) || 0, samples: Number(s.samples) || 0, src: s.source });
  for (const h of App.data.holes) if (!h.archived && h.status === "Complete" && h.end_date && h.ddh_name) { const k = h.project_id + "|" + h.ddh_name.toLowerCase(); if (!m.has(k)) m.set(k, { project_id: h.project_id, drill_hole: h.ddh_name, reporting_date: h.end_date, meters: App.holeDrilled(h) || 0, samples: Number(h.n_samples) || 0, src: "Tracker" }); }
  return [...m.values()].filter(r => r.reporting_date >= "2025-01-01");
}
function agg(list){ // by year-month
  const out = {};
  for (const r of list) { const k = r.reporting_date.slice(0, 7); const o = out[k] || (out[k] = { ym: k }); const p = r.project_id; o[p + "_m"] = (o[p + "_m"] || 0) + r.meters; o[p + "_h"] = (o[p + "_h"] || 0) + 1; o[p + "_s"] = (o[p + "_s"] || 0) + r.samples; o.m = (o.m || 0) + r.meters; o.h = (o.h || 0) + 1; o.s = (o.s || 0) + r.samples; }
  return out;
}
const summary = o => o.h ? `${App.fmt.n(o.s)} samples across ${o.h} hole${o.h > 1 ? "s" : ""} (${App.fmt.n(o.s / o.h)} per hole)` : "No holes reported";

function render(){
  const el = $("#view-stats"), all = rows(), projects = App.data.projects, years = [...new Set(all.map(r => r.reporting_date.slice(0, 4)))].sort();
  const list = all.filter(r => (state.year === "all" || r.reporting_date.startsWith(state.year)) && (state.project === "all" || r.project_id === state.project));
  const byM = agg(list), months = []; // continuous month list from first to last
  if (years.length) { const first = (state.year === "all" ? years[0] : state.year) + "-01"; const lastYm = state.year === "all" ? App.today().slice(0, 7) : state.year + "-12"; for (let y = Number(first.slice(0, 4)), m = 1; `${y}-${String(m).padStart(2, "0")}` <= lastYm; m++) { if (m > 12) { m = 1; y++; } months.push(`${y}-${String(m).padStart(2, "0")}`); } }
  const byY = {}; for (const r of list) { const y = r.reporting_date.slice(0, 4); const o = byY[y] || (byY[y] = agg([])); const p = r.project_id; o[p + "_m"] = (o[p + "_m"] || 0) + r.meters; o[p + "_h"] = (o[p + "_h"] || 0) + 1; o[p + "_s"] = (o[p + "_s"] || 0) + r.samples; o.m = (o.m || 0) + r.meters; o.h = (o.h || 0) + 1; o.s = (o.s || 0) + r.samples; }
  const tot = { m: list.reduce((a, r) => a + r.meters, 0), h: list.length, s: list.reduce((a, r) => a + r.samples, 0) };
  const peak = Object.values(byM).sort((a, b) => b.m - a.m)[0];
  const cols = p => [`${p}_m`, `${p}_h`, `${p}_s`];
  const yearRow = (label, period, o) => `<tr><td><b>${esc(label)}</b></td><td class="muted">${period}</td>${projects.map(p => `<td class="num">${App.fmt.n(o[p.id + "_m"] || 0)}</td>`).join("")}<td class="num"><b>${App.fmt.n(o.m || 0)}</b></td>${projects.map(p => `<td class="num">${o[p.id + "_h"] || 0}</td>`).join("")}<td class="num"><b>${o.h || 0}</b></td>${projects.map(p => `<td class="num">${App.fmt.n(o[p.id + "_s"] || 0)}</td>`).join("")}<td class="num"><b>${App.fmt.n(o.s || 0)}</b></td><td class="num">${o.h ? App.fmt.n(o.s / o.h) : "–"}</td></tr>`;
  const head = `<tr><th>Year</th><th>Period</th>${projects.map(p => `<th class="num">${esc(p.name)} m</th>`).join("")}<th class="num">Total m</th>${projects.map(p => `<th class="num">${esc(p.name)} holes</th>`).join("")}<th class="num">Holes</th>${projects.map(p => `<th class="num">${esc(p.name)} samples</th>`).join("")}<th class="num">Samples</th><th class="num">Samples / hole</th></tr>`;
  el.innerHTML = `
    <div class="pagehead"><h2>Stats</h2><div class="seg"><button data-year="all" aria-pressed="${state.year === "all"}">All years</button>${years.map(y => `<button data-year="${y}" aria-pressed="${state.year === y}">${y}</button>`).join("")}</div>
      <div class="seg"><button data-proj="all" aria-pressed="${state.project === "all"}">All projects</button>${projects.map(p => `<button data-proj="${esc(p.id)}" aria-pressed="${state.project === p.id}">${esc(p.name)}</button>`).join("")}</div>
      <label class="lyr"><input type="checkbox" id="sTable" ${state.table ? "checked" : ""}> table view</label></div>
    <div class="tiles"><div class="tile"><div class="v">${App.fmt.n(tot.m)}<small> m</small></div><div class="l">Total metres, ${state.year === "all" ? "since Jan 2025" : state.year}</div></div><div class="tile"><div class="v">${tot.h}</div><div class="l">Holes completed</div></div><div class="tile"><div class="v">${App.fmt.n(tot.s)}</div><div class="l">Samples (${tot.h ? App.fmt.n(tot.s / tot.h) : "–"} per hole)</div></div><div class="tile"><div class="v">${peak ? App.fmt.n(peak.m) : "–"}<small> m</small></div><div class="l">Peak month${peak ? `, ${MONTHS[Number(peak.ym.slice(5)) - 1]} ${peak.ym.slice(0, 4)}` : ""}</div></div><div class="tile"><div class="v">${App.fmt.n(App.seasonMetres())}<small> m</small></div><div class="l">Current season (timesheet)</div></div></div>
    <div class="card"><header><h3>Annual summary</h3></header><div class="tablewrap"><table><thead>${head}</thead><tbody>${Object.keys(byY).sort().map(y => yearRow(y, y === App.today().slice(0, 4) ? "YTD" : "Total", byY[y])).join("")}${yearRow("All", "Total", { ...Object.fromEntries(projects.flatMap(p => cols(p.id).map(k => [k, Object.values(byY).reduce((a, o) => a + (o[k] || 0), 0)]))), ...tot })}</tbody></table></div></div>
    <div class="cols-2">
      <div class="card"><header><h3>Monthly metres by project</h3></header>${state.table ? "" : `<div class="chartbox"><canvas id="sM"></canvas></div>`}</div>
      <div class="card"><header><h3>Holes completed per month</h3></header>${state.table ? "" : `<div class="chartbox"><canvas id="sH"></canvas></div>`}</div>
    </div>
    <div class="card"><header><h3>Monthly detail</h3></header><div class="tablewrap"><table><thead><tr><th>Year</th><th>Month</th>${projects.map(p => `<th class="num">${esc(p.name)} m</th>`).join("")}<th class="num">Total m</th>${projects.map(p => `<th class="num">${esc(p.name)} holes</th>`).join("")}<th class="num">Holes</th>${projects.map(p => `<th class="num">${esc(p.name)} samples</th>`).join("")}<th class="num">Samples</th><th class="num">Samples / hole</th><th>Summary</th></tr></thead><tbody>
      ${months.map(ym => { const o = byM[ym] || {}; return `<tr><td>${ym.slice(0, 4)}</td><td>${MONTHS[Number(ym.slice(5)) - 1]}</td>${projects.map(p => `<td class="num">${App.fmt.n(o[p.id + "_m"] || 0)}</td>`).join("")}<td class="num"><b>${App.fmt.n(o.m || 0)}</b></td>${projects.map(p => `<td class="num">${o[p.id + "_h"] || 0}</td>`).join("")}<td class="num"><b>${o.h || 0}</b></td>${projects.map(p => `<td class="num">${App.fmt.n(o[p.id + "_s"] || 0)}</td>`).join("")}<td class="num"><b>${App.fmt.n(o.s || 0)}</b></td><td class="num">${o.h ? App.fmt.n(o.s / o.h) : "–"}</td><td class="muted small">${summary(o)}</td></tr>`; }).join("")}</tbody></table></div></div>
    <div class="card"><header><h3>Per hole <span class="tag">${list.length}</span></h3><button class="btn xs" id="sOpen">${state.open ? "hide" : "show"}</button></header>${state.open ? `<div class="tablewrap"><table><thead><tr>${[["drill_hole", "Drill hole"], ["project_id", "Project"], ["reporting_date", "Reported"], ["meters", "Metres"], ["samples", "Samples"], ["src", "Source"]].map(([k, l]) => `<th class="sort ${["meters", "samples"].includes(k) ? "num" : ""}" data-sort="${k}">${l}${state.sort.key === k ? `<span class="arrow">${state.sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead><tbody>
      ${list.slice().sort((a, b) => { const x = a[state.sort.key], y = b[state.sort.key]; return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * state.sort.dir; }).map(r => `<tr><td><b>${esc(r.drill_hole)}</b></td><td>${esc(projects.find(p => p.id === r.project_id)?.name || r.project_id)}</td><td>${App.fmt.d(r.reporting_date)}</td><td class="num">${App.fmt.n(r.meters)}</td><td class="num">${App.fmt.n(r.samples)}</td><td class="muted">${esc(r.src)}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
  $$("[data-year]", el).forEach(b => b.onclick = () => { state.year = b.dataset.year; render(); }); $$("[data-proj]", el).forEach(b => b.onclick = () => { state.project = b.dataset.proj; render(); });
  $("#sTable").onchange = e => { state.table = e.target.checked; render(); }; $("#sOpen").onclick = () => { state.open = !state.open; render(); };
  $$("th[data-sort]", el).forEach(th => th.onclick = () => { const k = th.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 }; render(); });
  if (state.table) return;
  const labels = months.map(ym => `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(2, 4)}`), opts = (unit) => ({ responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: App.cssVar("--muted"), boxWidth: 10, usePointStyle: true } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { color: App.cssVar("--muted"), maxRotation: 0 } }, y: { stacked: true, grid: { color: App.cssVar("--grid") }, ticks: { color: App.cssVar("--muted") }, title: { display: true, text: unit, color: App.cssVar("--muted") } } } });
  const ps = projects.filter(p => state.project === "all" || p.id === state.project);
  for (const [id, key, type, unit] of [["sM", "_m", "bar", "metres"], ["sH", "_h", "line", "holes"]]) { if (charts[id]) charts[id].destroy(); const o = opts(unit); if (type === "line") { o.scales.x.stacked = false; o.scales.y.stacked = false; }
    charts[id] = new Chart($("#" + id), { type, data: { labels, datasets: ps.map(p => ({ label: p.name, data: months.map(ym => byM[ym]?.[p.id + key] || 0), backgroundColor: PCOL[p.id] || "#898781", borderColor: PCOL[p.id] || "#898781", borderWidth: 2, borderRadius: 3, maxBarThickness: 22, fill: false, pointRadius: 2 })) }, options: o }); }
}
App.view("stats", { render });
})();
