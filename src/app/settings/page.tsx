import { supabaseServer } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/queries";
import { ErrorNote, PageHeader } from "@/components/ui";
import { deleteEverything, saveOffer, saveSettings } from "../actions";

export const dynamic = "force-dynamic";
const FD: [string, string][] = [["no_answer", "Nicht erreicht → erneut in (Tagen)"], ["message_sent", "Nachricht gesendet → prüfen in"], ["proposal_sent", "Angebot gesendet → nachfassen in"], ["meeting_completed", "Meeting erledigt → nächster Schritt in"], ["decision_pending", "Entscheid offen → nachfassen in"], ["interested", "Interessiert → nächster Schritt in"]];
export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams; const sb = await supabaseServer(); const s = await loadSettings(); const { data: offers } = await sb.from("offers").select("*").order("name");
  return (
    <div><PageHeader title="Einstellungen" back="/more" /><ErrorNote message={error} />
      <form action={saveSettings} className="grid gap-3">
        <div className="card grid gap-3"><div className="label">LinkedIn-Identität</div><input className="input" name="self_name" defaultValue={s.self_name ?? ""} placeholder="Dein LinkedIn-Anzeigename" /><input className="input" name="self_url" defaultValue={s.self_url ?? ""} placeholder="Dein LinkedIn-Profil-URL (optional)" /></div>
        <div className="card grid gap-3"><div className="label">Follow-up-Standards (Tage) – ausdrückliche Zusagen haben immer Vorrang</div>
          {FD.map(([k, l]) => <label key={k} className="flex items-center justify-between gap-3 text-sm"><span>{l}</span><input name={`fd_${k}`} inputMode="numeric" defaultValue={s.followup[k]} className="input w-20 text-center" /></label>)}</div>
        <div className="card grid gap-3"><div className="label">Ziele</div>
          <label className="flex items-center justify-between gap-3 text-sm">Neukunden / Monat<input name="g_customers" defaultValue={s.goals.customers_per_month} className="input w-28 text-center" /></label>
          <label className="flex items-center justify-between gap-3 text-sm">Kontakte / Tag<input name="g_outreach" defaultValue={s.goals.daily_outreach} className="input w-28 text-center" /></label>
          <label className="flex items-center justify-between gap-3 text-sm">Anrufe / Monat<input name="g_calls" defaultValue={s.goals.monthly_calls} className="input w-28 text-center" /></label>
          <label className="flex items-center justify-between gap-3 text-sm">Umsatz CHF / Monat<input name="g_revenue" defaultValue={s.goals.monthly_revenue} className="input w-28 text-center" /></label></div>
        <button className="btn btn-primary">Speichern</button></form>
      <h2 className="h-section">Angebote & Preise</h2>
      <div className="grid gap-2">{offers?.map((o) => (
        <form key={o.id} action={saveOffer} className="card grid grid-cols-6 gap-2"><input type="hidden" name="id" value={o.id} /><input className="input col-span-6 min-h-11" name="name" defaultValue={o.name} /><select name="kind" defaultValue={o.kind} className="input col-span-3 min-h-11"><option value="one_time">Einmalig</option><option value="recurring">Monatlich</option><option value="custom">Individuell</option></select>
          <input className="input col-span-2 min-h-11" name="price" defaultValue={o.price_chf} inputMode="decimal" /><button className="btn btn-blue col-span-1 min-h-11 px-0">OK</button></form>))}
        <form action={saveOffer} className="card grid grid-cols-6 gap-2"><div className="label col-span-6">Neues Angebot</div><input className="input col-span-6 min-h-11" name="name" placeholder="z.B. Social Media Starter" required /><select name="kind" className="input col-span-3 min-h-11"><option value="one_time">Einmalig</option><option value="recurring">Monatlich</option><option value="custom">Individuell</option></select>
          <input className="input col-span-2 min-h-11" name="price" inputMode="decimal" placeholder="CHF" /><button className="btn btn-primary col-span-1 min-h-11 px-0">＋</button></form></div>
      <h2 className="h-section">Daten</h2>
      <div className="card grid gap-3"><a href="/api/export" className="btn btn-ghost">Alle Daten exportieren (JSON)</a>
        <form action={deleteEverything} className="grid gap-2"><p className="text-xs text-muted">Löscht unwiderruflich alle Leads, Kontakte, Nachrichten, Importe und Partner. Zum Bestätigen „ALLES LÖSCHEN“ eingeben.</p><input name="confirm" className="input" placeholder="ALLES LÖSCHEN" /><button className="btn btn-danger">Alle Daten löschen</button></form></div></div>
  );
}
