import { describe, it, expect } from "vitest";
import { parseGermanDate as p, addDays, weekdayName, formatCHF } from "@/lib/dates";
import { rankQueue, scoreLead } from "@/lib/priority";
import { revenueSummary, pipelineSummary } from "@/lib/revenue";
import { actualRate, volumeNeeded } from "@/lib/goals";

const TODAY = "2026-10-08"; // Thursday
describe("German dates", () => {
  it("resolves common phrases", () => {
    expect(weekdayName(TODAY)).toBe("Donnerstag");
    expect(p("Freitag", TODAY)?.date).toBe("2026-10-09");
    expect(p("übermorgen", TODAY)?.date).toBe("2026-10-10");
    expect(p("morgen", TODAY)?.date).toBe("2026-10-09");
    expect(p("nächsten Donnerstag", TODAY)?.date).toBe("2026-10-15"); // never "today"
    expect(p("in 3 Tagen", TODAY)?.date).toBe("2026-10-11");
    expect(p("15.11.", TODAY)?.date).toBe("2026-11-15");
    expect(p("nächste Woche Mittwoch", TODAY)?.date).toBe("2026-10-14");
  });
  it("flags month-only dates as approximate", () => {
    const r = p("im Januar", TODAY)!; expect(r.date).toBe("2027-01-01"); expect(r.approximate).toBe(true);
  });
  it("returns null for unknown", () => { expect(p("irgendwann mal", TODAY)).toBeNull(); expect(addDays("2026-12-31", 1)).toBe("2027-01-01"); });
  it("formats CHF with apostrophe", () => expect(formatCHF(14900)).toBe("CHF 14'900"));
});

const lead = (o = {}) => ({ temperature: "cold", stage: "contacted", deal_value: null, proposal_sent: false, not_interested: false, unanswered_attempts: 0, buying_signals: [], priority_override: null, ...o });
describe("priority", () => {
  it("scores per spec and explains", () => {
    const s = scoreLead(lead({ temperature: "hot", stage: "decision_pending", deal_value: 5000 }), "2026-10-07", TODAY);
    expect(s.score).toBe(25 + 20 + 10 + 5);
  });
  it("excludes won/lost and honours override", () => {
    const q = rankQueue([{ lead: lead({ stage: "won" }), due: TODAY }, { lead: lead({ priority_override: 99 }), due: TODAY }, { lead: lead({ temperature: "hot" }), due: TODAY }], TODAY);
    expect(q).toHaveLength(2); expect(q[0].score).toBe(99);
  });
  it("penalises rejections", () => expect(scoreLead(lead({ not_interested: true, unanswered_attempts: 4 }), null, TODAY).score).toBe(-55));
});

describe("revenue", () => {
  it("separates contract, invoiced, received; a won deal is not cash", () => {
    const deals = [{ id: "a", one_time_value: 1490, monthly_value: 0, contract_months: null, won_at: "2026-10-02" }, { id: "b", one_time_value: 0, monthly_value: 900, contract_months: 12, won_at: "2026-03-01" }];
    const r = revenueSummary(deals, [], TODAY);
    expect(r.closedMonth).toBe(1490); expect(r.closedYear).toBe(1490 + 10800); expect(r.received).toBe(0); expect(r.mrrTotal).toBe(900);
  });
  it("weights the pipeline and excludes won/lost", () => {
    const r = pipelineSummary([{ stage: "proposal", deal_value: 1000 }, { stage: "won", deal_value: 5000 }, { stage: "lost", deal_value: 7 }], { proposal: 0.6 });
    expect(r).toEqual({ active: 1000, weighted: 600, count: 1 });
  });
});

describe("goals", () => {
  const f = { prospects: 310, attempts: 900, connected: 120, qualified: 30, meetings: 12, proposals: 8, won: 4 };
  it("uses actual rate when enough data", () => {
    const r = actualRate(f)!; expect(r).toBeCloseTo(4 / 310);
    const v = volumeNeeded(10, r, f); expect(v).toMatchObject({ status: "actual", required: 775 });
  });
  it("says insufficient without data, supports scenarios", () => {
    const s = { ...f, won: 1 }; expect(actualRate(s)).toBeNull();
    expect(volumeNeeded(10, null, s).status).toBe("insufficient");
    expect(volumeNeeded(10, null, s, 0.012)).toMatchObject({ status: "scenario", required: 834 });
  });
});
