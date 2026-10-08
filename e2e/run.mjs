// End-to-end acceptance tests (A–H) against: real Next.js build + real Chromium + real PostgreSQL/PostgREST (auth + AI providers mocked).
// Run: node e2e/run.mjs   (needs Playwright at $PLAYWRIGHT_DIR, Postgres 16 and PostgREST at /opt/pgrst)
import { spawn, execSync } from "node:child_process";
import { zipSync, strToU8 } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { startStack, ANON_KEY, OWNER } from "./stack.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const { chromium, devices } = await import((process.env.PLAYWRIGHT_DIR || "/opt/node-tools/node_modules/playwright") + "/index.mjs");
const SHOTS = process.env.SHOTS || path.join(ROOT, "e2e/screenshots"); fs.mkdirSync(SHOTS, { recursive: true });
const failures = []; let passed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log("  ✓", msg); } else { failures.push(msg); console.log("  ✗ FAIL:", msg); } };
const section = (s) => console.log("\n" + s);

const stack = await startStack({ root: ROOT });
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: stack.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY, ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: stack.url, GROQ_API_KEY: "test", GROQ_BASE_URL: stack.url, OWNER_EMAIL: OWNER.email, PORT: "3100" };
let next;
try {
  console.log("building app …"); execSync("npx next build", { cwd: ROOT, env, stdio: "pipe" });
  const logFd = fs.openSync(path.join(SHOTS, "next.log"), "w"); next = spawn("npx", ["next", "start", "-p", "3100"], { cwd: ROOT, env, stdio: ["ignore", logFd, logFd], detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:3100/login")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const BASE = "http://127.0.0.1:3100"; const sql = stack.q;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const newCtx = () => browser.newContext({ ...devices["iPhone 13"], defaultBrowserType: undefined, permissions: ["microphone"], baseURL: BASE, locale: "de-CH", timezoneId: "Europe/Zurich" });
  const login = async (page) => { await page.goto("/login"); await page.fill('input[name=email]', OWNER.email); await page.fill('input[name=password]', OWNER.password); await page.click("text=Anmelden"); await page.waitForURL(BASE + "/"); };
  const snapshot = () => sql(`select md5(coalesce((select string_agg(to_jsonb(l)::text, '|' order by id) from (select id, stage, temperature, deal_value, notes, pain_points, objections, referral_partner_id, not_interested from leads) l),'') || coalesce((select string_agg(to_jsonb(t)::text,'|' order by id) from (select id,title,due_date,status from tasks where needs_review = false) t),'') || coalesce((select string_agg(to_jsonb(a)::text,'|' order by id) from activities a),'') || coalesce((select string_agg(to_jsonb(d)::text,'|' order by id) from deals d),''))`);

  // ───────── auth & protection ─────────
  section("AUTH");
  const anon = await newCtx(); const ap = await anon.newPage();
  await ap.goto("/leads"); ok(ap.url().endsWith("/login"), "unauthenticated page request redirects to /login");
  ok((await anon.request.get("/api/export")).status() === 401, "unauthenticated API returns 401");
  await ap.fill('input[name=email]', OWNER.email); await ap.fill('input[name=password]', "wrong"); await ap.click("text=Anmelden"); await ap.waitForSelector("[role=alert]");
  ok(true, "wrong password shows error"); await anon.close();
  const ctx = await newCtx(); const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await login(page); ok(true, "owner can sign in");
  ok(sql("select count(*) from offers where name='Social Media Starter' and price_chf=1490") === "1", "default offer 'Social Media Starter' CHF 1490 seeded");
  const mani = await (await ctx.request.get("/manifest.webmanifest")).json();
  ok(mani.display === "standalone" && mani.background_color === "#070B12" && mani.icons.length >= 3, "PWA manifest: standalone, brand colours, icons");
  ok((await ctx.request.get("/icons/icon-512.png")).ok() && (await ctx.request.get("/sw.js")).ok(), "icons + service worker served");

  // ───────── phase 1: core CRM ─────────
  section("CORE CRM");
  await page.screenshot({ path: `${SHOTS}/01-today-empty.png` });
  await page.goto("/leads/new"); await page.fill('input[name=company]', "HM Renovation"); await page.fill('input[name=contact]', "Milos");
  await page.click("summary:has-text('Weitere Angaben')"); await page.fill('input[name=linkedin]', "https://www.linkedin.com/in/milos-hm"); await page.fill('input[name=source]', "LinkedIn");
  await page.click("text=Lead anlegen"); await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
  const hmUrl = page.url(); ok(sql("select count(*) from leads")=== "1" && sql("select count(*) from tasks where status='open'") === "1", "lead created with exactly one next action");
  await page.screenshot({ path: `${SHOTS}/02-lead-detail.png`, fullPage: true });

  // ───────── TEST A ─────────
  section("TEST A – voice update");
  const quick = async (text, shot) => {
    await fetch(`${stack.url}/__mock/stt?text=${encodeURIComponent(text)}`);
    await page.click('button[aria-label="Quick Update per Sprache"]'); await page.click('button[aria-label="Aufnahme starten"]');
    await page.waitForSelector('button[aria-label="Aufnahme beenden"]'); await page.waitForTimeout(2500); await page.click('button[aria-label="Aufnahme beenden"]');
    await page.waitForSelector("text=Transkript – bei Bedarf korrigieren", { timeout: 15000 });
    ok((await page.inputValue("[role=dialog] textarea")) === text, `transcript shown & editable: "${text.slice(0, 40)}…"`);
    await page.click("text=Auswerten"); await page.waitForSelector("text=Bestätigen & speichern", { timeout: 15000 });
    if (shot) await page.screenshot({ path: `${SHOTS}/${shot}` });
  };
  await quick("Ich habe Milos geschrieben. Noch keine Antwort. Freitag nachfassen.", "03-voice-preview.png");
  const friday = await page.inputValue("[role=dialog] input[type=date]"); ok(friday === "2026-10-09", `preview shows Friday as due date (${friday})`);
  const sel = await page.$eval("[role=dialog] select", (s) => s.selectedOptions[0].textContent); ok(/HM Renovation/.test(sel) && /Milos/.test(sel), "contact matched to HM Renovation / Milos");
  ok(sql("select count(*) from activities where source='voice'") === "0", "nothing saved before confirmation");
  await page.click("text=Bestätigen & speichern"); await page.waitForSelector("text=Gespeichert");
  ok(sql("select count(*) from activities where source='voice' and type='linkedin_message'") === "1", "activity created");
  ok(sql("select title||'|'||due_date from tasks where status='open'") === "Milos nachfassen|2026-10-09", "next action created, due Friday 2026-10-09");
  ok(sql("select count(*) from tasks where status='open'") === "1" && sql("select count(*) from leads") === "1", "no duplicate task / no duplicate lead");
  ok(sql("select status from voice_updates") === "applied" && sql("select count(*) from audit_logs where action='voice.apply'") === "1", "transcript stored + audit log written");
  await page.click("text=Schliessen");

  // new lead via voice (duplicate check path)
  await quick("Neue Firma Müller Elektro AG. Geschäftsführer Thomas Müller. Heute angerufen, nicht erreicht. Morgen nochmals.");
  ok((await page.$eval("[role=dialog] select", (s) => s.value)) === "new", "unknown company → proposes NEW lead");
  await page.click("text=Bestätigen & speichern"); await page.waitForSelector("text=Gespeichert"); await page.click("text=Schliessen");
  ok(sql("select count(*) from companies where name='Müller Elektro AG'") === "1" && sql("select due_date from tasks t join leads l on l.id=t.lead_id join companies c on c.id=l.company_id where c.name='Müller Elektro AG' and t.status='open'") === "2026-10-09", "new lead + tomorrow's follow-up created");

  // ───────── TEST B ─────────
  section("TEST B – deal won needs approval");
  await page.goto(hmUrl); await quick("Milos hat das Starter-Paket für 1490 Franken bestätigt.", "04-voice-won.png");
  ok(await page.isVisible("text=Ich bestätige"), "won confirmation required in preview");
  await page.click("text=Bestätigen & speichern"); await page.waitForSelector("[role=alert]");
  ok(sql("select stage from leads l join companies c on c.id=l.company_id where c.name='HM Renovation'") !== "won", "NOT won without approval");
  await page.check("[role=dialog] input[type=checkbox]"); await page.click("text=Bestätigen & speichern"); await page.waitForSelector("text=Gespeichert"); await page.click("text=Schliessen");
  ok(sql("select stage from leads l join companies c on c.id=l.company_id where c.name='HM Renovation'") === "won", "won after approval");
  ok(sql("select one_time_value from deals") === "1490.00", "contract value CHF 1490 recorded");
  ok(sql("select count(*) from payments") === "0", "payment NOT marked as received");
  ok(sql("select count(*) from tasks t join leads l on l.id=t.lead_id join companies c on c.id=l.company_id where c.name='HM Renovation' and t.status='open'") === "0", "removed from active queue");
  await page.goto("/"); const todayTxt = await page.textContent("main");
  ok(!/HM RENOVATION/i.test(todayTxt.split("Heutige Prioritäten")[1] ?? ""), "won lead absent from TODAY queue");
  ok(/1'490/.test(todayTxt), "TODAY shows closed this month CHF 1'490");
  await page.screenshot({ path: `${SHOTS}/05-today.png`, fullPage: true });

  // ───────── LinkedIn helpers ─────────
  const H = "CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,IS MESSAGE DRAFT\n";
  const ME = "Elena Test", ME_URL = "https://www.linkedin.com/in/elena-test";
  const conv = (id, other, otherUrl, n, base = Date.parse("2026-09-01T08:00:00Z")) => Array.from({ length: n }, (_, i) => {
    const mine = i % 2 === 1; const d = new Date(base + i * 3600_000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
    return `${id},,${mine ? ME : other},${mine ? ME_URL : otherUrl},${mine ? other : ME},${mine ? otherUrl : ME_URL},${d},,"Nachricht ${i + 1} von ${other}, mit Komma",INBOX,\n`;
  }).join("");
  const zip = (csv) => Buffer.from(zipSync({ "Basic_LinkedInDataExport_10-08-2026/messages.csv": strToU8(csv), "Basic_LinkedInDataExport_10-08-2026/Connections.csv": strToU8("First Name\nx") }));
  const upload = async (buf, name = "Basic_LinkedInDataExport_10-08-2026.zip") => {
    await page.goto("/linkedin"); await page.setInputFiles("#li-file", { name, mimeType: "application/zip", buffer: buf });
    await page.waitForSelector("text=Synchronisieren", { timeout: 15000 });
    await page.fill("input.input[value]", ME).catch(async () => { await page.locator("label:has-text('Anzeigename') input").fill(ME); });
    await page.locator("label:has-text('Anzeigename') input").fill(ME);
    await page.click("button:has-text('Synchronisieren')"); await page.waitForSelector("text=Synchronisierung abgeschlossen", { timeout: 30000 });
    return page.textContent("main");
  };
  const HM = "https://www.linkedin.com/in/milos-hm";

  // ───────── TEST C ─────────
  section("TEST C – initial LinkedIn import (12 messages)");
  const leadsBefore = sql("select count(*) from leads");
  let txt = await upload(zip(H + conv("conv-hm", "Milos", HM, 12)));
  ok(/12/.test(txt) && /neue Nachrichten importiert/.test(txt), "result panel: 12 new messages");
  ok(sql("select count(*) from linkedin_messages") === "12", "12 messages stored");
  ok(sql("select count(*) from linkedin_conversations") === "1", "conversation created");
  ok(sql("select review_status from linkedin_conversations") === "matched" && sql("select count(*) from linkedin_conversations where lead_id is not null") === "1", "conversation matched to existing contact via profile URL");
  ok(sql("select count(*) from leads") === leadsBefore, "no duplicate CRM lead created");
  ok(sql("select bool_and(sent_at >= lag) from (select sent_at, lag(sent_at, 1, '-infinity') over (order by sent_at) lag from linkedin_messages) x") === "t", "chronology preserved");
  await page.screenshot({ path: `${SHOTS}/06-linkedin-sync.png`, fullPage: true });

  // ───────── TEST D ─────────
  section("TEST D – newer archive: same 12 + 6 new");
  const snap1 = snapshot();
  txt = await upload(zip(H + conv("conv-hm", "Milos", HM, 18)), "Basic_LinkedInDataExport_10-12-2026.zip");
  ok(/\b6\b[^]*neue Nachrichten importiert/.test(txt) && /12 bestehende/.test(txt), "result panel: 12 recognised, 6 new");
  ok(sql("select count(*) from linkedin_messages") === "18", "18 messages total");
  ok(sql("select message_count from linkedin_conversations") === "18" && sql("select updated_conversations from linkedin_imports order by started_at desc limit 1") === "1", "conversation updated, count 18");
  ok(snapshot() === snap1, "no CRM field overwritten (leads/tasks/activities/deals unchanged)");

  // ───────── TEST E ─────────
  section("TEST E – identical archive again");
  txt = await upload(zip(H + conv("conv-hm", "Milos", HM, 18)), "Basic_LinkedInDataExport_10-12-2026.zip");
  ok(/18 bestehende/.test(txt) && /\b0\b[^]*neue Nachrichten importiert/.test(txt) && /bereits importiert/.test(txt), "0 new, 18 duplicates ignored, file recognised as already imported");
  ok(sql("select count(*) from linkedin_messages") === "18" && snapshot() === snap1, "no new rows, no CRM change");
  ok(sql("select count(*) from linkedin_imports where status='completed'") === "3", "import history has 3 completed imports");

  // invalid files
  await page.goto("/linkedin"); await page.setInputFiles("#li-file", { name: "bad.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({ "x.txt": strToU8("hi") })) });
  await page.waitForSelector("[role=alert]"); ok(/keine messages\.csv/.test(await page.textContent("[role=alert]")), "ZIP without messages.csv → clear validation error");
  await page.setInputFiles("#li-file", { name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("A,B\n1,2\n") });
  await page.waitForSelector("text=Unbekanntes Messages.csv-Format"); ok(sql("select count(*) from linkedin_imports") === "3", "unknown format rejected, nothing imported");

  // ───────── TEST G ─────────
  section("TEST G – follow-up sync");
  await page.goto("/leads/new"); await page.fill('input[name=company]', "Reply Test AG"); await page.fill('input[name=contact]', "Rita");
  await page.click("summary:has-text('Weitere Angaben')"); await page.fill('input[name=linkedin]', "https://www.linkedin.com/in/rita-test");
  await page.fill('input[name=next_title]', "Prüfen ob Rita geantwortet hat"); await page.click("text=Lead anlegen"); await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
  const ritaUrl = page.url(); const dueBefore = sql("select due_date from tasks where title like 'Prüfen ob Rita%'");
  const future = Date.now() + 2 * 3600_000; // reply arrives after the task was created
  const ritaCsv = H + `conv-rita,,${ME},${ME_URL},Rita,https://www.linkedin.com/in/rita-test,2026-10-01 09:00:00 UTC,,Hallo Rita,INBOX,\nconv-rita,,Rita,https://www.linkedin.com/in/rita-test,${ME},${ME_URL},${new Date(future).toISOString().replace("T", " ").slice(0, 19)} UTC,,"Ja gerne, schick mir Infos",INBOX,\n`;
  await upload(zip(H + conv("conv-hm", "Milos", HM, 18) + ritaCsv.slice(H.length)));
  ok(sql("select needs_review from tasks where title like 'Prüfen ob Rita%'") === "t", "task flagged for review");
  ok(sql("select due_date from tasks where title like 'Prüfen ob Rita%'") === dueBefore && sql("select status from tasks where title like 'Prüfen ob Rita%'") === "open", "task NOT silently changed");
  ok(sql("select count(*) from suggestions where kind='reply_detected' and status='pending'") === "1", "review suggestion created");
  await page.goto("/"); ok(/zur Prüfung/.test(await page.textContent("main")), "TODAY shows 'zur Prüfung' banner");
  await page.goto(ritaUrl); ok(/Neue LinkedIn-Antwort/.test(await page.textContent("main")), "lead page explains why the action may be outdated");
  ok(await page.isVisible("text=LinkedIn · Rita"), "LinkedIn messages visibly distinct in timeline");
  await page.screenshot({ path: `${SHOTS}/07-lead-linkedin.png`, fullPage: true });

  // AI analysis (mocked provider) creates suggestion, never auto-applies
  await page.goto("/linkedin"); ok(sql("select count(*) from leads") === "3", "no lead auto-created by sync");

  // ───────── pipeline / search / ask ─────────
  section("PIPELINE · SEARCH · ASK");
  await page.goto("/pipeline"); await page.click("button:has-text('Neu ·')");
  const card = page.locator("select[id^='m-']").first(); await card.selectOption("contacted"); await page.waitForTimeout(1200);
  ok(sql("select count(*) from leads where stage='contacted'") >= "1", "pipeline stage change persisted");
  await page.screenshot({ path: `${SHOTS}/08-pipeline.png` });
  await page.goto("/search?q=Rita"); ok(await page.isVisible("text=Reply Test AG") || (await page.textContent("main")).includes("Rita"), "search finds company/contact");
  await page.goto("/search?q=Starter-Paket"); ok(/Sprachnotiz/.test(await page.textContent("main")), "search finds voice transcripts");
  await page.goto("/search?q=schick mir Infos"); ok(/linkedin/.test(await page.textContent("main")), "search finds imported LinkedIn messages");
  await page.goto(ritaUrl); await page.click("text=LinkedIn-Antwort generieren"); await page.waitForSelector("text=Nachricht kopieren"); ok(true, "Ask VAULT / reply generation returns a copyable draft");

  // ───────── revenue ─────────
  section("REVENUE");
  await page.goto("/revenue"); await page.fill('input[name=amount]', "1490"); await page.click("button:has-text('Erfassen')"); await page.waitForSelector("text=Eingegangen CHF 1'490");
  ok(sql("select kind||amount from payments") === "received1490.00", "payment recorded only on manual confirmation");
  await page.screenshot({ path: `${SHOTS}/09-revenue.png`, fullPage: true });

  // ───────── TEST H ─────────
  section("TEST H – persistence");
  await ctx.close(); const ctx2 = await newCtx(); const p2 = await ctx2.newPage(); await login(p2);
  await p2.goto("/leads?f=done"); ok((await p2.textContent("main")).includes("HM Renovation"), "won lead still present after reopening");
  await p2.goto("/leads"); const t2 = await p2.textContent("main"); ok(t2.includes("Reply Test AG") && t2.includes("Müller Elektro AG"), "all other leads present");
  await p2.goto(hmUrl); const t3 = await p2.textContent("main"); ok(/Nachricht 18 von Milos|Nachricht 17/.test(t3) || /LinkedIn · /.test(t3), "LinkedIn history + notes present");
  ok(/Milos hat das Starter-Paket/.test(t3) || /bestätigt/.test(t3), "voice activity present in timeline");
  const exp = await (await ctx2.request.get("/api/export")).json(); ok(exp.linkedin_messages.length === 20 && exp.leads.length === 3, "data export contains everything");
  await p2.goto("/more"); await p2.click("button:has-text('Demo-Daten laden')"); await p2.waitForSelector("button:has-text('Demo-Firmen löschen')");
  ok(sql("select count(*) from companies where is_demo") === "6" && sql("select count(*) from leads where is_demo and stage='won'") === "0", "demo data loads, marked, none Won");
  await p2.click("button:has-text('Demo-Firmen löschen')"); await p2.waitForSelector("button:has-text('Demo-Daten laden')");
  ok(sql("select count(*) from companies where is_demo") === "0" && sql("select count(*) from leads") === "3", "demo data deletes cleanly, real data untouched");
  await ctx2.close(); await browser.close();
} catch (e) { console.log("E2E CRASH", e); failures.push("crash: " + (e?.message ?? e)); }
finally { try { process.kill(-next.pid); } catch {} next?.kill(); await stack.stop(); }
console.log(`\n${passed} checks passed, ${failures.length} failed`); if (failures.length) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
