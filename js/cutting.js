/* Cutting backlog: samples from the Feuille_de_scie workbook (table samples, loaded nightly by tools/cutting_sync.py).
   A sample enters the backlog the day its hole was drilled past its To depth (shift_current), else the hole's start date,
   else the day the sync first saw it. It leaves on its cut date (Date Scie column, the Date Scie log, else the shipping date).
   Holes before JO-26-25 are assumed sent and never counted. */
(() => {
"use strict";
const { $, $$, esc } = App;
const state = { win: localStorage.getItem("mgmdrill.cut.win") || "60", from: "", to: "", byHole: true, table: false };
const charts = {};
const PALETTE = ["#c9a227", "#2a78d6", "#1baf7a", "#eb6834", "#e87ba4", "#8e6bd6", "#eda100", "#3fb8c9", "#b5651d", "#7a9a2c", "#d64545", "#5c7cfa"];

function window_(){
  const end = App.today();
  if (state.win === "custom" && state.from && state.to) return [state.from, state.to];
  if (state.win === "season") return [App.seasonStart(), end];
  return [App.addDays(end, -(Number(state.win) - 1)), end];
}
function dates(from, to){ const out = []; for (let d = from; d <= to; d = App.addDays(d, 1)) out.push(d); return out; }
function base(){ return { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: App.cssVar("--muted"), boxWidth: 10, usePointStyle: true } }, tooltip: { backgroundColor: App.cssVar("--header"), titleColor: App.cssVar("--gold"), bodyColor: "#f5f1e6" } }, scales: { x: { grid: { color: App.cssVar("--grid") }, ticks: { color: App.cssVar("--muted"), maxRotation: 0, autoSkip: true } }, y: { grid: { color: App.cssVar("--grid") }, ticks: { color: App.cssVar("--muted") }, border: { display: false } } } }; }
function mk(id, cfg){ if (charts[id]) charts[id].destroy(); const c = $("#" + id); if (!c) return; charts[id] = new Chart(c, cfg); }
const xbtns = (id, name) => `<span class="row noprint" data-xcard="${id}" data-xname="${name}"><button class="btn sm" data-x="png" title="Save this chart as a PNG">Image</button><button class="btn sm" data-x="copy" title="Copy this chart to the clipboard">Copy</button><button class="btn sm" data-x="pdf" title="Print this chart to PDF">PDF</button></span>`;
const holeKey = n => String(n || "").toUpperCase();
const holeSort = (a, b) => { const na = Number((a.match(/-(\d+)/) || [])[1] || 0), nb = Number((b.match(/-(\d+)/) || [])[1] || 0); return na - nb || a.localeCompare(b); };

/* when did each sample enter the backlog */
function enteredDates(samples){
  const prog = {};                                          // hole -> [{d, m}] sorted by date, m = deepest end_m so far
  for (const s of App.data.shifts) if (s.hole_name && s.end_m != null) (prog[holeKey(s.hole_name)] ||= []).push({ d: s.shift_date, m: Number(s.end_m) });
  for (const k in prog) { prog[k].sort((a, b) => a.d.localeCompare(b.d)); let mx = -1; for (const p of prog[k]) { mx = Math.max(mx, p.m); p.m = mx; } }
  const holeStart = {}; for (const h of App.data.holes) if (h.ddh_name) holeStart[holeKey(h.ddh_name)] = h.start_date;
  const out = {};
  for (const s of samples) {
    const k = holeKey(s.hole_name), p = prog[k], depth = s.to_m ?? s.from_m;
    let d = null;
    if (p && p.length) { if (depth != null) d = (p.find(x => x.m >= depth) || p[p.length - 1]).d; else d = p[0].d; }
    out[s.sample_no] = d || holeStart[k] || s.first_seen;
  }
  return out;
}

