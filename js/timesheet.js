/* Timesheet view: two rows per date (night shift on top, day shift below, newest date first), one
   5-column group per selected rig (Hole, Start, End, Total, Comment). The window ends yesterday:
   a shift is entered once it is over.
   Editing never updates a row: every change INSERTs a new shift_entries row with source 'manual'
   and the shift_current view picks the winner (contractor rjll/spektra beats manual, then newest).
   Contractor cells are read-only. A date row covers that calendar date's day + night shifts. */
(() => {
"use strict";
const LS_RIGS = "mgmdrill.ts.rigs";
const CONTRACTOR = new Set(["rjll", "spektra"]);
const PRESETS = [["7", "Last 7 days"], ["14", "Last 14 days"], ["month", "This month"], ["lastmonth", "Last month"], ["season", "Season"]];
const st = { preset: "7", from: null, to: null, editing: false, dirty: false };
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
  const t = App.addDays(App.today(), -1); // yesterday: the last finished day
  let a, b;
  if (st.preset === "custom" && st.from && st.to) { a = st.from; b = st.to; }
  else if (st.preset === "14") { a = App.addDays(t, -13); b = t; }
  else if (st.preset === "month") { a = App.today().slice(0, 8) + "01"; b = t; }
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

/* latest existing row for a rig before (date, shift) */
function prevShift(rigId, date, shift){
  const k = date + (shift === "night" ? "b" : "a"); let best = null, bk = "";
  for (const s of App.data.shifts) { if (s.rig_id !== rigId) continue; const sk = s.shift_date + (s.shift === "night" ? "b" : "a"); if (sk < k && sk > bk) { bk = sk; best = s; } }
  return best;
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
  const inherit = (!r || r.start_m == null) && ed ? prevShift(rig.id, date, shift) : null;
  h += cell([...base(), "num"], data("start_m") + ttl(inherit?.end_m != null ? `Starts at the previous shift's end (${num(inherit.end_m)} m) unless you type a depth` : sTitle) + (gap ? ` style="color:var(--warn);font-weight:700"` : ""),
    r && r.start_m != null ? num(r.start_m) : (inherit?.end_m != null ? `<span class="muted" style="font-weight:400">${num(inherit.end_m)}</span>` : ""));
  h += cell([...base(), "num"], data("end_m") + ttl(r?.end_m != null ? srcT : ""), r ? num(r.end_m) : "");
  // Total
  const tot = r ? App.shiftTotal(r) : null;
  const tc = [...base(), "num"]; if (r && tot === 0) tc.push("zero"); if (tot < 0) tc.push("neg");
  h += cell(tc, data("total_m") + ttl(r ? srcT : ""), r ? num(tot) : "");
  // Comment + discussion indicator + drawer button
  const n = App.commentsForShift(rig.id, date, shift).length;
  const txt = r?.comment || "";
  const short = txt.length > 18 ? txt.slice(0, 18) + "…" : txt;
  h += cell([...base(), "sub"], data("comment") + ttl(txt ? `${txt}\n${srcT}` : ""),
    `<span class="row" style="gap:4px;flex-wrap:nowrap"><span>${esc(short)}</span>${n ? `<span title="${n} comment${n > 1 ? "s" : ""}">💬</span>` : ""}<button class="btn xs ghost" data-open="${esc(rig.id)}|${date}|${shift}" title="Shift comments">…</button></span>`);
  return h;
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
  const zeroDays = totals.filter(([, m]) => m === 0).length;
  const tiles = `<div class="tiles">
    <div class="tile"><span class="l">Window total</span><span class="v">${App.fmt.n(winTotal)} <small>m</small></span><span class="l">${App.fmt.d(from)} – ${App.fmt.d(to)} · ${dates.length} days</span></div>
    <div class="tile"><span class="l">Average per day</span><span class="v">${App.fmt.n(dates.length ? winTotal / dates.length : 0, 1)} <small>m/day</small></span><span class="l">${rigs.length} rig${rigs.length === 1 ? "" : "s"} selected</span></div>
    <div class="tile"><span class="l">Best day</span><span class="v">${best && best[1] > 0 ? App.fmt.n(best[1]) : "–"} <small>m</small></span><span class="l">${best && best[1] > 0 ? App.fmt.dl(best[0]) : "No production"}</span></div>
    <div class="tile"><span class="l">Days with zero production</span><span class="v">${zeroDays}</span><span class="l">of ${dates.length} days in window</span></div>
  </div>`;

  // grid
  const colgroup = `<colgroup><col style="width:84px"><col style="width:44px">${rigs.map(() => `<col style="width:84px"><col style="width:50px"><col style="width:50px"><col style="width:46px"><col style="width:100px">`).join("")}</colgroup>`;
  const head1 = `<tr class="h1"><th rowspan="2" class="sticky-col">Date</th><th rowspan="2">Shift</th>${rigs.map(r => `<th colspan="5" style="color:${esc(r.color)};border-bottom:2px solid ${esc(r.color)}">${esc(r.label)}</th>`).join("")}</tr>`;
  const head2 = `<tr class="h2">${rigs.map(() => ["Hole", "Start", "End", "Total", "Comment"].map(l => `<th${l === "Start" || l === "End" || l === "Total" ? ' class="num"' : ""}>${l}</th>`).join("")).join("")}</tr>`;
  const body = dates.map(d => {
    const tot = dayTot(d), perRig = rigs.map(r => `${esc(r.id)} ${num(by[r.id]?.[d] || 0) || 0}`).join(" · ");
    const latest = d === to ? " latest" : "";
    const night = `<tr class="night first${latest}"><td rowspan="2" class="sticky-col" title="${perRig}"><b>${App.fmt.d(d)}</b> <span class="note">${latest ? "yesterday" : App.parseDate(d).toLocaleDateString("en-CA", { weekday: "short" })}</span><div class="daytot${tot === 0 ? " zero" : ""}">${num(tot) || 0} m</div></td><td class="sub">Night</td>${rigs.map(r => shiftCells(r, d, "night")).join("")}</tr>`;
    const day = `<tr class="${latest.trim()}"><td class="sub">Day</td>${rigs.map(r => shiftCells(r, d, "day")).join("")}</tr>`;
    return night + day;
  }).join("");
  const foot = `<tfoot><tr><td colspan="2" class="sticky-col">Total ${App.fmt.n(winTotal)} m</td>${rigs.map(r => `<td colspan="3"></td><td class="num">${num(App.rangeMetres(from, to, r.id))}</td><td></td>`).join("")}</tr></tfoot>`;
  const holeNames = App.projectHoles().map(h => h.ddh_name).filter(Boolean);

  el.innerHTML = `
    <div class="pagehead"><h2>Timesheet</h2><span class="note">Newest day on top, night shift above day shift. Last day shown: ${App.fmt.dl(to)}.</span></div>
    <div class="toolbar">
      <div class="seg" id="tsPreset">${PRESETS.map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${st.preset === k}">${l}</button>`).join("")}</div>
      <input type="date" id="tsFrom" value="${from}" style="width:auto" aria-label="From"><span class="muted">to</span><input type="date" id="tsTo" value="${to}" style="width:auto" aria-label="To">
      <span class="sep"></span>
      <div class="chips" id="tsRigs">${allRigs.map(r => `<button type="button" class="chip toggle" style="--c:${esc(r.color)}" data-rig="${esc(r.id)}" aria-pressed="${rigs.includes(r)}"><i></i>${esc(r.label)}</button>`).join("")}</div>
    </div>
    ${tiles}
    ${App.canEdit ? `<p class="note">Click a shaded cell to type; Enter or click away saves, Escape cancels. A new shift starts where the previous one ended (grey number) unless you type a start. Cells marked ${App.src("rjll")} or ${App.src("spektra")} come from the contractor and override manual entry, so they are read-only. Start depths in <span style="color:var(--warn);font-weight:700">amber</span> do not match the previous shift's end.</p>` : ""}
    ${rigs.length ? `<div class="tablewrap tall"><table class="ts dense">${colgroup}<thead>${head1}${head2}</thead><tbody>${body}</tbody>${foot}</table></div>` : `<div class="empty">No rigs selected.</div>`}
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
  App.$$("[data-open]", el).forEach(b => b.onclick = e => { e.stopPropagation(); const [r, d, s] = b.dataset.open.split("|"); App.openShift(r, d, s); });
  App.$$("td.edit", el).forEach(td => td.onclick = () => startEdit(td));
}

