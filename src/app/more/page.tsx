import Link from "next/link";
import { logout, seedDemo, deleteDemo } from "../actions";
import { PageHeader } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ITEMS: [string, string, string][] = [["/linkedin", "LinkedIn Sync", "Archiv hochladen, Konversationen prüfen"], ["/revenue", "Umsatz", "Abschlüsse, Rechnungen, Zahlungseingänge"], ["/goals", "Ziele & Volumen", "Wie viele Kontakte brauche ich?"],
  ["/referrals", "Empfehlungspartner", "Provisionen"], ["/search", "Suche", "Firmen, Kontakte, Notizen, Nachrichten, Transkripte"], ["/settings", "Einstellungen", "Angebote, Follow-up-Regeln, Export, Löschen"]];
export default async function More() {
  const sb = await supabaseServer(); const { count } = await sb.from("companies").select("id", { count: "exact", head: true }).eq("is_demo", true);
  return (
    <div><PageHeader title="Mehr" />
      <div className="grid gap-2">{ITEMS.map(([h, t, d]) => <Link key={h} href={h} className="card flex items-center justify-between py-4"><div><div className="font-semibold">{t}</div><div className="text-xs text-muted">{d}</div></div><span className="text-accent">→</span></Link>)}</div>
      <h2 className="h-section">Demo-Daten</h2>
      <div className="card"><p className="mb-3 text-sm text-muted">Erfundene Beispiel-Leads zum Ausprobieren (ohne Telefonnummern oder Verläufe). Klar als „Demo“ markiert.</p>
        {count ? <form action={deleteDemo}><button className="btn btn-danger w-full">{count} Demo-Firmen löschen</button></form> : <form action={seedDemo}><button className="btn btn-ghost w-full">Demo-Daten laden</button></form>}</div>
      <form action={logout} className="mt-8"><button className="btn btn-ghost w-full">Abmelden</button></form></div>
  );
}
