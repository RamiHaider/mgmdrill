// sync-feeds: cloud pull of the contractor + survey feeds into the mgmdrill database.
//   ?mode=surveys  IMDEXHUB-IQ downhole surveys (all tools, all statuses) -> surveys   (incremental by LastModified)
//   ?mode=rjll     RJLL portal API time reports                            -> shift_entries (source 'rjll')
// Called every 15 min by pg_cron (run_sync) with header x-sync-key = Vault 'sync_key'.
// Secrets come from Vault through the service-role-only RPC sync_secrets():
//   imdex_api_key, imdex_apim_key, rjll_api_token, sync_key
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const IMDEX = "https://api.imdexhub.com";
const BUDGET_MS = 110_000; // stop paging before the function's wall clock runs out; the cursor resumes next tick
const r2 = (x: number | null | undefined) => (x == null || Number.isNaN(x)) ? null : Math.round(x * 100) / 100;
const g = (x: number) => String(r2(x));

type Secrets = Record<string, string>;

async function getJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

async function holeMap() {
  const { data, error } = await sb.from("holes").select("id,ddh_name").eq("archived", false).not("ddh_name", "is", null);
  if (error) throw error;
  const m = new Map<string, string>();
  for (const h of data!) if (h.ddh_name) m.set(h.ddh_name.trim().toLowerCase(), h.id);
  return m;
}

/* ---------------- IMDEXHUB-IQ surveys ---------------- */
async function syncSurveys(sec: Secrets, t0: number) {
  const H = { Authorization: "ApiKey " + sec.imdex_api_key, "Ocp-Apim-Subscription-Key": sec.imdex_apim_key };
  const holes = await holeMap();
  const projects = (await getJson(`${IMDEX}/plan/v1/projects?$top=100`, H)).value ?? [];
  // HUB-IQ's first page per cursor can take a minute, so each tick handles ONE project: the one synced longest ago.
  const { data: states } = await sb.from("sync_state").select("key,value,updated_at").like("key", "imdex:%");
  const stMap = new Map((states ?? []).map((x: any) => [x.key, x]));
  projects.sort((a: any, b: any) => (stMap.get(`imdex:${a.Id}`)?.updated_at ?? "").localeCompare(stMap.get(`imdex:${b.Id}`)?.updated_at ?? ""));
  const out: string[] = [];
  for (const p of projects.slice(0, 1)) {
    const key = `imdex:${p.Id}`;
    const st = stMap.get(key);
    let cursor: { LastModified: string; LastId: string } | null = st?.value?.LastModified ? st.value : null;
    let url = `${IMDEX}/survey/v1/surveys?projectId=${p.Id}&$top=500` +
      (cursor ? `&$deltaToken=${encodeURIComponent(btoa(JSON.stringify(cursor)).replace(/=+$/, ""))}` : "");
    let n = 0, pages = 0, maxMod = cursor?.LastModified ?? "", maxId = cursor?.LastId ?? "00000000-0000-0000-0000-000000000000", partial = false;
    while (url) {
      const d = await getJson(url, H);
      const rows = (d.value ?? []).filter((s: any) => s.Id).map((s: any) => ({
        id: s.Id, project_name: s.ProjectName ?? p.Name, drillhole_id: s.DrillholeId, hole_name: s.DrillholeName ?? "",
        hole_id: holes.get((s.DrillholeName ?? "").trim().toLowerCase()) ?? null, tool: s.ToolType, run_name: s.SurveyRunName,
        reading_type: s.ReadingType, depth: s.Depth, dip: s.Dip, azimuth: s.TnAzimuth, status: s.Status,
        date_created: s.DateCreated, date_updated: s.DateUpdated ?? s.DateCreated, synced_at: new Date().toISOString(),
      }));
      for (const s of d.value ?? []) { const m = s.DateUpdated ?? s.DateCreated ?? ""; if (m > maxMod) { maxMod = m; maxId = s.Id; } }
      if (rows.length) { const { error } = await sb.from("surveys").upsert(rows, { onConflict: "id" }); if (error) throw error; }
      n += rows.length; pages++;
      url = d["@nextLink"] ?? null;
      if (url && Date.now() - t0 > BUDGET_MS) { partial = true; break; }
    }
    if (maxMod) await sb.from("sync_state").upsert({ key, value: { LastModified: maxMod, LastId: maxId }, updated_at: new Date().toISOString() });
    out.push(`${p.Name}: ${n} records in ${pages} page(s)${partial ? " (more next run)" : ""}`);
  }
  return out.join(" · ");
}

/* ---------------- RJLL portal ---------------- */
type Line = { shift: string; hole: string; type: string; de: number; a: number; fores: number; done: boolean };