/* inline cell editing: one cell at a time; realtime re-renders wait until the edit ends */
function startEdit(td){
  if (st.editing) return;
  const { r: rig_id, d: shift_date, s: shift, f: field } = td.dataset;
  const cur = idx.get(key(rig_id, shift_date, shift)) || {};
  const prev = cur.start_m == null ? prevShift(rig_id, shift_date, shift) : null;
  const stored = field === "total_m" ? (cur.rig_id ? String(round2(App.shiftTotal(cur))) : "") : (cur[field] == null ? "" : String(cur[field]));
  const initial = field === "start_m" && cur.start_m == null && prev?.end_m != null ? String(prev.end_m) : stored;
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
    if (save && val !== stored.trim()) {
      const row = { rig_id, shift_date, shift, hole_name: cur.hole_name ?? null, hole_id: cur.hole_id ?? null, start_m: cur.start_m ?? null, end_m: cur.end_m ?? null,
        total_m: cur.total_m ?? null, comment: cur.comment || "", source: "manual" };
      // a new shift continues the previous one: same hole, start = previous end
      if (prev && row.start_m == null && field !== "start_m" && prev.end_m != null) row.start_m = Number(prev.end_m);
      if (prev && !row.hole_name && field !== "hole_name" && prev.hole_name) { row.hole_name = prev.hole_name; row.hole_id = prev.hole_id ?? App.holeByName(prev.hole_name)?.id ?? null; }
      if (field === "hole_name") { row.hole_name = val || null; row.hole_id = App.holeByName(val)?.id || null; }
      else if (field === "comment") row.comment = val;
      else {
        const n = parseNum(val);
        if (val !== "" && n == null) { App.toast("Not a number: " + val); st.editing = false; return render(); }
        row[field] = n;
        if (field !== "total_m" && row.start_m != null && row.end_m != null) row.total_m = round2(row.end_m - row.start_m);
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