function render(){
  const el = $("#view-cutting"), all = App.data.samples || [];
  const tracked = all.filter(s => s.cut_source !== "assumed"), assumed = all.length - tracked.length;
  const entered = enteredDates(tracked), [from, to] = window_(), ds = dates(from, to), today = App.today();
  const isCut = (s, d) => s.cut_date && s.cut_date <= d;
  const waitingNow = tracked.filter(s => !s.cut_date), cutNotShipped = tracked.filter(s => s.cut_date && !s.ship_date), shipped = tracked.filter(s => s.ship_date);
  const m = arr => arr.reduce((a, s) => a + (s.length_m || 0), 0);
  const lastCut = tracked.filter(s => s.cut_date && s.cut_source !== "shipped").map(s => s.cut_date).sort().pop();
  const lastShip = shipped.map(s => s.ship_date).sort().pop();
  const cut7 = tracked.filter(s => s.cut_date && s.cut_date > App.addDays(today, -7) && s.cut_date <= today).length / 7;
  const daysToClear = cut7 > 0 ? Math.ceil(waitingNow.length / cut7) : null;
  const holes = [...new Set(tracked.map(s => holeKey(s.hole_name)))].sort(holeSort);
  const colorOf = {}; holes.forEach((h, i) => colorOf[h] = PALETTE[i % PALETTE.length]);
  // daily series
  const series = ds.map(d => { const w = tracked.filter(s => entered[s.sample_no] <= d && !isCut(s, d)); const byHole = {}; for (const s of w) { const k = holeKey(s.hole_name); byHole[k] = (byHole[k] || 0) + (s.length_m || 0); }
    return { d, n: w.length, m: m(w), byHole, added: tracked.filter(s => entered[s.sample_no] === d).length, cut: tracked.filter(s => s.cut_date === d).length, shipped: tracked.filter(s => s.ship_date === d).length }; });
  const peak = series.reduce((a, x) => Math.max(a, x.m), 0);
  const winHoles = holes.filter(h => series.some(x => x.byHole[h] > 0));
  // holes with nothing left on site (everything shipped) merge into one grey area; active holes keep their colour
  const onSite = new Set(tracked.filter(s => !s.ship_date).map(s => holeKey(s.hole_name)));
  const activeHoles = winHoles.filter(h => onSite.has(h)), doneHoles = winHoles.filter(h => !onSite.has(h));
  const lastSync = all.map(s => s.synced_at).sort().pop();

  el.innerHTML = `
    <div class="pagehead"><h2>Cutting</h2>
      <div class="seg">${[["30", "30 days"], ["60", "60 days"], ["season", "Season"], ["custom", "Custom"]].map(([k, l]) => `<button data-win="${k}" aria-pressed="${state.win === k}">${l}</button>`).join("")}</div>
      <span class="row" ${state.win === "custom" ? "" : "hidden"}><input type="date" id="kFrom" value="${esc(state.from || from)}" style="width:auto"><input type="date" id="kTo" value="${esc(state.to || to)}" style="width:auto"></span>
    </div>
    <div class="toolbar"><label class="lyr"><input type="checkbox" id="kByHole" ${state.byHole ? "checked" : ""}> stack by hole</label><label class="lyr"><input type="checkbox" id="kTable" ${state.table ? "checked" : ""}> table view</label>
      <span class="note">Feuille_de_scie, read nightly${lastSync ? `, last ${App.fmt.dt(lastSync)}` : ""}. ${assumed ? `${App.fmt.n(assumed)} samples before JO-26-25 assumed sent.` : ""}</span>
      <span class="sep"></span><button class="btn sm" id="kPdf" title="Print the tiles, all charts and the table to PDF">Export all PDF</button><button class="btn sm" id="kPng" title="Save the tiles, all charts and the table as one PNG">Export all image</button></div>
    ${all.length ? "" : `<div class="card"><p class="note">No samples yet. Run <code>py -3 -I tools/cutting_sync.py</code> on the laptop (it runs by itself at midnight).</p></div>`}
    <div id="kSheet">
    <div class="tiles">
      <div class="tile"><div class="v">${App.fmt.n(waitingNow.length)}<small> samples · ${App.fmt.n(m(waitingNow), 1)} m</small></div><div class="l">Waiting to be cut</div><div class="d ${waitingNow.length ? "down" : "up"}">${waitingNow.length ? `${[...new Set(waitingNow.map(s => holeKey(s.hole_name)))].length} holes` : "backlog clear"}</div></div>
      <div class="tile"><div class="v">${App.fmt.n(cutNotShipped.length)}<small> samples</small></div><div class="l">Cut, not shipped yet</div><div class="d">last cut ${lastCut ? App.fmt.d(lastCut) : "– (no Date Scie yet)"}</div></div>
      <div class="tile"><div class="v">${App.fmt.n(shipped.length)}<small> samples</small></div><div class="l">Shipped to the lab</div><div class="d">last shipment ${App.fmt.d(lastShip)}</div></div>
      <div class="tile"><div class="v">${App.fmt.n(cut7, 1)}<small> / day</small></div><div class="l">Cut rate, last 7 days</div><div class="d ${daysToClear != null && daysToClear <= 7 ? "up" : "down"}">${daysToClear != null ? `${daysToClear} days to clear` : "no cutting recorded this week"}</div></div>
    </div>
    <div class="card"><header><h3>Backlog, metres waiting to be cut</h3><span class="note">${App.fmt.d(from)} – ${App.fmt.d(to)}, peak ${App.fmt.n(peak, 1)} m · grey = holes fully shipped</span>${xbtns("kBacklog", "backlog-metres")}</header>
      ${state.table ? tableHtml(series) : `<div class="chartbox"><canvas id="kBacklog"></canvas></div>`}</div>
    <div class="cols-2">
      <div class="card"><header><h3>Backlog, number of samples</h3>${xbtns("kCount", "backlog-samples")}</header><div class="chartbox"><canvas id="kCount"></canvas></div></div>
      <div class="card"><header><h3>Daily flow, samples</h3><span class="note">drilled in, cut, shipped</span>${xbtns("kFlow", "daily-flow")}</header><div class="chartbox"><canvas id="kFlow"></canvas></div></div>
    </div>
    <div class="card"><header><h3>Samples per hole</h3><span class="note">waiting · cut · shipped, click a bar for the hole</span>${xbtns("kHoles", "samples-per-hole")}</header><div class="chartbox tall"><canvas id="kHoles"></canvas></div></div>
    <div class="card"><header><h3>Hole totals</h3>${xbtns("kTotals", "hole-totals")}</header><div class="tablewrap"><table><thead><tr><th>Hole</th><th class="num">Samples</th><th class="num">Waiting</th><th class="num">Waiting m</th><th class="num">Cut</th><th class="num">Shipped</th><th>Last cut</th><th>Last shipped</th><th>Cut date from</th></tr></thead><tbody>
      ${holes.map(h => { const ss = tracked.filter(s => holeKey(s.hole_name) === h), w = ss.filter(s => !s.cut_date), c = ss.filter(s => s.cut_date), sh = ss.filter(s => s.ship_date); const hole = App.data.holes.find(x => holeKey(x.ddh_name) === h);
        const src = ["sheet", "date_scie", "shipped"].map(k => [k, c.filter(s => s.cut_source === k).length]).filter(x => x[1]).map(([k, n]) => `${{ sheet: "sheet", date_scie: "log", shipped: "shipping" }[k]} ${n}`).join(", ");
        return `<tr><td>${hole ? `<a href="#" data-open="${hole.id}">${esc(h)}</a>` : esc(h)}</td><td class="num">${ss.length}</td><td class="num"><b>${w.length}</b></td><td class="num">${App.fmt.n(m(w), 1)}</td><td class="num">${c.length}</td><td class="num">${sh.length}</td><td>${App.fmt.d(c.filter(s => s.cut_source !== "shipped").map(s => s.cut_date).sort().pop())}</td><td>${App.fmt.d(sh.map(s => s.ship_date).sort().pop())}</td><td class="note">${src || "–"}</td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td>All holes</td><td class="num">${tracked.length}</td><td class="num">${waitingNow.length}</td><td class="num">${App.fmt.n(m(waitingNow), 1)}</td><td class="num">${tracked.filter(s => s.cut_date).length}</td><td class="num">${shipped.length}</td><td></td><td></td><td></td></tr></tfoot></table></div></div>
    </div>`;

  $$("[data-win]", el).forEach(b => b.onclick = () => { state.win = b.dataset.win; localStorage.setItem("mgmdrill.cut.win", state.win); render(); });
  $("#kFrom").onchange = e => { state.from = e.target.value; render(); }; $("#kTo").onchange = e => { state.to = e.target.value; render(); };
  $("#kByHole").onchange = e => { state.byHole = e.target.checked; render(); }; $("#kTable").onchange = e => { state.table = e.target.checked; render(); };
  $$("[data-open]", el).forEach(a => a.onclick = e => { e.preventDefault(); App.openHole(a.dataset.open); });
  $("#kPdf").onclick = () => App.exportPdf($("#kSheet")); $("#kPng").onclick = () => App.exportPng($("#kSheet"), "cutting");
  $$("[data-x]", el).forEach(b => b.onclick = () => { const w = b.closest("[data-xcard]"), card = b.closest(".card"), name = `cutting-${w.dataset.xname}`;
    if (b.dataset.x === "png") App.exportPng(card, name); else if (b.dataset.x === "copy") App.copyPng(card); else App.exportPdf(card); });

  const labels = ds.map(d => App.fmt.d(d));
  // 1 backlog metres
  if (!state.table) {
    const o = base(); o.scales.y.title = { display: true, text: "metres", color: App.cssVar("--muted") }; o.elements = { point: { radius: 0 } }; o.scales.y.stacked = state.byHole; o.scales.y.beginAtZero = true;
    const grey = App.cssVar("--muted-2") || "#898781";
    const datasets = state.byHole && winHoles.length
      ? [...(doneHoles.length ? [{ label: `Left site (${doneHoles.length} holes)`, data: series.map(x => +doneHoles.reduce((a, h) => a + (x.byHole[h] || 0), 0).toFixed(1)), borderColor: grey, backgroundColor: grey + "66", borderWidth: 1, fill: true, stack: "m" }] : []),
         ...activeHoles.map(h => ({ label: h, data: series.map(x => +(x.byHole[h] || 0).toFixed(1)), borderColor: colorOf[h], backgroundColor: colorOf[h] + "aa", borderWidth: 1, fill: true, stack: "m" }))]
      : [{ label: "Waiting", data: series.map(x => +x.m.toFixed(1)), borderColor: App.cssVar("--gold"), backgroundColor: App.cssVar("--gold") + "33", borderWidth: 2, fill: true }];
    mk("kBacklog", { type: "line", data: { labels, datasets }, options: o });
  }
  // 2 backlog count
  const o2 = base(); o2.scales.y.title = { display: true, text: "samples", color: App.cssVar("--muted") }; o2.elements = { point: { radius: 0 } }; o2.scales.y.beginAtZero = true;
  mk("kCount", { type: "line", data: { labels, datasets: [{ label: "Waiting", data: series.map(x => x.n), borderColor: App.cssVar("--fg"), borderWidth: 2, fill: false }] }, options: o2 });
  // 3 daily flow
  const o3 = base(); o3.scales.y.title = { display: true, text: "samples / day", color: App.cssVar("--muted") }; o3.scales.y.beginAtZero = true;
  mk("kFlow", { type: "bar", data: { labels, datasets: [
    { label: "Drilled (into backlog)", data: series.map(x => x.added), backgroundColor: App.cssVar("--muted-2"), borderRadius: 2, maxBarThickness: 18 },
    { label: "Cut", data: series.map(x => x.cut), backgroundColor: App.cssVar("--gold"), borderRadius: 2, maxBarThickness: 18 },
    { label: "Shipped", data: series.map(x => x.shipped), backgroundColor: "#2a78d6", borderRadius: 2, maxBarThickness: 18 }] }, options: o3 });
  // 4 per hole
  const perHole = holes.map(h => { const ss = tracked.filter(s => holeKey(s.hole_name) === h); return { h, w: ss.filter(s => !s.cut_date), c: ss.filter(s => s.cut_date && !s.ship_date), s: ss.filter(s => s.ship_date) }; });
  const o4 = base(); o4.indexAxis = "y"; o4.scales.x.stacked = true; o4.scales.y.stacked = true; o4.interaction = { mode: "nearest", axis: "y", intersect: true };
  o4.onClick = (e, items) => { if (items.length) { const hole = App.data.holes.find(x => holeKey(x.ddh_name) === perHole[items[0].index].h); if (hole) App.openHole(hole.id); } };
  o4.plugins.tooltip.callbacks = { label: c => { const p = perHole[c.dataIndex], arr = [p.w, p.c, p.s][c.datasetIndex]; return ` ${c.dataset.label}: ${arr.length} samples · ${App.fmt.n(m(arr), 1)} m`; } };
  mk("kHoles", { type: "bar", data: { labels: holes, datasets: [
    { label: "Waiting", data: perHole.map(p => p.w.length), backgroundColor: "#d64545", borderRadius: 2, maxBarThickness: 16 },
    { label: "Cut, not shipped", data: perHole.map(p => p.c.length), backgroundColor: App.cssVar("--gold"), borderRadius: 2, maxBarThickness: 16 },
    { label: "Shipped", data: perHole.map(p => p.s.length), backgroundColor: "#2a78d6", borderRadius: 2, maxBarThickness: 16 }] }, options: o4 });
  const box = $("#kHoles")?.parentElement; if (box) box.style.height = Math.max(260, holes.length * 22 + 60) + "px";
}
function tableHtml(series){
  return `<div class="tablewrap"><table><thead><tr><th>Date</th><th class="num">Waiting samples</th><th class="num">Waiting m</th><th class="num">Drilled in</th><th class="num">Cut</th><th class="num">Shipped</th></tr></thead><tbody>
    ${series.slice().reverse().map(x => `<tr><td>${App.fmt.d(x.d)}</td><td class="num"><b>${x.n}</b></td><td class="num">${App.fmt.n(x.m, 1)}</td><td class="num">${x.added || ""}</td><td class="num">${x.cut || ""}</td><td class="num">${x.shipped || ""}</td></tr>`).join("")}</tbody></table></div>`;
}
App.view("cutting", { render });
})();
