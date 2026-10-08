import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/queries";
import { ErrorNote, PageHeader, Temp, Stage, Demo } from "@/components/ui";
import { DoneSheet } from "@/components/DoneSheet";
import { AskVault } from "@/components/AskVault";
import { VoiceButton } from "@/components/VoiceButton";
import { addNote, clearReview, markLost, markWon, setNextAction, updateLead } from "@/app/actions";
import { diffDays, formatCH, formatCHDateTime, formatCHF, weekdayName, zurichToday } from "@/lib/dates";
import { STAGES, STAGE_LABEL } from "@/lib/voice";

export const dynamic = "force-dynamic";
const Row = ({ k, v }: { k: string; v?: string | null }) => <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0"><span className="text-muted">{k}</span><span className="text-right">{v || "–"}</span></div>;
const List = ({ k, v }: { k: string; v: string[] }) => <div className="py-2"><div className="label mb-1">{k}</div>{v.length ? <ul className="list-disc pl-5 text-sm">{v.map((x) => <li key={x}>{x}</li>)}</ul> : <div className="text-sm text-muted">Nichts erfasst</div>}</div>;

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ win?: string; lose?: string; error?: string }> }) {
  const { id } = await params; const sp = await searchParams; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await supabaseServer(); const today = zurichToday(); const settings = await loadSettings();
  const { data: l } = await sb.from("leads").select("*, companies(*), contacts!leads_contact_id_fkey(*)").eq("id", id).maybeSingle(); if (!l) notFound();
  const [{ data: acts }, { data: task }, { data: convs }, { data: deal }, { data: offers }, { data: partners }] = await Promise.all([
    sb.from("activities").select("*").eq("lead_id", id).order("occurred_at", { ascending: false }).limit(60),
    sb.from("tasks").select("*").eq("lead_id", id).eq("status", "open").maybeSingle(),
    sb.from("linkedin_conversations").select("id, participant_name, summary").eq("lead_id", id),
    sb.from("deals").select("*").eq("lead_id", id).maybeSingle(),
    sb.from("offers").select("id, name, price_chf, kind").eq("active", true).order("name"), sb.from("referral_partners").select("id, name").order("name"),
  ]);
  const li = convs?.length ? (await sb.from("linkedin_messages").select("id, direction, sent_at, content, sender_name").in("conversation_id", convs.map((c) => c.id)).order("sent_at", { ascending: false }).limit(60)).data ?? [] : [];
  const timeline = [...(acts ?? []).map((a) => ({ k: "crm" as const, at: a.occurred_at, a })), ...li.map((m) => ({ k: "li" as const, at: m.sent_at, m }))].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 80);
  const c = l.companies, k = l.contacts; const name = c?.name ?? k?.name ?? "Lead"; const offer = offers?.find((o) => o.id === l.offer_id);
  const closed = l.stage === "won" || l.stage === "lost"; const late = task ? diffDays(today, task.due_date) : 0;
  const lines = (a: string[]) => a.join("\n");

  return (
    <div>
      <PageHeader title={name} back="/leads" sub={k?.name ? `${k.name}${k.position ? " · " + k.position : ""}` : "Lead"} right={<div className="flex flex-col items-end gap-2"><Temp t={l.temperature} />{l.is_demo && <Demo />}</div>} />
      <ErrorNote message={sp.error} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><Stage s={l.stage} />{l.deal_value != null && <span className="chip border-accent/30 text-accent">Potenzial {formatCHF(l.deal_value)}</span>}{l.expected_mrr && <span className="chip">MRR {formatCHF(l.expected_mrr)}</span>}</div>

      {!closed && (
        <section className={`card ${task?.needs_review ? "border-accent/60" : ""}`} aria-label="Nächste Aktion">
          <div className="label mb-2">Nächste Aktion</div>
          {task ? (<>
            <div className="text-lg font-semibold">{task.title}</div>
            <div className={`mt-1 text-sm ${late > 0 ? "text-danger" : "text-muted"}`}>{weekdayName(task.due_date)}, {formatCH(task.due_date)}{late > 0 ? ` · ${late} Tag(e) überfällig` : late === 0 ? " · heute" : ""}</div>
            {task.needs_review && <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm text-accent">⚠ {task.review_reason}
              <form action={clearReview.bind(null, task.id)} className="mt-2"><button className="btn btn-ghost min-h-10 px-3 text-xs text-white">Aktion ist weiterhin korrekt</button></form></div>}
            <div className="mt-4 flex gap-2"><DoneSheet taskId={task.id} leadId={id} title={task.title} followup={settings.followup} /></div>
          </>) : <div className="mb-2 text-sm text-danger">⚠ Keine nächste Aktion – bitte festlegen.</div>}
          <form action={setNextAction.bind(null, id)} className="mt-4 grid grid-cols-5 gap-2">
            <input name="title" className="input col-span-5 min-h-11" placeholder={task ? "Aktion ersetzen …" : "Nächste Aktion"} required />
            <input name="due" type="date" min={today} className="input col-span-2 min-h-11" /><input name="due_text" className="input col-span-2 min-h-11" placeholder='oder "Freitag"' /><button className="btn btn-blue col-span-1 min-h-11 px-0">OK</button></form>
        </section>)}

      <div className="mt-4 grid grid-cols-4 gap-2">
        {k?.phone ? <a href={`tel:${k.phone}`} className="btn btn-primary flex-col py-2 text-[11px]">Anrufen</a> : <Link href={`/leads/${id}/call`} className="btn btn-primary flex-col py-2 text-[11px]">Anruf-Modus</Link>}
        {k?.email ? <a href={`mailto:${k.email}`} className="btn btn-ghost flex-col py-2 text-[11px]">E-Mail</a> : <span className="btn btn-ghost flex-col py-2 text-[11px] opacity-40">E-Mail</span>}
        {k?.linkedin_url ? <a href={k.linkedin_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost flex-col py-2 text-[11px]">LinkedIn</a> : <span className="btn btn-ghost flex-col py-2 text-[11px] opacity-40">LinkedIn</span>}
        <VoiceButton leadId={id} />
      </div>
      {(k?.phone || k?.email) && <div className="mt-2 text-xs text-muted">{[k?.phone, k?.email].filter(Boolean).join(" · ")}</div>}

      <h2 className="h-section">Sales Intelligence</h2>
      <div className="card"><List k="Schmerzpunkte" v={l.pain_points} /><List k="Kaufsignale" v={l.buying_signals} /><List k="Einwände" v={l.objections} />
        <Row k="Entscheider" v={l.decision_makers} /><Row k="Timing" v={l.timing} /></div>

      <h2 className="h-section">Deal</h2>
      <div className="card"><Row k="Angebot" v={offer?.name} /><Row k="Potenzial" v={l.deal_value != null ? formatCHF(l.deal_value) : null} /><Row k="Phase" v={STAGE_LABEL[l.stage]} /><Row k="Erwarteter Abschluss" v={l.expected_close ? formatCH(l.expected_close) : null} />
        {deal && <><Row k="Vertragswert (einmalig)" v={formatCHF(deal.one_time_value)} /><Row k="Monatlich (MRR)" v={deal.monthly_value > 0 ? formatCHF(deal.monthly_value) : null} /><Link href="/revenue" className="mt-2 block text-sm text-accent underline">Zahlungen erfassen →</Link></>}</div>
      {!closed && (
        <details open={!!sp.win || !!sp.lose} className="mt-3">
          <summary className="btn btn-ghost w-full cursor-pointer">Gewonnen / Verloren markieren</summary>
          <div className="mt-3 grid gap-3">
            <form action={markWon.bind(null, id)} className={`card grid gap-3 ${sp.win ? "border-accent" : ""}`}><div className="label">Gewonnen – Bestätigung</div>
              <input className="input" name="one_time" inputMode="decimal" placeholder="Einmaliger Vertragswert CHF" defaultValue={l.deal_value ?? ""} /><div className="grid grid-cols-2 gap-3"><input className="input" name="monthly" inputMode="decimal" placeholder="Monatlich CHF" defaultValue={l.expected_mrr ?? ""} /><input className="input" name="months" inputMode="numeric" placeholder="Laufzeit Monate" /></div>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="confirm" className="mt-1 h-5 w-5 accent-[#F3FF9A]" required />Ja, der Kunde hat zugesagt. Eine Zahlung ist dadurch noch nicht eingegangen.</label><button className="btn btn-primary">Als gewonnen speichern</button></form>
            <form action={markLost.bind(null, id)} className={`card grid gap-3 ${sp.lose ? "border-danger" : ""}`}><div className="label">Verloren</div><input className="input" name="reason" placeholder="Grund (optional)" /><button className="btn btn-danger">Als verloren speichern</button></form>
          </div></details>)}
      {closed && <div className="card mt-3 text-sm text-muted">Dieser Lead ist {l.stage === "won" ? "gewonnen" : "verloren"} und erscheint nicht mehr in der aktiven Queue.{l.lost_reason ? ` Grund: ${l.lost_reason}` : ""}</div>}

      <div className="mt-8"><AskVault leadId={id} hasLinkedIn={!!convs?.length} /></div>
      {convs?.some((x) => x.summary) && <div className="card mt-3"><div className="label mb-1">LinkedIn-Zusammenfassung (KI)</div>{convs.filter((x) => x.summary).map((x) => <p key={x.id} className="text-sm">{x.summary}</p>)}</div>}

      <h2 className="h-section">Verlauf</h2>
      <form action={addNote.bind(null, id)} className="mb-3 flex gap-2"><input name="text" className="input" placeholder="Notiz hinzufügen …" required /><button className="btn btn-blue">＋</button></form>
      <ol className="grid gap-2">
        {timeline.length === 0 && <li className="text-sm text-muted">Noch keine Einträge.</li>}
        {timeline.map((t) => t.k === "crm" ? (
          <li key={t.a.id} className="card py-3"><div className="flex justify-between gap-2 text-xs text-muted"><span className="uppercase tracking-wider">{t.a.type}{t.a.outcome ? ` · ${t.a.outcome}` : ""} · {t.a.source === "voice" ? "Sprache" : t.a.source === "system" ? "System" : "CRM"}</span><span>{formatCHDateTime(t.a.occurred_at)}</span></div>
            {t.a.summary && <p className="mt-1 whitespace-pre-wrap text-sm">{t.a.summary}</p>}</li>
        ) : (
          <li key={t.m.id} className={`rounded-2xl border border-blue/40 bg-blue/10 p-3 py-3 ${t.m.direction === "outbound" ? "ml-6" : "mr-6"}`}>
            <div className="flex justify-between gap-2 text-xs text-blue"><span className="font-semibold uppercase tracking-wider">LinkedIn · {t.m.direction === "outbound" ? "Ich" : t.m.sender_name}</span><span>{formatCHDateTime(t.m.sent_at)}</span></div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{t.m.content}</p></li>))}
      </ol>

      <details className="mt-8"><summary className="btn btn-ghost w-full cursor-pointer">Lead bearbeiten</summary>
        <form action={updateLead.bind(null, id)} className="mt-3 grid gap-3">
          <div className="card grid gap-3"><div className="label">Firma</div><input className="input" name="company" defaultValue={c?.name ?? ""} placeholder="Firma" /><div className="grid grid-cols-2 gap-3"><input className="input" name="industry" defaultValue={c?.industry ?? ""} placeholder="Branche" /><input className="input" name="location" defaultValue={c?.location ?? ""} placeholder="Ort" /></div>
            <input className="input" name="website" defaultValue={c?.website ?? ""} placeholder="Website" /><input className="input" name="company_linkedin" defaultValue={c?.linkedin_url ?? ""} placeholder="Firmen-LinkedIn" /><input className="input" name="company_instagram" defaultValue={c?.instagram ?? ""} placeholder="Instagram" /></div>
          {k && <div className="card grid gap-3"><div className="label">Kontakt</div><input className="input" name="contact" defaultValue={k.name} /><input className="input" name="position" defaultValue={k.position ?? ""} placeholder="Funktion" />
            <input className="input" name="phone" type="tel" defaultValue={k.phone ?? ""} placeholder="Telefon" /><input className="input" name="email" type="email" defaultValue={k.email ?? ""} placeholder="E-Mail" /><input className="input" name="linkedin" defaultValue={k.linkedin_url ?? ""} placeholder="LinkedIn-URL" /><input className="input" name="instagram" defaultValue={k.instagram ?? ""} placeholder="Instagram" /></div>}
          <div className="card grid gap-3"><div className="label">Lead</div>
            <div className="grid grid-cols-2 gap-3"><select className="input" name="temperature" defaultValue={l.temperature}><option value="hot">Heiss</option><option value="warm">Warm</option><option value="cold">Kalt</option></select>
              <select className="input" name="stage" defaultValue={closed ? "" : l.stage}>{closed && <option value="">{STAGE_LABEL[l.stage]}</option>}{STAGES.filter((s) => s !== "won" && s !== "lost").map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3"><input className="input" name="deal_value" inputMode="decimal" defaultValue={l.deal_value ?? ""} placeholder="Potenzial CHF" /><input className="input" name="expected_mrr" inputMode="decimal" defaultValue={l.expected_mrr ?? ""} placeholder="Erwartete MRR" /></div>
            <select className="input" name="offer_id" defaultValue={l.offer_id ?? ""}><option value="">Kein Angebot</option>{offers?.map((o) => <option key={o.id} value={o.id}>{o.name} ({formatCHF(o.price_chf)})</option>)}</select>
            <select className="input" name="referral_partner_id" defaultValue={l.referral_partner_id ?? ""}><option value="">Kein Empfehlungspartner</option>{partners?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input className="input" name="source" defaultValue={l.source ?? ""} placeholder="Quelle" /><label className="text-xs text-muted">Erwarteter Abschluss<input className="input mt-1" type="date" name="expected_close" defaultValue={l.expected_close ?? ""} /></label>
            <textarea className="input" name="pain_points" defaultValue={lines(l.pain_points)} placeholder="Schmerzpunkte (eine pro Zeile)" /><textarea className="input" name="buying_signals" defaultValue={lines(l.buying_signals)} placeholder="Kaufsignale" /><textarea className="input" name="objections" defaultValue={lines(l.objections)} placeholder="Einwände" />
            <input className="input" name="decision_makers" defaultValue={l.decision_makers ?? ""} placeholder="Entscheider" /><input className="input" name="timing" defaultValue={l.timing ?? ""} placeholder="Timing" /><textarea className="input" name="notes" defaultValue={l.notes ?? ""} placeholder="Notizen" />
            <input className="input" name="priority_override" inputMode="numeric" defaultValue={l.priority_override ?? ""} placeholder="Manuelle Priorität (Score überschreiben)" />
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="not_interested" defaultChecked={l.not_interested} className="h-5 w-5 accent-[#F3FF9A]" />Ausdrücklich kein Interesse</label></div>
          <button className="btn btn-primary">Speichern</button></form></details>
    </div>
  );
}