function shiftRow(lines: Line[], rig_id: string, date: string, shift: string) {
  const main = lines[lines.length - 1].hole;
  const mine = lines.filter(l => l.hole === main && l.type !== "Reaming");
  const total = lines.reduce((s, l) => s + l.fores, 0);
  const notes: string[] = [];
  for (const h of [...new Set(lines.filter(l => l.hole !== main).map(l => l.hole))]) {
    const hl = lines.filter(l => l.hole === h), m = hl.reduce((s, l) => s + l.fores, 0);
    notes.push(`${h} ${g(hl[0].de)}->${g(hl[hl.length - 1].a)} m (${g(m)} m${hl.some(l => l.done) ? ", hole done" : ""})`);
  }
  for (const l of lines) {
    if (l.type === "Reaming") notes.push(`reaming ${l.hole} ${g(l.de)}->${g(l.a)} m`);
    else if (l.type === "Casing" && l.hole === main) notes.push(`casing ${g(l.de)}->${g(l.a)} m`);
  }
  if (lines.some(l => l.hole === main && l.done)) notes.push("hole done");
  return { rig_id, shift_date: date, shift, hole_name: main, start_m: mine.length ? r2(mine[0].de) : null,
    end_m: mine.length ? r2(mine[mine.length - 1].a) : null, total_m: r2(total), comment: notes.join("; "), source: "rjll" };
}

async function syncRjll(sec: Secrets) {
  const today = new Date(), from = new Date(today.getTime() - 20 * 86400e3), to = new Date(today.getTime() + 86400e3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const data = await getJson(`https://portail.rjll.ca/api.php?type=json&token=${sec.rjll_api_token}&dateFrom=${iso(from)}&dateTo=${iso(to)}`, {});
  const rows: any[] = []; let nRep = 0;
  for (const c of data.contrats ?? []) for (const rep of c.rapports ?? []) {
    nRep++;
    const rig = String(rep.foreuse ?? "").replace(/-/g, "").toUpperCase();
    const lines: Line[] = [];
    for (const p of [...(rep.plans ?? [])].sort((a, b) => a.id - b.id)) {
      if (!p.trou) continue;
      const de = parseFloat(p.profondeur_from || "0"), a = parseFloat(p.profondeur_to || "0"), f = parseFloat(p.fores || "0");
      if ([de, a, f].some(Number.isNaN)) continue;
      lines.push({ shift: p.shift === "jour" ? "day" : "night", hole: String(p.trou).trim().toUpperCase(),
        type: p.format === "NW" ? "Casing" : (f === 0 && a > de ? "Reaming" : "Drilling"), de, a, fores: f, done: p.bool_trou_termine === "on" });
    }
    const pend = !["approved", "internalapproved"].includes(rep.statut);
    for (const shift of ["day", "night"]) {
      const sl = lines.filter(l => l.shift === shift); if (!sl.length) continue;
      const row = shiftRow(sl, rig, rep.date, shift);
      if (pend) row.comment = ("RJLL pending; " + row.comment).replace(/; $/, "");
      rows.push(row);
    }
  }
  const { data: rigs } = await sb.from("rigs").select("id"); const rigSet = new Set((rigs ?? []).map(r => r.id));
  const holes = await holeMap();
  const { data: ex, error } = await sb.from("shift_entries").select("rig_id,shift_date,shift,hole_name,start_m,end_m,total_m,comment,created_at")
    .in("source", ["rjll", "spektra"]).gte("shift_date", iso(from)).order("created_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, any>();
  for (const e of ex ?? []) { const k = `${e.rig_id}|${e.shift_date}|${e.shift}`; if (!latest.has(k)) latest.set(k, e); }
  const same = (a: any, b: any) => a && a.hole_name === b.hole_name && a.comment === b.comment &&
    r2(a.start_m) === b.start_m && r2(a.end_m) === b.end_m && r2(a.total_m) === b.total_m;
  const skipped: string[] = [], fresh: any[] = [];
  for (const r of rows) {
    if (!rigSet.has(r.rig_id)) { skipped.push(r.rig_id); continue; }
    if (same(latest.get(`${r.rig_id}|${r.shift_date}|${r.shift}`), r)) continue;
    const hid = holes.get(r.hole_name.toLowerCase()); if (hid) (r as any).hole_id = hid;
    fresh.push(r);
  }
  if (fresh.length) { const { error: e2 } = await sb.from("shift_entries").insert(fresh); if (e2) throw e2; }
  return `${nRep} reports, ${rows.length} shifts, ${fresh.length} new/changed` + (skipped.length ? ` · unknown rigs: ${[...new Set(skipped)].join(",")}` : "");
}

/* ---------------- entry ---------------- */
Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  const mode = new URL(req.url).searchParams.get("mode") ?? "";
  const { data: sec, error: se } = await sb.rpc("sync_secrets");
  if (se || !sec?.sync_key) return new Response("secrets missing in vault", { status: 500 });
  if (req.headers.get("x-sync-key") !== sec.sync_key) return new Response("forbidden", { status: 403 });
  if (!["surveys", "rjll"].includes(mode)) return new Response("mode must be surveys or rjll", { status: 400 });

  const { data: run } = await sb.from("sync_runs").insert({ kind: mode === "surveys" ? "imdex surveys" : "rjll api", status: "running" }).select("id").single();
  let status = "ok", message = "";
  try { message = mode === "surveys" ? await syncSurveys(sec, t0) : await syncRjll(sec); }
  catch (e) { status = "error"; message = String(e?.message ?? e).slice(0, 1500); }
  message += ` (${Math.round((Date.now() - t0) / 1000)} s)`;
  if (run?.id) await sb.from("sync_runs").update({ status, message, finished_at: new Date().toISOString() }).eq("id", run.id);
  return new Response(JSON.stringify({ status, message }), { status: status === "ok" ? 200 : 500, headers: { "Content-Type": "application/json" } });
});
