"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";
import { deleteDraft, listDrafts, saveDraft, type Draft } from "@/lib/drafts";
import { ACTIVITY_TYPES, OUTCOMES, STAGES, STAGE_LABEL } from "@/lib/voice";
import { formatCH, weekdayName } from "@/lib/dates";

type LeadRef = { id: string; company: string | null; contact: string | null; stage: string };
type Proposal = {
  company_name: string | null; contact_name: string | null; activity_type: string; outcome: string | null; summary: string; suggested_stage: string | null; suggested_temperature: string | null;
  deal_value: number | null; expected_mrr: number | null; pain_points: string[]; objections: string[]; buying_signals: string[]; decision_makers: string | null; timing: string | null;
  next_action_title: string | null; confidence: number; warnings: string[]; needs_won_confirmation: boolean;
  match: { status: string; candidates: { lead_id: string; label: string; score: number }[] }; due: { date: string; approximate: boolean } | null;
};
type Step = "idle" | "recording" | "transcribing" | "transcript" | "interpreting" | "preview" | "saving" | "done";
const ACT_LABEL: Record<string, string> = { call: "Telefonat", call_attempt: "Anrufversuch", email: "E-Mail", linkedin_message: "LinkedIn-Nachricht", linkedin_reply: "LinkedIn-Antwort", meeting: "Meeting", proposal: "Angebot", note: "Notiz", follow_up: "Follow-up", other: "Sonstiges" };
const OUT_LABEL: Record<string, string> = { no_answer: "Nicht erreicht", spoke: "Gesprochen", message_sent: "Nachricht gesendet", interested: "Interessiert", meeting_booked: "Termin gebucht", proposal_sent: "Angebot gesendet", decision_pending: "Entscheid offen", other: "Anderes" };
const MAX_SECONDS = 180;

