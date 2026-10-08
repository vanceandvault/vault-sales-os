import { supabaseServer } from "@/lib/supabase/server";
import { loadLeads, loadSettings } from "@/lib/queries";
import { PageHeader, Stat } from "@/components/ui";
import { actualRate, pct, volumeNeeded, MIN_PROSPECTS_FOR_RATE, MIN_WON_FOR_RATE, type Funnel } from "@/lib/goals";
import { STAGES } from "@/lib/voice";

export const dynamic = "force-dynamic";
const rank = (s: string) => STAGES.indexOf(s as never);
export default async function Goals({ searchParams }: { searchParams: Promise<{ rate?: string }> }) {
  const sp = await searchParams; const sb = await supabaseServer(); const [leads, settings] = await Promise.all([loadLeads(), loadSettings()]);
  const { data: acts } = await sb.from("activities").select("lead_id, type, outcome").in("type", ["call", "call_attempt", "linkedin_message", "email"]).limit(20000);
  const touched = new Set((acts ?? []).map((a) => a.lead_id));
  const prospects = leads.filter((l) => touched.has(l.id) || rank(l.stage) > 0);
  const f: Funnel = {
    prospects: prospects.length, attempts: (acts ?? []).length, connected: (acts ?? []).filter((a) => a.type === "call" && a.outcome !== "no_answer").length,
    qualified: leads.filter((l) => l.stage !== "lost" && rank(l.stage) >= rank("qualified")).length, meetings: leads.filter((l) => l.stage !== "lost" && rank(l.stage) >= rank("call_completed")).length,
    proposals: leads.filter((l) => l.proposal_sent || (l.stage !== "lost" && rank(l.stage) >= rank("proposal"))).length, won: leads.filter((l) => l.stage === "won").length };
  const rate = actualRate(f); const scenario = sp.rate ? Number(sp.rate.replace(",", ".")) / 100 : undefined;
  const g = settings.goals; const v = volumeNeeded(g.customers_per_month, rate, f, scenario);
  return (
    <div><PageHeader title="Ziele & Volumen" back="/more" />
      <div className="card"><div className="label">Monatsziel</div><div className="mt-1 text-3xl font-semibold text-accent">{g.customers_per_month} Kunden</div>
        <div className="mt-1 text-xs text-muted">Zielwerte anpassen unter Einstellungen · {g.daily_outreach} Kontakte/Tag · {g.monthly_calls} Anrufe/Monat · CHF {g.monthly_revenue}/Monat</div></div>
      <h2 className="h-section">Rechner</h2>
      <div className="card">
        {v.status === "insufficient" ? (<><div className="text-lg font-semibold">Zu wenig Daten</div>
          <p className="mt-1 text-sm text-muted">Für eine belastbare Quote braucht es mindestens {MIN_PROSPECTS_FOR_RATE} kontaktierte Prospects und {MIN_WON_FOR_RATE} gewonnene Kunden (aktuell {f.prospects} / {f.won}).</p></>)
          : (<div className="grid grid-cols-2 gap-4"><Stat value={`${(v.rate * 100).toFixed(1)} %`} label={v.status === "actual" ? "Tatsächliche Quote (Kunden ÷ Prospects)" : "Szenario-Annahme"} />
            <Stat value={v.required} label="Benötigte neue Prospects" accent /><Stat value={v.completed} label="Bereits kontaktiert" /><Stat value={v.remaining} label="Noch offen" /></div>)}
        <form className="mt-4 flex gap-2"><input name="rate" defaultValue={sp.rate} inputMode="decimal" className="input" placeholder="Szenario: Quote in % (z.B. 1.2)" /><button className="btn btn-ghost">Rechnen</button></form>
        <p className="mt-2 text-xs text-muted">Schätzung auf Basis vergangener Werte – kein garantiertes Ergebnis. Szenarien sind Annahmen, keine Messwerte.</p></div>
      <h2 className="h-section">Trichter (Ist-Werte)</h2>
      <div className="card"><table className="w-full text-sm"><tbody>
        {([["Neue Prospects (kontaktiert)", f.prospects, null], ["Kontaktversuche gesamt", f.attempts, null], ["Verbundene Gespräche", f.connected, pct(f.connected, f.attempts)], ["Qualifizierte Leads", f.qualified, pct(f.qualified, f.prospects)],
          ["Meetings / Calls erledigt", f.meetings, pct(f.meetings, f.prospects)], ["Angebote", f.proposals, pct(f.proposals, f.prospects)], ["Kunden gewonnen", f.won, pct(f.won, f.prospects)]] as [string, number, number | null][]).map(([l, n, p]) => (
          <tr key={l} className="border-b border-line last:border-0"><td className="py-2">{l}</td><td className="py-2 text-right tabular-nums">{n}</td><td className="w-20 py-2 text-right text-xs text-muted">{p != null ? `${p} %` : ""}</td></tr>))}</tbody></table>
        <p className="mt-2 text-xs text-muted">Prozent = Anteil an den Prospects (Kontaktversuche: Gespräche ÷ Versuche). Phasen-Werte sind eine Näherung anhand der aktuellen Phase; verlorene Leads zählen nur als Prospect.</p></div></div>
  );
}
