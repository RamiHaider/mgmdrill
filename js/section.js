/* Long section view (Dan, 13 Nov). A base image (Leapfrog export, stored in the database, never in the repo)
   with an SVG overlay of markers: result squares coloured by metal factor (Au g/t x length, from the
   intercept list), grey circles for pending results, cyan stars for ongoing holes, plus free text labels.
   Editors drag markers, click one to change hole / kind / colour, edit the header and intercept list in
   place; everything persists in `sections` (positions are fractions of the image). Export / copy as PNG. */
(() => {
"use strict";
const { $, $$, esc } = App;
const KIND = { result: "Result", pending: "Pending results", ongoing: "Ongoing" };
const MF = [{ k: "white", c: "#ffffff", min: 0 }, { k: "green", c: "#bbff5a", min: 1 }, { k: "yellow", c: "#ffe739", min: 10 }, { k: "red", c: "#ff1a1a", min: 50 }];
const GREY = "#6b6b6b", CYAN = "#00e5ff";
const state = { id: null, sel: null, adding: null, drag: null, editing: false, pendingRender: false, saveT: null };
const images = {};   // section id -> data URL (loaded once, kept out of App.data so realtime reloads stay small)

/* ---------- helpers ---------- */
const sec = () => App.data.sections.find(s => s.id === state.id) || App.data.sections[0] || null;
const shortLabel = hole => String(hole || "").replace(/^JO-\d\d/i, "").replace(/^EM-\d\d-/i, "EM-");
const parseMF = text => { const m = /([\d.]+)\s*g\/t.*?over\s*([\d.]+)/i.exec(text || ""); return m ? Number(m[1]) * Number(m[2]) : null; };
const mfBucket = mf => { let c = MF[0]; if (mf != null) for (const b of MF) if (mf >= b.min) c = b; return c; };
const interceptFor = (s, hole) => (s.intercepts || []).find(i => String(i.hole).toLowerCase() === String(hole).toLowerCase());
function markerColor(s, m){
  if (m.kind === "pending") return GREY; if (m.kind === "ongoing") return CYAN;
  if (m.color) return (MF.find(b => b.k === m.color) || MF[0]).c;
  return mfBucket(parseMF(interceptFor(s, m.hole)?.text)).c;
}
const holeNum = h => { const m = /(\d+)\s*([A-Za-z]*)$/.exec(String(h)); return m ? [Number(m[1]), m[2]] : [999, String(h)]; };
const sortInt = list => [...list].sort((a, b) => { const [na, sa] = holeNum(a.hole), [nb, sb] = holeNum(b.hole); return na - nb || sa.localeCompare(sb) || String(a.hole).localeCompare(String(b.hole)); });
const ce = can => can ? `contenteditable="plaintext-only" spellcheck="false"` : "";
const uid = p => p + Math.random().toString(36).slice(2, 8);
function starPath(fill, r = 12){
  const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; pts.push(`${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`); }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="#000" stroke-width="1.5"/>`;
}
function shape(s, m){
  const c = markerColor(s, m);
  if (m.kind === "ongoing") return starPath(c, 13);
  if (m.kind === "pending") return `<circle r="10" fill="${c}" stroke="#000" stroke-width="1.6"/>`;
  return `<rect x="-10" y="-10" width="20" height="20" fill="${c}" stroke="#000" stroke-width="1.6"/>`;
}
function svgItems(s, W, H){
  const ms = (s.markers || []).map(m => `<g class="mk${state.sel === m.id ? " sel" : ""}" data-id="${esc(m.id)}" transform="translate(${(m.x * W).toFixed(1)},${(m.y * H).toFixed(1)})">${shape(s, m)}<text x="0" y="-15" text-anchor="middle">${esc(m.label || shortLabel(m.hole))}</text></g>`);
  const ts = (s.texts || []).map(t => `<g class="tx${state.sel === t.id ? " sel" : ""}" data-id="${esc(t.id)}" transform="translate(${(t.x * W).toFixed(1)},${(t.y * H).toFixed(1)})"><rect class="hit" x="-60" y="-20" width="120" height="30" fill="transparent"/><text x="0" y="0" text-anchor="middle" font-size="${Number(t.size) || 28}">${esc(t.text)}</text></g>`);
  return ms.join("") + ts.join("");
}

/* ---------- persistence ---------- */
async function persist(s, patch){
  try { await App.update("sections", { id: s.id }, { ...patch, updated_by: App.session?.user?.email || null, updated_at: new Date().toISOString() }); }
  catch (e) { App.err(e); }
}
async function loadImage(s){
  images[s.id] = null;
  try { const { data, error } = await App.sb.from("sections").select("image").eq("id", s.id).maybeSingle(); if (error) throw error; images[s.id] = data?.image || null; }
  catch (e) { App.err(e); }
  if (!$("#view-section").hidden) render();
}

/* ---------- render ---------- */
function render(){
  const el = $("#view-section"), s = sec();
  if (state.editing || state.drag) { state.pendingRender = true; return; }
  if (!s) { el.innerHTML = `<div class="pagehead"><h2>Long section</h2><a class="btn sm" href="#map">← Map</a></div><div class="msg">No section set up yet.</div>`; return; }
  state.id = s.id;
  const W = s.image_w || 2400, H = s.image_h || 1146, can = App.canEdit, img = images[s.id];
  el.innerHTML = `
    <div class="pagehead"><h2>Long section</h2>
      <div class="toolbar">
        ${can ? `<select id="lsAdd" style="width:auto"><option value="">Add…</option><option value="result">Result (square)</option><option value="pending">Pending results (circle)</option><option value="ongoing">Ongoing (star)</option><option value="text">Text label</option></select>` : ""}
        ${App.isAdmin ? `<button class="btn sm" id="lsBase">Set base image</button><input type="file" id="lsFile" accept="image/*" hidden>` : ""}
        <span class="sep"></span>
        <button class="btn sm" id="lsPng">Export image</button><button class="btn sm" id="lsCopy">Copy image</button>
        <a class="btn sm" href="#map">← Map</a>
      </div></div>
    ${state.adding ? `<div class="msg">Click on the section where the ${state.adding === "text" ? "text label" : KIND[state.adding].toLowerCase() + " marker"} goes. Esc cancels.</div>` : ""}
    ${can && !state.adding ? `<div class="small muted" style="margin:-4px 0 8px">Drag a marker to move it, click it to change hole / type / colour or delete it. Title, lines and intercepts edit in place. Result colour follows the intercept (grade × length) unless you override it.</div>` : ""}
    <div class="lsSheet" id="lsSheet">
      <div class="lsHead">
        <div class="lsTitle">
          <h1 ${ce(can)} data-f="title">${esc(s.header?.title || "")}</h1>
          ${(s.header?.lines || []).map((l, i) => `<div class="line" ${ce(can)} data-f="line" data-i="${i}">${esc(l)}</div>`).join("")}
          ${can ? `<div class="noprint"><button class="btn xs ghost" id="lsLineAdd">+ line</button>${(s.header?.lines || []).length ? `<button class="btn xs ghost" id="lsLineDel">− line</button>` : ""}</div>` : ""}
        </div>
        <div class="lsLogo"><img src="assets/leaf.png" alt=""><div><b>MAPLE</b><span>GOLD MINES</span></div></div>
        <div class="lsLegend">
          <div><b>Metal Factor</b><div class="sub">(Au g/t × length)</div><div class="mf"><span>0</span><span>1</span><span>10</span><span>50</span></div><div class="mfb">${MF.map(b => `<i style="background:${b.c}"></i>`).join("")}</div></div>
          <div><b>Drilling state</b><div class="st"><svg viewBox="-14 -14 28 28" width="22" height="22">${starPath(CYAN, 12)}</svg>Ongoing</div><div class="st"><svg viewBox="-14 -14 28 28" width="22" height="22"><circle r="10" fill="${GREY}" stroke="#000" stroke-width="1.6"/></svg>Pending results</div></div>
        </div>
        <div class="lsInts" id="lsInts">${sortInt(s.intercepts || []).map(i => `<div class="int" data-hole="${esc(i.hole)}"><b ${ce(can)} data-f="ihole">${esc(i.hole)}</b><span ${ce(can)} data-f="itext">${esc(i.text)}</span>${can ? `<button class="btn xs ghost noprint" data-idel="${esc(i.hole)}" title="Remove">✕</button>` : ""}</div>`).join("")}${can ? `<button class="btn xs noprint" id="lsIntAdd">+ intercept</button>` : ""}</div>
      </div>
      <div class="lsFig" id="lsFig" style="aspect-ratio:${W}/${H}">
        ${img ? `<img src="${img}" alt="" draggable="false">` : `<div class="lsNoImg">${img === undefined ? "Loading base image…" : "No base image yet. " + (App.isAdmin ? "Use “Set base image” above." : "Ask an admin to set one.")}</div>`}
        <svg id="lsSvg" viewBox="0 0 ${W} ${H}" class="${can ? "edit" : ""}${state.adding ? " adding" : ""}">${svgItems(s, W, H)}</svg>
      </div>
      <div class="lsFoot noprint">${s.updated_by ? `Last edited by ${esc(s.updated_by.split("@")[0])} ${App.fmt.dt(s.updated_at)}` : ""}</div>
    </div>
    <div id="lsPop" class="lsPop" hidden></div>`;
  wire(s, W, H);
  if (img === undefined) loadImage(s);
}

/* ---------- wiring ---------- */
function wire(s, W, H){
  const can = App.canEdit, svg = $("#lsSvg");
  $("#lsPng").onclick = () => { state.sel = null; closePop(); render(); App.exportPng($("#lsSheet"), "long-section"); };
  $("#lsCopy").onclick = () => { state.sel = null; closePop(); render(); App.copyPng($("#lsSheet")); };
  const base = $("#lsBase"); if (base) { base.onclick = () => $("#lsFile").click(); $("#lsFile").onchange = e => setBase(s, e.target.files[0]); }
  if (!can) return;

  $("#lsAdd").onchange = e => { state.adding = e.target.value || null; state.sel = null; render(); };
  document.onkeydown = e => {
    if (App.current !== "section") return;
    if (e.key === "Escape") { if (state.adding || state.sel) { state.adding = null; state.sel = null; closePop(); render(); } }
    if ((e.key === "Delete" || e.key === "Backspace") && state.sel && !e.target.closest("input,textarea,[contenteditable]")) { e.preventDefault(); removeItem(s, state.sel); }
  };

  // header + intercepts: edit in place, save on blur (debounced on input)
  const sheet = $("#lsSheet");
  sheet.addEventListener("focusin", e => { if (e.target.closest("[contenteditable]")) state.editing = true; });
  sheet.addEventListener("focusout", e => { if (e.target.closest("[contenteditable]")) { state.editing = false; clearTimeout(state.saveT); commitText(s, e.target); if (state.pendingRender) { state.pendingRender = false; render(); } } });
  sheet.addEventListener("input", e => { if (e.target.closest("[contenteditable]")) { clearTimeout(state.saveT); state.saveT = setTimeout(() => commitText(s, e.target), 900); } });
  sheet.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.closest("[contenteditable]")) { e.preventDefault(); e.target.blur(); } });
  $("#lsLineAdd").onclick = () => { s.header = { ...(s.header || {}), lines: [...(s.header?.lines || []), "New line"] }; persist(s, { header: s.header }); render(); };
  const ld = $("#lsLineDel"); if (ld) ld.onclick = () => { s.header = { ...(s.header || {}), lines: (s.header?.lines || []).slice(0, -1) }; persist(s, { header: s.header }); render(); };
  $("#lsIntAdd").onclick = () => { s.intercepts = [...(s.intercepts || []), { hole: "JO-26-", text: "0.00 g/t Au over 0.00 m" }]; persist(s, { intercepts: s.intercepts }); render(); $$("#lsInts .int b").pop()?.focus(); };
  $("#lsInts").onclick = e => { const b = e.target.closest("[data-idel]"); if (!b) return; s.intercepts = (s.intercepts || []).filter(i => i.hole !== b.dataset.idel); persist(s, { intercepts: s.intercepts }); render(); };

  // markers: drag / click / place
  const toSvg = e => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.addEventListener("pointerdown", e => {
    const g = e.target.closest("g.mk, g.tx");
    if (state.adding) { e.preventDefault(); const p = toSvg(e); addItem(s, state.adding, p.x / W, p.y / H); return; }
    if (!g) { if (state.sel) { state.sel = null; closePop(); render(); } return; }
    e.preventDefault(); svg.setPointerCapture(e.pointerId);
    const p = toSvg(e); const m = [...(s.markers || []), ...(s.texts || [])].find(x => x.id === g.dataset.id);
    state.drag = { g, item: m, start: p, ox: m.x * W, oy: m.y * H, moved: false, cx: e.clientX, cy: e.clientY };
  });
  svg.addEventListener("pointermove", e => {
    const d = state.drag; if (!d) return;
    const p = toSvg(e), dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) d.g.setAttribute("transform", `translate(${(d.ox + dx).toFixed(1)},${(d.oy + dy).toFixed(1)})`);
  });
  svg.addEventListener("pointerup", e => {
    const d = state.drag; if (!d) return; state.drag = null;
    if (d.moved) {
      const p = toSvg(e); d.item.x = Math.min(1, Math.max(0, (d.ox + p.x - d.start.x) / W)); d.item.y = Math.min(1, Math.max(0, (d.oy + p.y - d.start.y) / H));
      persist(s, d.item.kind ? { markers: s.markers } : { texts: s.texts });
      if (state.pendingRender) { state.pendingRender = false; render(); }
    } else { state.sel = d.item.id; render(); openPop(s, d.item, d.cx, d.cy); }
  });
  svg.addEventListener("pointercancel", () => { state.drag = null; });
}
function commitText(s, el){
  const f = el.dataset.f, v = el.textContent.trim(); if (!f) return;
  if (f === "title") { if ((s.header?.title || "") === v) return; s.header = { ...(s.header || {}), title: v }; return persist(s, { header: s.header }); }
  if (f === "line") { const lines = [...(s.header?.lines || [])]; if (lines[+el.dataset.i] === v) return; lines[+el.dataset.i] = v; s.header = { ...(s.header || {}), lines }; return persist(s, { header: s.header }); }
  const row = el.closest(".int"), it = (s.intercepts || []).find(i => i.hole === row?.dataset.hole); if (!it) return;
  if (f === "ihole") { if (it.hole === v || !v) return; it.hole = v; row.dataset.hole = v; }
  if (f === "itext") { if (it.text === v) return; it.text = v; }
  persist(s, { intercepts: s.intercepts });
  if (!state.editing) render();   // result colours follow the intercepts
}
function addItem(s, kind, x, y){
  state.adding = null;
  if (kind === "text") { const t = { id: uid("t"), text: "Label", x, y, size: 36 }; s.texts = [...(s.texts || []), t]; persist(s, { texts: s.texts }); state.sel = t.id; render(); openPop(s, t); }
  else { const m = { id: uid("m"), hole: "JO-26-", kind, x, y }; s.markers = [...(s.markers || []), m]; persist(s, { markers: s.markers }); state.sel = m.id; render(); openPop(s, m); }
}
function removeItem(s, id){
  if (s.markers?.some(m => m.id === id)) { s.markers = s.markers.filter(m => m.id !== id); persist(s, { markers: s.markers }); }
  else if (s.texts?.some(t => t.id === id)) { s.texts = s.texts.filter(t => t.id !== id); persist(s, { texts: s.texts }); }
  state.sel = null; closePop(); render();
}

/* ---------- popover: edit one marker / text ---------- */
function closePop(){ const p = $("#lsPop"); if (p) p.hidden = true; }
function openPop(s, item, cx, cy){
  const pop = $("#lsPop"); if (!pop) return;
  const isText = !item.kind;
  const holes = App.data.holes.filter(h => !h.archived).flatMap(h => [h.ddh_name, h.planned_name]).filter(Boolean).sort();
  pop.innerHTML = isText
    ? `<label>Text<input id="pText" value="${esc(item.text)}"></label><label>Size<input id="pSize" type="number" min="10" max="80" value="${esc(item.size || 28)}" style="width:80px"></label>
       <div class="row"><button class="btn xs danger" id="pDel">Delete</button><button class="btn xs" id="pClose">Done</button></div>`
    : `<label>Hole<input id="pHole" list="lsHoles" value="${esc(item.hole)}" autocomplete="off"><datalist id="lsHoles">${holes.map(h => `<option value="${esc(h)}">`).join("")}</datalist></label>
       <label>Type<select id="pKind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${item.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
       ${item.kind === "result" ? `<label>Colour<select id="pColor"><option value="">Auto from intercept${(() => { const mf = parseMF(interceptFor(s, item.hole)?.text); return mf == null ? " (none listed → white)" : ` (MF ${mf.toFixed(1)} → ${mfBucket(mf).k})`; })()}</option>${MF.map(b => `<option value="${b.k}" ${item.color === b.k ? "selected" : ""}>${b.k}</option>`).join("")}</select></label>` : ""}
       <label>Label on map (blank = short hole name)<input id="pLabel" value="${esc(item.label || "")}" placeholder="${esc(shortLabel(item.hole))}"></label>
       <div class="row"><button class="btn xs danger" id="pDel">Delete</button><button class="btn xs" id="pClose">Done</button></div>`;
  pop.hidden = false;
  const fig = $("#lsFig").getBoundingClientRect();
  const x = cx ?? fig.left + item.x * fig.width, y = cy ?? fig.top + item.y * fig.height;
  pop.style.left = Math.min(x + 12, innerWidth - pop.offsetWidth - 10) + "px"; pop.style.top = Math.min(y + 12, innerHeight - pop.offsetHeight - 10) + "px";
  const save = () => {
    if (isText) { item.text = $("#pText").value.trim() || "Label"; item.size = Number($("#pSize").value) || 28; persist(s, { texts: s.texts }); }
    else {
      item.hole = $("#pHole").value.trim() || item.hole; const k = $("#pKind").value, kindChanged = k !== item.kind; item.kind = k;
      const c = $("#pColor"); item.color = c && c.value ? c.value : undefined; if (!item.color) delete item.color;
      item.label = $("#pLabel").value.trim() || undefined; if (!item.label) delete item.label;
      persist(s, { markers: s.markers });
      if (kindChanged) { render(); openPop(s, item, cx, cy); return; }
    }
    $("#lsSvg").innerHTML = svgItems(s, s.image_w || 2400, s.image_h || 1146);
  };
  pop.oninput = save; pop.onchange = save;
  $("#pDel").onclick = () => removeItem(s, item.id);
  $("#pClose").onclick = () => { state.sel = null; closePop(); render(); };
  const first = pop.querySelector("input"); if (first) { first.focus(); if (item.hole === "JO-26-" || item.text === "Label") first.select(); }
}

/* ---------- base image (admin): resized in the browser, stored as a data URL ---------- */
function setBase(s, file){
  if (!file) return;
  const img = new Image();
  img.onload = async () => {
    const maxW = 2400, k = Math.min(1, maxW / img.naturalWidth), W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas"); c.width = W; c.height = H; c.getContext("2d").drawImage(img, 0, 0, W, H);
    const data = c.toDataURL("image/jpeg", .88);
    await persist(s, { image: data, image_w: W, image_h: H });
    images[s.id] = data; s.image_w = W; s.image_h = H; URL.revokeObjectURL(img.src);
    App.toast(`Base image set (${W}×${H})`); render();
  };
  img.onerror = () => App.toast("Could not read that image");
  img.src = URL.createObjectURL(file);
}

App.view("section", { render });
})();
