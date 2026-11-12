/* Drill sequence: per rig, the hole it is on and the holes queued after it (holes.rig_id + holes.seq),
   with remaining metres and expected completion dates from a metres-per-day rate.
   Editors reorder the queue and assign holes; the rate is the target (60) or the rig's recent actual. */
(() => {
"use strict";
const { $, $$, esc } = App;
const state = { rate: localStorage.getItem("mgmdrill.seq.rate") || "target", custom: JSON.parse(localStorage.getItem("mgmdrill.seq.custom") || "{}") };
const OPEN = new Set(["Permit Pending", "Planned", "Flagged", "Cut", "Spotted", "In Progress"]);

function rateFor(rig){
  if (state.rate === "custom" && state.custom[rig.id]) return Number(state.custom[rig.id]);
  if (state.rate === "actual") return App.rigAvg(rig.id, 14);
  return Number(App.targets().m_per_rig_day) || 60;
}
function queue(rig){
  const cur = App.rigCurrentHole(rig.id);
  const list = App.projectHoles().filter(h => h.rig_id === rig.id && OPEN.has(h.status) && h.id !== cur?.id).sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999) || App.holeLabel(a).localeCompare(App.holeLabel(b)));
  return cur && OPEN.has(cur.status) ? [cur, ...list] : list;
}
function remaining(h){
  const depth = App.holeDepth(h), planned = Number(h.planned_depth) || 0;
  if (h.status === "In Progress") return Math.max(0, planned - (depth ?? (Number(h.start_length) || 0)));
  return Math.max(0, planned - (Number(h.start_length) || 0));
}

