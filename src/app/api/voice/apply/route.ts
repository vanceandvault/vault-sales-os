import { z } from "zod";
import { err, guard } from "@/lib/api";
import { ACTIVITY_TYPES, OUTCOMES, STAGES } from "@/lib/voice";
export const runtime = "nodejs";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const list = z.array(z.string().trim().min(1).max(200)).max(10);
const Body = z.object({
  voice_update_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  new_lead: z.object({ company_name: z.string().trim().max(200).optional(), contact_name: z.string().trim().max(200).optional(), source: z.string().max(60).optional(), industry: z.string().max(100).optional() }).optional(),
  activity: z.object({ type: z.enum(ACTIVITY_TYPES), outcome: z.enum(OUTCOMES).nullable().optional(), summary: z.string().trim().max(2000).optional() }),
  lead: z.object({
    stage: z.enum(STAGES).nullable().optional(), temperature: z.enum(["hot", "warm", "cold"]).nullable().optional(),
    deal_value: z.number().nonnegative().nullable().optional(), expected_mrr: z.number().nonnegative().nullable().optional(), offer_id: z.string().uuid().nullable().optional(),
    pain_points: list.optional(), objections: list.optional(), buying_signals: list.optional(),
    decision_makers: z.string().max(300).nullable().optional(), timing: z.string().max(300).nullable().optional(), not_interested: z.boolean().optional(), lost_reason: z.string().max(300).optional(),
  }).default({}),
  next_action: z.object({ title: z.string().trim().min(1).max(200), due_date: date }).nullable().optional(),
  won: z.object({ confirmed: z.literal(true), one_time_value: z.number().nonnegative().optional(), monthly_value: z.number().nonnegative().optional(), contract_months: z.number().int().positive().optional() }).optional(),
}).refine((b) => b.lead_id || b.new_lead?.company_name || b.new_lead?.contact_name, { message: "Lead oder neue Firma/Kontakt fehlt" })
  .refine((b) => b.lead?.stage !== "won" || b.won?.confirmed, { message: "Gewonnen erfordert Bestätigung" });

export async function POST(req: Request) {
  const g = await guard("apply", 60); if ("res" in g) return g.res;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return err(body.error.issues[0]?.message ?? "Ungültige Eingabe");
  const { data, error } = await g.sb.rpc("apply_update", { p: body.data });
  if (error) { console.error("apply_update", error.message); return err(error.message.includes("Bestätigung") ? error.message : "Speichern fehlgeschlagen. Entwurf bleibt erhalten – bitte erneut versuchen.", 500); }
  return Response.json(data);
}
