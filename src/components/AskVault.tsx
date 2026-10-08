"use client";
import { useState } from "react";

const TASKS: [string, string][] = [["next", "Was soll ich als Nächstes tun?"], ["followup", "Follow-up schreiben"], ["prepare_call", "Anruf vorbereiten"], ["summary", "Verlauf zusammenfassen"],
  ["objections", "Einwände erkennen"], ["signals", "Kaufsignale erkennen"], ["question", "Nächste Frage vorschlagen"]];

export function AskVault({ leadId, hasLinkedIn }: { leadId: string; hasLinkedIn: boolean }) {
  const [busy, setBusy] = useState<string | null>(null); const [out, setOut] = useState<{ task: string; text: string } | null>(null); const [err, setErr] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  async function run(task: string) {
    setBusy(task); setErr(null); setOut(null); setCopied(false);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, task }) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? "Anfrage fehlgeschlagen."); else setOut({ task, text: j.text });
    } catch { setErr("Keine Verbindung."); } finally { setBusy(null); }
  }
  const copy = async () => { await navigator.clipboard.writeText(out!.text).then(() => setCopied(true)).catch(() => setErr("Kopieren nicht möglich – bitte Text markieren.")); };
  return (
    <section id="ask" className="card">
      <div className="label mb-3">Ask VAULT</div>
      <div className="flex flex-wrap gap-2">
        {TASKS.map(([k, l]) => <button key={k} disabled={!!busy} onClick={() => run(k)} className="btn btn-ghost min-h-10 px-3 text-xs">{busy === k ? "…" : l}</button>)}
        {hasLinkedIn && <button disabled={!!busy} onClick={() => run("reply")} className="btn btn-blue min-h-10 px-3 text-xs">{busy === "reply" ? "…" : "LinkedIn-Antwort generieren"}</button>}
      </div>
      {err && <div role="alert" className="mt-3 text-sm text-danger">{err}</div>}
      {out && (<div className="mt-4 rounded-xl bg-bg p-4"><div className="whitespace-pre-wrap text-sm leading-relaxed">{out.text}</div>
        <div className="mt-3 flex items-center gap-3"><button onClick={copy} className="btn btn-primary min-h-10 px-4 text-xs">{copied ? "Kopiert ✓" : "Nachricht kopieren"}</button>
          <span className="text-xs text-muted">KI-Vorschlag – wird nie automatisch gesendet.</span></div></div>)}
    </section>
  );
}
