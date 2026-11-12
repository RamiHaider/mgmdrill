/* mgmdrill core: config, auth, data cache, realtime, helpers, routing, drawers.
   Views register with App.view(name, {render}) and read App.data. */
(() => {
"use strict";
const SUPABASE_URL = "https://htmiinlwnojwxznpisav.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_5of3YmOQIUyUR6GZCCPsFA_B-meAJyp";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const App = window.App = {
  sb, $, $$, esc,
  session: null, role: null, me: null,
  get isAdmin(){ return this.role === "admin"; },
  get canEdit(){ return this.role === "admin" || this.role === "editor"; },
  get canView(){ return !!this.role; },
  project: localStorage.getItem("mgmdrill.project") || "joutel",
  data: { projects: [], rigs: [], holes: [], shifts: [], reports: [], rigDaily: [], modules: [], comments: [], consumables: [], stats: [], layers: [], settings: null, members: [] },
  loaded: false,
  views: {},
  view(name, def){ this.views[name] = def; },
};

/* ---------- formatting ---------- */
const pad = n => String(n).padStart(2, "0");
App.fmt = {
  n: (v, d = 0) => (v == null || isNaN(v)) ? "–" : Number(v).toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d }),
  m: v => (v == null || isNaN(v)) ? "–" : Number(v).toLocaleString("en-CA", { maximumFractionDigits: 1 }) + " m",
  pct: v => (v == null || isNaN(v)) ? "–" : Math.round(v * 100) + "%",
  d: v => { if (!v) return "–"; const d = typeof v === "string" ? App.parseDate(v) : v; return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }); },
  dl: v => { if (!v) return "–"; const d = typeof v === "string" ? App.parseDate(v) : v; return d.toLocaleDateString("en-CA", { weekday: "short", year: "numeric", month: "long", day: "numeric" }); },
  dt: v => v ? new Date(v).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "–",
  iso: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
};
App.parseDate = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
App.today = () => App.fmt.iso(new Date());
App.addDays = (iso, n) => { const d = App.parseDate(iso); d.setDate(d.getDate() + n); return App.fmt.iso(d); };
App.daysBetween = (a, b) => Math.round((App.parseDate(b) - App.parseDate(a)) / 86400000);
App.statusClass = s => String(s || "").toLowerCase().replace(/\s+/g, "-");
App.vibeClass = v => (v || "").split(" ")[0];
App.pill = s => `<span class="pill ${App.statusClass(s)}">${esc(s)}</span>`;
App.vibe = v => v ? `<span class="vibe ${App.vibeClass(v)}"><i></i>${esc(v)}</span>` : `<span class="muted">–</span>`;
App.src = s => `<span class="src ${esc(s)}">${esc(s)}</span>`;
App.STATUSES = ["Permit Pending", "Planned", "Flagged", "Cut", "Spotted", "In Progress", "Complete", "Cancelled"];
App.VIBES = ["Bad", "Neutral", "Ok", "Good", "Excellent", "Mortgage your house"];
App.STATUS_COLOR = { "Permit Pending": "var(--s-permit)", Planned: "var(--s-planned)", Flagged: "var(--s-flag)", Cut: "var(--s-cut)", Spotted: "var(--s-spotted)", "In Progress": "var(--s-progress)", Complete: "var(--s-complete)", Cancelled: "var(--s-cancel)" };
App.STATUS_HEX = { "Permit Pending": "#c3c2b7", Planned: "#898781", Flagged: "#e87ba4", Cut: "#6250d6", Spotted: "#eda100", "In Progress": "#2a78d6", Complete: "#1baf7a", Cancelled: "#e34948" };

/* ---------- UI helpers ---------- */
App.toast = t => { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(App.toast.t); App.toast.t = setTimeout(() => el.hidden = true, 2800); };
App.err = e => { console.error(e); App.toast("Error: " + (e?.message || e)); };
App.confirm = (msg) => window.confirm(msg);
App.cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
App.isDark = () => matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";

