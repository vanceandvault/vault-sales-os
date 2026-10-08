"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildConversations, extractMessagesCsv, ImportError, inferSelf, LIMITS, parseMessagesCsv, sha256Hex, toBatches, type OutConversation } from "@/lib/linkedin";

type Prepared = { fileName: string; fingerprint: string; convs: OutConversation[]; messages: number; skipped: { line: number; reason: string }[]; self: string };
type Result = { new_messages: number; existing_messages: number; new_conversations: number; updated_conversations: number; potential_leads: number; conversations_processed: number; status: string };

export function LinkedInUpload({ selfName }: { selfName: string | null }) {
  const router = useRouter(); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [prep, setPrep] = useState<Prepared | null>(null);
  const [self, setSelf] = useState(selfName ?? ""); const [progress, setProgress] = useState<string | null>(null); const [res, setRes] = useState<Result | null>(null);
  const [importId, setImportId] = useState<string | null>(null); const [dup, setDup] = useState(false); const [ai, setAi] = useState<string | null>(null);
  const rows = useRef<ReturnType<typeof parseMessagesCsv>["rows"]>([]);

  async function pick(file: File) {
    setErr(null); setPrep(null); setRes(null); setBusy(true); setProgress("Datei wird gelesen …");
    try {
      if (file.size > LIMITS.maxArchiveBytes) throw new ImportError(`Datei zu gross (max. ${LIMITS.maxArchiveBytes / 1048576} MB). Bitte bei LinkedIn nur „Nachrichten“ exportieren.`);
      const bytes = new Uint8Array(await file.arrayBuffer()); const fingerprint = await sha256Hex(bytes);
      const text = /\.csv$/i.test(file.name) ? new TextDecoder().decode(bytes) : extractMessagesCsv(bytes);
      const parsed = parseMessagesCsv(text); rows.current = parsed.rows;
      const guess = selfName || inferSelf(parsed.rows) || ""; setSelf(guess);
      const convs = await buildConversations(parsed.rows, guess);
      setPrep({ fileName: file.name, fingerprint, convs, messages: parsed.rows.length, skipped: parsed.skipped, self: guess });
    } catch (e) { setErr(e instanceof ImportError ? e.message : "Datei konnte nicht gelesen werden. Ist es der LinkedIn-Datenexport (ZIP)?"); }
    finally { setBusy(false); setProgress(null); if (input.current) input.current.value = ""; }
  }

  async function run() {
    if (!prep) return; setBusy(true); setErr(null);
    let id: string | null = null; const errors: string[] = [];
    try {
      const convs = self.trim() && self.trim() !== prep.self ? await buildConversations(rows.current, self.trim()) : prep.convs;
      const s = await fetch("/api/linkedin/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: prep.fileName, fingerprint: prep.fingerprint, selfName: self.trim() || undefined }) });
      const sj = await s.json(); if (!s.ok) throw new Error(sj.error ?? "Start fehlgeschlagen");
      id = sj.importId; setImportId(id); setDup(!!sj.alreadyImported);
      const batches = toBatches(convs);
      for (let i = 0; i < batches.length; i++) {
        setProgress(`Synchronisiere … ${i + 1}/${batches.length}`);
        const r = await fetch("/api/linkedin/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId: id, conversations: batches[i] }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Batch fehlgeschlagen");
      }
      const f = await fetch("/api/linkedin/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId: id, ok: true, errors, skipped: prep.skipped.length }) });
      setRes(await f.json()); setPrep(null); router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import fehlgeschlagen";
      if (id) await fetch("/api/linkedin/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId: id, ok: false, errors: [msg] }) }).catch(() => {});
      setErr(`${msg}. Bereits übernommene Nachrichten sind sicher gespeichert – du kannst dieselbe Datei gefahrlos erneut hochladen.`); router.refresh();
    } finally { setBusy(false); setProgress(null); }
  }

  async function analyse() {
    if (!importId) return; setAi("Analysiere …");
    const r = await fetch("/api/linkedin/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId }) }); const j = await r.json().catch(() => ({}));
    setAi(r.ok ? `${j.analysed} Konversationen analysiert, ${j.created} Vorschlag/Vorschläge erstellt.` : j.error ?? "Analyse fehlgeschlagen."); router.refresh();
  }

  return (
    <section className="card">
      <input ref={input} type="file" accept=".zip,.csv,application/zip,application/x-zip-compressed,text/csv" className="sr-only" id="li-file" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      <label htmlFor="li-file" className={`btn btn-primary w-full ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>LinkedIn-Archiv hochladen</label>
      <p className="mt-2 text-xs text-muted">ZIP direkt aus der Dateien-App wählen (Messages.csv wird automatisch gefunden). Es wird nur die Nachrichten-Datei verarbeitet – das ZIP wird nicht hochgeladen oder gespeichert.</p>
      {progress && <div className="mt-4 text-sm" aria-live="polite">{progress}</div>}
      {err && <div role="alert" className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</div>}
      {prep && (
        <div className="mt-4 grid gap-3">
          <div className="rounded-xl bg-bg p-3 text-sm"><b>{prep.fileName}</b><br />{prep.convs.length} Konversationen · {prep.messages} Nachrichten{prep.skipped.length ? ` · ${prep.skipped.length} Zeilen übersprungen (Entwürfe/ungültig)` : ""}</div>
          <label className="text-xs text-muted">Dein LinkedIn-Anzeigename (um gesendete von empfangenen Nachrichten zu unterscheiden)
            <input className="input mt-1" value={self} onChange={(e) => setSelf(e.target.value)} /></label>
          {!self.trim() && <div className="text-xs text-danger">Bitte deinen Namen angeben – sonst können Richtungen nicht erkannt werden.</div>}
          <button disabled={busy || !self.trim()} onClick={run} className="btn btn-blue">Synchronisieren</button>
        </div>)}
      {res && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm" aria-live="polite">
          <div className="mb-2 font-semibold text-accent">Synchronisierung abgeschlossen{dup ? " (Datei war bereits importiert)" : ""}</div>
          <ul className="grid gap-1"><li>{res.existing_messages} bestehende Nachrichten erkannt (Duplikate ignoriert)</li><li><b>{res.new_messages}</b> neue Nachrichten importiert</li>
            <li>{res.updated_conversations} Konversationen aktualisiert · {res.new_conversations} neu</li><li>{res.potential_leads} mögliche neue Leads zur Prüfung</li></ul>
          <p className="mt-2 text-xs text-muted">CRM-Daten (Notizen, Werte, Aktionen, Phasen) wurden nicht verändert.</p>
          <button onClick={analyse} className="btn btn-ghost mt-3 w-full">KI-Analyse neuer Antworten starten</button>{ai && <p className="mt-2 text-xs">{ai}</p>}
        </div>)}
    </section>
  );
}
