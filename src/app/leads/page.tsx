import Link from "next/link";
import { loadLeads, leadName } from "@/lib/queries";
import { PageHeader, Temp, Stage, Demo, Empty } from "@/components/ui";
import { STAGES, STAGE_LABEL } from "@/lib/voice";
import { diffDays, formatCH, formatCHF, zurichToday } from "@/lib/dates";

export const dynamic = "force-dynamic";
type SP = { q?: string; t?: string; s?: string; f?: string; ind?: string; src?: string };
const FILTERS: [string, string][] = [["overdue", "Überfällig"], ["no_action", "Ohne Aktion"], ["decision", "Entscheid offen"], ["proposal", "Angebot gesendet"], ["done", "Gewonnen/Verloren"]];

export default async function Leads({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const today = zurichToday(); let leads = await loadLeads();
  const industries = [...new Set(leads.map((l) => l.companies?.industry).filter(Boolean))] as string[]; const sources = [...new Set(leads.map((l) => l.source).filter(Boolean))] as string[];
  const q = sp.q?.toLowerCase().trim();
  if (sp.f !== "done") leads = leads.filter((l) => !["won", "lost"].includes(l.stage)); else leads = leads.filter((l) => ["won", "lost"].includes(l.stage));
  if (q) leads = leads.filter((l) => `${leadName(l)} ${l.contacts?.name ?? ""} ${l.notes ?? ""}`.toLowerCase().includes(q));
  if (sp.t) leads = leads.filter((l) => l.temperature === sp.t); if (sp.s) leads = leads.filter((l) => l.stage === sp.s);
  if (sp.ind) leads = leads.filter((l) => l.companies?.industry === sp.ind); if (sp.src) leads = leads.filter((l) => l.source === sp.src);
  if (sp.f === "overdue") leads = leads.filter((l) => l.tasks[0] && l.tasks[0].due_date < today);
  if (sp.f === "no_action") leads = leads.filter((l) => !l.tasks[0]);
  if (sp.f === "decision") leads = leads.filter((l) => l.stage === "decision_pending");
  if (sp.f === "proposal") leads = leads.filter((l) => l.proposal_sent || l.stage === "proposal");
  const href = (o: Partial<SP>) => "/leads?" + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const chip = (on: boolean) => `chip min-h-9 ${on ? "border-accent text-accent" : "text-muted"}`;

  return (
    <div>
      <PageHeader title="Leads" sub={`${leads.length} Einträge`} right={<Link href="/leads/new" className="btn btn-primary">＋ Neu</Link>} />
      <form className="mb-3"><input name="q" defaultValue={sp.q} className="input" placeholder="Firma, Kontakt oder Notiz suchen …" type="search" />
        {["t", "s", "f", "ind", "src"].map((k) => sp[k as keyof SP] && <input key={k} type="hidden" name={k} value={sp[k as keyof SP]} />)}</form>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {["hot", "warm", "cold"].map((t) => <Link key={t} href={href({ t: sp.t === t ? undefined : t })} className={chip(sp.t === t)}>{t === "hot" ? "Heiss" : t === "warm" ? "Warm" : "Kalt"}</Link>)}
        {FILTERS.map(([k, l]) => <Link key={k} href={href({ f: sp.f === k ? undefined : k })} className={chip(sp.f === k)}>{l}</Link>)}
        {STAGES.filter((s) => s !== "won" && s !== "lost").map((s) => <Link key={s} href={href({ s: sp.s === s ? undefined : s })} className={chip(sp.s === s)}>{STAGE_LABEL[s]}</Link>)}
        {industries.map((i) => <Link key={i} href={href({ ind: sp.ind === i ? undefined : i })} className={chip(sp.ind === i)}>{i}</Link>)}
        {sources.map((i) => <Link key={i} href={href({ src: sp.src === i ? undefined : i })} className={chip(sp.src === i)}>Quelle: {i}</Link>)}
      </div>
      {leads.length === 0 && <Empty>Keine Leads gefunden.</Empty>}
      <div className="grid gap-2">
        {leads.map((l) => { const t = l.tasks[0]; return (
          <Link key={l.id} href={`/leads/${l.id}`} className="card block py-3">
            <div className="flex items-center justify-between gap-2"><div className="min-w-0 truncate font-semibold">{leadName(l)} {l.is_demo && <Demo />}</div><Temp t={l.temperature} /></div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><Stage s={l.stage} />{l.contacts?.name && <span>{l.contacts.name}</span>}{l.deal_value != null && <span className="text-accent">{formatCHF(l.deal_value)}</span>}</div>
            <div className={`mt-2 text-xs ${t && diffDays(today, t.due_date) > 0 ? "text-danger" : "text-muted"}`}>{t ? `${t.title} · ${formatCH(t.due_date)}` : "⚠ Keine nächste Aktion"}</div>
          </Link>); })}
      </div>
    </div>
  );
}
