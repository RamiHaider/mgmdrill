/* Admin: members and roles, rigs, projects, targets and rules, sync log. Admins only (RLS enforces it too). */
(() => {
"use strict";
const { $, $$, esc } = App;

function render(){
  const el = $("#view-admin");
  if (!App.isAdmin) { el.innerHTML = `<div class="empty">Admins only.</div>`; return; }
  const s = App.settings(), t = s.targets || {}, members = App.data.members || [], rigs = App.data.rigs.slice().sort((a, b) => a.sort - b.sort);
  el.innerHTML = `
    <div class="pagehead"><h2>Admin</h2><span class="note">Changes apply immediately for everyone.</span></div>
    <div class="cols">
      <div class="card"><header><h3>Members</h3><span class="tag">${members.length}</span></header>
        <div class="tablewrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead><tbody>
          ${members.map(m => `<tr><td class="mono">${esc(m.email)}</td><td>${esc(m.name)}</td><td><select data-role="${esc(m.email)}" style="width:auto"><option ${m.role === "admin" ? "selected" : ""}>admin</option><option ${m.role === "editor" ? "selected" : ""}>editor</option><option ${m.role === "viewer" ? "selected" : ""}>viewer</option></select></td><td><button class="btn xs danger" data-rm="${esc(m.email)}">remove</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">Nobody yet.</td></tr>`}</tbody></table></div>
        <form id="mAdd" class="row"><input name="email" type="email" placeholder="email" required class="grow"><input name="name" placeholder="name" style="max-width:140px"><select name="role" style="width:auto"><option>viewer</option><option>editor</option><option>admin</option></select><button class="btn primary sm">Add</button></form>
        <p class="note">Adding a member grants access once they have a login. Create the login in Supabase → Authentication → Users → <b>Add user</b> (same email, auto-confirm, a temporary password, and user metadata <code>{"must_change_pw": true}</code>); the first sign-in then asks them to choose their own password (they can press Later). <b>Never set that flag on an existing account</b>: on Nov 13 it was set on everyone and signed every user out. <i>Forgot password</i> on the sign-in page emails a reset link. Roles: admin = everything, editor = enter metres, geology, holes, reports, consumables; viewer = read and comment.</p>
      </div>
      <div class="card"><header><h3>Targets &amp; rules</h3></header>
        <form id="tForm" class="form">
          <div class="field"><label>Metres per rig per day</label><input name="m_per_rig_day" type="number" step="1" value="${esc(t.m_per_rig_day ?? 60)}"></div>
          <div class="field"><label>Programme metres</label><input name="program_m" type="number" step="100" value="${esc(t.program_m ?? 25000)}"></div>
          <div class="field"><label>Programme holes</label><input name="program_holes" type="number" step="1" value="${esc(t.program_holes ?? 75)}"></div>
          <div class="field"><label>Season start</label><input name="season_start" type="date" value="${esc(t.season_start || "2026-07-01")}"></div>
          <div class="field full"><label>Flag a hole automatically when its vibe is one of</label><div class="chips">${App.VIBES.map(v => `<label class="chip sm"><input type="checkbox" name="flag_vibe" value="${esc(v)}" ${(s.flag_rule?.vibes || []).includes(v) ? "checked" : ""}> ${esc(v)}</label>`).join("")}</div></div>
          <div class="field"><label>MICH lithology codes (comma separated)</label><input name="mich" value="${esc((s.mich_codes?.mich || []).join(", "))}"></div>
          <div class="field"><label>Microgabbro codes (not MICH)</label><input name="microgabbro" value="${esc((s.mich_codes?.microgabbro || []).join(", "))}"></div>
          <div class="actions full"><button class="btn primary sm">Save targets</button><span class="note">Daily target = active rigs × metres per rig per day.</span></div>
        </form>
      </div>
      <div class="card"><header><h3>Rigs</h3></header>
        <div class="tablewrap"><table><thead><tr><th>Id</th><th>Label</th><th>Contractor</th><th>Project</th><th>Data source</th><th>Colour</th><th>Order</th><th>Active</th></tr></thead><tbody>
          ${rigs.map(r => `<tr data-rig="${esc(r.id)}"><td class="mono">${esc(r.id)}</td><td><input name="label" value="${esc(r.label)}"></td><td><input name="contractor" value="${esc(r.contractor)}"></td>
            <td><select name="project_id">${App.data.projects.map(p => `<option value="${esc(p.id)}" ${p.id === r.project_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></td>
            <td><select name="source"><option ${r.source === "manual" ? "selected" : ""}>manual</option><option ${r.source === "rjll" ? "selected" : ""}>rjll</option><option ${r.source === "spektra" ? "selected" : ""}>spektra</option></select></td>
            <td><input name="color" type="color" value="${esc(r.color)}" style="width:44px;padding:2px"></td><td><input name="sort" type="number" value="${esc(r.sort)}" style="width:60px"></td>
            <td><input name="active" type="checkbox" ${r.active ? "checked" : ""}></td></tr>`).join("")}</tbody></table></div>
        <form id="rAdd" class="row"><input name="id" placeholder="id, e.g. FSD12" required style="max-width:120px"><input name="label" placeholder="label, e.g. RJLL FSD12" required class="grow"><input name="contractor" placeholder="contractor" required style="max-width:120px"><select name="project_id" style="width:auto">${App.data.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><button class="btn primary sm">Add rig</button></form>
        <p class="note">Edits save when you leave a field. A rig marked inactive keeps its history but drops out of targets, the timesheet and the sequence. Data source decides which contractor feed overwrites manual entries.</p>
      </div>
      <div class="card"><header><h3>Projects</h3></header>
        <div class="list">${App.data.projects.map(p => `<label class="row"><input type="checkbox" data-proj="${esc(p.id)}" ${p.active ? "checked" : ""}> <b>${esc(p.name)}</b> <span class="tag">${esc(p.id)}</span> <span class="note">${App.data.holes.filter(h => h.project_id === p.id && !h.archived).length} holes</span></label>`).join("")}</div>
        <form id="pAdd" class="row"><input name="id" placeholder="id, e.g. morris" required style="max-width:120px"><input name="name" placeholder="Name" required class="grow"><button class="btn primary sm">Add project</button></form>
      </div>
      <div class="card"><header><h3>Data feeds</h3></header>
        <p class="note">Feeds: a cloud job (Supabase cron, every 15 minutes) pulls the RJLL time reports from the RJLL portal API (source <b>rjll</b>, pending reports flagged in the comment) and the IMDEXHUB-IQ downhole surveys (hole cards, OMNIx42). A job on the database manager's laptop (noon and midnight) files the Spektra daily workbook from the Outlook mailbox to SharePoint and loads its shifts (source <b>spektra</b>). Contractor rows take precedence over manual entries. Each run is logged below. MX Deposit result summaries (not connected yet) will use the MICH codes above.</p>
        <div id="syncLog" class="list"><span class="spin"></span></div>
        <p class="note">To refresh from the Excel tracker instead, run <span class="tag">tools/import_tracker.py</span> and paste the SQL into the Supabase SQL editor.</p>
      </div>
    </div>`;

  $$("[data-role]", el).forEach(s => s.onchange = () => go(App.update("members", { email: s.dataset.role }, { role: s.value }), ["members"]));
  $$("[data-rm]", el).forEach(b => b.onclick = () => { if (App.confirm(`Remove ${b.dataset.rm}? Their login stays but loses access.`)) go(App.remove("members", { email: b.dataset.rm }), ["members"]); });
  $("#mAdd").onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target); go(App.insert("members", { email: String(fd.get("email")).trim().toLowerCase(), name: fd.get("name") || "", role: fd.get("role") }), ["members"]); };
  $("#tForm").onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target);
    const targets = { m_per_rig_day: Number(fd.get("m_per_rig_day")), program_m: Number(fd.get("program_m")), program_holes: Number(fd.get("program_holes")), season_start: fd.get("season_start") };
    const split = v => String(v || "").split(",").map(x => x.trim()).filter(Boolean);
    go(App.update("settings", { id: "main" }, { targets, flag_rule: { vibes: fd.getAll("flag_vibe") }, mich_codes: { mich: split(fd.get("mich")), microgabbro: split(fd.get("microgabbro")) }, updated_at: new Date().toISOString() }), ["settings"]); };
  $$("tr[data-rig] input, tr[data-rig] select", el).forEach(i => i.onchange = () => { const tr = i.closest("tr"); const patch = {}; for (const f of $$("input,select", tr)) patch[f.name] = f.type === "checkbox" ? f.checked : (f.type === "number" ? Number(f.value) : f.value); go(App.update("rigs", { id: tr.dataset.rig }, patch), ["rigs"]); });
  $("#rAdd").onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target); const PAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]; const color = PAL.find(c => !rigs.some(r => r.color === c)) || PAL[rigs.length % PAL.length];
    go(App.insert("rigs", { id: String(fd.get("id")).trim(), label: fd.get("label"), contractor: fd.get("contractor"), project_id: fd.get("project_id"), source: "manual", sort: rigs.length + 1, color }), ["rigs"]); };
  $$("[data-proj]", el).forEach(c => c.onchange = () => go(App.update("projects", { id: c.dataset.proj }, { active: c.checked }), null));
  $("#pAdd").onsubmit = e => { e.preventDefault(); const fd = new FormData(e.target); go(App.insert("projects", { id: String(fd.get("id")).trim().toLowerCase(), name: fd.get("name"), sort: App.data.projects.length + 1 }), null); };
  App.sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(20).then(({ data }) => { const l = $("#syncLog"); if (!l) return; l.innerHTML = (data || []).map(r => `<div class="cmt"><div class="meta">${esc(r.kind)} · ${App.fmt.dt(r.started_at)} · <b>${esc(r.status)}</b></div><div class="body small">${esc(r.message)}</div></div>`).join("") || `<div class="empty">No sync runs yet.</div>`; });
}
async function go(p, parts){ try { await p; App.toast("Saved"); if (parts) await App.reload(parts); else { App.data.projects = await App.sb.from("projects").select("*").order("sort").then(r => r.data || []); App.render(); } } catch (e) { App.err(e); } }
App.view("admin", { render });
})();
