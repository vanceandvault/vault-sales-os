export type Deal = { id: string; one_time_value: number; monthly_value: number; contract_months: number | null; won_at: string };
export type Payment = { deal_id: string; kind: "invoiced" | "received"; amount: number; on_date: string };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** Contract value: one-time + monthly × months (months only counted when contractually known). */
export const contractValue = (d: Deal) => Number(d.one_time_value) + Number(d.monthly_value) * (d.contract_months ?? 0);

export function revenueSummary(deals: Deal[], payments: Payment[], today: string) {
  const month = today.slice(0, 7), year = today.slice(0, 4);
  const inM = deals.filter((d) => d.won_at.startsWith(month)), inY = deals.filter((d) => d.won_at.startsWith(year));
  return {
    closedMonth: sum(inM.map(contractValue)), closedYear: sum(inY.map(contractValue)),
    oneTimeMonth: sum(inM.map((d) => Number(d.one_time_value))), mrrMonth: sum(inM.map((d) => Number(d.monthly_value))),
    mrrTotal: sum(deals.map((d) => Number(d.monthly_value))),
    totalContracted: sum(deals.map(contractValue)),
    invoiced: sum(payments.filter((p) => p.kind === "invoiced").map((p) => Number(p.amount))),
    received: sum(payments.filter((p) => p.kind === "received").map((p) => Number(p.amount))),
    customers: deals.length,
    avgDeal: deals.length ? sum(deals.map((d) => Number(d.one_time_value) || Number(d.monthly_value))) / deals.length : 0,
  };
}

export function pipelineSummary(leads: { stage: string; deal_value: number | null }[], prob: Record<string, number>) {
  const active = leads.filter((l) => l.stage !== "won" && l.stage !== "lost");
  return { active: sum(active.map((l) => Number(l.deal_value ?? 0))),
    weighted: sum(active.map((l) => Number(l.deal_value ?? 0) * (prob[l.stage] ?? 0))), count: active.length };
}
