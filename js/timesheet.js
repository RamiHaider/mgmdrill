/* Timesheet view: one row group per date (day shift, night shift, daily total), one 5-column
   group per selected rig (Hole, Start, End, Total, Comment).
   Editing never updates a row: every change INSERTs a new shift_entries row with source 'manual'
   and the shift_current view picks the winner (contractor rjll/spektra beats manual, then newest).
   Contractor cells are read-only. A date row covers that calendar date's day + night shifts. */
(() => {
"use strict";
const LS_RIGS = "mgmdrill.ts.rigs";
const CONTRACTOR = new Set(["rjll", "spektra"]);
const PRESETS = [["7", "Last 7 days"], ["14", "Last 14 days"], ["month", "This month"], ["lastmonth", "Last month"], ["season", "Season"]];
const st = { preset: "7", from: null, to: null, showForm: false, fv: {}, totalTouched: false, editing: false, dirty: false };
let idx = new Map(), prevOf = new Map();

const esc = s => App.esc(s);
const key = (r, d, s) => `${r}|${d}|${s}`;
const num = v => (v == null || v === "" || isNaN(v)) ? "" : Number(v).toLocaleString("en-CA", { maximumFractionDigits: 1 });
const parseNum = v => { const s = String(v ?? "").trim().replace(",", "."); if (s === "") return null; const n = Number(s); return isNaN(n) ? null : n; };
const round2 = n => Math.round(n * 100) / 100;
const sameHole = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase();

function loadRigSel(){ try { const v = JSON.parse(localStorage.getItem(LS_RIGS)); return Array.isArray(v) ? v : null; } catch { return null; } }
function saveRigSel(ids){ try { localStorage.setItem(LS_RIGS, JSON.stringify(ids)); } catch { /* storage blocked */ } }
function selectedRigs(){ const sel = loadRigSel(), rigs = App.activeRigs(); return sel ? rigs.filter(r => sel.includes(r.id)) : rigs; }

function range(){
  const t = App.today();
  let a, b;
  if (st.preset === "custom" && st.from && st.to) { a = st.from; b = st.to; }
  else if (st.preset === "14") { a = App.addDays(t, -13); b = t; }
  else if (st.preset === "month") { a = t.slice(0, 8) + "01"; b = t; }
  else if (st.preset === "lastmonth") { b = App.addDays(t.slice(0, 8) + "01", -1); a = b.slice(0, 8) + "01"; }
  else if (st.preset === "season") { a = App.seasonStart(); b = t; }
  else { a = App.addDays(t, -6); b = t; }
  return a <= b ? [a, b] : [b, a];
}
function datesDesc(from, to){ const out = []; for (let d = to; d >= from; d = App.addDays(d, -1)) out.push(d); return out; }

/* index current shift rows and, per rig, the previous shift row (for the depth check) */
function buildIndex(){
  idx = new Map(); prevOf = new Map();
  const byRig = {};
  for (const s of App.data.shifts) { idx.set(key(s.rig_id, s.shift_date, s.shift), s); (byRig[s.rig_id] ||= []).push(s); }
  const ord = s => s.shift_date + (s.shift === "night" ? "b" : "a");
  for (const list of Object.values(byRig)) {
    list.sort((a, b) => ord(a).localeCompare(ord(b)));
    for (let i = 1; i < list.length; i++) prevOf.set(key(list[i].rig_id, list[i].shift_date, list[i].shift), list[i - 1]);
  }
}

const cell = (cls, attrs, html) => `<td${cls.length ? ` class="${cls.join(" ")}"` : ""}${attrs}>${html}</td>`;

function shiftCells(rig, date, shift){
  const r = idx.get(key(rig.id, date, shift));
  const locked = !!r && CONTRACTOR.has(r.source);
  const ed = App.canEdit && !locked;
  const srcT = r ? `source: ${r.source}` : "";
  const data = f => ed ? ` data-r="${esc(rig.id)}" data-d="${date}" data-s="${shift}" data-f="${f}"` : "";
  const ttl = t => t ? ` title="${esc(t)}"` : "";
  const base = f => ed ? ["edit"] : [];
  let h = "";
  // Hole
  h += cell([...base(), "hole"], data("hole_name") + ttl(r?.hole_name ? srcT : ""), r ? `${esc(r.hole_name || "")}${locked ? " " + App.src(r.source) : ""}` : "");
  // Start (with depth-continuity check against the previous shift on the same hole)
  const p = prevOf.get(key(rig.id, date, shift));
  const gap = r && p && r.start_m != null && p.end_m != null && sameHole(r.hole_name, p.hole_name) && Math.abs(Number(r.start_m) - Number(p.end_m)) > 0.05;
  const sTitle = gap ? `Gap vs previous shift (previous end ${num(p.end_m)} m) · ${srcT}` : (r?.start_m != null ? srcT : "");
  h += cell([...base(), "num"], data("start_m") + ttl(sTitle) + (gap ? ` style="color:var(--warn);font-weight:700"` : ""), r ? num(r.start_m) : "");
  h += cell([...base(), "num"], data("end_m") + ttl(r?.end_m != null ? srcT : ""), r ? num(r.end_m) : "");
  // Total
  const tot = r ? App.shiftTotal(r) : null;
  const tc = [...base(), "num"]; if (r && tot === 0) tc.push("zero"); if (tot < 0) tc.push("neg");
  h += cell(tc, data("total_m") + ttl(r ? srcT : ""), r ? num(tot) : "");
  // Comment + discussion indicator + drawer button
  const n = App.commentsForShift(rig.id, date, shift).length;
  const txt = r?.comment || "";
  const short = txt.length > 40 ? txt.slice(0, 40) + "…" : txt;
  h += cell([...base(), "sub"], data("comment") + ttl(txt ? `${txt}\n${srcT}` : ""),
    `<span class="row" style="gap:4px;flex-wrap:nowrap"><span>${esc(short)}</span>${n ? `<span title="${n} comment${n > 1 ? "s" : ""}">💬</span>` : ""}<button class="btn xs ghost" data-open="${esc(rig.id)}|${date}|${shift}" title="Shift comments">…</button></span>`);
  return h;
}

function formHtml(){
  const rigs = App.activeRigs(), v = st.fv;
  const f = (k, label, input) => `<div class="field"><label for="tsf_${k}">${label}</label>${input}</div>`;
  return `<div class="card" id="tsForm"><header><h3>Add shift entry</h3><button class="btn xs ghost" id="tsfClose">Close</button></header>
    <form class="form" id="tsfForm">
      ${f("rig", "Rig", `<select id="tsf_rig" data-k="rig" required>${rigs.map(r => `<option value="${esc(r.id)}"${v.rig === r.id ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select>`)}
      ${f("date", "Date", `<input id="tsf_date" data-k="date" type="date" required value="${esc(v.date || App.today())}">`)}
      ${f("shift", "Shift", `<select id="tsf_shift" data-k="shift"><option value="day">Day</option><option value="night"${v.shift === "night" ? " selected" : ""}>Night</option></select>`)}
      ${f("hole", "Hole", `<input id="tsf_hole" data-k="hole" list="tsHoles" autocomplete="off" value="${esc(v.hole || "")}">`)}
      ${f("start", "Start (m)", `<input id="tsf_start" data-k="start" inputmode="decimal" value="${esc(v.start || "")}">`)}
      ${f("end", "End (m)", `<input id="tsf_end" data-k="end" inputmode="decimal" value="${esc(v.end || "")}">`)}
      ${f("total", "Total (m)", `<input id="tsf_total" data-k="total" inputmode="decimal" value="${esc(v.total || "")}">`)}
      <div class="field full"><label for="tsf_comment">Comment</label><input id="tsf_comment" data-k="comment" maxlength="2000" value="${esc(v.comment || "")}"></div>
      <div class="actions full"><button class="btn primary sm" type="submit">Save entry</button><span class="note">Saved as a manual entry. Contractor data for the same shift takes precedence.</span></div>
    </form></div>`;
}

function render(){
  if (st.editing) { st.dirty = true; return; }
  st.dirty = false;
  const el = App.$("#view-timesheet");
  buildIndex();
  const [from, to] = range();
  const dates = datesDesc(from, to);
  const allRigs = App.activeRigs(), rigs = selectedRigs();
  const by = App.dailyByRig();
  const dayTot = d => rigs.reduce((a, r) => a + (by[r.id]?.[d] || 0), 0);

  // tiles
  const totals = dates.map(d => [d, dayTot(d)]);
  const winTotal = totals.reduce((a, [, m]) => a + m, 0);
  const best = totals.reduce((b, x) => (!b || x[1] > b[1]) ? x : b, null);
  const zeroDays = totals.filter(([d, m]) => m === 0 && d <= App.today()).length;
  const tiles = `<div class="tiles">
    <div class="tile"><span class="l">Window total</span><span class="v">${App.fmt.n(winTotal)} <small>m</small></span><span class="l">${App.fmt.d(from)} – ${App.fmt.d(to)} · ${dates.length} days</span></div>
    <div class="tile"><span class="l">Average per day</span><span class="v">${App.fmt.n(dates.length ? winTotal / dates.length : 0, 1)} <small>m/day</small></span><span class="l">${rigs.length} rig${rigs.length === 1 ? "" : "s"} selected</span></div>
    <div class="tile"><span class="l">Best day</span><span class="v">${best && best[1] > 0 ? App.fmt.n(best[1]) : "–"} <small>m</small></span><span class="l">${best && best[1] > 0 ? App.fmt.dl(best[0]) : "No production"}</span></div>
    <div class="tile"><span class="l">Days with zero production</span><span class="v">${zeroDays}</span><span class="l">of ${dates.length} days in window</span></div>
  </div>`;

  // grid
  const head1 = `<tr><th rowspan="2" class="sticky-col">Date</th><th rowspan="2">Shift</th>${rigs.map(r => `<th colspan="5" style="color:${esc(r.color)};border-bottom:2px solid ${esc(r.color)}">${esc(r.label)}</th>`).join("")}</tr>`;
  const head2 = `<tr>${rigs.map(() => ["Hole", "Start", "End", "Total", "Comment"].map(l => `<th style="top:29px"${l === "Start" || l === "End" || l === "Total" ? ' class="num"' : ""}>${l}</th>`).join("")).join("")}</tr>`;
  const body = dates.map(d => {
    const day = `<tr><td rowspan="3" class="sticky-col"><b>${App.fmt.d(d)}</b><div class="note">${App.parseDate(d).toLocaleDateString("en-CA", { weekday: "short" })}</div></td><td class="sub">Day</td>${rigs.map(r => shiftCells(r, d, "day")).join("")}</tr>`;
    const night = `<tr class="night"><td class="sub">Night</td>${rigs.map(r => shiftCells(r, d, "night")).join("")}</tr>`;
    const tot = `<tr class="daytotal"><td>Total ${App.fmt.n(dayTot(d))} m</td>${rigs.map(r => { const m = by[r.id]?.[d] || 0; return `<td colspan="3"></td><td class="num${m === 0 ? " zero" : ""}${m < 0 ? " neg" : ""}">${num(m)}</td><td></td>`; }).join("")}</tr>`;
    return day + night + tot;
  }).join("");
  const foot = `<tfoot><tr><td colspan="2" class="sticky-col">Window total ${App.fmt.n(winTotal)} m</td>${rigs.map(r => `<td colspan="3"></td><td class="num">${num(App.rangeMetres(from, to, r.id))}</td><td></td>`).join("")}</tr></tfoot>`;
  const holeNames = App.projectHoles().map(h => h.ddh_name).filter(Boolean);

  el.innerHTML = `
    <div class="pagehead"><h2>Timesheet</h2>${App.canEdit ? `<button class="btn primary sm" id="tsAdd">Add shift entry</button>` : ""}</div>
    <div class="toolbar">
      <div class="seg" id="tsPreset">${PRESETS.map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${st.preset === k}">${l}</button>`).join("")}</div>
      <input type="date" id="tsFrom" value="${from}" style="width:auto" aria-label="From"><span class="muted">to</span><input type="date" id="tsTo" value="${to}" style="width:auto" aria-label="To">
      <span class="sep"></span>
      <div class="chips" id="tsRigs">${allRigs.map(r => `<button type="button" class="chip toggle" style="--c:${esc(r.color)}" data-rig="${esc(r.id)}" aria-pressed="${rigs.includes(r)}"><i></i>${esc(r.label)}</button>`).join("")}</div>
    </div>
    ${st.showForm && App.canEdit ? formHtml() : ""}
    ${tiles}
    ${App.canEdit ? `<p class="note">Click a highlighted cell to edit; Enter or click away saves, Escape cancels. Cells marked ${App.src("rjll")} or ${App.src("spektra")} come from contractor reports and override manual entry, so they are read-only. Start depths in <span style="color:var(--warn);font-weight:700">amber</span> do not match the previous shift's end depth.</p>` : ""}
    ${rigs.length ? `<div class="tablewrap"><table class="ts"><thead>${head1}${head2}</thead><tbody>${body}</tbody>${foot}</table></div>` : `<div class="empty">No rigs selected.</div>`}
    <datalist id="tsHoles">${holeNames.map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
  wire(el);
}

function wire(el){
  App.$$("#tsPreset button", el).forEach(b => b.onclick = () => { st.preset = b.dataset.p; render(); });
  const fr = App.$("#tsFrom", el), tt = App.$("#tsTo", el);
  fr.onchange = tt.onchange = () => { if (!fr.value || !tt.value) return; st.preset = "custom"; st.from = fr.value; st.to = tt.value; render(); };
  App.$$("#tsRigs [data-rig]", el).forEach(b => b.onclick = () => {
    const cur = selectedRigs().map(r => r.id), id = b.dataset.rig;
    saveRigSel(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]); render();
  });
  const add = App.$("#tsAdd", el); if (add) add.onclick = () => { st.showForm = !st.showForm; render(); };
  App.$$("[data-open]", el).forEach(b => b.onclick = e => { e.stopPropagation(); const [r, d, s] = b.dataset.open.split("|"); App.openShift(r, d, s); });
  App.$$("td.edit", el).forEach(td => td.onclick = () => startEdit(td));
  wireForm(el);
}

function wireForm(el){
  const form = App.$("#tsfForm", el); if (!form) return;
  App.$("#tsfClose", el).onclick = () => { st.showForm = false; st.fv = {}; st.totalTouched = false; render(); };
  const g = k => App.$("#tsf_" + k, el);
  const autoTotal = () => { const s = parseNum(g("start").value), e = parseNum(g("end").value); if (!st.totalTouched && s != null && e != null) { g("total").value = String(round2(e - s)); st.fv.total = g("total").value; } };
  App.$$("[data-k]", form).forEach(i => i.oninput = i.onchange = () => {
    st.fv[i.dataset.k] = i.value;
    if (i.dataset.k === "total") st.totalTouched = i.value.trim() !== "";
    if (i.dataset.k === "start" || i.dataset.k === "end") autoTotal();
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const hole = g("hole").value.trim();
    const row = { rig_id: g("rig").value, shift_date: g("date").value, shift: g("shift").value, hole_name: hole || null, hole_id: App.holeByName(hole)?.id || null,
      start_m: parseNum(g("start").value), end_m: parseNum(g("end").value), total_m: parseNum(g("total").value), comment: g("comment").value.trim(), source: "manual" };
    if (!row.rig_id || !row.shift_date) return App.toast("Rig and date are required");
    if (row.total_m == null && row.start_m != null && row.end_m != null) row.total_m = round2(row.end_m - row.start_m);
    const cur = idx.get(key(row.rig_id, row.shift_date, row.shift));
    if (cur && CONTRACTOR.has(cur.source)) App.toast(`Note: ${cur.source.toUpperCase()} data exists for this shift and will still show`);
    try { await App.insert("shift_entries", row); st.showForm = false; st.fv = {}; st.totalTouched = false; App.toast("Shift entry saved"); await App.reload(["shifts"]); } catch (x) { App.err(x); }
  };
}

/* inline cell editing: one cell at a time; realtime re-renders wait until the edit ends */
function startEdit(td){
  if (st.editing) return;
  const { r: rig_id, d: shift_date, s: shift, f: field } = td.dataset;
  const cur = idx.get(key(rig_id, shift_date, shift)) || {};
  const initial = field === "total_m" ? (cur.rig_id ? String(round2(App.shiftTotal(cur))) : "") : (cur[field] == null ? "" : String(cur[field]));
  const input = document.createElement("input");
  input.type = "text"; input.value = initial; input.autocomplete = "off";
  if (field === "hole_name") input.setAttribute("list", "tsHoles");
  else if (field !== "comment") input.inputMode = "decimal";
  st.editing = true;
  td.onclick = null; td.textContent = ""; td.appendChild(input); input.focus(); input.select();
  let done = false;
  const finish = async save => {
    if (done) return; done = true;
    const val = input.value.trim();
    if (save && val !== initial.trim()) {
      const row = { rig_id, shift_date, shift, hole_name: cur.hole_name ?? null, hole_id: cur.hole_id ?? null, start_m: cur.start_m ?? null, end_m: cur.end_m ?? null,
        total_m: cur.total_m ?? null, comment: cur.comment || "", source: "manual" };
      if (field === "hole_name") { row.hole_name = val || null; row.hole_id = App.holeByName(val)?.id || null; }
      else if (field === "comment") row.comment = val;
      else {
        const n = parseNum(val);
        if (val !== "" && n == null) { App.toast("Not a number: " + val); st.editing = false; return render(); }
        row[field] = n;
        if ((field === "start_m" || field === "end_m") && row.start_m != null && row.end_m != null) row.total_m = round2(row.end_m - row.start_m);
      }
      try { await App.insert("shift_entries", row); await App.reload(["shifts"]); } catch (x) { App.err(x); }
    }
    st.editing = false; render();
  };
  input.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
  };
  input.onblur = () => finish(true);
}

App.view("timesheet", { render });
})();
