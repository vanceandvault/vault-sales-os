import { z } from "zod";
import { parseGermanDate, weekdayName, type ParsedDate } from "./dates";
import { SAFETY, untrusted, type Llm } from "./ai";

export const STAGES = ["new", "contacted", "replied", "qualified", "call_booked", "call_completed", "proposal", "decision_pending", "won", "lost"] as const;
export const STAGE_LABEL: Record<string, string> = { new: "Neu", contacted: "Kontaktiert", replied: "Geantwortet", qualified: "Qualifiziert", call_booked: "Call gebucht",
  call_completed: "Call erledigt", proposal: "Angebot", decision_pending: "Entscheid offen", won: "Gewonnen", lost: "Verloren" };
export const ACTIVITY_TYPES = ["call", "call_attempt", "email", "linkedin_message", "linkedin_reply", "meeting", "proposal", "note", "follow_up", "other"] as const;
export const OUTCOMES = ["no_answer", "spoke", "message_sent", "interested", "meeting_booked", "proposal_sent", "decision_pending", "other"] as const;

/** What the model may return. Everything is nullable: "unknown" must be expressible. */
export const AiUpdateSchema = z.object({
  company_name: z.string().nullable(), contact_name: z.string().nullable(),
  activity_type: z.enum(ACTIVITY_TYPES), outcome: z.enum(OUTCOMES).nullable(),
  summary: z.string().max(600),
  suggested_stage: z.enum(STAGES).nullable(), suggested_temperature: z.enum(["hot", "warm", "cold"]).nullable(),
  deal_value: z.number().nonnegative().nullable(), expected_mrr: z.number().nonnegative().nullable(), offer_name: z.string().nullable(),
  pain_points: z.array(z.string()).max(8), objections: z.array(z.string()).max(8), buying_signals: z.array(z.string()).max(8),
  decision_makers: z.string().nullable(), timing: z.string().nullable(),
  next_action_title: z.string().nullable(), next_action_due_phrase: z.string().nullable().describe("Wörtlich genannter Zeitpunkt, z.B. 'Freitag', 'übermorgen', 'im Januar'"),
  next_action_due_iso: z.string().nullable().describe("YYYY-MM-DD, nur wenn eindeutig"),
  won_claimed: z.boolean().describe("Nur true, wenn ausdrücklich gesagt wird, dass der Kunde zugesagt/bestätigt hat"),
  lost_claimed: z.boolean(), not_interested: z.boolean(),
  confidence: z.number().min(0).max(1), clarification_required: z.string().nullable(),
});
export type AiUpdate = z.infer<typeof AiUpdateSchema>;

export type LeadRef = { id: string; company: string | null; contact: string | null; stage: string };

// ───────── matching (deterministic, server side) ─────────
const SUFFIX = /\b(ag|gmbh|sa|sàrl|sarl|kg|ltd|inc|llc|co|und|&)\b/g;
export const normCompany = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(SUFFIX, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function lev(a: string, b: string) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
const sim = (a: string, b: string) => {
  if (!a || !b) return 0; if (a === b) return 1;
  const ta = a.split(" "), tb = b.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.every((t, i) => t === long[i])) return 0.9;   // "HLI" ↔ "HLI Gebäudetechnik", "Elle Facility" ↔ "ELLE Facility Services"
  return 1 - lev(a, b) / Math.max(a.length, b.length);
};

export type Match = { status: "exact" | "ambiguous" | "none"; candidates: { lead_id: string; label: string; score: number }[] };
export function matchLead(companyName: string | null, contactName: string | null, leads: LeadRef[]): Match {
  const c = normCompany(companyName ?? ""), k = normCompany(contactName ?? "");
  if (!c && !k) return { status: "none", candidates: [] };
  const scored = leads.map((l) => {
    const sc = c ? sim(c, normCompany(l.company ?? "")) : 0, sk = k ? sim(k, normCompany(l.contact ?? "")) : 0;
    const score = c && k ? Math.max(sc, sk) * 0.7 + Math.min(sc, sk) * 0.3 : Math.max(sc, sk);
    return { lead_id: l.id, label: [l.company, l.contact].filter(Boolean).join(" — "), score, active: l.stage !== "won" && l.stage !== "lost" };
  }).filter((x) => x.score >= 0.75).sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active));
  if (!scored.length) return { status: "none", candidates: [] };
  const top = scored[0], second = scored[1];
  const status = top.score >= 0.9 && (!second || top.score - second.score >= 0.15) ? "exact" : "ambiguous";
  return { status, candidates: scored.slice(0, 4).map(({ lead_id, label, score }) => ({ lead_id, label, score: Math.round(score * 100) / 100 })) };
}

