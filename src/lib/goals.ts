export type Funnel = { prospects: number; attempts: number; connected: number; qualified: number; meetings: number; proposals: number; won: number };
export const MIN_WON_FOR_RATE = 3, MIN_PROSPECTS_FOR_RATE = 30;

/** Conversion rate = won ÷ unique prospects contacted (not ÷ repeated attempts). Returns null when data is insufficient. */
export function actualRate(f: Funnel): number | null {
  if (f.won < MIN_WON_FOR_RATE || f.prospects < MIN_PROSPECTS_FOR_RATE) return null;
  return f.won / f.prospects;
}
export function volumeNeeded(goalCustomers: number, rate: number | null, f: Funnel, scenarioRate?: number) {
  const r = rate ?? scenarioRate ?? null;
  if (!r || r <= 0) return { status: "insufficient" as const };
  const required = Math.ceil(goalCustomers / r);
  return { status: rate ? ("actual" as const) : ("scenario" as const), rate: r, required, completed: f.prospects, remaining: Math.max(0, required - f.prospects) };
}
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