export function QuickUpdate() {
  const router = useRouter();
  const [open, setOpen] = useState(false); const [step, setStep] = useState<Step>("idle"); const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(""); const [leadId, setLeadId] = useState<string | undefined>(); const [secs, setSecs] = useState(0);
  const [vuId, setVuId] = useState<string | null>(null); const [leads, setLeads] = useState<LeadRef[]>([]); const [offerId, setOfferId] = useState<string | null>(null);
  const [p, setP] = useState<Proposal | null>(null); const [target, setTarget] = useState<string>("new");
  const [form, setForm] = useState({ company: "", contact: "", type: "note", outcome: "", summary: "", stage: "", temp: "", value: "", title: "", due: "", pains: "", objs: "", signals: "" });
  const [wonOk, setWonOk] = useState(false); const [drafts, setDrafts] = useState<Draft[]>([]); const [result, setResult] = useState<{ lead_id: string } | null>(null);
  const rec = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]); const timer = useRef<ReturnType<typeof setInterval> | null>(null); const stream = useRef<MediaStream | null>(null);

  const reset = useCallback(() => { setStep("idle"); setError(null); setTranscript(""); setP(null); setVuId(null); setWonOk(false); setResult(null); setSecs(0); }, []);
  const refreshDrafts = useCallback(() => { listDrafts().then(setDrafts); }, []);
  useEffect(() => {
    const h = (e: Event) => { reset(); setLeadId((e as CustomEvent).detail?.leadId); setOpen(true); refreshDrafts(); };
    window.addEventListener("vault:quick-update", h); return () => window.removeEventListener("vault:quick-update", h);
  }, [reset, refreshDrafts]);
  useEffect(() => { document.body.style.overflow = open ? "hidden" : ""; }, [open]);

  const stopTracks = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; if (timer.current) clearInterval(timer.current); };
  const close = () => { if (rec.current?.state === "recording") { rec.current.onstop = null; rec.current.stop(); } stopTracks(); setOpen(false); reset(); };

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Aufnahme wird in diesem Browser nicht unterstützt. Bitte Text eingeben."); return; }
    try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { setError((e as DOMException).name === "NotAllowedError" ? "Mikrofon-Zugriff verweigert. iPhone: Einstellungen → Safari → Mikrofon erlauben (oder App neu öffnen). Du kannst auch Text eingeben." : "Kein Mikrofon gefunden. Bitte Text eingeben."); return; }
    const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined); chunks.current = []; rec.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onerror = () => { stopTracks(); setStep("idle"); setError("Aufnahme unterbrochen. Bitte erneut starten."); };
    r.onstop = () => { stopTracks(); void send(new Blob(chunks.current, { type: r.mimeType || "audio/mp4" })); };
    r.start(1000); setStep("recording"); setSecs(0);
    timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= MAX_SECONDS) r.state === "recording" && r.stop(); return s + 1; }), 1000);
  }
  const stop = () => { if (rec.current?.state === "recording") rec.current.stop(); };

  async function send(blob: Blob, draftId?: string) {
    if (blob.size < 1500) { setStep("idle"); setError("Keine Sprache erkannt – die Aufnahme war zu kurz."); return; }
    setStep("transcribing"); setError(null);
    const fd = new FormData(); fd.set("audio", new File([blob], `voice.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type }));
    try {
      const r = await fetch("/api/voice/transcribe", { method: "POST", body: fd }); const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.code === "stt_network" || r.status >= 500) await saveDraft({ id: draftId, audio: blob, mime: blob.type, leadId, error: j.error });
        setStep("idle"); refreshDrafts(); setError(`${j.error ?? "Transkription fehlgeschlagen."} ${r.status >= 500 ? "Die Aufnahme wurde als Entwurf gespeichert." : ""}`); return;
      }
      if (draftId) await deleteDraft(draftId);
      setTranscript(j.transcript); setStep("transcript");
    } catch {
      await saveDraft({ id: draftId, audio: blob, mime: blob.type, leadId, error: "Offline" }); refreshDrafts();
      setStep("idle"); setError("Keine Verbindung. Die Aufnahme ist als Entwurf auf diesem Gerät gespeichert – sende sie später erneut.");
    }
  }

  async function interpret(text = transcript, draftId?: string) {
    setStep("interpreting"); setError(null);
    try {
      const r = await fetch("/api/voice/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text, leadId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.voiceUpdateId) setVuId(j.voiceUpdateId); setStep("transcript"); setError(`${j.error ?? "Auswertung fehlgeschlagen."} Dein Text ist gesichert – erneut versuchen oder oben anpassen.`); return; }
      if (draftId) await deleteDraft(draftId);
      const pr: Proposal = j.proposal; setP(pr); setVuId(j.voiceUpdateId); setLeads(j.leads); setOfferId(j.offerId);
      const top = pr.match.candidates[0];
      setTarget(pr.match.status === "exact" && top ? top.lead_id : pr.match.status === "ambiguous" ? "" : "new");
      setForm({ company: pr.company_name ?? "", contact: pr.contact_name ?? "", type: pr.activity_type, outcome: pr.outcome ?? "", summary: pr.summary, stage: pr.suggested_stage ?? "", temp: pr.suggested_temperature ?? "",
        value: pr.deal_value != null ? String(pr.deal_value) : "", title: pr.next_action_title ?? "", due: pr.due?.date ?? "", pains: pr.pain_points.join("\n"), objs: pr.objections.join("\n"), signals: pr.buying_signals.join("\n") });
      setWonOk(false); setStep("preview");
    } catch { setStep("transcript"); setError("Keine Verbindung. Dein Text ist gesichert – bitte erneut versuchen."); await saveDraft({ transcript: text, leadId, error: "Offline" }); refreshDrafts(); }
  }

  async function save() {
    if (!p) return; setError(null);
    if (!target) { setError("Bitte den richtigen Lead wählen."); return; }
    if (target === "new" && !form.company.trim() && !form.contact.trim()) { setError("Firma oder Kontakt für den neuen Lead angeben."); return; }
    if (form.stage === "won" && !wonOk) { setError("Bitte den Gewinn ausdrücklich bestätigen."); return; }
    if (form.title.trim() && !form.due) { setError("Bitte ein Fälligkeitsdatum für die nächste Aktion wählen."); return; }
    const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    const value = form.value.trim() ? Number(form.value.replace(/['’\s]/g, "").replace(",", ".")) : null;
    if (value != null && !Number.isFinite(value)) { setError("Betrag ungültig."); return; }
    const body = {
      voice_update_id: vuId ?? undefined, ...(target === "new" ? { new_lead: { company_name: form.company.trim() || undefined, contact_name: form.contact.trim() || undefined, source: "Sprachnotiz" } } : { lead_id: target }),
      activity: { type: form.type, outcome: form.outcome || null, summary: form.summary },
      lead: { stage: form.stage || null, temperature: form.temp || null, deal_value: value, offer_id: offerId, pain_points: lines(form.pains), objections: lines(form.objs), buying_signals: lines(form.signals), decision_makers: p.decision_makers, timing: p.timing },
      next_action: form.title.trim() && form.due ? { title: form.title.trim(), due_date: form.due } : null,
      ...(form.stage === "won" ? { won: { confirmed: true, one_time_value: value ?? 0 } } : {}),
    };
    setStep("saving");
    try {
      const r = await fetch("/api/voice/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { setStep("preview"); setError(j.error ?? "Speichern fehlgeschlagen."); return; }
      setResult(j); setStep("done"); router.refresh();
    } catch { setStep("preview"); setError("Keine Verbindung – nichts wurde gespeichert. Bitte erneut versuchen."); }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const dueLabel = form.due ? `${weekdayName(form.due)}, ${formatCH(form.due)}` : "";

  return (
    <>
      <button onClick={() => { reset(); setLeadId(undefined); setOpen(true); refreshDrafts(); }} aria-label="Quick Update per Sprache"
        className="fixed bottom-24 left-1/2 z-40 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-bg shadow-[0_8px_30px_rgba(243,255,154,0.25)] active:scale-95 md:bottom-8 md:left-auto md:right-8 md:translate-x-0">
        {Icon.mic}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Quick Update" className="fixed inset-0 z-50 flex items-end bg-black/70 md:items-center md:justify-center">
          <div className="pb-safe max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-bg p-5 md:max-w-xl md:rounded-3xl">
            <div className="mb-4 flex items-center justify-between"><div className="label">Quick Update{leadId ? " · für diesen Lead" : ""}</div><button onClick={close} className="btn btn-ghost min-h-10 px-3">Schliessen</button></div>
            {error && <div role="alert" className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

            {(step === "idle" || step === "recording") && (
              <div className="text-center">
                <p className="mb-6 text-sm text-muted">Sprich dein Update, z.B. „Ich habe Milos von HM Renovation angerufen, er will Freitag zurückrufen.“</p>
                {step === "idle" ? (
                  <button onClick={start} className="btn btn-primary mx-auto h-24 w-24 rounded-full text-3xl" aria-label="Aufnahme starten">{Icon.mic}</button>
                ) : (
                  <>
                    <button onClick={stop} className="btn mx-auto h-24 w-24 animate-pulse rounded-full bg-danger text-bg" aria-label="Aufnahme beenden">■</button>
                    <div className="mt-3 text-2xl tabular-nums" aria-live="polite">{mmss}</div><div className="label">Tippen zum Beenden</div>
                  </>
                )}
                {step === "idle" && (
                  <div className="mt-8 text-left">
                    <div className="label mb-2">Oder Text eingeben</div>
                    <textarea className="input" placeholder="Update als Text …" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
                    <button disabled={transcript.trim().length < 3} onClick={() => interpret()} className="btn btn-blue mt-3 w-full">Auswerten</button>
                  </div>
                )}
                {step === "idle" && drafts.length > 0 && (
                  <div className="mt-8 text-left"><div className="label mb-2">Gespeicherte Entwürfe ({drafts.length})</div>
                    {drafts.map((d) => (
                      <div key={d.id} className="card mb-2 flex items-center justify-between gap-2 py-3">
                        <div className="min-w-0 text-sm"><div>{new Date(d.createdAt).toLocaleString("de-CH")}</div><div className="truncate text-xs text-muted">{d.audio ? "Audio" : d.transcript}</div></div>
                        <div className="flex gap-2"><button className="btn btn-primary min-h-10 px-3" onClick={() => { setLeadId(d.leadId); d.audio ? send(d.audio, d.id) : interpret(d.transcript!, d.id); }}>Senden</button>
                          <button className="btn btn-ghost min-h-10 px-3" aria-label="Entwurf löschen" onClick={async () => { await deleteDraft(d.id); refreshDrafts(); }}>✕</button></div>
                      </div>))}
                  </div>)}
              </div>
            )}

            {(step === "transcribing" || step === "interpreting" || step === "saving") && (
              <div className="py-16 text-center" aria-live="polite"><div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
                <div className="label">{step === "transcribing" ? "Transkribiere …" : step === "interpreting" ? "Werte aus …" : "Speichere …"}</div></div>
            )}

            {step === "transcript" && (
              <div><div className="label mb-2">Transkript – bei Bedarf korrigieren</div>
                <textarea className="input min-h-36" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
                <div className="mt-3 grid grid-cols-2 gap-3"><button className="btn btn-ghost" onClick={() => { setStep("idle"); setTranscript(""); }}>Neu aufnehmen</button><button className="btn btn-primary" onClick={() => interpret()}>Auswerten</button></div></div>
            )}

            {step === "preview" && p && (
              <div className="flex flex-col gap-4">
                <div className="card"><div className="label mb-1">Transkript</div><p className="text-sm text-white/80">{transcript}</p></div>
                {p.warnings.map((w, i) => <div key={i} className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm text-accent">⚠ {w}</div>)}
                <label className="block"><span className="label">Lead</span>
                  <select className="input mt-1" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="" disabled>– bitte wählen –</option><option value="new">＋ Neuer Lead</option>
                    {[...p.match.candidates.map((c) => leads.find((l) => l.id === c.lead_id)).filter(Boolean) as LeadRef[], ...leads.filter((l) => !p.match.candidates.some((c) => c.lead_id === l.id))].map((l) => (
                      <option key={l.id} value={l.id}>{[l.company, l.contact].filter(Boolean).join(" — ")} · {STAGE_LABEL[l.stage]}</option>))}
                  </select></label>
                {target === "new" && <div className="grid grid-cols-2 gap-3"><label><span className="label">Firma</span><input className="input mt-1" value={form.company} onChange={set("company")} /></label>
                  <label><span className="label">Kontakt</span><input className="input mt-1" value={form.contact} onChange={set("contact")} /></label></div>}
                <div className="grid grid-cols-2 gap-3">
                  <label><span className="label">Aktivität</span><select className="input mt-1" value={form.type} onChange={set("type")}>{ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACT_LABEL[t]}</option>)}</select></label>
                  <label><span className="label">Ergebnis</span><select className="input mt-1" value={form.outcome} onChange={set("outcome")}><option value="">–</option>{OUTCOMES.map((t) => <option key={t} value={t}>{OUT_LABEL[t]}</option>)}</select></label>
                  <label><span className="label">Phase</span><select className="input mt-1" value={form.stage} onChange={(e) => { set("stage")(e); setWonOk(false); }}><option value="">unverändert</option>{STAGES.map((t) => <option key={t} value={t}>{STAGE_LABEL[t]}</option>)}</select></label>
                  <label><span className="label">Temperatur</span><select className="input mt-1" value={form.temp} onChange={set("temp")}><option value="">unverändert</option><option value="hot">Heiss</option><option value="warm">Warm</option><option value="cold">Kalt</option></select></label>
                </div>
                <label><span className="label">Zusammenfassung</span><textarea className="input mt-1" value={form.summary} onChange={set("summary")} /></label>
                <label><span className="label">Potenzial / Vertragswert (CHF)</span><input className="input mt-1" inputMode="decimal" value={form.value} onChange={set("value")} /></label>
                <div className="grid grid-cols-5 gap-3"><label className="col-span-3"><span className="label">Nächste Aktion</span><input className="input mt-1" value={form.title} onChange={set("title")} placeholder="z.B. Milos anrufen" /></label>
                  <label className="col-span-2"><span className="label">Fällig</span><input type="date" className="input mt-1" value={form.due} onChange={set("due")} /></label></div>
                {dueLabel && <div className="-mt-2 text-xs text-muted">{dueLabel}</div>}
                <details className="card"><summary className="label cursor-pointer">Schmerzpunkte · Einwände · Kaufsignale</summary>
                  <div className="mt-3 grid gap-3"><label><span className="label">Schmerzpunkte (eine pro Zeile)</span><textarea className="input mt-1" value={form.pains} onChange={set("pains")} /></label>
                    <label><span className="label">Einwände</span><textarea className="input mt-1" value={form.objs} onChange={set("objs")} /></label>
                    <label><span className="label">Kaufsignale</span><textarea className="input mt-1" value={form.signals} onChange={set("signals")} /></label></div></details>
                {form.stage === "won" && (
                  <label className="card flex items-start gap-3 border-accent/50"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#F3FF9A]" checked={wonOk} onChange={(e) => setWonOk(e.target.checked)} />
                    <span className="text-sm">Ich bestätige: Dieser Deal ist <b>gewonnen</b> mit Vertragswert <b>CHF {form.value || "0"}</b>. Eine Zahlung gilt dadurch <u>nicht</u> als eingegangen.</span></label>)}
                <button onClick={save} className="btn btn-primary w-full">Bestätigen & speichern</button>
                <button onClick={close} className="btn btn-ghost w-full">Verwerfen</button>
              </div>
            )}

            {step === "done" && result && (
              <div className="py-8 text-center"><div className="mb-2 text-3xl text-accent">✓</div><div className="mb-6 font-semibold">Gespeichert</div>
                <div className="grid gap-3"><Link href={`/leads/${result.lead_id}`} onClick={close} className="btn btn-primary">Lead öffnen</Link>
                  <Link href="/" onClick={close} className="btn btn-ghost">Zurück zu Heute</Link><button className="btn btn-ghost" onClick={reset}>Weiteres Update</button></div></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
