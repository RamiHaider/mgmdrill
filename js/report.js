/* Daily Drilling Report (layout per Dan, 12 Nov): date + production-through, programme KPIs, one table with a
   row per active rig (hole, metres, depth, objective, next target from the drill sequence) and a geology row
   under each, then RC / other sections and HSEC. Yellow fields are manual; the rest is computed. Print = PDF. */
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
function nextTarget(rigId){
  const n = App.rigNextHole(rigId);
  return n ? `${App.holeLabel(n)}${n.zone ? ` (${n.zone})` : ""}${n.objective ? ` — ${n.objective}` : ""}` : "";
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
      <span class="sep"></span><button class="btn sm" id="rPrint">Print / PDF</button><button class="btn sm" id="rCopy">Copy as text</button><button class="btn sm" id="rCopyHtml">Copy for email</button><button class="btn sm" id="rCopyPng">Copy as image</button>
    </div>
    ${!r ? `<div class="msg">No report saved for ${App.fmt.dl(state.date)}. The numbers below are computed anyway; create the report to add geology, RC, other notes and weather.</div>` : ""}
    <article class="report" id="rBody">
      <div class="rhead"><img src="assets/leaf.png" alt=""><div class="t"><b>MGM Daily Drilling Report</b><div>Report date ${App.fmt.dl(state.date)} · production through ${App.fmt.dl(through)}</div></div></div>
      <div class="kpis"><div class="kpi"><b>${App.fmt.n(App.seasonMetres(through))}</b><span>Programme m, current</span></div><div class="kpi"><b>${App.fmt.n(t.program_m)}</b><span>Programme target</span></div><div class="kpi"><b>${complete}</b><span>DDH complete</span></div><div class="kpi"><b>${rigs.length}</b><span>Active drills</span></div>
        <div class="kpi"><b style="color:${daily >= dailyTarget ? "var(--good)" : "inherit"}">${App.fmt.n(daily)}</b><span>Daily m, ${App.fmt.d(through)} (target ${App.fmt.n(dailyTarget)}, ${App.fmt.pct(daily / (dailyTarget || 1))})</span></div>
        <div class="kpi"><b>${App.fmt.n(week)}</b><span>Rolling 7 days (target ${App.fmt.n(dailyTarget * 7)}, ${App.fmt.pct(week / (dailyTarget * 7 || 1))})</span></div></div>
      <h3>Drilling highlights · active drills</h3>
      <div class="tablewrap"><table><thead><tr><th>Rig</th><th>Hole</th><th class="num">Daily m</th><th class="num">Target</th><th class="num">Depth</th><th class="num">Planned</th><th>Objective</th><th>Next target (from sequence)</th></tr></thead><tbody>
        ${rigs.map(x => { const h = rigHole(x.id, through), m = by[x.id]?.[through] || 0, d = rigDaily(x.id), nt = nextTarget(x.id); return `<tr><td><span class="chip sm" style="--c:${x.color}"><i></i>${esc(x.label)}</span></td><td><b>${esc(App.holeLabel(h))}</b>${h?.zone ? `<div class="small muted">${esc(h.zone)}</div>` : ""}</td><td class="num" style="color:${m >= (t.m_per_rig_day || 60) ? "var(--good)" : "inherit"}">${App.fmt.n(m)}</td><td class="num">${esc(t.m_per_rig_day || 60)}</td><td class="num">${App.fmt.n(App.holeDepth(h))}</td><td class="num">${App.fmt.n(h?.planned_depth)}</td><td class="wrap-text small">${esc(h?.objective || "")}</td><td class="wrap-text small">${nt ? esc(nt) : (r ? field("rig_daily", "next_target", d.next_target, { rig: x.id }) : "–")}</td></tr>
          <tr class="geo"><td colspan="8"><b>Geology</b>${r ? field("rig_daily", "geology", d.geology, { rig: x.id }) : (d.geology ? esc(d.geology) : "–")}${r && (App.canEdit || d.note) ? `<b style="margin-left:14px">Note</b>${field("rig_daily", "note", d.note, { rig: x.id })}` : ""}</td></tr>`; }).join("")}</tbody></table></div>
      ${mods.map(m => moduleHtml(m)).join("")}
      ${r && App.canEdit ? `<div class="row noprint"><select id="rAddMod" style="width:auto"><option value="">Add a section…</option><option value="rc">RC drilling</option><option value="other">Other</option><option value="custom">Custom</option></select></div>` : ""}
      <h3>HSEC · General · Logistics</h3>
      <div class="rig"><div class="f full"><b>Weather</b>${r ? field("daily_reports", "weather", r.weather) : "–"}</div><div class="f full"><b>HSEC</b>${r ? field("daily_reports", "hsec", r.hsec) : "–"}</div></div>
      <div class="foot">Report date covers the preceding day. Next target comes from the drill sequence (Holes → Order); yellow fields are manual entries, everything else is computed from the timesheet and hole register.${r?.updated_by ? ` Last edited by ${esc(r.updated_by.split("@")[0])} ${App.fmt.dt(r.updated_at)}.` : ""}</div>
    </article>`;
  $("#rPrev").onclick = () => { state.date = App.addDays(state.date, -1); render(); }; $("#rNext").onclick = () => { state.date = App.addDays(state.date, 1); render(); };
  $("#rDate").onchange = e => { state.date = e.target.value; render(); }; $("#rPick").onchange = e => { if (e.target.value) { state.date = e.target.value; render(); } };
  $("#rPrint").onclick = () => window.print();
  $("#rCopy").onclick = () => navigator.clipboard.writeText(asText()).then(() => App.toast("Copied as text")).catch(App.err);
  $("#rCopyHtml").onclick = () => { const html = $("#rBody").outerHTML.replace(/contenteditable="plaintext-only"/g, ""); const item = new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([asText()], { type: "text/plain" }) }); navigator.clipboard.write([item]).then(() => App.toast("Copied, paste into Outlook")).catch(App.err); };
  $("#rCopyPng").onclick = () => copyPng($("#rCopyPng"));
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
  const dailyTarget = rigs.length * (Number(t.m_per_rig_day) || 60), daily = rigs.reduce((a, x) => a + (by[x.id]?.[through] || 0), 0), week = App.rangeMetres(App.addDays(through, -6), through);
  const L = [`MGM DAILY DRILLING REPORT`, `Report date: ${App.fmt.dl(state.date)}   Production through: ${App.fmt.dl(through)}`,
    `Programme m: ${App.fmt.n(App.seasonMetres(through))} / ${App.fmt.n(t.program_m)}   DDH complete: ${App.projectHoles().filter(h => h.status === "Complete").length}   Active drills: ${rigs.length}`,
    `Daily: ${App.fmt.n(daily)} / ${App.fmt.n(dailyTarget)} m (${App.fmt.pct(daily / (dailyTarget || 1))})   Rolling 7 days: ${App.fmt.n(week)} / ${App.fmt.n(dailyTarget * 7)} m (${App.fmt.pct(week / (dailyTarget * 7 || 1))})`, "", "DRILLING HIGHLIGHTS - ACTIVE DRILLS"];
  for (const x of rigs) { const h = rigHole(x.id, through), d = rigDaily(x.id); L.push(`${x.label} | ${App.holeLabel(h)}${h?.zone ? ` (${h.zone})` : ""}`, `  Daily metres: ${App.fmt.n(by[x.id]?.[through] || 0)}   Current depth: ${App.fmt.n(App.holeDepth(h))}   Planned depth: ${App.fmt.n(h?.planned_depth)}`, `  Objective: ${h?.objective || "-"}`, `  Next target: ${nextTarget(x.id) || d.next_target || "-"}`, `  Geology: ${d.geology || "-"}`, d.note ? `  Note: ${d.note}` : "", ""); }
  for (const m of App.data.modules.filter(m => m.report_date === state.date)) { L.push(m.title.toUpperCase()); if (m.kind === "rc") L.push(`  Holes last 24 h: ${m.data.holes_24h}   Total holes: ${m.data.total_holes}   Total metres: ${m.data.total_m}   Samples: ${m.data.samples}`); for (const l of (m.data.notes || m.data.lines || [])) L.push(`  - ${l}`); L.push(""); }
  if (r) L.push("HSEC - GENERAL - LOGISTICS", `  Weather: ${r.weather || "-"}`, r.hsec ? `  HSEC: ${r.hsec}` : "");
  return L.filter(l => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}
App.view("report", { render });
})();

// Snapshot the report as a PNG and put it on the clipboard (falls back to a download where the browser cannot write images).
async function copyPng(btn){
  if (typeof html2canvas !== "function") return App.toast("Image tool did not load, refresh the page");
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Rendering…";
  try {
    const canvas = await html2canvas($("#rBody"), { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
      onclone: doc => { doc.documentElement.setAttribute("data-theme", "light"); const b = doc.getElementById("rBody"); b.classList.add("snap"); b.querySelectorAll(".noprint").forEach(x => x.remove());
        const dots = $("#rBody").querySelectorAll(".chip i"); b.querySelectorAll(".chip i").forEach((d, i) => { d.style.background = getComputedStyle(dots[i]).backgroundColor; }); } });
    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    const name = `MGM_Daily_Report_${state.date}.png`;
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      App.toast("Image copied, paste it into your email");
    } else {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      App.toast("Image downloaded (this browser cannot copy images)");
    }
  } catch (e) { App.err(e); } finally { btn.disabled = false; btn.textContent = label; }
}
