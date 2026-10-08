import { guard } from "@/lib/api";
export const runtime = "nodejs";
const TABLES = ["settings", "companies", "contacts", "offers", "referral_partners", "leads", "deals", "payments", "commissions", "voice_updates", "activities", "tasks",
  "linkedin_imports", "linkedin_conversations", "linkedin_messages", "suggestions", "audit_logs"];

export async function GET() {
  const g = await guard("export", 5); if ("res" in g) return g.res;
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
  for (const t of TABLES) {
    const rows: unknown[] = []; for (let from = 0; ; from += 1000) {
      const { data } = await g.sb.from(t).select("*").range(from, from + 999); rows.push(...(data ?? [])); if ((data?.length ?? 0) < 1000) break;
    }
    out[t] = rows;
  }
  await g.sb.from("audit_logs").insert({ action: "data.export" });
  return new Response(JSON.stringify(out, null, 1), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="vault-sales-os-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
