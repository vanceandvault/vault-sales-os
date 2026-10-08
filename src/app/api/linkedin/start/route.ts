import { z } from "zod";
import { err, guard } from "@/lib/api";
export const runtime = "nodejs";
const Body = z.object({ fileName: z.string().min(1).max(200), fingerprint: z.string().regex(/^[0-9a-f]{64}$/), selfName: z.string().trim().max(200).optional() });

export async function POST(req: Request) {
  const g = await guard("li-start", 30); if ("res" in g) return g.res;
  const b = Body.safeParse(await req.json().catch(() => null)); if (!b.success) return err("Ungültige Eingabe");
  const { sb, user } = g;
  const { data: prev } = await sb.from("linkedin_imports").select("id, finished_at").eq("file_fingerprint", b.data.fingerprint).eq("status", "completed").limit(1);
  const { data: settings } = await sb.from("settings").select("self_name").maybeSingle();
  let selfName = settings?.self_name ?? null;
  if (b.data.selfName && b.data.selfName !== selfName) { selfName = b.data.selfName; await sb.from("settings").upsert({ user_id: user.id, self_name: selfName }); }
  const { data: imp, error } = await sb.from("linkedin_imports").insert({ file_name: b.data.fileName.replace(/[^\w.\- ]/g, "_"), file_fingerprint: b.data.fingerprint }).select("id").single();
  if (error || !imp) return err("Import konnte nicht gestartet werden", 500);
  return Response.json({ importId: imp.id, selfName, alreadyImported: !!prev?.length });
}
