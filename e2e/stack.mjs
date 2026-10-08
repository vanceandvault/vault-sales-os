// Local test stack: real PostgreSQL + real PostgREST + minimal GoTrue-compatible auth stub + mocked AI providers.
// Used ONLY for automated end-to-end tests. Never part of the deployed app.
import { execSync, spawn } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SECRET = "test-secret-test-secret-test-secret-123456";
export const OWNER = { id: "00000000-0000-0000-0000-0000000000aa", email: "owner@example.com", password: "test-pass-1234" };
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export const jwt = (claims) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(claims), s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url"); return `${h}.${p}.${s}`; };
export const ANON_KEY = jwt({ role: "anon", iss: "e2e", exp: 4102444800 });

export async function startStack({ root, pgPort = 54998, gwPort = 54321, pgrstPort = 3050 }) {
  const PGBIN = process.env.PGBIN || "/usr/lib/postgresql/16/bin"; const dir = fs.mkdtempSync("/tmp/vault-e2e-"); fs.chmodSync(dir, 0o777);
  const asPg = (cmd) => execSync(process.getuid() === 0 ? `su pgtest -c ${JSON.stringify(cmd)}` : cmd, { stdio: "pipe" });
  try { execSync("id pgtest", { stdio: "ignore" }); } catch { execSync("useradd -m pgtest"); }
  asPg(`${PGBIN}/initdb -D ${dir}/data -A trust`); asPg(`${PGBIN}/pg_ctl -D ${dir}/data -o '-p ${pgPort} -k ${dir}' -l ${dir}/log start -w`);
  const psql = (file) => asPg(`psql -h ${dir} -p ${pgPort} -d t -v ON_ERROR_STOP=1 -q -f ${file}`);
  asPg(`createdb -h ${dir} -p ${pgPort} t`);
  const q = (sql) => asPg(`psql -h ${dir} -p ${pgPort} -d t -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`).toString().trim();
  psql(path.join(root, "supabase/test/00_stub_supabase.sql"));
  asPg(`psql -h ${dir} -p ${pgPort} -d t -c "create role authenticator noinherit login; grant anon, authenticated to authenticator;"`);
  for (const f of fs.readdirSync(path.join(root, "supabase/migrations")).sort()) psql(path.join(root, "supabase/migrations", f));
  q(`insert into auth.users(id,email) values ('${OWNER.id}','${OWNER.email}')`);

  const pgrst = spawn("/opt/pgrst/postgrest", [], { env: { ...process.env, PGRST_DB_URI: `postgresql://authenticator@/t?host=${dir}&port=${pgPort}`, PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(pgrstPort), PGRST_DB_POOL: "5" }, stdio: "ignore" });

  const mock = { transcript: "Test", aiCalls: [] };
  const userJson = { id: OWNER.id, aud: "authenticated", role: "authenticated", email: OWNER.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const session = () => { const exp = Math.floor(Date.now() / 1000) + 3600; return { access_token: jwt({ sub: OWNER.id, role: "authenticated", aud: "authenticated", email: OWNER.email, exp }), token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: crypto.randomUUID(), user: userJson }; };
  const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };

  const gw = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/rest/v1/")) {
      const p = http.request({ host: "127.0.0.1", port: pgrstPort, path: url.pathname.replace("/rest/v1", "") + url.search, method: req.method, headers: { ...req.headers, host: "127.0.0.1" } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      p.on("error", () => send(res, 502, { message: "postgrest down" })); req.pipe(p); return;
    }
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      if (url.searchParams.get("grant_type") === "password") return body.email === OWNER.email && body.password === OWNER.password ? send(res, 200, session()) : send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
      return send(res, 200, session());
    }
    if (url.pathname === "/auth/v1/user") {
      const tok = (req.headers.authorization ?? "").replace("Bearer ", "");
      try { const [h, p, s] = tok.split("."); const ok = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") === s; const c = JSON.parse(Buffer.from(p, "base64url")); if (ok && c.sub === OWNER.id && c.exp > Date.now() / 1000) return send(res, 200, userJson); } catch {}
      return send(res, 401, { msg: "invalid JWT" });
    }
    if (url.pathname === "/auth/v1/logout") return send(res, 204);
    // ───── mocked AI providers ─────
    if (url.pathname === "/__mock/stt") { mock.transcript = url.searchParams.get("text") ?? ""; return send(res, 200, { ok: true }); }
    if (url.pathname === "/openai/v1/audio/transcriptions") { await readBody(req); return send(res, 200, { text: mock.transcript }); }
    if (url.pathname === "/v1/messages") {
      const body = JSON.parse((await readBody(req)).toString()); const user = body.messages[0].content; mock.aiCalls.push(body.tools?.[0]?.name ?? "text");
      const tool = body.tools?.[0]?.name; const t = (/<untrusted>\n([\s\S]*?)\n<\/untrusted>/.exec(user) ?? [])[1] ?? "";
      const base = { company_name: null, contact_name: null, activity_type: "note", outcome: null, summary: t.slice(0, 200), suggested_stage: null, suggested_temperature: null, deal_value: null, expected_mrr: null, offer_name: null,
        pain_points: [], objections: [], buying_signals: [], decision_makers: null, timing: null, next_action_title: null, next_action_due_phrase: null, next_action_due_iso: null, won_claimed: false, lost_claimed: false, not_interested: false, confidence: 0.9, clarification_required: null };
      let input;
      if (tool === "record_crm_update") {
        if (/bestätigt/.test(t)) input = { ...base, contact_name: "Milos", activity_type: "note", summary: "Milos bestätigt das Starter-Paket", suggested_stage: "won", deal_value: 1490, offer_name: "Starter", won_claimed: true };
        else if (/Neue Firma/.test(t)) input = { ...base, company_name: "Müller Elektro AG", contact_name: "Thomas Müller", activity_type: "call_attempt", outcome: "no_answer", summary: "Nicht erreicht", next_action_title: "Thomas Müller erneut anrufen", next_action_due_phrase: "morgen" };
        else input = { ...base, contact_name: "Milos", activity_type: "linkedin_message", outcome: "message_sent", summary: "Milos auf LinkedIn geschrieben, noch keine Antwort", next_action_title: "Milos nachfassen", next_action_due_phrase: "Freitag" };
      } else if (tool === "analyze_conversation") input = { summary: "Interesse an Social Media Paket", signals: ["interest"], opportunity: true, evidence: "schick mir Infos", suggested_action: "Infos zum Starter-Paket senden" };
      const content = input ? [{ type: "tool_use", id: "tu_1", name: tool, input }] : [{ type: "text", text: "Bekannt: …\nVorschlag: Kurze Nachricht senden." }];
      return send(res, 200, { id: "msg_1", type: "message", role: "assistant", model: body.model, content, stop_reason: input ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    send(res, 404, { error: "not found " + url.pathname });
  });
  await new Promise((r) => gw.listen(gwPort, r));
  await new Promise((r) => setTimeout(r, 1500)); // let PostgREST connect

  return { dir, q, mock, url: `http://127.0.0.1:${gwPort}`,
    async stop() { gw.close(); pgrst.kill(); try { asPg(`${PGBIN}/pg_ctl -D ${dir}/data stop -m immediate`); } catch {} fs.rmSync(dir, { recursive: true, force: true }); } };
}