export type Proposal = AiUpdate & { match: Match; due: ParsedDate | null; needs_won_confirmation: boolean; warnings: string[] };

export function buildProposal(ai: AiUpdate, leads: LeadRef[], today: string): Proposal {
  const match = matchLead(ai.company_name, ai.contact_name, leads);
  let due: ParsedDate | null = null; const warnings: string[] = [];
  if (ai.next_action_due_phrase) due = parseGermanDate(ai.next_action_due_phrase, today);   // explicit commitment wins, resolved deterministically
  if (!due && ai.next_action_due_iso && /^\d{4}-\d{2}-\d{2}$/.test(ai.next_action_due_iso) && ai.next_action_due_iso >= today) due = { date: ai.next_action_due_iso, approximate: false };
  if (ai.next_action_due_phrase && !due) warnings.push(`Zeitpunkt "${ai.next_action_due_phrase}" nicht eindeutig – bitte Datum wählen.`);
  if (due?.approximate) warnings.push(due.note ?? "Datum ist ungefähr – bitte prüfen.");
  if (match.status === "ambiguous") warnings.push("Mehrere mögliche Treffer – bitte den richtigen Lead wählen.");
  if (ai.confidence < 0.5) warnings.push("Die KI ist unsicher – bitte alles prüfen.");
  if (ai.clarification_required) warnings.push(ai.clarification_required);
  const won = ai.won_claimed;
  return { ...ai, suggested_stage: won ? "won" : ai.lost_claimed ? "lost" : ai.suggested_stage, match, due, needs_won_confirmation: won, warnings };
}

export async function interpretTranscript(transcript: string, leads: LeadRef[], today: string, llm: Llm): Promise<Proposal> {
  const list = leads.slice(0, 300).map((l) => `- ${l.company ?? "(ohne Firma)"} / ${l.contact ?? "(ohne Kontakt)"} [${l.stage}]`).join("\n");
  const user = `Heute ist ${weekdayName(today)}, ${today.split("-").reverse().join(".")} (Europe/Zurich).
Bekannte Leads (nur zur Namenszuordnung; gib den Namen so zurück, wie er im Transkript gemeint ist, bei Zuordnung den bekannten Schreibweise):
${list || "(keine)"}

Sprachnotiz des Inhabers:
${untrusted(transcript)}

Extrahiere das CRM-Update. Regeln: won_claimed nur bei ausdrücklicher Zusage. Frist wörtlich in next_action_due_phrase übernehmen (kein Standard erfinden). Betrag in CHF als Zahl. Bei Unklarheit: null und clarification_required setzen. Standard-Folgeaktionen nur, wenn keine Frist genannt wurde: nicht erreicht → in 2 Tagen erneut versuchen.`;
  const raw = await llm({ system: SAFETY, user, schema: AiUpdateSchema, name: "record_crm_update", description: "Strukturiertes CRM-Update aus einer Sprachnotiz" });
  const parsed = AiUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new Error("KI-Antwort ungültig: " + parsed.error.issues[0]?.message);
  const p = buildProposal(parsed.data, leads, today);
  // default follow-up only if the user named no date (explicit commitments always override defaults)
  if (!p.due && !p.next_action_due_phrase && p.outcome === "no_answer" && p.suggested_stage !== "won") {
    const d = parseGermanDate("in 2 Tagen", today)!; p.due = d; p.warnings.push("Standard-Folgeaktion (in 2 Tagen) – keine Frist genannt.");
    p.next_action_title ??= "Erneut versuchen";
  }
  return p;
}
