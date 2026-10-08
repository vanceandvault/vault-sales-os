import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { loadLeads, loadSettings, leadName } from "@/lib/queries";
import { rankQueue, isActive } from "@/lib/priority";
import { pipelineSummary, revenueSummary } from "@/lib/revenue";
import { diffDays, formatCH, formatCHF, weekdayName, zurichToday, TZ } from "@/lib/dates";
import { Stat, Temp, Stage, Demo, Empty } from "@/components/ui";
import { DoneSheet } from "@/components/DoneSheet";
import { setNextAction, snoozeTask } from "./actions";

export const dynamic = "force-dynamic";
const MONTHS = ["JANUAR", "FEBRUAR", "MÄRZ", "APRIL", "MAI", "JUNI", "JULI", "AUGUST", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DEZEMBER"];

function ago(iso: string | null) {
  if (!iso) return "Noch kein Kontakt"; const d = diffDays(zurichToday(), iso.slice(0, 10));
  return d <= 0 ? "Heute" : d === 1 ? "Gestern" : `Vor ${d} Tagen`;
}

export default async function Today() {
  const sb = await supabaseServer(); const today = zurichToday();
  const [leads, settings, { data: deals }, { data: payments }, { data: user }, { count: sugg }] = await Promise.all([
    loadLeads(), loadSettings(), sb.from("deals").select("*"), sb.from("payments").select("*"), sb.auth.getUser(),
    sb.from("suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const hour = Number(new Intl.DateTimeFormat("de-CH", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
  const first = (user.user?.email?.split("@")[0].split(/[._-]/)[0] ?? "").toUpperCase();
  const [, m, d] = today.split("-").map(Number);
  const active = leads.filter((l) => isActive(l.stage));
  const due = rankQueue(active.filter((l) => l.tasks[0] && l.tasks[0].due_date <= today).map((l) => ({ l, lead: l, due: l.tasks[0].due_date })), today, settings.weights);
  const upcoming = active.filter((l) => l.tasks[0] && l.tasks[0].due_date > today).sort((a, b) => a.tasks[0].due_date.localeCompare(b.tasks[0].due_date)).slice(0, 6);
  const noAction = active.filter((l) => !l.tasks[0]);
  const review = active.filter((l) => l.tasks[0]?.needs_review);
  const rev = revenueSummary((deals ?? []) as never, (payments ?? []) as never, today); const pipe = pipelineSummary(leads, settings.prob);

  return (
    <div className="pt-safe pt-6">
      <div className="label">VAULT STUDIO</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{hour < 11 ? "GUTEN MORGEN" : hour < 17 ? "GUTEN TAG" : "GUTEN ABEND"}{first ? `, ${first}` : ""}</h1>
      <div className="label mt-1">{weekdayName(today).toUpperCase()}, {String(d).padStart(2, "0")}. {MONTHS[m - 1]}</div>

      <section aria-label="Finanzen" className="card mt-6 grid grid-cols-3 gap-4">
        <Stat value={formatCHF(rev.closedMonth)} label="Abgeschlossen (Monat)" accent />
        <Stat value={formatCHF(pipe.active)} label="Aktive Pipeline" />
        <Stat value={due.length} label="Aktionen heute" />
      </section>
      <div className="mt-2 px-1 text-xs text-muted">Gewichtete Pipeline (Schätzung): {formatCHF(pipe.weighted)} · Offene Zahlungen werden nicht als Umsatz gezählt.</div>

      {(review.length > 0 || (sugg ?? 0) > 0 || noAction.length > 0) && (
        <div className="mt-5 grid gap-2">
          {review.length > 0 && <Link href="#review" className="card flex items-center justify-between border-accent/40 py-3 text-sm"><span>{review.length} Aktion(en) zur Prüfung (neue LinkedIn-Antwort)</span><span className="text-accent">→</span></Link>}
          {(sugg ?? 0) > 0 && <Link href="/linkedin" className="card flex items-center justify-between py-3 text-sm"><span>{sugg} LinkedIn-Vorschlag/Vorschläge warten auf dich</span><span className="text-accent">→</span></Link>}
          {noAction.length > 0 && <Link href="/leads?f=no_action" className="card flex items-center justify-between py-3 text-sm"><span>{noAction.length} aktive Leads ohne nächste Aktion</span><span className="text-accent">→</span></Link>}
        </div>)}

      <h2 className="h-section">Heutige Prioritäten</h2>
      {due.length === 0 && <Empty>Keine fälligen Aktionen. {leads.length === 0 ? <>Lege deinen ersten Lead an oder lade <Link className="text-accent underline" href="/more">Demo-Daten</Link>.</> : "Gut gemacht."}</Empty>}
      <div className="grid gap-3">
        {due.map((x, i) => {
          const l = x.l, t = l.tasks[0], late = diffDays(today, t.due_date);
          const callish = /anruf|anrufen|telefon|call/i.test(t.title);
          return (
            <article key={l.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="label">{String(i + 1).padStart(2, "0")} — {leadName(l).toUpperCase()} {l.is_demo && <Demo />}</div>
                  <div className="mt-1 text-sm text-muted">{l.contacts?.name ? `Kontakt: ${l.contacts.name}` : "Kein Kontakt erfasst"}</div></div>
                <Temp t={l.temperature} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2"><Stage s={l.stage} />{l.deal_value != null && <span className="chip text-accent border-accent/30">Potenzial {formatCHF(l.deal_value)}</span>}
                <span className="text-xs text-muted">Letzte Interaktion: {ago(l.last_interaction_at)}</span></div>
              <div className="mt-4 rounded-xl bg-bg p-3"><div className="label mb-1">Nächste Aktion</div><div className="font-medium">{t.title}</div>
                <div className={`mt-1 text-xs ${late > 0 ? "text-danger" : "text-muted"}`}>{late > 0 ? `Überfällig seit ${late} Tag(en) · ${formatCH(t.due_date)}` : `Heute fällig · ${formatCH(t.due_date)}`}</div>
                {t.needs_review && <div id="review" className="mt-2 text-xs text-accent">⚠ {t.review_reason}</div>}</div>
              <details className="mt-2"><summary className="cursor-pointer text-xs text-muted">Warum auf Platz {i + 1}? (Score {x.score})</summary><ul className="mt-1 text-xs text-muted">{x.reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
              <div className="mt-4 flex gap-2">
                {callish && l.contacts?.phone ? <a href={`tel:${l.contacts.phone}`} className="btn btn-primary flex-1">Anrufen</a>
                  : <Link href={callish ? `/leads/${l.id}/call` : `/leads/${l.id}#ask`} className="btn btn-primary flex-1">{callish ? "Anrufen" : "Nachfassen"}</Link>}
                <DoneSheet taskId={t.id} leadId={l.id} title={t.title} followup={settings.followup} />
                <Link href={`/leads/${l.id}`} className="btn btn-ghost flex-1">Details</Link>
              </div>
              <form action={snoozeTask.bind(null, t.id, 1)} className="mt-2 text-right"><button className="text-xs text-muted underline">Auf morgen verschieben</button></form>
            </article>);
        })}
      </div>

      {noAction.length > 0 && (<><h2 className="h-section">Ohne nächste Aktion</h2>
        <div className="grid gap-2">{noAction.slice(0, 5).map((l) => (
          <form key={l.id} action={setNextAction.bind(null, l.id)} className="card flex flex-wrap items-center gap-2 py-3">
            <Link href={`/leads/${l.id}`} className="min-w-0 flex-1 truncate font-medium">{leadName(l)}</Link>
            <input name="title" className="input min-h-10 flex-1 basis-40" placeholder="Nächste Aktion" required /><input name="due_text" className="input min-h-10 w-28" placeholder="Freitag" />
            <button className="btn btn-blue min-h-10 px-3">＋</button></form>))}</div></>)}

      {upcoming.length > 0 && (<><h2 className="h-section">Demnächst</h2>
        <div className="grid gap-2">{upcoming.map((l) => (
          <Link key={l.id} href={`/leads/${l.id}`} className="card flex items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><div className="truncate font-medium">{leadName(l)}</div><div className="truncate text-xs text-muted">{l.tasks[0].title}</div></div>
            <div className="shrink-0 text-xs text-muted">{weekdayName(l.tasks[0].due_date).slice(0, 2)} {formatCH(l.tasks[0].due_date)}</div></Link>))}</div></>)}
    </div>
  );
}
