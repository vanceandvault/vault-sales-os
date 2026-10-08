import { z } from "zod";
import { err, guard } from "@/lib/api";
export const runtime = "nodejs";
const Body = z.object({ importId: z.string().uuid(), ok: z.boolean(), errors: z.array(z.string().max(500)).max(50).default([]), skipped: z.number().int().nonnegative().default(0) });

export async function POST(req: Request) {
  const g = await guard("li-finish", 60); if ("res" in g) return g.res;
  const b = Body.safeParse(await req.json().catch(() => null)); if (!b.success) return err("Ungültige Eingabe");
  const errors = b.data.skipped ? [...b.data.errors, `${b.data.skipped} Zeilen übersprungen (Entwürfe/ungültig)`] : b.data.errors;
  const { error } = await g.sb.from("linkedin_imports").update({ status: b.data.ok ? "completed" : "failed", errors, finished_at: new Date().toISOString() }).eq("id", b.data.importId);
  if (error) return err("Abschluss fehlgeschlagen", 500);
  await g.sb.from("audit_logs").insert({ action: b.data.ok ? "linkedin.import" : "linkedin.import_failed", entity: "linkedin_imports", entity_id: b.data.importId });
  const { data } = await g.sb.from("linkedin_imports").select("*").eq("id", b.data.importId).single();
  return Response.json(data);
}
