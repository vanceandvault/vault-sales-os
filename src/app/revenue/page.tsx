import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { loadLeads, loadSettings } from "@/lib/queries";
import { ErrorNote, PageHeader, Stat, Empty } from "@/components/ui";
import { contractValue, pipelineSummary, revenueSummary } from "@/lib/revenue";
import { formatCH, formatCHF, zurichToday } from "@/lib/dates";
import { recordPayment } from "../actions";

export const dynamic = "force-dynamic";
export default async function Revenue({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams; const sb = await supabaseServer(); const today = zurichToday();
  const [{ data: deals }, { data: pays }, leads, settings] = await Promise.all([
    sb.from("deals").select("*, leads(companies(name), contacts!leads_contact_id_fkey(name))").order("won_at", { ascending: false }), sb.from("payments").select("*").order("on_date", { ascending: false }), loadLeads(), loadSettings()]);
  const r = revenueSummary((deals ?? []) as never, (pays ?? []) as never, today); const p = pipelineSummary(leads, settings.prob);
  return (
    <div><PageHeader title="Umsatz" back="/more" /><ErrorNote message={error} />
      <div className="card grid grid-cols-2 gap-5 md:grid-cols-3">
        <Stat value={formatCHF(r.closedMonth)} label="Abgeschlossen (Monat)" accent /><Stat value={formatCHF(r.closedYear)} label="Abgeschlossen (Jahr)" /><Stat value={r.customers} label="Kunden gewonnen" />
        <Stat value={formatCHF(p.active)} label="Aktive Pipeline" /><Stat value={formatCHF(p.weighted)} label="Gewichtete Pipeline" /><Stat value={formatCHF(r.avgDeal)} label="Ø Dealwert" /></div>
      <h2 className="h-section">Getrennt betrachtet</h2>
      <div className="card grid grid-cols-2 gap-5 md:grid-cols-3">
        <Stat value={formatCHF(r.oneTimeMonth)} label="Einmalig (Monat)" /><Stat value={formatCHF(r.mrrTotal)} label="Wiederkehrend / Monat (gesamt)" /><Stat value={formatCHF(r.totalContracted)} label="Vertraglich total*" />
        <Stat value={formatCHF(r.invoiced)} label="Fakturiert" /><Stat value={formatCHF(r.received)} label="Zahlungseingang" accent /></div>
      <p className="mt-2 text-xs text-muted">*Einmalig + monatlich × Laufzeit (nur wenn Laufzeit erfasst). Angebote zählen nicht als Umsatz. „Gewonnen“ ist kein Zahlungseingang – Eingänge werden manuell bestätigt.</p>
      <h2 className="h-section">Gewonnene Deals</h2>
      {!deals?.length && <Empty>Noch keine gewonnenen Deals.</Empty>}
      <div className="grid gap-3">{deals?.map((d: any) => { const dp = (pays ?? []).filter((x) => x.deal_id === d.id); const rec = dp.filter((x) => x.kind === "received").reduce((n, x) => n + Number(x.amount), 0); const inv = dp.filter((x) => x.kind === "invoiced").reduce((n, x) => n + Number(x.amount), 0);
        return (
          <div key={d.id} className="card"><div className="flex justify-between gap-2"><Link href={`/leads/${d.lead_id}`} className="font-semibold">{d.leads?.companies?.name ?? d.leads?.contacts?.name}</Link><span className="text-xs text-muted">{formatCH(d.won_at)}</span></div>
            <div className="mt-1 text-sm text-muted">Einmalig {formatCHF(d.one_time_value)}{d.monthly_value > 0 ? ` · ${formatCHF(d.monthly_value)}/Monat${d.contract_months ? ` × ${d.contract_months}` : ""}` : ""} · Vertrag {formatCHF(contractValue(d))}</div>
            <div className="mt-1 text-sm">Fakturiert {formatCHF(inv)} · <span className="text-accent">Eingegangen {formatCHF(rec)}</span></div>
            <form action={recordPayment.bind(null, d.id)} className="mt-3 grid grid-cols-6 gap-2"><select name="kind" className="input col-span-3 min-h-11"><option value="received">Zahlung eingegangen</option><option value="invoiced">Rechnung gestellt</option></select>
              <input name="amount" inputMode="decimal" className="input col-span-3 min-h-11" placeholder="Betrag CHF" required /><input type="date" name="date" defaultValue={today} className="input col-span-4 min-h-11" /><button className="btn btn-blue col-span-2 min-h-11">Erfassen</button></form></div>); })}</div></div>
  );
}