/* ---------- derived data ---------- */
App.rig = id => App.data.rigs.find(r => r.id === id);
App.hole = id => App.data.holes.find(h => h.id === id);
App.holeByName = name => name ? App.data.holes.find(h => !h.archived && (h.ddh_name || "").toLowerCase() === String(name).toLowerCase()) : null;
App.holeLabel = h => h ? (h.ddh_name || h.planned_name || "?") : "–";
App.projectRigs = () => App.data.rigs.filter(r => r.project_id === App.project).sort((a, b) => a.sort - b.sort);
App.activeRigs = () => App.projectRigs().filter(r => r.active);
App.projectHoles = () => App.data.holes.filter(h => h.project_id === App.project && !h.archived);
App.settings = () => App.data.settings || { targets: { m_per_rig_day: 60, program_m: 25000, program_holes: 75, season_start: "2026-07-01" } };
App.targets = () => App.settings().targets || {};

/* shift_current rows: total metres for a shift */
App.shiftTotal = s => (s.total_m != null) ? Number(s.total_m) : (s.end_m != null && s.start_m != null ? Number(s.end_m) - Number(s.start_m) : 0);
/* metres per rig per day: { "FSD15": { "2026-11-10": 69, ... }, ... } */
App.dailyByRig = () => {
  const out = {};
  for (const s of App.data.shifts) {
    const r = out[s.rig_id] || (out[s.rig_id] = {});
    r[s.shift_date] = (r[s.shift_date] || 0) + App.shiftTotal(s);
  }
  return out;
};
App.dailyTotal = (date) => App.activeRigs().reduce((a, r) => a + (App.dailyByRig()[r.id]?.[date] || 0), 0);
/* current depth of a hole = deepest end_m in its shifts, else the manual value */
App.holeDepth = h => {
  if (!h) return null;
  let max = null;
  for (const s of App.data.shifts) {
    if (s.hole_id === h.id || (!s.hole_id && s.hole_name && h.ddh_name && s.hole_name.toLowerCase() === h.ddh_name.toLowerCase())) {
      if (s.end_m != null && (max == null || Number(s.end_m) > max)) max = Number(s.end_m);
    }
  }
  if (h.final_depth != null && (max == null || h.final_depth > max)) max = Number(h.final_depth);
  if (max == null) max = h.current_depth_manual != null ? Number(h.current_depth_manual) : null;
  return max;
};
App.holeDrilled = h => { const d = App.holeDepth(h); return d == null ? null : d - (Number(h.start_length) || 0); };
/* the hole a rig is on now = latest shift with a hole name */
App.rigCurrentHole = rigId => {
  const rows = App.data.shifts.filter(s => s.rig_id === rigId && s.hole_name).sort((a, b) => (b.shift_date + (b.shift === "night" ? "b" : "a")).localeCompare(a.shift_date + (a.shift === "night" ? "b" : "a")));
  for (const s of rows) { const h = App.holeByName(s.hole_name); if (h) return h; }
  return App.data.holes.find(h => h.rig_id === rigId && h.status === "In Progress") || null;
};
/* latest date with any production */
App.lastProductionDate = () => { let m = null; for (const s of App.data.shifts) if (App.shiftTotal(s) > 0 && (!m || s.shift_date > m)) m = s.shift_date; return m; };
App.seasonStart = () => App.targets().season_start || "2026-07-01";
App.seasonMetres = (through) => { let t = 0; for (const s of App.data.shifts) if (s.shift_date >= App.seasonStart() && (!through || s.shift_date <= through) && App.activeRigs().some(r => r.id === s.rig_id)) t += App.shiftTotal(s); return t; };
App.rangeMetres = (from, to, rigId) => { let t = 0; for (const s of App.data.shifts) if (s.shift_date >= from && s.shift_date <= to && (!rigId || s.rig_id === rigId)) t += App.shiftTotal(s); return t; };
/* average m/day for a rig over the last n productive days */
App.rigAvg = (rigId, n = 14) => {
  const d = App.dailyByRig()[rigId] || {}; const days = Object.keys(d).filter(k => d[k] > 0).sort().slice(-n);
  if (!days.length) return App.targets().m_per_rig_day || 60;
  return days.reduce((a, k) => a + d[k], 0) / days.length;
};
App.isFlagged = h => h.flagged || (App.settings().flag_rule?.vibes || []).includes(h.vibe);
App.commentsFor = (hole_id) => App.data.comments.filter(c => c.hole_id === hole_id);
App.commentsForShift = (rig_id, date, shift) => App.data.comments.filter(c => c.rig_id === rig_id && c.shift_date === date && (!shift || c.shift === shift));

