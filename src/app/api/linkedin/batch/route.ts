import { z } from "zod";
import { err, guard } from "@/lib/api";
export const runtime = "nodejs";
export const maxDuration = 30;

const Msg = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/), sender_name: z.string().max(300), sender_url: z.string().max(500),
  direction: z.enum(["inbound", "outbound"]), sent_at: z.string().datetime(), subject: z.string().max(1000), content: z.string().max(50_000),
});
const Conv = z.object({ conversation_key: z.string().min(1).max(500), title: z.string().max(500), participant_name: z.string().max(300), participant_url: z.string().max(500), messages: z.array(Msg).min(1).max(5000) });
const Body = z.object({ importId: z.string().uuid(), conversations: z.array(Conv).min(1).max(1500) });

export async function POST(req: Request) {
  const g = await guard("li-batch", 400); if ("res" in g) return g.res;
  const b = Body.safeParse(await req.json().catch(() => null)); if (!b.success) return err("Ungültige Daten im Import-Batch: " + (b.error.issues[0]?.path.join(".") ?? ""));
  const { data, error } = await g.sb.rpc("import_linkedin_batch", { p_import: b.data.importId, p_convs: b.data.conversations });
  if (error) { console.error("import batch", error.message); return err("Batch fehlgeschlagen – Import kann gefahrlos wiederholt werden.", 500); }
  return Response.json(data);
}
