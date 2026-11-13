// invite-member: called by the Admin tab. Adds (or updates) the members row, creates the login if it does not
// exist yet, and emails the person a one-time link to mgmdrill.com where they choose their password.
// Body: { email, name?, role, resend?: true }. Caller must be a signed-in admin (checked with their JWT via my_role()).
// Secrets: RESEND_API_KEY (Edge Function secret). Optional MAIL_FROM, SITE_URL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = Deno.env.get("SITE_URL") || "https://mgmdrill.com";
const FROM = Deno.env.get("MAIL_FROM") || "MGM Drill Tracking <noreply@mgmcamp.com>";
const ROLES = new Set(["admin", "editor", "viewer"]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function mail(name: string, role: string, link: string, isNew: boolean, inviter: string) {
  const hello = name ? `Hi ${esc(name)},` : "Hello,";
  const what = isNew
    ? `${esc(inviter)} gave you access to the Maple Gold Mines drill-tracking site as <b>${esc(role)}</b>. Click the button to choose your password; after that you sign in at <a href="${SITE}">${SITE.replace("https://", "")}</a> with this email address.`
    : `Here is a fresh sign-in link for the Maple Gold Mines drill-tracking site (role <b>${esc(role)}</b>). Click it to set a new password.`;
  return `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Lato,Arial,sans-serif;color:#1c1a16">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#121212;border-bottom:2px solid #d7b973;padding:14px 18px;border-radius:10px 10px 0 0">
      <div style="color:#f5f1e6;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:14px">Maple Gold Mines</div>
      <div style="color:#d7b973;font-weight:700;letter-spacing:.18em;font-size:10px">DRILL TRACKING</div>
    </div>
    <div style="background:#fff;border:1px solid #d9d3c4;border-top:0;border-radius:0 0 10px 10px;padding:18px">
      <p style="margin:0 0 10px">${hello}</p>
      <p style="margin:0 0 16px">${what}</p>
      <p style="margin:0 0 16px"><a href="${link}" style="background:#121212;color:#f5f1e6;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:700">Set my password</a></p>
      <p style="color:#6a6457;font-size:12px;margin:0">The link works once and expires in 24 hours. If it has expired, use <i>Forgot password</i> on the sign-in page, or ask ${esc(inviter)} to send a new one.</p>
    </div>
    <p style="color:#6a6457;font-size:12px;margin:12px 4px 0">Sent automatically by the drill-tracking site. Replies are not read.</p>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  // who is calling? run my_role() as the caller
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply(401, { error: "sign in first" });
  const asCaller = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: me } = await asCaller.auth.getUser();
  if (!me?.user?.email) return reply(401, { error: "sign in first" });
  const { data: role } = await asCaller.rpc("my_role");
  if (role !== "admin") return reply(403, { error: "admins only" });

  let body: any; try { body = await req.json(); } catch { return reply(400, { error: "bad json" }); }
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const newRole = String(body.role || "viewer");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: "that is not an email address" });
  if (!ROLES.has(newRole)) return reply(400, { error: "unknown role" });

  // 1. membership (role) lives in members; RLS and my_role() read it live, so this is the permission change
  const { error: mErr } = await admin.from("members").upsert({ email, name, role: newRole }, { onConflict: "email" });
  if (mErr) return reply(500, { error: mErr.message });

  // 2. login: invite link for a new person, recovery link for someone who already has an account
  let isNew = true;
  let gen = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { name }, redirectTo: SITE } });
  if (gen.error && /already|exists|registered/i.test(gen.error.message)) {
    isNew = false;
    gen = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: SITE } });
  }
  if (gen.error) return reply(500, { error: gen.error.message, member_saved: true });
  const th = gen.data.properties?.hashed_token;
  const link = `${SITE}/?token_hash=${encodeURIComponent(th!)}&type=${isNew ? "invite" : "recovery"}`;

  // 3. the email
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return reply(200, { ok: true, emailed: false, isNew, error: "RESEND_API_KEY is not set on the function; the account exists but no email went out" });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], reply_to: me.user.email, subject: isNew ? "Your access to MGM drill tracking" : "MGM drill tracking: set a new password", html: mail(name, newRole, link, isNew, me.user.email) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return reply(200, { ok: true, emailed: false, isNew, error: `mail failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}` });
  return reply(200, { ok: true, emailed: true, isNew, id: j.id });
});
