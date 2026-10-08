import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/ui";
import { addDays, formatCHDateTime, weekday, zurichToday, TZ } from "@/lib/dates";
import { pct } from "@/lib/goals";

export const dynamic = "force-dynamic";
const zday = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(iso));
type A = { id: string; lead_id: string; type: string; outcome: string | null; summary: string | null; occurred_at: string; source: string; is_new_prospect_touch: boolean };
const COUNTERS: [string, string, (a: A) => boolean][] = [
  ["Anrufversuche", "call_attempt+call", (a) => a.type === "call" || a.type === "call_attempt"], ["Verbundene Gespräche", "spoke", (a) => a.type === "call" && a.outcome !== "no_answer"],
  ["LinkedIn-Outreach", "li out", (a) => a.type === "linkedin_message"], ["LinkedIn-Antworten", "li in", (a) => a.type === "linkedin_reply"], ["E-Mails", "mail", (a) => a.type === "email"],
  ["Meetings", "meet", (a) => a.type === "meeting"], ["Angebote", "prop", (a) => a.type === "proposal"], ["Follow-ups", "fu", (a) => a.type === "follow_up"],
  ["Gewonnen", "won", (a) => a.type === "won"], ["Verloren", "lost", (a) => a.type === "lost"],
];
const OUTREACH = ["call", "call_attempt", "linkedin_message", "email"];

export default async function Activity() {
  const sb = await supabaseServer(); const today = zurichToday(); const monthStart = today.slice(0, 7) + "-01";
  const weekStart = addDays(today, -((weekday(today) + 6) % 7));
  const { data } = await sb.from("activities").select("id, lead_id, type, outcome, summary, occurred_at, source, is_new_prospect_touch, leads(companies(name), contacts!leads_contact_id_fkey(name))").gte("occurred_at", addDays(monthStart, -1) + "T00:00:00Z").order("occurred_at", { ascending: false }).limit(2000);
  const rows = (data ?? []) as unknown as (A & { leads: { companies: { name: string } | null; contacts: { name: string } | null } | null })[];
  const inRange = (from: string) => rows.filter((a) => zday(a.occurred_at) >= from);
  const ranges = [["Heute", inRange(today).filter((a) => zday(a.occurred_at) === today)], ["Diese Woche", inRange(weekStart)], ["Dieser Monat", inRange(monthStart)]] as const;
  const month = ranges[2][1]; const attempts = month.filter(COUNTERS[0][2]).length, connected = month.filter(COUNTERS[1][2]).length;
  const uniqueProspects = new Set(month.filter((a) => OUTREACH.includes(a.type)).map((a) => a.lead_id)).size;
  const reached = new Set(month.filter(COUNTERS[1][2]).map((a) => a.lead_id)).size;
  return (
    <div><PageHeader title="Aktivität" />
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="label pb-2 font-medium">Metrik</th>{ranges.map(([l]) => <th key={l} className="label pb-2 text-right font-medium">{l}</th>)}</tr></thead>
        <tbody>{COUNTERS.map(([label, , f]) => (<tr key={label} className="border-t border-line"><td className="py-2">{label}</td>{ranges.map(([l, r]) => <td key={l} className="py-2 text-right tabular-nums">{r.filter(f).length}</td>)}</tr>))}</tbody></table></div>
      <h2 className="h-section">Quoten (Monat) – mit Nenner</h2>
      <div className="card grid gap-2 text-sm">
        <div className="flex justify-between"><span>Gesprächsquote <span className="text-xs text-muted">(Gespräche ÷ Anrufversuche: {connected}/{attempts})</span></span><b>{pct(connected, attempts) ?? "–"}{pct(connected, attempts) != null && " %"}</b></div>
        <div className="flex justify-between"><span>Erreichte Prospects <span className="text-xs text-muted">({reached} von {uniqueProspects} kontaktierten)</span></span><b>{pct(reached, uniqueProspects) ?? "–"}{pct(reached, uniqueProspects) != null && " %"}</b></div>
        <p className="mt-1 text-xs text-muted">Einzigartige Prospects ({uniqueProspects}) werden getrennt von wiederholten Kontaktversuchen ({attempts + month.filter(COUNTERS[2][2]).length + month.filter(COUNTERS[4][2]).length}) gezählt. Bei wenig Daten sind Quoten nur Anhaltspunkte.</p></div>
      <h2 className="h-section">Letzte Aktivitäten</h2>
      {rows.length === 0 && <Empty>Noch keine Aktivitäten.</Empty>}
      <ol className="grid gap-2">{rows.slice(0, 40).map((a) => (
        <li key={a.id}><Link href={`/leads/${a.lead_id}`} className="card block py-3"><div className="flex justify-between gap-2 text-xs text-muted"><span className="uppercase tracking-wider">{a.type}{a.outcome ? ` · ${a.outcome}` : ""}</span><span>{formatCHDateTime(a.occurred_at)}</span></div>
          <div className="mt-1 text-sm font-medium">{a.leads?.companies?.name ?? a.leads?.contacts?.name ?? "Lead"}</div>{a.summary && <div className="line-clamp-2 text-sm text-muted">{a.summary}</div>}</Link></li>))}</ol></div>
  );
}
