import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { loadLeads, loadSettings, leadName } from "@/lib/queries";
import { PageHeader, Stat, Empty } from "@/components/ui";
import { LinkedInUpload } from "@/components/LinkedInUpload";
import { approveOpportunity, createFromConversation, dismissSuggestion, ignoreConversation, linkConversation } from "../actions";
import { formatCH, formatCHDateTime } from "@/lib/dates";

export const dynamic = "force-dynamic";
export default async function LinkedIn() {
  const sb = await supabaseServer(); const settings = await loadSettings();
  const [{ data: imports }, { count: total }, { data: review }, { data: sugg }, leads] = await Promise.all([
    sb.from("linkedin_imports").select("*").order("started_at", { ascending: false }).limit(20),
    sb.from("linkedin_conversations").select("id", { count: "exact", head: true }),
    sb.from("linkedin_conversations").select("id, participant_name, participant_url, message_count, last_message_at, last_inbound_at, review_status, possible_company").in("review_status", ["new", "possible_match"]).order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(30),
    sb.from("suggestions").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(30), loadLeads(),
  ]);
  const { count: toReview } = await sb.from("linkedin_conversations").select("id", { count: "exact", head: true }).in("review_status", ["new", "possible_match"]);
  const last = imports?.find((i) => i.status === "completed");
  return (
    <div><PageHeader title="LinkedIn Sync" back="/more" />
      <div className="card mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat value={last ? formatCH(last.finished_at) : "–"} label="Letzter Sync" /><Stat value={total ?? 0} label="Konversationen" /><Stat value={last?.new_messages ?? 0} label="Neue Nachrichten" accent />
        <Stat value={last?.updated_conversations ?? 0} label="Aktualisierte Konv." /><Stat value={toReview ?? 0} label="Mögliche neue Leads" /><Stat value={last?.existing_messages ?? 0} label="Duplikate ignoriert" /></div>
      <LinkedInUpload selfName={settings.self_name} />

      <h2 className="h-section">Vorschläge zur Prüfung ({sugg?.length ?? 0})</h2>
      {!sugg?.length && <Empty>Keine offenen Vorschläge.</Empty>}
      <div className="grid gap-2">{sugg?.map((s) => (
        <div key={s.id} className="card"><div className="label">{s.kind === "reply_detected" ? "Antwort erkannt" : "Neue Verkaufschance"}</div><div className="mt-1 font-medium">{s.title}</div>{s.detail && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{s.detail}</p>}
          <div className="mt-3 flex gap-2">
            {s.kind === "new_opportunity" ? <form action={approveOpportunity.bind(null, s.id)} className="flex-1"><button className="btn btn-primary w-full">Aktion freigeben</button></form>
              : s.lead_id ? <Link href={`/leads/${s.lead_id}`} className="btn btn-primary flex-1">Aktion prüfen</Link> : null}
            <form action={dismissSuggestion.bind(null, s.id)} className="flex-1"><button className="btn btn-ghost w-full">Verwerfen</button></form></div></div>))}</div>

      <h2 className="h-section">Neue Leads prüfen ({toReview ?? 0})</h2>
      {!review?.length && <Empty>Keine Konversationen zur Prüfung.</Empty>}
      <div className="grid gap-2">{review?.map((c) => (
        <div key={c.id} className="card">
          <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{c.participant_name ?? "Unbekannt"}</div><div className="text-xs text-muted">{c.message_count} Nachrichten · zuletzt {c.last_message_at ? formatCHDateTime(c.last_message_at) : "–"}{c.last_inbound_at ? " · enthält Antworten" : ""}</div></div>
            {c.review_status === "possible_match" && <span className="chip border-accent/40 text-accent">Möglicher Treffer</span>}</div>
          {c.possible_company && <p className="mt-2 text-sm">Mögliche Firma: <b>{c.possible_company}</b> <span className="text-xs text-muted">(Name stimmt überein – nicht verifiziert)</span></p>}
          <form action={linkConversation.bind(null, c.id)} className="mt-3 flex gap-2"><select name="lead_id" className="input min-h-11" required defaultValue=""><option value="" disabled>Bestehenden Lead zuordnen …</option>{leads.map((l) => <option key={l.id} value={l.id}>{leadName(l)}{l.contacts?.name ? ` — ${l.contacts.name}` : ""}</option>)}</select><button className="btn btn-blue min-h-11 px-3">Zuordnen</button></form>
          <div className="mt-2 grid grid-cols-2 gap-2"><form action={createFromConversation.bind(null, c.id)}><button className="btn btn-ghost w-full">Kontakt anlegen</button></form><form action={ignoreConversation.bind(null, c.id)}><button className="btn btn-ghost w-full">Ignorieren</button></form></div></div>))}</div>
      {(toReview ?? 0) > 30 && <p className="mt-2 text-xs text-muted">Es werden die 30 neuesten angezeigt.</p>}

      <h2 className="h-section">Import-Verlauf</h2>
      <div className="grid gap-2">{imports?.length ? imports.map((i) => (
        <details key={i.id} className="card py-3"><summary className="flex cursor-pointer items-center justify-between gap-2 text-sm"><span className="truncate">{i.file_name}</span>
          <span className={`chip ${i.status === "completed" ? "text-accent" : i.status === "failed" ? "text-danger" : ""}`}>{i.status === "completed" ? "OK" : i.status === "failed" ? "Fehler" : "läuft"}</span></summary>
          <div className="mt-3 grid gap-1 text-xs text-muted"><div>{formatCHDateTime(i.started_at)}</div><div>Fingerprint: {i.file_fingerprint.slice(0, 16)}…</div>
            <div>{i.conversations_processed} Konversationen · {i.new_messages} neu · {i.existing_messages} bestehend · {i.updated_conversations} aktualisiert</div>
            {Array.isArray(i.errors) && i.errors.length > 0 && <ul className="text-danger">{(i.errors as string[]).map((e, k) => <li key={k}>{e}</li>)}</ul>}
            {i.status === "failed" && <div className="text-white">Wiederholen: dieselbe Datei erneut hochladen (idempotent).</div>}</div></details>)) : <Empty>Noch kein Import.</Empty>}</div></div>
  );
}
