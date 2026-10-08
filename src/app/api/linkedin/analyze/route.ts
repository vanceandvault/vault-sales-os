import { z } from "zod";
import { aiError, err, guard } from "@/lib/api";
import { SAFETY, structuredLlm, untrusted } from "@/lib/ai";
export const runtime = "nodejs";
export const maxDuration = 60;

const Out = z.object({
  summary: z.string().max(500),
  signals: z.array(z.enum(["interest", "service_question", "budget_objection", "proposal_request", "meeting_suggestion", "referral", "follow_up_commitment", "rejection", "unanswered"])).max(6),
  opportunity: z.boolean().describe("true nur bei belegtem Interesse oder Anfrage"),
  evidence: z.string().max(300).nullable().describe("wörtliches kurzes Zitat, das die Einschätzung belegt"),
  suggested_action: z.string().max(200).nullable(),
});
const Body = z.object({ importId: z.string().uuid() });

/** Optional AI pass over conversations that received NEW inbound messages in this import. Produces suggestions only. */
export async function POST(req: Request) {
  const g = await guard("li-analyze", 10); if ("res" in g) return g.res;
  const b = Body.safeParse(await req.json().catch(() => null)); if (!b.success) return err("Ungültige Eingabe");
  const { sb } = g;
  const { data: msgs } = await sb.from("linkedin_messages").select("conversation_id").eq("import_id", b.data.importId).eq("direction", "inbound");
  const ids = [...new Set((msgs ?? []).map((m) => m.conversation_id))].slice(0, 15);
  let created = 0, analysed = 0;
  try {
    for (const id of ids) {
      const { data: conv } = await sb.from("linkedin_conversations").select("id, participant_name, lead_id, review_status").eq("id", id).single();
      if (!conv || conv.review_status === "ignored") continue;
      const { data: thread } = await sb.from("linkedin_messages").select("direction, sent_at, content").eq("conversation_id", id).order("sent_at", { ascending: false }).limit(25);
      const text = (thread ?? []).reverse().map((m) => `${m.direction === "outbound" ? "ICH" : "GEGENÜBER"} (${m.sent_at.slice(0, 10)}): ${m.content.slice(0, 600)}`).join("\n");
      const raw = await structuredLlm({ system: SAFETY, schema: Out, name: "analyze_conversation", description: "Verkaufssignale in einem LinkedIn-Verlauf",
        user: `Analysiere diesen LinkedIn-Verlauf mit ${conv.participant_name}. Setze opportunity nur bei belegtem Interesse/Anfrage. Gib eine kurze Zusammenfassung.\n${untrusted(text)}` });
      const o = Out.safeParse(raw); if (!o.success) continue; analysed++;
      await sb.from("linkedin_conversations").update({ summary: o.data.summary, summary_message_count: thread?.length ?? 0 }).eq("id", id);
      if (o.data.opportunity && o.data.evidence) {
        const { error } = await sb.from("suggestions").insert({ conversation_id: id, lead_id: conv.lead_id, kind: "new_opportunity", title: `${conv.participant_name}: mögliches Interesse`,
          detail: `${o.data.suggested_action ?? "Gespräch fortführen"}\nBeleg: „${o.data.evidence}“`, payload: { signals: o.data.signals, action: o.data.suggested_action } });
        if (!error) created++;
      }
    }
  } catch (e) { return aiError(e); }
  return Response.json({ analysed, created });
}
