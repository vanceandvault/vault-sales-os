"use client";
import { useState } from "react";
import { completeTask } from "@/app/actions";
import { addDays, zurichToday } from "@/lib/dates";

const OUTCOMES: [string, string][] = [["no_answer", "Nicht erreicht"], ["spoke", "Gesprochen"], ["message_sent", "Nachricht gesendet"], ["interested", "Interessiert"], ["meeting_booked", "Termin gebucht"],
  ["proposal_sent", "Angebot gesendet"], ["decision_pending", "Entscheid offen"], ["won", "Gewonnen"], ["lost", "Verloren"], ["other", "Andere"]];
const SUGGEST: Record<string, string> = { no_answer: "Erneut anrufen", message_sent: "Antwort prüfen / nachfassen", proposal_sent: "Angebot nachfassen", decision_pending: "Entscheid nachfassen",
  meeting_booked: "Termin vorbereiten", spoke: "Nächsten Schritt klären", interested: "Angebot / Termin vorschlagen", other: "" };

export function DoneSheet({ taskId, leadId, title, followup }: { taskId: string; leadId: string; title: string; followup: Record<string, number> }) {
  const [open, setOpen] = useState(false); const [outcome, setOutcome] = useState<string | null>(null);
  const days = outcome ? followup[outcome] ?? (outcome === "other" || outcome === "won" || outcome === "lost" ? null : 2) : null;
  const today = zurichToday();
  return (
    <>
      <button className="btn btn-ghost flex-1" onClick={() => setOpen(true)}>Erledigt</button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Was ist passiert?" className="fixed inset-0 z-50 flex items-end bg-black/70 md:items-center md:justify-center">
          <form action={completeTask.bind(null, taskId)} className="pb-safe max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-bg p-5 md:max-w-lg md:rounded-3xl">
            <div className="mb-1 flex items-center justify-between"><div className="label">Was ist passiert?</div><button type="button" className="btn btn-ghost min-h-10 px-3" onClick={() => setOpen(false)}>Abbrechen</button></div>
            <p className="mb-4 text-sm text-muted">{title}</p>
            <input type="hidden" name="outcome" value={outcome ?? ""} />
            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map(([k, l]) => (
                <button type="button" key={k} onClick={() => setOutcome(k)} aria-pressed={outcome === k}
                  className={`btn min-h-12 ${outcome === k ? "border-accent bg-accent/10 text-accent" : "btn-ghost"} ${k === "won" ? "col-span-1" : ""}`}>{l}</button>))}
            </div>
            <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("vault:quick-update", { detail: { leadId } })); }}>🎙 Stattdessen per Sprache</button>
            {outcome && outcome !== "won" && outcome !== "lost" && (
              <div className="mt-5 grid gap-3">
                <div className="label">Nächste Aktion {days != null ? `(Vorschlag: in ${days} Tagen)` : ""}</div>
                <input className="input" name="next_title" defaultValue={SUGGEST[outcome] ?? ""} key={outcome} placeholder="Nächste Aktion (leer = Standard)" />
                <div className="grid grid-cols-2 gap-3">
                  <input className="input" type="date" name="next_due" min={today} defaultValue={days != null ? addDays(today, days) : ""} key={"d" + outcome} />
                  <input className="input" name="next_due_text" placeholder='oder "Freitag"' />
                </div>
                <textarea className="input" name="note" placeholder="Notiz (optional)" />
              </div>)}
            {(outcome === "won" || outcome === "lost") && <p className="mt-4 text-sm text-muted">Im nächsten Schritt bestätigst du {outcome === "won" ? "den Gewinn und Vertragswert" : "den Verlust"} – vorher wird nichts geändert.</p>}
            <button disabled={!outcome} className="btn btn-primary mt-5 w-full">Speichern</button>
          </form>
        </div>)}
    </>
  );
}