/* ---------- data loading ---------- */
async function q(p){ const { data, error } = await p; if (error) throw error; return data || []; }
App.loadAll = async function(){
  if (!App.canView) { App.loaded = false; return; }
  const d = App.data;
  const [projects, rigs, holes, shifts, reports, rigDaily, modules, comments, consumables, stats, settings] = await Promise.all([
    q(sb.from("projects").select("*").order("sort")),
    q(sb.from("rigs").select("*").order("sort")),
    q(sb.from("holes").select("*").order("created_at")),
    q(sb.from("shift_current").select("*").order("shift_date")),
    q(sb.from("daily_reports").select("*").order("report_date", { ascending: false }).limit(400)),
    q(sb.from("rig_daily").select("*")),
    q(sb.from("report_modules").select("*").order("sort")),
    q(sb.from("comments").select("*").order("created_at")),
    q(sb.from("consumables").select("*")),
    q(sb.from("stats_source").select("*")),
    q(sb.from("settings").select("*").eq("id", "main").maybeSingle()),
  ]);
  Object.assign(d, { projects, rigs, holes, shifts, reports, rigDaily, modules, comments, consumables, stats, settings: settings || null });
  if (App.isAdmin) d.members = await q(sb.from("members").select("*").order("email")).catch(() => []);
  App.loaded = true;
};
App.loadLayers = async function(){ if (!App.data.layers.length) App.data.layers = await q(sb.from("map_layers").select("*").order("sort")); return App.data.layers; };
App.reload = async function(parts){
  const d = App.data;
  const map = {
    holes: () => q(sb.from("holes").select("*").order("created_at")).then(x => d.holes = x),
    shifts: () => q(sb.from("shift_current").select("*").order("shift_date")).then(x => d.shifts = x),
    reports: () => q(sb.from("daily_reports").select("*").order("report_date", { ascending: false }).limit(400)).then(x => d.reports = x),
    rigDaily: () => q(sb.from("rig_daily").select("*")).then(x => d.rigDaily = x),
    modules: () => q(sb.from("report_modules").select("*").order("sort")).then(x => d.modules = x),
    comments: () => q(sb.from("comments").select("*").order("created_at")).then(x => d.comments = x),
    consumables: () => q(sb.from("consumables").select("*")).then(x => d.consumables = x),
    settings: () => q(sb.from("settings").select("*").eq("id", "main").maybeSingle()).then(x => d.settings = x || null),
    rigs: () => q(sb.from("rigs").select("*").order("sort")).then(x => d.rigs = x),
    members: () => q(sb.from("members").select("*").order("email")).then(x => d.members = x),
    stats: () => q(sb.from("stats_source").select("*")).then(x => d.stats = x),
  };
  await Promise.all((parts || Object.keys(map)).map(k => map[k]()));
  App.render();
};
const TABLE_PART = { holes: "holes", shift_entries: "shifts", daily_reports: "reports", rig_daily: "rigDaily", report_modules: "modules", comments: "comments", consumables: "consumables", settings: "settings", rigs: "rigs" };
let channel = null, pending = new Set(), pendingT = null;
App.subscribe = function(){
  if (channel) { sb.removeChannel(channel); channel = null; }
  if (!App.canView) return;
  channel = sb.channel("mgmdrill");
  for (const t of Object.keys(TABLE_PART)) channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
    pending.add(TABLE_PART[t]); clearTimeout(pendingT); pendingT = setTimeout(() => { const p = [...pending]; pending.clear(); App.reload(p).catch(App.err); }, 400);
  });
  channel.subscribe();
};

