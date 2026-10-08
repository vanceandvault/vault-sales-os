"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { addDays, parseGermanDate, zurichToday } from "@/lib/dates";
import { STAGES } from "@/lib/voice";

const s = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
const n = (f: FormData, k: string) => { const v = s(f, k); if (!v) return null; const x = Number(v.replace(/['’\s]/g, "").replace(",", ".")); return Number.isFinite(x) && x >= 0 ? x : null; };
const uuid = (v: string) => { if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error("Ungültige ID"); return v; };
const done = (...paths: string[]) => paths.forEach((p) => revalidatePath(p, p === "/" ? "page" : "layout"));
async function db() { const sb = await supabaseServer(); const { data } = await sb.auth.getUser(); if (!data.user) redirect("/login"); return { sb, uid: data.user.id }; }
function check(error: { message: string } | null) { if (error) { console.error(error.message); throw new Error("Speichern fehlgeschlagen"); } }

// ───── auth ─────
export async function login(f: FormData) {
  const sb = await supabaseServer();
  const owner = process.env.OWNER_EMAIL?.toLowerCase(); const email = String(f.get("email") ?? "").trim();
  if (owner && email.toLowerCase() !== owner) redirect("/login?error=" + encodeURIComponent("Anmeldung fehlgeschlagen"));
  const { error } = await sb.auth.signInWithPassword({ email, password: String(f.get("password") ?? "") });
  if (error) redirect("/login?error=" + encodeURIComponent("Anmeldung fehlgeschlagen"));
  redirect("/");
}
export async function logout() { const sb = await supabaseServer(); await sb.auth.signOut(); redirect("/login"); }

// ───── leads ─────
export async function createLead(f: FormData) {
  const { sb } = await db();
  const company = s(f, "company"), contact = s(f, "contact");
  if (!company && !contact) redirect("/leads/new?error=" + encodeURIComponent("Firma oder Kontakt angeben"));
  let companyId: string | null = null, contactId: string | null = null;
  if (company) { const { data, error } = await sb.from("companies").insert({ name: company, industry: s(f, "industry"), website: s(f, "website"), location: s(f, "location") }).select("id").single(); check(error); companyId = data!.id; }
  if (contact) { const { data, error } = await sb.from("contacts").insert({ company_id: companyId, name: contact, phone: s(f, "phone"), email: s(f, "email"), position: s(f, "position"), linkedin_url: s(f, "linkedin") }).select("id").single(); check(error); contactId = data!.id; }
  const { data: lead, error } = await sb.from("leads").insert({ company_id: companyId, contact_id: contactId, source: s(f, "source"), deal_value: n(f, "deal_value"), temperature: s(f, "temperature") ?? "cold" }).select("id").single();
  check(error);
  await sb.rpc("set_next_action", { p_lead: lead!.id, p_title: s(f, "next_title") ?? "Erstkontakt aufnehmen", p_due: s(f, "next_due") ?? zurichToday(), p_by: "user" });
  done("/", "/leads", "/pipeline");
  redirect(`/leads/${lead!.id}`);
}

export async function updateLead(id: string, f: FormData) {
  const { sb } = await db(); uuid(id);
  const lines = (k: string) => (s(f, k) ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const lead = await sb.from("leads").select("company_id, contact_id").eq("id", id).single();
  const stage = s(f, "stage");
  if (stage && !STAGES.includes(stage as never)) throw new Error("Ungültige Phase");
  if (stage === "won" || stage === "lost") throw new Error("Gewonnen/Verloren nur über die Bestätigung");
  check((await sb.from("leads").update({ temperature: s(f, "temperature") ?? "cold", ...(stage ? { stage } : {}), source: s(f, "source"), deal_value: n(f, "deal_value"), expected_mrr: n(f, "expected_mrr"),
    notes: s(f, "notes"), pain_points: lines("pain_points"), buying_signals: lines("buying_signals"), objections: lines("objections"), decision_makers: s(f, "decision_makers"), timing: s(f, "timing"),
    expected_close: s(f, "expected_close"), offer_id: s(f, "offer_id"), referral_partner_id: s(f, "referral_partner_id"), not_interested: f.get("not_interested") === "on", priority_override: n(f, "priority_override") }).eq("id", id)).error);
  if (lead.data?.company_id) check((await sb.from("companies").update({ name: s(f, "company") ?? "Unbenannt", industry: s(f, "industry"), website: s(f, "website"), location: s(f, "location"), linkedin_url: s(f, "company_linkedin"), instagram: s(f, "company_instagram") }).eq("id", lead.data.company_id)).error);
  if (lead.data?.contact_id) check((await sb.from("contacts").update({ name: s(f, "contact") ?? "Unbenannt", position: s(f, "position"), phone: s(f, "phone"), email: s(f, "email"), linkedin_url: s(f, "linkedin"), instagram: s(f, "instagram") }).eq("id", lead.data.contact_id)).error);
  done("/", "/leads", "/pipeline"); redirect(`/leads/${id}`);
}

export async function moveStage(id: string, stage: string) {
  const { sb } = await db(); uuid(id);
  if (!STAGES.includes(stage as never) || stage === "won" || stage === "lost") return { error: "Gewonnen/Verloren erfordert Bestätigung" };
  const { data: before } = await sb.from("leads").select("stage").eq("id", id).single();
  const { error } = await sb.from("leads").update({ stage }).eq("id", id); if (error) return { error: "Speichern fehlgeschlagen" };
  await sb.from("activities").insert({ lead_id: id, type: "stage_change", summary: `${before?.stage} → ${stage}`, source: "manual" });
  done("/", "/pipeline", "/leads"); return { ok: true };
}

export async function markWon(id: string, f: FormData) {
  const { sb } = await db(); uuid(id);
  if (f.get("confirm") !== "on") redirect(`/leads/${id}?error=` + encodeURIComponent("Bitte Gewinn ausdrücklich bestätigen"));
  const { error } = await sb.rpc("mark_won", { p_lead: id, p_one_time: n(f, "one_time") ?? 0, p_monthly: n(f, "monthly") ?? 0, p_months: n(f, "months") });
  check(error); done("/", "/pipeline", "/leads", "/revenue"); redirect(`/leads/${id}`);
}
export async function markLost(id: string, f: FormData) {
  const { sb } = await db(); uuid(id);
  check((await sb.rpc("mark_lost", { p_lead: id, p_reason: s(f, "reason") })).error); done("/", "/pipeline", "/leads"); redirect(`/leads/${id}`);
}

// ───── tasks ─────
export async function completeTask(taskId: string, f: FormData) {
  const { sb } = await db(); uuid(taskId);
  const outcome = s(f, "outcome") ?? "other";
  const due = s(f, "next_due_text") ? parseGermanDate(s(f, "next_due_text")!, zurichToday())?.date ?? null : s(f, "next_due");
  const { data: t } = await sb.from("tasks").select("lead_id").eq("id", taskId).maybeSingle();
  const { error } = await sb.rpc("complete_task", { p_task: taskId, p_outcome: outcome, p_note: s(f, "note"), p_next_title: s(f, "next_title"), p_next_due: due });
  check(error); done("/", "/pipeline", "/leads", "/activity");
  if (outcome === "won" && t) redirect(`/leads/${t.lead_id}?win=1`);
  if (outcome === "lost" && t) redirect(`/leads/${t.lead_id}?lose=1`);
}
export async function setNextAction(leadId: string, f: FormData) {
  const { sb } = await db(); uuid(leadId);
  const due = s(f, "due") ?? (s(f, "due_text") ? parseGermanDate(s(f, "due_text")!, zurichToday())?.date : null);
  if (!due || !s(f, "title")) redirect(`/leads/${leadId}?error=` + encodeURIComponent("Titel und Datum nötig"));
  check((await sb.rpc("set_next_action", { p_lead: leadId, p_title: s(f, "title"), p_due: due, p_by: "user" })).error); done("/", "/leads");
  redirect(`/leads/${leadId}`);
}
export async function snoozeTask(taskId: string, days: number) {
  const { sb } = await db(); uuid(taskId);
  const { data } = await sb.from("tasks").select("due_date").eq("id", taskId).single();
  const base = data && data.due_date > zurichToday() ? data.due_date : zurichToday();
  check((await sb.from("tasks").update({ due_date: addDays(base, Math.min(Math.max(days, 1), 60)), needs_review: false, review_reason: null }).eq("id", taskId)).error); done("/");
}
export async function clearReview(taskId: string) {
  const { sb } = await db(); uuid(taskId);
  check((await sb.from("tasks").update({ needs_review: false, review_reason: null }).eq("id", taskId)).error);
  await sb.from("suggestions").update({ status: "approved" }).eq("task_id", taskId).eq("status", "pending"); done("/", "/linkedin");
}
export async function addNote(leadId: string, f: FormData) {
  const { sb } = await db(); uuid(leadId); const text = s(f, "text"); if (!text) return;
  check((await sb.from("activities").insert({ lead_id: leadId, type: "note", summary: text, source: "manual" })).error);
  await sb.from("leads").update({ last_interaction_at: new Date().toISOString() }).eq("id", leadId); done(`/leads/${leadId}`, "/activity");
}

// ───── revenue / partners / offers / settings ─────
export async function recordPayment(dealId: string, f: FormData) {
  const { sb } = await db(); uuid(dealId); const kind = s(f, "kind"), amount = n(f, "amount");
  if (!amount || amount <= 0 || (kind !== "invoiced" && kind !== "received")) redirect("/revenue?error=" + encodeURIComponent("Betrag ungültig"));
  check((await sb.rpc("record_payment", { p_deal: dealId, p_kind: kind, p_amount: amount, p_date: s(f, "date"), p_note: s(f, "note") })).error); done("/revenue", "/referrals"); redirect("/revenue");
}
export async function createPartner(f: FormData) {
  const { sb } = await db(); if (!s(f, "name")) return;
  check((await sb.from("referral_partners").insert({ name: s(f, "name"), company: s(f, "company"), commission_pct: n(f, "pct") ?? 0, commission_months: n(f, "months"), commission_basis: s(f, "basis") === "invoiced" ? "invoiced" : "received", notes: s(f, "notes") }).select("id").single()).error); done("/referrals");
}
export async function setCommissionPaid(id: string) {
  const { sb } = await db(); uuid(id); check((await sb.from("commissions").update({ paid: true, paid_on: zurichToday() }).eq("id", id)).error); done("/referrals");
}
export async function saveOffer(f: FormData) {
  const { sb } = await db(); if (!s(f, "name")) return;
  const row = { name: s(f, "name"), kind: s(f, "kind") ?? "one_time", price_chf: n(f, "price") ?? 0, active: f.get("active") !== "off" };
  const id = s(f, "id"); check((id ? await sb.from("offers").update(row).eq("id", uuid(id)) : await sb.from("offers").insert(row)).error); done("/settings");
}
export async function saveSettings(f: FormData) {
  const { sb, uid } = await db(); const cur = (await sb.from("settings").select("*").maybeSingle()).data;
  const fd = { ...(cur?.followup_defaults ?? {}) }; for (const k of ["no_answer", "message_sent", "proposal_sent", "meeting_completed", "decision_pending", "interested"]) { const v = n(f, `fd_${k}`); if (v != null) fd[k] = Math.round(v); }
  const goals = { customers_per_month: n(f, "g_customers") ?? 10, daily_outreach: n(f, "g_outreach") ?? 50, monthly_calls: n(f, "g_calls") ?? 2000, monthly_revenue: n(f, "g_revenue") ?? 10000 };
  check((await sb.from("settings").upsert({ user_id: uid, self_name: s(f, "self_name"), self_linkedin_url: s(f, "self_url"), followup_defaults: fd, goals })).error); done("/settings", "/goals");
}

// ───── LinkedIn review ─────
export async function linkConversation(convId: string, f: FormData) {
  const { sb } = await db(); uuid(convId); const leadId = s(f, "lead_id"); if (!leadId) return;
  const { data: lead } = await sb.from("leads").select("contact_id").eq("id", uuid(leadId)).single();
  const { data: conv } = await sb.from("linkedin_conversations").select("participant_url, participant_name").eq("id", convId).single();
  check((await sb.from("linkedin_conversations").update({ lead_id: leadId, contact_id: lead?.contact_id ?? null, review_status: "matched" }).eq("id", convId)).error);
  if (lead?.contact_id && conv?.participant_url) await sb.from("contacts").update({ linkedin_url: conv.participant_url }).eq("id", lead.contact_id).is("linkedin_url", null);
  done("/linkedin");
}
export async function createFromConversation(convId: string) {
  const { sb } = await db(); uuid(convId);
  const { data: c } = await sb.from("linkedin_conversations").select("participant_name, participant_url").eq("id", convId).single(); if (!c) return;
  const { data: contact, error } = await sb.from("contacts").insert({ name: c.participant_name ?? "Unbekannt", linkedin_url: c.participant_url }).select("id").single(); check(error);
  const { data: lead, error: e2 } = await sb.from("leads").insert({ contact_id: contact!.id, source: "LinkedIn", stage: "contacted" }).select("id").single(); check(e2);
  await sb.rpc("set_next_action", { p_lead: lead!.id, p_title: "LinkedIn-Verlauf prüfen & nächsten Schritt festlegen", p_due: zurichToday(), p_by: "linkedin" });
  check((await sb.from("linkedin_conversations").update({ lead_id: lead!.id, contact_id: contact!.id, review_status: "matched" }).eq("id", convId)).error);
  done("/", "/leads", "/linkedin"); redirect(`/leads/${lead!.id}`);
}
export async function ignoreConversation(convId: string) {
  const { sb } = await db(); check((await sb.from("linkedin_conversations").update({ review_status: "ignored" }).eq("id", uuid(convId))).error); done("/linkedin");
}
export async function dismissSuggestion(id: string) {
  const { sb } = await db(); check((await sb.from("suggestions").update({ status: "dismissed" }).eq("id", uuid(id))).error); done("/linkedin", "/");
}
export async function approveOpportunity(id: string) {
  const { sb } = await db(); uuid(id);
  const { data: sg } = await sb.from("suggestions").select("*").eq("id", id).single(); if (!sg) return;
  let leadId = sg.lead_id as string | null;
  if (!leadId && sg.conversation_id) {
    const { data: c } = await sb.from("linkedin_conversations").select("participant_name, participant_url").eq("id", sg.conversation_id).single();
    const { data: contact } = await sb.from("contacts").insert({ name: c?.participant_name ?? "Unbekannt", linkedin_url: c?.participant_url }).select("id").single();
    const { data: lead } = await sb.from("leads").insert({ contact_id: contact!.id, source: "LinkedIn", stage: "replied" }).select("id").single(); leadId = lead!.id;
    await sb.from("linkedin_conversations").update({ lead_id: leadId, contact_id: contact!.id, review_status: "matched" }).eq("id", sg.conversation_id);
  }
  if (leadId) await sb.rpc("set_next_action", { p_lead: leadId, p_title: (sg.payload as { action?: string })?.action ?? "Auf LinkedIn-Interesse reagieren", p_due: zurichToday(), p_by: "linkedin" });
  check((await sb.from("suggestions").update({ status: "approved" }).eq("id", id)).error); done("/", "/linkedin", "/leads"); if (leadId) redirect(`/leads/${leadId}`);
}

// ───── demo & data control ─────
export async function seedDemo() {
  const { sb } = await db(); const t = zurichToday();
  const rows: [string, string | null, string, string, string, number | null, string, number][] = [
    ["ELLE Facility Services", "Leonidas", "decision_pending", "hot", "Leonidas wegen des Angebots anrufen", 1490, t, 0],
    ["HLI Gebäudetechnik", null, "qualified", "warm", "Nachfassen zum Starter-Paket", 1490, t, 0],
    ["Weber & Partner Elektro AG", null, "contacted", "cold", "Antwort auf LinkedIn prüfen", null, addDays(t, 1), 0],
    ["HM Renovation", "Milos", "qualified", "hot", "Milos nochmals anrufen", 1490, addDays(t, -1), 0],
    ["ELNOVA AG", null, "new", "cold", "Erstkontakt aufnehmen", null, addDays(t, 3), 0],
    ["BNU GmbH", "Qerim", "replied", "warm", "Qerim im Januar kontaktieren (Budget)", null, addDays(t, 60), 0],
  ];
  for (const [co, ct, stage, temp, task, val, due] of rows) {
    const c = await sb.from("companies").insert({ name: co, is_demo: true, industry: "Demo" }).select("id").single(); check(c.error);
    let contactId: string | null = null; if (ct) { const k = await sb.from("contacts").insert({ company_id: c.data!.id, name: ct, is_demo: true }).select("id").single(); check(k.error); contactId = k.data!.id; }
    const l = await sb.from("leads").insert({ company_id: c.data!.id, contact_id: contactId, stage, temperature: temp, deal_value: val, is_demo: true, source: "Demo", proposal_sent: stage === "decision_pending" }).select("id").single(); check(l.error);
    await sb.rpc("set_next_action", { p_lead: l.data!.id, p_title: task, p_due: due, p_by: "system" });
  }
  await sb.from("audit_logs").insert({ action: "demo.seed" }); done("/", "/leads", "/pipeline"); redirect("/more");
}
export async function deleteDemo() { const { sb } = await db(); check((await sb.rpc("delete_demo_data")).error); done("/", "/leads", "/pipeline", "/more"); redirect("/more"); }
export async function deleteEverything(f: FormData) {
  const { sb } = await db(); if (f.get("confirm") !== "ALLES LÖSCHEN") redirect("/settings?error=" + encodeURIComponent("Bestätigungstext stimmt nicht"));
  await sb.from("audit_logs").insert({ action: "data.delete_all" });
  for (const t of ["linkedin_imports", "linkedin_conversations", "voice_updates", "referral_partners", "companies", "contacts", "leads", "offers"]) check((await sb.from(t).delete().not("id", "is", null)).error);
  done("/", "/leads", "/pipeline", "/more", "/linkedin"); redirect("/settings");
}
