import { supabaseServer } from "./supabase/server";
import { DEFAULT_WEIGHTS, type Weights } from "./priority";

export type LeadRow = {
  id: string; stage: string; temperature: string; deal_value: number | null; expected_mrr: number | null; source: string | null; proposal_sent: boolean; not_interested: boolean;
  unanswered_attempts: number; buying_signals: string[]; priority_override: number | null; last_interaction_at: string | null; is_demo: boolean; notes: string | null;
  referral_partner_id: string | null; offer_id: string | null; created_at: string;
  companies: { name: string; industry: string | null } | null; contacts: { name: string; phone: string | null } | null;
  tasks: { id: string; title: string; due_date: string; needs_review: boolean; review_reason: string | null; status: string }[];
};
const SELECT = "id, stage, temperature, deal_value, expected_mrr, source, proposal_sent, not_interested, unanswered_attempts, buying_signals, priority_override, last_interaction_at, is_demo, notes, referral_partner_id, offer_id, created_at, companies(name, industry), contacts!leads_contact_id_fkey(name, phone), tasks(id, title, due_date, needs_review, review_reason, status)";

export async function loadLeads(): Promise<LeadRow[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb.from("leads").select(SELECT).order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error("Leads konnten nicht geladen werden: " + error.message);
  return (data as unknown as LeadRow[]).map((l) => ({ ...l, tasks: l.tasks.filter((t) => t.status === "open") }));
}
export async function loadSettings() {
  const sb = await supabaseServer(); const { data } = await sb.from("settings").select("*").maybeSingle();
  return {
    weights: { ...DEFAULT_WEIGHTS, ...(data?.priority_weights ?? {}) } as Weights,
    prob: (data?.weighted_probability ?? { new: 0.05, contacted: 0.1, replied: 0.15, qualified: 0.3, call_booked: 0.4, call_completed: 0.5, proposal: 0.6, decision_pending: 0.75 }) as Record<string, number>,
    followup: (data?.followup_defaults ?? { no_answer: 2, message_sent: 2, proposal_sent: 2, meeting_completed: 1, decision_pending: 1, interested: 2 }) as Record<string, number>,
    goals: (data?.goals ?? { customers_per_month: 10, daily_outreach: 50, monthly_calls: 2000, monthly_revenue: 10000 }) as Record<string, number>,
    self_name: (data?.self_name ?? null) as string | null, self_url: (data?.self_linkedin_url ?? null) as string | null,
  };
}
export const leadName = (l: Pick<LeadRow, "companies" | "contacts">) => l.companies?.name ?? l.contacts?.name ?? "Unbenannt";
