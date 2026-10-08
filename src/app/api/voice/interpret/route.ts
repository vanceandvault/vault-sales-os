import { z } from "zod";
import { aiError, err, guard } from "@/lib/api";
import { structuredLlm } from "@/lib/ai";
import { interpretTranscript, matchLead, type LeadRef } from "@/lib/voice";
import { zurichToday } from "@/lib/dates";
export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ transcript: z.string().trim().min(3).max(8000), leadId: z.string().uuid().optional() });

export async function POST(req: Request) {
  const g = await guard("interpret", 40); if ("res" in g) return g.res;
  const body = Body.safeParse(await req.json().catch(() => null)); if (!body.success) return err("Ungültige Eingabe");
  const { sb } = g;

  const { data: rows, error } = await sb.from("leads").select("id, stage, companies(name), contacts(name)").order("updated_at", { ascending: false }).limit(300);
  if (error) return err("Leads konnten nicht geladen werden", 500);
  const leads: LeadRef[] = (rows ?? []).map((r: any) => ({ id: r.id, stage: r.stage, company: r.companies?.name ?? null, contact: r.contacts?.name ?? null }));

  // the raw transcript is stored first: an update is never lost, even if the AI fails
  const { data: vu, error: e2 } = await sb.from("voice_updates").insert({ transcript: body.data.transcript, lead_id: body.data.leadId ?? null }).select("id").single();
  if (e2 || !vu) return err("Speichern des Transkripts fehlgeschlagen", 500);

  try {
    const proposal = await interpretTranscript(body.data.transcript, leads, zurichToday(), structuredLlm);
    if (body.data.leadId) { // opened from a lead: the target is known
      const l = leads.find((x) => x.id === body.data.leadId);
      if (l) proposal.match = { status: "exact", candidates: [{ lead_id: l.id, label: [l.company, l.contact].filter(Boolean).join(" — "), score: 1 }] };
    }
    const { data: offers } = await sb.from("offers").select("id, name").eq("active", true);
    const offer = proposal.offer_name ? offers?.find((o) => o.name.toLowerCase().includes(proposal.offer_name!.toLowerCase().replace(/-?paket|package/g, "").trim()) || proposal.offer_name!.toLowerCase().includes(o.name.toLowerCase())) : undefined;
    await sb.from("voice_updates").update({ proposal }).eq("id", vu.id);
    return Response.json({ voiceUpdateId: vu.id, proposal, offerId: offer?.id ?? null, leads });
  } catch (e) {
    await sb.from("voice_updates").update({ status: "failed" }).eq("id", vu.id);
    const r = aiError(e); const j = await r.clone().json();
    return Response.json({ ...j, voiceUpdateId: vu.id }, { status: r.status });
  }
}
