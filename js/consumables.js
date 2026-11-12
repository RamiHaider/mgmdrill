/* Consumables & standby by rig per half-month billing period, for checking the RJLL invoices. */
(() => {
"use strict";
const { $, $$, esc } = App;
const state = { period: null, rigs: null, q: "", table: false };
const ORDER = ["Metres Drilled", "Billable Hours", "Standby / Delays", "Contractor time", "Downhole Surveys", "Consumables / Materials", "Other"];
let chart = null;
const norm = s => /own time/i.test(s) ? "Contractor time" : s;
const periodLabel = p => `${App.fmt.d(p.start)} – ${App.fmt.d(p.end)}, ${p.start.slice(0, 4)}`;
function periods(){ const m = new Map(); for (const c of App.data.consumables) m.set(c.period_start, { start: c.period_start, end: c.period_end }); return [...m.values()].sort((a, b) => b.start.localeCompare(a.start)); }
function halfMonth(d){ const x = App.parseDate(d); const s = x.getDate() <= 15 ? 1 : 16; const e = x.getDate() <= 15 ? 15 : new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); return { start: App.fmt.iso(new Date(x.getFullYear(), x.getMonth(), s)), end: App.fmt.iso(new Date(x.getFullYear(), x.getMonth(), e)) }; }

function render(){
  const el = $("#view-consumables"), ps = periods(), rigs = App.projectRigs();
  if (!state.period || !ps.some(p => p.start === state.period)) state.period = ps[0]?.start || halfMonth(App.today()).start;
  if (!state.rigs) state.rigs = new Set(rigs.map(r => r.id));
  const cur = ps.find(p => p.start === state.period) || halfMonth(state.period), sel = rigs.filter(r => state.rigs.has(r.id));
  const rows = App.data.consumables.filter(c => c.period_start === state.period && state.rigs.has(c.rig_id) && (!state.q || c.item.toLowerCase().includes(state.q.toLowerCase())));
  const sections = [...new Set(rows.map(c => norm(c.section)))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const sum = (f) => rows.filter(f).reduce((a, c) => a + Number(c.qty || 0), 0);
  const nq = sum(c => /coring/i.test(c.item)), bill = sum(c => norm(c.section) === "Billable Hours" && /rig-hr/i.test(c.unit)), stby = sum(c => /standby/i.test(c.section) && /rig-hr/i.test(c.unit)), days = Math.max(0, ...rows.filter(c => /shift reports/i.test(c.item)).map(c => Number(c.qty)));
  el.innerHTML = `
    <div class="pagehead"><h2>Consumables &amp; standby</h2>
      <select id="cPeriod" style="width:auto">${ps.map(p => `<option value="${p.start}" ${p.start === state.period ? "selected" : ""}>${periodLabel(p)}</option>`).join("")}${ps.some(p => p.start === cur.start) ? "" : `<option value="${cur.start}" selected>${periodLabel(cur)}</option>`}</select>
      <input id="cQ" type="search" placeholder="Find item…" value="${esc(state.q)}" style="max-width:200px"><button class="btn sm" id="cCsv">Export CSV</button></div>
    <div class="toolbar"><div class="chips">${rigs.map(r => `<button class="chip toggle" data-rig="${esc(r.id)}" aria-pressed="${state.rigs.has(r.id)}" style="--c:${r.color}"><i></i>${esc(r.id)}</button>`).join("")}</div></div>
    <p class="note">From RJLL portal shift reports, one block per half-month billing period. Compare each block with the RJLL invoice for the same period. rig-hr = drill crew time; fore-hr = foreman time. Spektra has no portal feed, its lines are entered by hand.</p>
    <div class="tiles"><div class="tile"><div class="v">${App.fmt.n(nq)}<small> m</small></div><div class="l">NQ coring</div></div><div class="tile"><div class="v">${App.fmt.n(bill, 1)}</div><div class="l">Billable rig-hours</div></div><div class="tile"><div class="v">${App.fmt.n(stby, 1)}</div><div class="l">Standby rig-hours</div></div><div class="tile"><div class="v">${App.fmt.n(days)}</div><div class="l">Shift-report days (max per rig)</div></div></div>
    ${sel.some(r => r.contractor !== "RJLL") && !rows.some(c => sel.find(r => r.id === c.rig_id)?.contractor !== "RJLL") ? `<div class="msg">No lines for the Spektra rig in this period.</div>` : ""}
    <div class="tablewrap"><table><thead><tr><th>Item</th><th>Unit</th>${sel.map(r => `<th class="num" style="color:${r.color}">${esc(r.id)}</th>`).join("")}<th class="num">Total</th>${App.canEdit ? "<th></th>" : ""}</tr></thead><tbody>
      ${sections.map(sec => { const items = new Map(); for (const c of rows.filter(c => norm(c.section) === sec)) { const k = c.item + "|" + c.unit; if (!items.has(k)) items.set(k, { item: c.item, unit: c.unit, by: {} }); items.get(k).by[c.rig_id] = c; }
        return `<tr><td colspan="${3 + sel.length + (App.canEdit ? 1 : 0)}" style="background:var(--surface-2);font-weight:700;text-transform:uppercase;font-size:11.5px;letter-spacing:.05em;color:var(--muted)">${esc(sec)}</td></tr>` +
          [...items.values()].sort((a, b) => Object.values(b.by).reduce((x, c) => x + c.qty, 0) - Object.values(a.by).reduce((x, c) => x + c.qty, 0)).map(it => `<tr><td class="wrap-text">${esc(it.item)}</td><td class="muted">${esc(it.unit)}</td>${sel.map(r => { const c = it.by[r.id]; return App.canEdit ? `<td class="num edit" data-id="${c?.id || ""}" data-rig="${r.id}" data-item="${esc(it.item)}" data-unit="${esc(it.unit)}" data-sec="${esc(sec)}" contenteditable="plaintext-only">${c ? App.fmt.n(c.qty, 1).replace(/\.0$/, "") : ""}</td>` : `<td class="num">${c ? App.fmt.n(c.qty, 1).replace(/\.0$/, "") : ""}</td>`; }).join("")}<td class="num"><b>${App.fmt.n(Object.values(it.by).reduce((x, c) => x + Number(c.qty), 0), 1).replace(/\.0$/, "")}</b></td>${App.canEdit ? `<td><button class="btn xs ghost danger-text" data-del-item="${esc(it.item)}|${esc(it.unit)}|${esc(sec)}" title="Delete this line for all rigs">✕</button></td>` : ""}</tr>`).join(""); }).join("") || `<tr><td colspan="${3 + sel.length}" class="empty">No lines in this period.</td></tr>`}</tbody></table></div>
    ${App.canEdit ? `<form id="cAdd" class="card"><header><h3>Add a line to ${periodLabel(cur)}</h3></header><div class="form">
      <div class="field"><label>Rig</label><select name="rig_id">${rigs.map(r => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join("")}</select></div>
      <div class="field"><label>Section</label><input name="section" list="cSec" required><datalist id="cSec">${ORDER.map(s => `<option value="${s}">`).join("")}</datalist></div>
      <div class="field"><label>Item</label><input name="item" required></div><div class="field"><label>Unit</label><input name="unit" placeholder="m, rig-hr, each…"></div><div class="field"><label>Quantity</label><input name="qty" type="number" step="any" required></div>
      <div class="actions"><button class="btn primary sm">Add</button></div></div></form>` : ""}
    <div class="card"><header><h3>NQ coring metres per rig, last 6 periods</h3><label class="lyr"><input type="checkbox" id="cTable" ${state.table ? "checked" : ""}> table view</label></header>${state.table ? "" : `<div class="chartbox short"><canvas id="cChart"></canvas></div>`}<div id="cCmp"></div></div>`;

  $("#cPeriod").onchange = e => { state.period = e.target.value; render(); }; $("#cQ").oninput = e => { state.q = e.target.value; render(); };
  $$("[data-rig]", el).forEach(b => b.onclick = () => { const id = b.dataset.rig; state.rigs.has(id) ? state.rigs.delete(id) : state.rigs.add(id); render(); });
  $("#cCsv").onclick = () => { const csv = ["period_start,period_end,rig,section,item,unit,qty", ...rows.map(c => [c.period_start, c.period_end, c.rig_id, norm(c.section), c.item, c.unit, c.qty].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `consumables_${state.period}.csv`; a.click(); };
  $$("td.edit", el).forEach(td => td.onblur = async () => { const v = Number(td.textContent.replace(/,/g, "").trim()); if (isNaN(v)) return App.toast("Not a number"); try {
      if (td.dataset.id) await App.update("consumables", { id: td.dataset.id }, { qty: v });
      else if (td.textContent.trim() !== "") await App.insert("consumables", { period_start: cur.start, period_end: cur.end, rig_id: td.dataset.rig, section: td.dataset.sec, item: td.dataset.item, unit: td.dataset.unit, qty: v, source: "manual" });
      await App.reload(["consumables"]); } catch (e) { App.err(e); } });
  $$("[data-del-item]", el).forEach(b => b.onclick = async () => { const [item, unit, sec] = b.dataset.delItem.split("|"); if (!App.confirm(`Delete "${item}" for all rigs in this period?`)) return; try { for (const c of rows.filter(c => c.item === item && c.unit === unit && norm(c.section) === sec)) await App.remove("consumables", { id: c.id }); await App.reload(["consumables"]); } catch (e) { App.err(e); } });
  const f = $("#cAdd"); if (f) f.onsubmit = async e => { e.preventDefault(); const fd = new FormData(f); try { await App.insert("consumables", { period_start: cur.start, period_end: cur.end, rig_id: fd.get("rig_id"), section: fd.get("section"), item: fd.get("item"), unit: fd.get("unit") || "", qty: Number(fd.get("qty")), source: "manual" }); await App.reload(["consumables"]); } catch (x) { App.err(x); } };
  $("#cTable").onchange = e => { state.table = e.target.checked; render(); };
  // comparison
  const last6 = ps.slice(0, 6).reverse(), data = r => last6.map(p => App.data.consumables.filter(c => c.period_start === p.start && c.rig_id === r.id && /coring/i.test(c.item)).reduce((a, c) => a + Number(c.qty), 0));
  if (state.table) $("#cCmp").innerHTML = `<div class="tablewrap"><table><thead><tr><th>Period</th>${sel.map(r => `<th class="num">${esc(r.id)}</th>`).join("")}</tr></thead><tbody>${last6.map((p, i) => `<tr><td>${periodLabel(p)}</td>${sel.map(r => `<td class="num">${App.fmt.n(data(r)[i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  else { if (chart) chart.destroy(); chart = new Chart($("#cChart"), { type: "bar", data: { labels: last6.map(periodLabel), datasets: sel.map(r => ({ label: r.label, data: data(r), backgroundColor: r.color, borderRadius: 3, maxBarThickness: 26 })) }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: App.cssVar("--muted"), boxWidth: 10, usePointStyle: true } } }, scales: { x: { grid: { display: false }, ticks: { color: App.cssVar("--muted") } }, y: { grid: { color: App.cssVar("--grid") }, ticks: { color: App.cssVar("--muted") }, title: { display: true, text: "metres", color: App.cssVar("--muted") } } } } }); }
}
App.view("consumables", { render });
})();
