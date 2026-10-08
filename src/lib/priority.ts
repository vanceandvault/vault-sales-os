import { diffDays } from "./dates";

export type Weights = { hot: number; warm: number; decision_pending: number; proposal: number; meeting_completed: number; positive_reply: number;
  overdue: number; due_today: number; high_value: number; unanswered: number; not_interested: number; high_value_threshold: number };
export const DEFAULT_WEIGHTS: Weights = { hot: 25, warm: 15, decision_pending: 20, proposal: 20, meeting_completed: 15, positive_reply: 10,
  overdue: 10, due_today: 10, high_value: 5, unanswered: -15, not_interested: -40, high_value_threshold: 3000 };

export type ScoreLead = { temperature: string; stage: string; deal_value: number | null; proposal_sent: boolean; not_interested: boolean;
  unanswered_attempts: number; buying_signals: string[]; priority_override: number | null };

export const isActive = (stage: string) => stage !== "won" && stage !== "lost";

/** Transparent, rule-based score. Every point is explained; nothing is a hidden "AI probability". */
export function scoreLead(l: ScoreLead, dueDate: string | null, today: string, w: Weights = DEFAULT_WEIGHTS) {
  const reasons: string[] = []; let s = 0;
  const add = (pts: number, why: string) => { s += pts; reasons.push(`${pts > 0 ? "+" : ""}${pts} ${why}`); };
  if (l.temperature === "hot") add(w.hot, "Heisser Lead"); else if (l.temperature === "warm") add(w.warm, "Warmer Lead");
  if (l.stage === "decision_pending") add(w.decision_pending, "Entscheid ausstehend");
  if (l.proposal_sent || l.stage === "proposal") add(w.proposal, "Angebot gesendet");
  if (l.stage === "call_completed") add(w.meeting_completed, "Gespräch abgeschlossen");
  if (l.stage === "replied" || l.buying_signals.length) add(w.positive_reply, "Positive Signale");
  if (dueDate) { const d = diffDays(dueDate, today); if (d < 0) add(w.overdue, "Überfällig"); else if (d === 0) add(w.due_today, "Heute fällig"); }
  if ((l.deal_value ?? 0) >= w.high_value_threshold) add(w.high_value, "Hoher Dealwert");
  if (l.unanswered_attempts >= 3) add(w.unanswered, `${l.unanswered_attempts} Versuche ohne Antwort`);
  if (l.not_interested) add(w.not_interested, "Ausdrücklich kein Interesse");
  if (l.priority_override != null) return { score: l.priority_override, reasons: ["Manuell überschrieben"], overridden: true };
  return { score: s, reasons, overridden: false };
}

export type QueueItem<T> = T & { score: number; reasons: string[]; due: string };
/** Today's queue: only open leads; overdue and due-today first by score; due date breaks ties. */
export function rankQueue<T extends { lead: ScoreLead; due: string }>(items: T[], today: string, w?: Weights): QueueItem<T>[] {
  return items.filter((i) => isActive(i.lead.stage))
    .map((i) => ({ ...i, ...scoreLead(i.lead, i.due, today, w) }))
    .sort((a, b) => b.score - a.score || a.due.localeCompare(b.due));
}