function render(){
  const el = $("#view-sequence"), rigs = App.activeRigs(), start = App.lastProductionDate() || App.today();
  el.innerHTML = `
    <div class="pagehead"><h2>Drill sequence</h2>
      <div class="seg" title="Rate used for the dates">
        <button data-rate="target" aria-pressed="${state.rate === "target"}">Target ${esc(App.targets().m_per_rig_day || 60)} m/day</button>
        <button data-rate="actual" aria-pressed="${state.rate === "actual"}">Actual (14 d)</button>
        <button data-rate="custom" aria-pressed="${state.rate === "custom"}">Custom</button>
      </div>
      <span class="note">Dates count from ${App.fmt.d(start)}, the last day with production.</span>
    </div>
    <div class="seq">${rigs.map(rig => {
      const q = queue(rig), rate = rateFor(rig); let day = 0; const rows = [];
      for (const h of q) { const rem = remaining(h); day += rate > 0 ? rem / rate : 0; rows.push({ h, rem, eta: App.addDays(start, Math.ceil(day)), days: day }); }
      const planned = q.reduce((a, h) => a + (Number(h.planned_depth) || 0) - (Number(h.start_length) || 0), 0), rem = rows.reduce((a, r) => a + r.rem, 0);
      const unassigned = App.projectHoles().filter(h => !h.rig_id && OPEN.has(h.status) && h.status !== "In Progress");
      return `<div class="card rigcard" style="--c:${rig.color}">
        <header><h3 style="color:var(--fg)">${esc(rig.label)}</h3><span class="note">${esc(rig.contractor)} · ${state.rate === "custom" ? `<input type="number" step="1" min="1" value="${esc(state.custom[rig.id] || Math.round(rate))}" data-custom="${rig.id}" style="width:70px;padding:2px 6px"> m/day` : `${App.fmt.n(rate, 1)} m/day`}</span></header>
        <ol>${rows.map((r, i) => `<li class="${r.h.status === "In Progress" ? "cur" : ""}" data-id="${r.h.id}"><span class="n">${i + 1}</span>
          <div class="h"><b><a href="#" data-open="${r.h.id}">${esc(App.holeLabel(r.h))}</a> ${App.pill(r.h.status)} ${r.h.zone ? `<span class="tag">${esc(r.h.zone)}</span>` : ""}</b><small title="${esc(r.h.objective)}">${esc(r.h.objective || "")}</small>
            <small class="mono">${r.h.status === "In Progress" ? `${App.fmt.n(App.holeDepth(r.h))} / ${App.fmt.n(r.h.planned_depth)} m` : `${App.fmt.n(r.h.planned_depth)} m${r.h.start_length ? ` from ${App.fmt.n(r.h.start_length)}` : ""} · az ${App.fmt.n(r.h.azimuth)} / dip ${App.fmt.n(r.h.dip)}`}</small></div>
          <div class="eta"><b>${App.fmt.d(r.eta)}</b>${App.fmt.n(r.rem)} m left · ${App.fmt.n(r.days, 1)} d${App.canEdit ? `<div class="row" style="justify-content:flex-end;gap:2px"><button class="btn xs ghost" data-up="${r.h.id}" title="Move up">▲</button><button class="btn xs ghost" data-down="${r.h.id}" title="Move down">▼</button><button class="btn xs ghost" data-unassign="${r.h.id}" title="Remove from this rig">✕</button></div>` : ""}</div></li>`).join("") || `<li><span class="n">–</span><div class="h"><b>Nothing queued</b></div><div></div></li>`}</ol>
        <div class="sum"><span>Planned <b>${App.fmt.n(planned)} m</b></span><span>Remaining <b>${App.fmt.n(rem)} m</b></span><span>Days <b>${App.fmt.n(rem / (rate || 1), 1)}</b></span><span>Done <b>${rows.length ? App.fmt.d(rows[rows.length - 1].eta) : "–"}</b></span></div>
        ${App.canEdit ? `<div class="row"><select data-assign="${rig.id}" style="max-width:260px"><option value="">Add a hole to this rig…</option>${unassigned.map(h => `<option value="${h.id}">${esc(App.holeLabel(h))} · ${esc(h.zone || "")} · ${App.fmt.n(h.planned_depth)} m</option>`).join("")}</select></div>` : ""}
      </div>`; }).join("")}</div>
    <div class="card"><header><h3>All queued holes</h3></header><div class="tablewrap"><table><thead><tr><th>Rig</th><th>#</th><th>Hole</th><th>Zone</th><th>Status</th><th class="num">Planned</th><th class="num">Remaining</th><th>ETA</th><th>Objective</th></tr></thead><tbody>
      ${rigs.flatMap(rig => { const rate = rateFor(rig); let day = 0; return queue(rig).map((h, i) => { const rem = remaining(h); day += rate > 0 ? rem / rate : 0; return `<tr class="clickable" data-open="${h.id}"><td><span class="chip sm" style="--c:${rig.color}"><i></i>${esc(rig.id)}</span></td><td>${i + 1}</td><td><b>${esc(App.holeLabel(h))}</b></td><td>${esc(h.zone || "")}</td><td>${App.pill(h.status)}</td><td class="num">${App.fmt.n(h.planned_depth)}</td><td class="num">${App.fmt.n(rem)}</td><td>${App.fmt.d(App.addDays(start, Math.ceil(day)))}</td><td class="wrap-text small">${esc(h.objective || "")}</td></tr>`; }); }).join("") || `<tr><td colspan="9" class="empty">No holes queued. Assign holes to rigs in the cards above.</td></tr>`}</tbody></table></div></div>`;
  $$("[data-rate]", el).forEach(b => b.onclick = () => { state.rate = b.dataset.rate; localStorage.setItem("mgmdrill.seq.rate", state.rate); render(); });
  $$("[data-custom]", el).forEach(i => i.onchange = () => { state.custom[i.dataset.custom] = Number(i.value) || 60; localStorage.setItem("mgmdrill.seq.custom", JSON.stringify(state.custom)); render(); });
  $$("[data-open]", el).forEach(a => a.onclick = e => { e.preventDefault(); App.openHole(a.dataset.open); });
  $$("[data-up],[data-down]", el).forEach(b => b.onclick = async e => { e.stopPropagation(); const id = b.dataset.up || b.dataset.down; const h = App.hole(id); const q = queue(App.rig(h.rig_id)); const i = q.findIndex(x => x.id === id); const j = b.dataset.up ? i - 1 : i + 1; if (j < 0 || j >= q.length) return; await resequence(h.rig_id, swap(q, i, j)); });
  $$("[data-unassign]", el).forEach(b => b.onclick = async e => { e.stopPropagation(); try { await App.update("holes", { id: b.dataset.unassign }, { rig_id: null, seq: null }); await App.reload(["holes"]); } catch (x) { App.err(x); } });
  $$("[data-assign]", el).forEach(s => s.onchange = async () => { if (!s.value) return; const rig = s.dataset.assign; const q = queue(App.rig(rig)); try { await App.update("holes", { id: s.value }, { rig_id: rig, seq: q.length + 1 }); await App.reload(["holes"]); } catch (x) { App.err(x); } });
}
function swap(list, i, j){ const a = list.slice(); [a[i], a[j]] = [a[j], a[i]]; return a; }
async function resequence(rigId, list){
  try { await Promise.all(list.map((h, i) => App.update("holes", { id: h.id }, { seq: i + 1 }))); await App.reload(["holes"]); } catch (e) { App.err(e); }
}
App.view("sequence", { render });
})();
