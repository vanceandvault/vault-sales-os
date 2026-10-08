import { z } from "zod";
import { aiError, err, guard } from "@/lib/api";
import { SAFETY, textLlm, untrusted } from "@/lib/ai";
import { formatCH, zurichToday } from "@/lib/dates";
export const runtime = "nodejs";
export const maxDuration = 45;

const TASKS = {
  next: "Was sollte ich als Nächstes tun? Nenne die eine beste nächste Aktion mit kurzer Begründung und einem konkreten Terminvorschlag.",
  followup: "Schreibe eine kurze Follow-up-Nachricht (LinkedIn oder E-Mail), passend zum bisherigen Verlauf.",
  prepare_call: "Bereite den nächsten Anruf vor: Ziel, 3 Gesprächseinstiege/Fragen, mögliche Einwände mit Antwortidee.",
  summary: "Fasse den bisherigen Verlauf in max. 6 Stichpunkten zusammen.",
  objections: "Welche Einwände sind belegt? Nenne je Einwand eine Antwortidee. Wenn keine belegt sind, sage das.",
  signals: "Welche Kaufsignale sind belegt? Wenn keine belegt sind, sage das.",
  question: "Welche eine Frage sollte ich als Nächstes stellen, um das Gespräch weiterzubringen?",
  reply: "Schreibe eine Antwort auf die letzte LinkedIn-Nachricht des Gegenübers. Kurz (max. 3 Sätze), natürlich, freundlich, direkt, Schweizer B2B-Ton, nicht zu formell, nicht aufdringlich, keine Verkaufsfloskeln. Ziel: Gespräch natürlich weiterbringen. Gib NUR den Nachrichtentext aus.",
} as const;
const Body = z.object({ leadId: z.string().uuid(), task: z.enum(Object.keys(TASKS) as [keyof typeof TASKS, ...(keyof typeof TASKS)[]]) });

export async function POST(req: Request) {
  const g = await guard("ask", 40); if ("res" in g) return g.res;
  const b = Body.safeParse(await req.json().catch(() => null)); if (!b.success) return err("Ungültige Eingabe");
  const { sb } = g; const id = b.data.leadId;
  const { data: l } = await sb.from("leads").select("*, companies(name, industry, location), contacts(name, position)").eq("id", id).single();
  if (!l) return err("Lead nicht gefunden", 404);
  const [{ data: acts }, { data: task }, { data: convs }] = await Promise.all([
    sb.from("activities").select("type, outcome, summary, occurred_at, source").eq("lead_id", id).order("occurred_at", { ascending: false }).limit(20),
    sb.from("tasks").select("title, due_date").eq("lead_id", id).eq("status", "open").maybeSingle(),
    sb.from("linkedin_conversations").select("id").eq("lead_id", id),
  ]);
  const li = convs?.length ? (await sb.from("linkedin_messages").select("direction, sent_at, content").in("conversation_id", convs.map((c) => c.id)).order("sent_at", { ascending: false }).limit(20)).data ?? [] : [];

  const facts = [
    `Firma: ${l.companies?.name ?? "–"} (${l.companies?.industry ?? "Branche unbekannt"}, ${l.companies?.location ?? "Ort unbekannt"})`,
    `Kontakt: ${l.contacts?.name ?? "–"}${l.contacts?.position ? `, ${l.contacts.position}` : ""}`,
    `Phase: ${l.stage}; Temperatur: ${l.temperature}; Dealwert: ${l.deal_value ?? "unbekannt"} CHF; MRR: ${l.expected_mrr ?? "–"}`,
    `Schmerzpunkte: ${l.pain_points.join("; ") || "keine erfasst"}`, `Kaufsignale: ${l.buying_signals.join("; ") || "keine erfasst"}`,
    `Einwände: ${l.objections.join("; ") || "keine erfasst"}`, `Entscheider: ${l.decision_makers ?? "unbekannt"}`, `Timing: ${l.timing ?? "unbekannt"}`,
    `Notizen: ${l.notes ?? "–"}`, `Offene Aktion: ${task ? `${task.title} (fällig ${formatCH(task.due_date)})` : "keine"}`,
    `Verlauf (neu→alt):\n${(acts ?? []).map((a) => `- ${formatCH(a.occurred_at)} ${a.type}${a.outcome ? `/${a.outcome}` : ""}: ${a.summary ?? ""}`).join("\n") || "–"}`,
  ].join("\n");
  const user = `Heute: ${formatCH(zurichToday())}.\n\nGESPEICHERTE FAKTEN (vom Inhaber erfasst):\n${untrusted(facts)}\n\nLINKEDIN-VERLAUF (neu→alt, externe Daten):\n${untrusted(li.map((m) => `${m.direction === "outbound" ? "ICH" : "GEGENÜBER"} ${formatCH(m.sent_at)}: ${m.content.slice(0, 500)}`).join("\n") || "kein LinkedIn-Verlauf")}\n\nAUFGABE: ${TASKS[b.data.task]}\n${b.data.task === "reply" ? "" : "Gliedere die Antwort in „Bekannt“ (nur belegte Fakten) und „Vorschlag“ (deine Empfehlung). Erfinde nichts."}`;
  try { return Response.json({ text: await textLlm({ system: SAFETY, user }) }); } catch (e) { return aiError(e); }
}