/* ---------- writes (small wrappers so views stay short) ---------- */
App.save = async function(table, row, opts = {}){
  const { data, error } = await sb.from(table).upsert(row, opts).select();
  if (error) throw error; return data;
};
App.update = async function(table, match, patch){
  let qb = sb.from(table).update(patch); for (const [k, v] of Object.entries(match)) qb = qb.eq(k, v);
  const { error } = await qb; if (error) throw error;
};
App.remove = async function(table, match){
  let qb = sb.from(table).delete(); for (const [k, v] of Object.entries(match)) qb = qb.eq(k, v);
  const { error } = await qb; if (error) throw error;
};
App.insert = async function(table, row){ const { data, error } = await sb.from(table).insert(row).select(); if (error) throw error; return data; };

/* ---------- routing ---------- */
const VIEWS = ["map", "holes", "timesheet", "production", "report", "sequence", "stats", "consumables", "admin"];
App.current = null;
App.route = function(){
  const h = location.hash.replace("#", "").split("?")[0];
  let v = VIEWS.includes(h) ? h : "map";
  if (!App.canView) v = "login";
  App.current = v;
  for (const x of VIEWS) { const el = $("#view-" + x); if (el) el.hidden = x !== v; }
  $("#view-login").hidden = v !== "login";
  $$("#nav a").forEach(a => a.dataset.view === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  $("#nav").hidden = !App.canView;
  $("#who").hidden = !App.canView;
  $$(".adminonly").forEach(a => a.hidden = !App.isAdmin);
  App.render();
};
window.addEventListener("hashchange", App.route);
App.render = function(){
  if (!App.canView || !App.loaded) return;
  const v = App.views[App.current];
  try { v && v.render(); } catch (e) { App.err(e); }
  if (App.drawer.kind) App.drawer.refresh();
};
App.go = v => { location.hash = "#" + v; };

/* ---------- project switch ---------- */
$("#projsel").onchange = e => { App.project = e.target.value; localStorage.setItem("mgmdrill.project", App.project); App.render(); };
function fillProjects(){
  const sel = $("#projsel"); sel.innerHTML = App.data.projects.filter(p => p.active).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  if (!App.data.projects.some(p => p.id === App.project)) App.project = App.data.projects[0]?.id || "joutel";
  sel.value = App.project;
}

/* ---------- drawer (hole card / shift comments) ---------- */
App.drawer = { kind: null, id: null, extra: null };
App.openHole = id => { App.drawer = { kind: "hole", id }; App.drawer.refresh(); $("#drawer").classList.add("open"); $("#scrim").hidden = false; };
App.openShift = (rig_id, date, shift) => { App.drawer = { kind: "shift", id: rig_id, extra: { date, shift } }; App.drawer.refresh(); $("#drawer").classList.add("open"); $("#scrim").hidden = false; };
App.closeDrawer = () => { App.drawer = { kind: null }; $("#drawer").classList.remove("open"); $("#scrim").hidden = true; };
$("#scrim").onclick = App.closeDrawer; $("#drawerClose").onclick = App.closeDrawer;
document.addEventListener("keydown", e => { if (e.key === "Escape") App.closeDrawer(); });

function commentsHtml(list, target){
  return `<div class="card"><header><h3>Comments <span class="tag">${list.length}</span></h3></header>
    <div class="list" id="cmtList">${list.length ? list.map(c => `<div class="cmt"><div class="meta">${esc(c.author.split("@")[0])} · ${App.fmt.dt(c.created_at)} ${(c.author.toLowerCase() === (App.session?.user?.email || "").toLowerCase() || App.isAdmin) ? `<button class="btn xs ghost danger-text" data-del="${c.id}">delete</button>` : ""}</div><div class="body">${esc(c.body)}</div></div>`).join("") : `<div class="empty">No comments yet.</div>`}</div>
    <form id="cmtForm" class="field"><textarea id="cmtBody" placeholder="Add a comment…" maxlength="4000" required></textarea><div class="actions"><button class="btn primary sm" type="submit">Post</button><span class="note">Everyone with access can comment.</span></div></form></div>`;
}
function wireComments(el, target){
  $("#cmtForm", el).onsubmit = async e => { e.preventDefault(); const body = $("#cmtBody", el).value.trim(); if (!body) return;
    try { await App.insert("comments", { ...target, body, author: App.session.user.email }); $("#cmtBody", el).value = ""; await App.reload(["comments"]); } catch (x) { App.err(x); } };
  $$("[data-del]", el).forEach(b => b.onclick = async () => { if (!App.confirm("Delete this comment?")) return; try { await App.remove("comments", { id: b.dataset.del }); await App.reload(["comments"]); } catch (x) { App.err(x); } });
}
App.drawer.refresh = function(){
  const d = App.drawer, el = $("#drawerBody");
  if (d.kind === "hole") {
    const h = App.hole(d.id); if (!h) return App.closeDrawer();
    const depth = App.holeDepth(h), drilled = App.holeDrilled(h), rig = App.rig(h.rig_id);
    $("#drawerTitle").innerHTML = `${esc(App.holeLabel(h))} ${App.pill(h.status)} ${App.isFlagged(h) ? '<span class="flag" title="Flagged">⚑</span>' : ""}`;
    const pct = h.planned_depth ? Math.min(1, (depth || 0) / h.planned_depth) : 0;
    el.innerHTML = `
      <dl class="kv">
        <dt>Planned ID</dt><dd>${esc(h.planned_name || "–")}</dd>
        <dt>Zone</dt><dd>${esc(h.zone || "–")}</dd>
        <dt>Rig</dt><dd>${rig ? `<span class="chip sm" style="--c:${rig.color}"><i></i>${esc(rig.label)}</span>` : "–"} ${h.seq ? `<span class="tag">#${h.seq}</span>` : ""}</dd>
        <dt>Collar</dt><dd class="mono">${App.fmt.n(h.easting)} E · ${App.fmt.n(h.northing)} N · ${App.fmt.n(h.elevation)} m</dd>
        <dt>Az / Dip</dt><dd class="mono">${App.fmt.n(h.azimuth)}° / ${App.fmt.n(h.dip)}°</dd>
        <dt>Depth</dt><dd><b>${App.fmt.m(depth)}</b> of ${App.fmt.m(h.planned_depth)} planned${h.start_length ? ` (wedge from ${App.fmt.m(h.start_length)})` : ""}<div class="meter"><i style="width:${pct * 100}%"></i></div></dd>
        <dt>Drilled</dt><dd>${App.fmt.m(drilled)}${h.final_depth ? ` · EOH ${App.fmt.m(h.final_depth)}` : ""}</dd>
        <dt>Dates</dt><dd>${App.fmt.d(h.start_date)} → ${h.end_date ? App.fmt.d(h.end_date) : (h.status === "In Progress" ? "in progress" : "–")}</dd>
        <dt>Samples</dt><dd>${App.fmt.n(h.n_samples)}</dd>
        <dt>Vibe</dt><dd>${App.vibe(h.vibe)}</dd>
        <dt>Objective</dt><dd>${esc(h.objective || "–")}</dd>
        <dt>Result</dt><dd>${esc(h.result || "–")}</dd>
      </dl>
      <div class="actions">
        ${App.canEdit ? `<button class="btn sm" id="dEdit">Edit hole</button>` : ""}
        ${(h.easting && h.northing) ? `<button class="btn sm" id="dMap">Show on map</button>` : ""}
      </div>
      ${commentsHtml(App.commentsFor(h.id), { hole_id: h.id })}`;
    wireComments(el, { hole_id: h.id });
    const e1 = $("#dEdit", el); if (e1) e1.onclick = () => { App.closeDrawer(); App.go("holes"); setTimeout(() => App.views.holes?.edit?.(h.id), 50); };
    const e2 = $("#dMap", el); if (e2) e2.onclick = () => { App.closeDrawer(); App.go("map"); setTimeout(() => App.views.map?.focus?.(h.id), 100); };
  } else if (d.kind === "shift") {
    const rig = App.rig(d.id), { date, shift } = d.extra;
    const rows = App.data.shifts.filter(s => s.rig_id === d.id && s.shift_date === date && (!shift || s.shift === shift));
    $("#drawerTitle").innerHTML = `${esc(rig?.label || d.id)} · ${App.fmt.dl(date)}${shift ? " · " + shift : ""}`;
    el.innerHTML = `<dl class="kv">${rows.map(s => `<dt>${esc(s.shift)}</dt><dd>${esc(s.hole_name || "–")} · ${App.fmt.n(s.start_m)} → ${App.fmt.n(s.end_m)} = <b>${App.fmt.m(App.shiftTotal(s))}</b> ${App.src(s.source)}${s.comment ? `<div class="note">${esc(s.comment)}</div>` : ""}</dd>`).join("") || "<dd class='empty'>No entries.</dd>"}</dl>
      ${commentsHtml(App.commentsForShift(d.id, date, shift), { rig_id: d.id, shift_date: date, shift: shift || null })}`;
    wireComments(el, { rig_id: d.id, shift_date: date, shift: shift || null });
  }
};

/* ---------- auth ---------- */
const showMsg = (sel, text, cls) => { const m = $(sel); m.hidden = !text; m.textContent = text || ""; m.className = "msg " + (cls || ""); };
$("#loginForm").onsubmit = async e => {
  e.preventDefault(); showMsg("#loginMsg", "Signing in…");
  const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
  if (error) return showMsg("#loginMsg", error.message, "err");
  showMsg("#loginMsg", "");
};
$("#lReset").onclick = async () => {
  const email = $("#lEmail").value.trim(); if (!email) return showMsg("#loginMsg", "Type your email first.", "err");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  showMsg("#loginMsg", error ? error.message : "Check your email for a reset link.", error ? "err" : "ok");
};
$("#btnLogout").onclick = async () => { await sb.auth.signOut({ scope: "local" }); };
let authSeq = 0;
sb.auth.onAuthStateChange((event, s) => {
  App.session = s; const seq = ++authSeq;
  setTimeout(async () => {
    if (seq !== authSeq) return;
    if (event === "PASSWORD_RECOVERY") { const np = prompt("Choose a new password (8+ characters):"); if (np) { const { error } = await sb.auth.updateUser({ password: np }); App.toast(error ? error.message : "Password updated"); } }
    if (s) { const { data } = await sb.rpc("my_role"); App.role = data || null; } else App.role = null;
    if (s && !App.role) showMsg("#loginMsg", "This account is signed in but has no access yet. Ask Rami or Dan to add you.", "err");
    if (event === "SIGNED_OUT") { App.closeDrawer(); App.toast("Signed out"); }
    try {
      await App.loadAll();
      if (App.canView) { fillProjects(); $("#whoName").textContent = s.user.email.split("@")[0]; $("#whoRole").textContent = App.role; }
    } catch (e) { App.err(e); }
    App.subscribe();
    if (App.canView && (!location.hash || location.hash === "#login")) location.hash = "#map";
    App.route();
  }, 0);
});
App.route();
})();
