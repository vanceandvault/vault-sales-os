import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/ui";
import { createPartner, setCommissionPaid } from "../actions";
import { formatCHF } from "@/lib/dates";

export const dynamic = "force-dynamic";
export default async function Referrals() {
  const sb = await supabaseServer();
  const [{ data: partners }, { data: leads }, { data: coms }] = await Promise.all([sb.from("referral_partners").select("*").order("name"), sb.from("leads").select("id, stage, referral_partner_id"), sb.from("commissions").select("*, payments(on_date, amount)").order("created_at", { ascending: false })]);
  return (
    <div><PageHeader title="Empfehlungspartner" back="/more" />
      {!partners?.length && <Empty>Noch keine Partner.</Empty>}
      <div className="grid gap-3">{partners?.map((p) => {
        const ls = (leads ?? []).filter((l) => l.referral_partner_id === p.id); const cs = (coms ?? []).filter((c) => c.partner_id === p.id);
        const earned = cs.reduce((n, c) => n + Number(c.amount), 0), paid = cs.filter((c) => c.paid).reduce((n, c) => n + Number(c.amount), 0);
        return (<div key={p.id} className="card"><div className="flex justify-between"><div className="font-semibold">{p.name}{p.company ? ` · ${p.company}` : ""}</div><div className="text-xs text-muted">{p.commission_pct} % · {p.commission_months ? `${p.commission_months} Monate` : "einmalig"} · auf {p.commission_basis === "received" ? "Zahlungseingang" : "Fakturiert"}</div></div>
          <div className="mt-2 grid grid-cols-5 gap-2 text-center text-xs"><div><b className="block text-base">{ls.length}</b>Leads</div><div><b className="block text-base">{ls.filter((l) => l.stage === "won").length}</b>Gewonnen</div><div><b className="block text-base">{formatCHF(earned)}</b>Verdient</div><div><b className="block text-base">{formatCHF(paid)}</b>Bezahlt</div><div><b className="block text-base text-accent">{formatCHF(earned - paid)}</b>Offen</div></div>
          {cs.filter((c) => !c.paid).map((c) => (<form key={c.id} action={setCommissionPaid.bind(null, c.id)} className="mt-2 flex items-center justify-between text-sm"><span>{formatCHF(c.amount)} <span className="text-xs text-muted">aus Zahlung {c.payments?.on_date}</span></span><button className="btn btn-ghost min-h-9 px-3 text-xs">Als bezahlt markieren</button></form>))}</div>); })}</div>
      <p className="mt-3 text-xs text-muted">Provisionen werden nur aus tatsächlich erfassten Zahlungen berechnet (Basis je Partner wählbar). Partner einem Lead zuordnen: Lead bearbeiten.</p>
      <h2 className="h-section">Neuer Partner</h2>
      <form action={createPartner} className="card grid gap-3"><input className="input" name="name" placeholder="Name" required /><input className="input" name="company" placeholder="Firma" />
        <div className="grid grid-cols-2 gap-3"><input className="input" name="pct" inputMode="decimal" placeholder="Provision %" /><input className="input" name="months" inputMode="numeric" placeholder="Dauer Monate (leer = einmalig)" /></div>
        <select name="basis" className="input"><option value="received">Basis: Zahlungseingang</option><option value="invoiced">Basis: Fakturiert</option></select><textarea className="input" name="notes" placeholder="Vereinbarung / Notizen" /><button className="btn btn-primary">Partner speichern</button></form></div>
  );
}
