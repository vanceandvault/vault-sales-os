import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader, Temp } from "@/components/ui";
import { VoiceButton } from "@/components/VoiceButton";
import { formatCH, formatCHF } from "@/lib/dates";

export const dynamic = "force-dynamic";
const Block = ({ k, v }: { k: string; v: string[] | string | null }) => (
  <div className="card"><div className="label mb-1">{k}</div>{Array.isArray(v) ? (v.length ? <ul className="list-disc pl-5 text-sm">{v.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-muted">Nichts erfasst</p>) : <p className="whitespace-pre-wrap text-sm">{v || <span className="text-muted">Nichts erfasst</span>}</p>}</div>);

export default async function CallMode({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServer();
  const { data: l } = await sb.from("leads").select("*, companies(name), contacts!leads_contact_id_fkey(name, phone)").eq("id", id).maybeSingle(); if (!l) notFound();
  const [{ data: last }, { data: task }, { data: offer }] = await Promise.all([
    sb.from("activities").select("type, summary, occurred_at").eq("lead_id", id).in("type", ["call", "call_attempt", "meeting", "note", "email"]).order("occurred_at", { ascending: false }).limit(1),
    sb.from("tasks").select("title").eq("lead_id", id).eq("status", "open").maybeSingle(),
    l.offer_id ? sb.from("offers").select("name, price_chf").eq("id", l.offer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const objective = l.stage === "proposal" || l.stage === "decision_pending" ? "Entscheid klären und nächsten verbindlichen Schritt vereinbaren." : l.stage === "qualified" || l.stage === "call_completed" ? "Angebot besprechen / Abschlusstermin festlegen." : "Bedarf verstehen und Gespräch/Termin vereinbaren.";
  return (
    <div><PageHeader title={l.companies?.name ?? l.contacts?.name ?? "Anruf"} back={`/leads/${id}`} sub="Anruf-Modus" right={<Temp t={l.temperature} />} />
      <div className="card mb-3 flex items-center justify-between gap-3"><div><div className="label">Kontakt</div><div className="text-lg font-semibold">{l.contacts?.name ?? "–"}</div><div className="text-sm text-muted">{l.contacts?.phone ?? "Keine Telefonnummer erfasst"}</div></div>
        {l.contacts?.phone ? <a href={`tel:${l.contacts.phone}`} className="btn btn-primary h-14 px-6">Anrufen</a> : <Link href={`/leads/${id}`} className="btn btn-ghost">Nummer ergänzen</Link>}</div>
      <div className="grid gap-3">
        <div className="card border-accent/40"><div className="label mb-1">Gesprächsziel (Vorschlag)</div><p className="text-sm">{objective}</p>{task && <p className="mt-2 text-xs text-muted">Offene Aktion: {task.title}</p>}</div>
        <Block k="Letztes Gespräch" v={last?.[0] ? `${formatCH(last[0].occurred_at)} · ${last[0].summary ?? last[0].type}` : null} />
        <Block k="Schmerzpunkte" v={l.pain_points} /><Block k="Kaufsignale" v={l.buying_signals} /><Block k="Einwände" v={l.objections} />
        <Block k="Entscheider" v={l.decision_makers} /><Block k="Budget / Timing" v={l.timing} />
        <Block k="Angebot & Potenzial" v={[offer ? `${offer.name} (${formatCHF(offer.price_chf)})` : null, l.deal_value != null ? `Potenzial ${formatCHF(l.deal_value)}` : null].filter(Boolean) as string[]} /></div>
      <div className="card mt-4"><div className="label mb-2">Nach dem Anruf</div><p className="mb-3 text-sm text-muted">Sprich eine Zusammenfassung: Schmerzpunkte, Kaufsignale, Einwände, Entscheider, Budget, Timing, Versprechen und nächster Schritt. Du bestätigst vor dem Speichern.</p>
        <VoiceButton leadId={id} label="Zusammenfassung sprechen" /><p className="mt-3 text-xs text-muted">Hinweis: Die App zeichnet keine Telefonate auf. Nimm nur deine eigene Zusammenfassung auf; Gesprächsaufzeichnungen erfordern die Einwilligung der Beteiligten.</p></div>
    </div>
  );
}
