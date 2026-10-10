import { guard } from "@/lib/api";
// Tells the UI which optional services are configured (booleans only – never the keys).
export async function GET() {
  const g = await guard("status", 120); if ("res" in g) return g.res;
  return Response.json({ stt: !!process.env.GROQ_API_KEY, ai: !!process.env.ANTHROPIC_API_KEY });
}
