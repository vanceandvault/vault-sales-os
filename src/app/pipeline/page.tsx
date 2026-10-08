import { loadLeads, loadSettings, leadName } from "@/lib/queries";
import { PageHeader, Stat } from "@/components/ui";
import { Pipeline } from "@/components/Pipeline";
import { pipelineSummary } from "@/lib/revenue";
import { formatCH, formatCHF, zurichToday } from "@/lib/dates";

export const dynamic = "force-dynamic";
export default async function PipelinePage() {
  const [leads, settings] = await Promise.all([loadLeads(), loadSettings()]); const today = zurichToday(); const p = pipelineSummary(leads, settings.prob);
  const cards = leads.map((l) => ({ id: l.id, name: leadName(l), contact: l.contacts?.name ?? null, value: l.deal_value, temp: l.temperature, stage: l.stage, next: l.tasks[0]?.title ?? null, due: l.tasks[0] ? formatCH(l.tasks[0].due_date) : null, overdue: !!l.tasks[0] && l.tasks[0].due_date < today }));
  return (
    <div><PageHeader title="Pipeline" />
      <div className="card mb-5 grid grid-cols-2 gap-4"><Stat value={formatCHF(p.active)} label={`Aktive Pipeline (${p.count})`} accent /><Stat value={formatCHF(p.weighted)} label="Gewichtet (Schätzung)" /></div>
      <Pipeline cards={cards} />
      <p className="mt-4 text-xs text-muted">Gewichtung = Dealwert × hinterlegte Phasen-Wahrscheinlichkeit (Einstellungen). Das ist eine Planungsgrösse, keine Prognose.</p></div>
  );
}
