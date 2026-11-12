/* Daily Drilling Report: the workbook's report sheet as an editable page. Yellow fields are manual;
   everything else is computed from the timesheet and the hole register. Print = PDF. */
(() => {
"use strict";
const { $, $$, esc } = App;
const state = { date: null };

function report(){ return App.data.reports.find(r => r.report_date === state.date); }
function rigDaily(rig){ return App.data.rigDaily.find(x => x.report_date === state.date && x.rig_id === rig) || { geology: "", next_target: "", note: "" }; }
function rigHole(rig, through){
  const s = App.data.shifts.filter(x => x.rig_id === rig && x.shift_date === through && x.hole_name).sort((a, b) => a.shift === "night" ? -1 : 1)[0];
  return (s && App.holeByName(s.hole_name)) || App.rigCurrentHole(rig);
}
function field(table, key, val, opts = {}){ // editable inline text
  return App.canEdit ? `<div class="edit-field" contenteditable="plaintext-only" data-t="${table}" data-k="${key}" ${Object.entries(opts).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}>${esc(val || "")}</div>` : `<div>${esc(val || "") || "–"}</div>`;
}

function render(){
  const el = $("#view-report");
  if (!state.date) state.date = App.data.reports.find(r => r.report_date === App.today())?.report_date || App.data.reports[0]?.report_date || App.today();
  const r = report(), rigs = App.activeRigs(), t = App.targets(), through = r?.production_through || App.addDays(state.date, -1), by = App.dailyByRig();
  const dailyTarget = rigs.length * (Number(t.m_per_rig_day) || 60), daily = rigs.reduce((a, x) => a + (by[x.id]?.[through] || 0), 0), week = App.rangeMetres(App.addDays(through, -6), through);
  const complete = App.projectHoles().filter(h => h.status === "Complete").length, mods = App.data.modules.filter(m => m.report_date === state.date).sort((a, b) => a.sort - b.sort);
  el.innerHTML = `
    <div class="pagehead"><h2>Daily report</h2>
      <div class="row"><button class="btn sm" id="rPrev">‹</button><input type="date" id="rDate" value="${esc(state.date)}" style="width:auto"><button class="btn sm" id="rNext">›</button></div>
      <select id="rPick" style="width:auto"><option value="">Saved reports…</option>${App.data.reports.slice(0, 60).map(x => `<option value="${x.report_date}">${App.fmt.dl(x.report_date)}</option>`).join("")}</select>
      ${!r && App.canEdit ? `<button class="btn primary sm" id="rNew">Create report for ${App.fmt.d(state.date)}</button>` : ""}
      <span class="sep"></span><button class="btn sm" id="rPrint">Print / PDF</button><button class="btn sm" id="rCopy">Copy as text</button><button class="btn sm" id="rCopyHtml">Copy for email</button>
    </div>
    ${!r ? `<div class="msg">No report saved for ${App.fmt.dl(state.date)}. The numbers below are computed anyway; create the report to add geology, RC, other notes and weather.</div>` : ""}
    <article class="report" id="rBody">
      <div class="rhead"><img src="assets/leaf.png" alt=""><div class="t"><b>MGM · Daily Drilling Report</b><div>${esc(App.data.projects.find(p => p.id === App.project)?.name || "")} project</div></div></div>
      <dl class="meta">
        <dt>Report date</dt><dd>${App.fmt.dl(state.date)}</dd><dt>Production through</dt><dd>${App.fmt.dl(through)}</dd>
        <dt>To</dt><dd>${r ? field("daily_reports", "to_line", r.to_line) : "–"}</dd><dt>From</dt><dd>${r ? field("daily_reports", "from_line", r.from_line) : "–"}</dd><dt>Re</dt><dd>${r ? field("daily_reports", "re_line", r.re_line) : "–"}</dd>
      </dl>
      <div class="tablewrap"><table><thead><tr><th>Rig</th><th>Hole</th><th class="num">Daily m</th><th class="num">Target</th><th class="num">Depth</th><th class="num">Hole target</th><th>Objective</th><th>Next target</th></tr></thead><tbody>
        ${rigs.map(x => { const h = rigHole(x.id, through), m = by[x.id]?.[through] || 0; return `<tr><td><span class="chip sm" style="--c:${x.color}"><i></i>${esc(x.label)}</span></td><td><b>${esc(App.holeLabel(h))}</b></td><td class="num" style="color:${m >= (t.m_per_rig_day || 60) ? "var(--good)" : "inherit"}">${App.fmt.n(m)}</td><td class="num">${esc(t.m_per_rig_day || 60)}</td><td class="num">${App.fmt.n(App.holeDepth(h))}</td><td class="num">${App.fmt.n(h?.planned_depth)}</td><td class="wrap-text small">${esc(h?.objective || "")}</td><td class="wrap-text small">${r ? field("rig_daily", "next_target", rigDaily(x.id).next_target, { rig: x.id }) : "–"}</td></tr>`; }).join("")}</tbody></table></div>
      <h3>Drilling highlights</h3>
      <div class="kpis"><div class="kpi"><b>${rigs.length}</b><span>Active drills</span></div><div class="kpi"><b>${App.fmt.n(App.seasonMetres(through))}</b><span>Programme m, current</span></div><div class="kpi"><b>${App.fmt.n(t.program_m)}</b><span>Programme target</span></div><div class="kpi"><b>${complete}</b><span>DDH complete</span></div></div>
      <div class="tablewrap"><table><thead><tr><th>Production</th><th class="num">Actual (m)</th><th class="num">Target (m)</th><th class="num">Achieved</th></tr></thead><tbody>
        <tr><td>Daily, ${App.fmt.d(through)}</td><td class="num">${App.fmt.n(daily)}</td><td class="num">${App.fmt.n(dailyTarget)}</td><td class="num">${App.fmt.pct(daily / (dailyTarget || 1))}</td></tr>
        <tr><td>Rolling seven days through ${App.fmt.d(through)}</td><td class="num">${App.fmt.n(week)}</td><td class="num">${App.fmt.n(dailyTarget * 7)}</td><td class="num">${App.fmt.pct(week / (dailyTarget * 7 || 1))}</td></tr></tbody></table></div>
      <h3>Hole-by-hole operations</h3>
      ${rigs.map(x => { const h = rigHole(x.id, through), d = rigDaily(x.id); return `<div class="rig"><div class="ttl"><i style="background:${x.color}"></i>${esc(x.label)} | ${esc(App.holeLabel(h))}</div>
        <div class="f full"><b>Objective</b>${esc(h?.objective || "–")}</div>
        <div class="f"><b>Daily metres</b>${App.fmt.n(by[x.id]?.[through] || 0)}</div><div class="f"><b>Current depth</b>${App.fmt.m(App.holeDepth(h))}</div><div class="f"><b>Planned depth</b>${App.fmt.m(h?.planned_depth)}</div>
        <div class="f full"><b>Geology</b>${r ? field("rig_daily", "geology", d.geology, { rig: x.id }) : "–"}</div>
        <div class="f full"><b>Next target</b>${r ? field("rig_daily", "next_target", d.next_target, { rig: x.id }) : "–"}</div>
        ${r && (App.canEdit || d.note) ? `<div class="f full"><b>Note</b>${field("rig_daily", "note", d.note, { rig: x.id })}</div>` : ""}</div>`; }).join("")}
      ${mods.map(m => moduleHtml(m)).join("")}
      ${r && App.canEdit ? `<div class="row noprint"><select id="rAddMod" style="width:auto"><option value="">Add a section…</option><option value="rc">RC drilling</option><option value="other">Other</option><option value="custom">Custom</option></select></div>` : ""}
      <h3>HSEC · General · Logistics</h3>
      <div class="rig"><div class="f full"><b>Weather</b>${r ? field("daily_reports", "weather", r.weather) : "–"}</div><div class="f full"><b>HSEC</b>${r ? field("daily_reports", "hsec", r.hsec) : "–"}</div></div>
      <div class="foot">Report date covers the preceding day. Yellow fields are manual entries, everything else is computed from the timesheet and hole register.${r?.updated_by ? ` Last edited by ${esc(r.updated_by.split("@")[0])} ${App.fmt.dt(r.updated_at)}.` : ""}</div>
    </article>`;
  $("#rPrev").onclick = () => { state.date = App.addDays(state.date, -1); render(); }; $("#rNext").onclick = () => { state.date = App.addDays(state.date, 1); render(); };
  $("#rDate").onchange = e => { state.date = e.target.value; render(); }; $("#rPick").onchange = e => { if (e.target.value) { state.date = e.target.value; render(); } };
  $("#rPrint").onclick = () => window.print();
  $("#rCopy").onclick = () => navigator.clipboard.writeText(asText()).then(() => App.toast("Copied as text")).catch(App.err);
  $("#rCopyHtml").onclick = () => { const html = $("#rBody").outerHTML.replace(/contenteditable="plaintext-only"/g, ""); const item = new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([asText()], { type: "text/plain" }) }); navigator.clipboard.write([item]).then(() => App.toast("Copied, paste into Outlook")).catch(App.err); };
  const nw = $("#rNew"); if (nw) nw.onclick = async () => { try {
    const prev = App.data.reports.find(x => x.report_date < state.date); const prevDaily = App.data.rigDaily.filter(x => x.report_date === prev?.report_date);
    await App.insert("daily_reports", { report_date: state.date, production_through: App.addDays(state.date, -1), to_line: prev?.to_line ?? undefined, from_line: prev?.from_line ?? undefined });
    for (const x of rigs) { const p = prevDaily.find(y => y.rig_id === x.id); await App.save("rig_daily", { report_date: state.date, rig_id: x.id, next_target: p?.next_target || "" }, { onConflict: "report_date,rig_id" }); }
    await App.reload(["reports", "rigDaily"]); } catch (e) { App.err(e); } };
  const am = $("#rAddMod"); if (am) am.onchange = async () => { const kind = am.value; if (!kind) return; try { await App.insert("report_modules", { report_date: state.date, kind, title: { rc: "RC drilling", other: "Other", custom: "Section" }[kind], data: kind === "rc" ? { holes_24h: 0, total_holes: 0, total_m: 0, samples: 0, notes: [] } : { lines: [] }, sort: mods.length + 1 }); await App.reload(["modules"]); } catch (e) { App.err(e); } };
  $$(".edit-field", el).forEach(f => f.onblur = () => saveField(f));
  $$("[data-mod-del]", el).forEach(b => b.onclick = async () => { if (!App.confirm("Remove this section?")) return; try { await App.remove("report_modules", { id: b.dataset.modDel }); await App.reload(["modules"]); } catch (e) { App.err(e); } });
  $$("[data-mod-line-add]", el).forEach(b => b.onclick = async () => { const m = App.data.modules.find(x => x.id === b.dataset.modLineAdd); const data = { ...m.data, [m.kind === "rc" ? "notes" : "lines"]: [...(m.data[m.kind === "rc" ? "notes" : "lines"] || []), ""] }; try { await App.update("report_modules", { id: m.id }, { data }); await App.reload(["modules"]); } catch (e) { App.err(e); } });
  $$("[data-mod-line-del]", el).forEach(b => b.onclick = async () => { const [id, i] = b.dataset.modLineDel.split(":"); const m = App.data.modules.find(x => x.id === id); const k = m.kind === "rc" ? "notes" : "lines"; const arr = (m.data[k] || []).slice(); arr.splice(Number(i), 1); try { await App.update("report_modules", { id }, { data: { ...m.data, [k]: arr } }); await App.reload(["modules"]); } catch (e) { App.err(e); } });
}
function moduleHtml(m){
  const del = App.canEdit ? `<button class="btn xs ghost danger-text noprint" data-mod-del="${m.id}">remove</button>` : "";
  const title = App.canEdit ? `<h3 class="edit-field" contenteditable="plaintext-only" data-t="report_modules" data-k="title" data-id="${m.id}" style="flex:1">${esc(m.title)}</h3>` : `<h3 style="flex:1">${esc(m.title)}</h3>`;
  const k = m.kind === "rc" ? "notes" : "lines", lines = m.data[k] || [];
  const list = `${lines.map((l, i) => `<div class="row"><div class="grow">${App.canEdit ? `<div class="edit-field" contenteditable="plaintext-only" data-t="report_modules" data-k="${k}" data-id="${m.id}" data-i="${i}">${esc(l)}</div>` : `<div>${esc(l)}</div>`}</div>${App.canEdit ? `<button class="btn xs ghost noprint" data-mod-line-del="${m.id}:${i}">✕</button>` : ""}</div>`).join("")}${App.canEdit ? `<button class="btn xs noprint" data-mod-line-add="${m.id}">+ line</button>` : ""}`;
  if (m.kind === "rc") return `<div class="modhd">${title}${del}</div><div class="kpis">${[["holes_24h", "Holes, last 24 h"], ["total_holes", "Total holes"], ["total_m", "Total metres"], ["samples", "Samples"]].map(([key, l]) => `<div class="kpi">${App.canEdit ? `<b class="edit-field" contenteditable="plaintext-only" data-t="report_modules" data-k="${key}" data-id="${m.id}" data-num="1">${esc(m.data[key] ?? 0)}</b>` : `<b>${App.fmt.n(m.data[key])}</b>`}<span>${l}</span></div>`).join("")}</div><div class="list">${list}</div>`;
  return `<div class="modhd">${title}${del}</div><div class="list">${list}</div>`;
}
async function saveField(f){
  const { t, k, rig, id, i, num } = f.dataset; const v = f.textContent.trim();
  try {
    if (t === "daily_reports") await App.update("daily_reports", { report_date: state.date }, { [k]: v });
    else if (t === "rig_daily") await App.save("rig_daily", { report_date: state.date, rig_id: rig, ...rigDaily(rig), [k]: v }, { onConflict: "report_date,rig_id" });
    else if (t === "report_modules") { const m = App.data.modules.find(x => x.id === id); if (k === "title") await App.update("report_modules", { id }, { title: v });
      else if (i != null) { const arr = (m.data[k] || []).slice(); arr[Number(i)] = v; await App.update("report_modules", { id }, { data: { ...m.data, [k]: arr } }); }
      else await App.update("report_modules", { id }, { data: { ...m.data, [k]: num ? Number(v) || 0 : v } }); }
  } catch (e) { App.err(e); }
}
function asText(){
  const r = report(), rigs = App.activeRigs(), t = App.targets(), through = r?.production_through || App.addDays(state.date, -1), by = App.dailyByRig();
  const L = [`MGM | DAILY DRILLING REPORT`, `Report date: ${App.fmt.dl(state.date)}`, `Production through: ${App.fmt.dl(through)}`, r ? `To: ${r.to_line}` : "", r ? `From: ${r.from_line}` : "", r ? `Re: ${r.re_line}` : "", ""];
  const dailyTarget = rigs.length * (Number(t.m_per_rig_day) || 60), daily = rigs.reduce((a, x) => a + (by[x.id]?.[through] || 0), 0), week = App.rangeMetres(App.addDays(through, -6), through);
  L.push("DRILLING HIGHLIGHTS", `Active drills: ${rigs.length}   Programme m: ${App.fmt.n(App.seasonMetres(through))} / ${App.fmt.n(t.program_m)}   DDH complete: ${App.projectHoles().filter(h => h.status === "Complete").length}`,
    `Daily: ${App.fmt.n(daily)} / ${App.fmt.n(dailyTarget)} m (${App.fmt.pct(daily / (dailyTarget || 1))})   Rolling 7 days: ${App.fmt.n(week)} / ${App.fmt.n(dailyTarget * 7)} m (${App.fmt.pct(week / (dailyTarget * 7 || 1))})`, "", "HOLE-BY-HOLE OPERATIONS");
  for (const x of rigs) { const h = rigHole(x.id, through), d = rigDaily(x.id); L.push(`${x.label} | ${App.holeLabel(h)}`, `  Objective: ${h?.objective || "-"}`, `  Daily metres: ${App.fmt.n(by[x.id]?.[through] || 0)}   Current depth: ${App.fmt.n(App.holeDepth(h))}   Planned depth: ${App.fmt.n(h?.planned_depth)}`, `  Geology: ${d.geology || "-"}`, `  Next target: ${d.next_target || "-"}`, d.note ? `  Note: ${d.note}` : "", ""); }
  for (const m of App.data.modules.filter(m => m.report_date === state.date)) { L.push(m.title.toUpperCase()); if (m.kind === "rc") L.push(`  Holes last 24 h: ${m.data.holes_24h}   Total holes: ${m.data.total_holes}   Total metres: ${m.data.total_m}   Samples: ${m.data.samples}`); for (const l of (m.data.notes || m.data.lines || [])) L.push(`  - ${l}`); L.push(""); }
  if (r) L.push("HSEC - GENERAL - LOGISTICS", `  Weather: ${r.weather || "-"}`, r.hsec ? `  HSEC: ${r.hsec}` : "");
  return L.filter(l => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}
App.view("report", { render });
})();
