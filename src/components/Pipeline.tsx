"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveStage } from "@/app/actions";
import { STAGES, STAGE_LABEL } from "@/lib/voice";
import { Temp } from "./ui";

export type Card = { id: string; name: string; contact: string | null; value: number | null; temp: string; stage: string; next: string | null; due: string | null; overdue: boolean };
const chf = (n: number) => "CHF " + new Intl.NumberFormat("de-CH").format(n).replace(/[’']/g, "'");

export function Pipeline({ cards }: { cards: Card[] }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [sel, setSel] = useState<string>("new"); const [err, setErr] = useState<string | null>(null); const [over, setOver] = useState<string | null>(null);
  const [local, setLocal] = useState(cards); if (cards !== local && !pending && JSON.stringify(cards) !== JSON.stringify(local)) setLocal(cards);

  function drop(id: string, stage: string) {
    setOver(null); const c = local.find((x) => x.id === id); if (!c || c.stage === stage) return;
    if (stage === "won" || stage === "lost") { router.push(`/leads/${id}?${stage === "won" ? "win" : "lose"}=1`); return; }
    const prev = local; setLocal(local.map((x) => (x.id === id ? { ...x, stage } : x))); setErr(null);
    start(async () => { const r = await moveStage(id, stage); if (r?.error) { setErr(r.error); setLocal(prev); } else router.refresh(); });
  }
  const stages = STAGES.filter((s) => s !== "won" && s !== "lost").concat(["won", "lost"] as never);
  const col = (s: string) => local.filter((c) => c.stage === s);
  const Item = ({ c }: { c: Card }) => (
    <Link href={`/leads/${c.id}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)} className="card block cursor-grab p-3 active:cursor-grabbing">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0 truncate text-sm font-semibold">{c.name}</div><Temp t={c.temp} /></div>
      <div className="mt-1 text-xs text-muted">{c.contact ?? "–"}{c.value != null ? ` · ${chf(c.value)}` : ""}</div>
      <div className={`mt-2 truncate text-xs ${c.overdue ? "text-danger" : "text-muted"}`}>{c.next ? `${c.next} · ${c.due}` : "⚠ Keine Aktion"}</div>
    </Link>);
  return (
    <div>
      {err && <div role="alert" className="mb-3 text-sm text-danger">{err}</div>}
      {/* mobile: stage selector + list */}
      <div className="md:hidden">
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-2">
          {stages.map((s) => <button key={s} onClick={() => setSel(s)} className={`chip min-h-10 shrink-0 ${sel === s ? "border-accent text-accent" : "text-muted"}`}>{STAGE_LABEL[s]} · {col(s).length}</button>)}
        </div>
        <div className="grid gap-2">{col(sel).map((c) => (
          <div key={c.id}><Item c={c} />
            {sel !== "won" && sel !== "lost" && <label className="sr-only" htmlFor={`m-${c.id}`}>Phase ändern</label>}
            {sel !== "won" && sel !== "lost" && <select id={`m-${c.id}`} className="input -mt-1 min-h-10 rounded-t-none text-sm" value={c.stage} onChange={(e) => drop(c.id, e.target.value)}>{stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>}</div>))}
          {col(sel).length === 0 && <div className="card border-dashed text-center text-sm text-muted">Keine Leads in dieser Phase.</div>}</div>
      </div>
      {/* desktop: kanban with drag and drop */}
      <div className="hidden gap-3 overflow-x-auto pb-4 md:flex">
        {stages.map((s) => {
          const total = col(s).reduce((n, c) => n + (c.value ?? 0), 0);
          return (
            <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData("text/plain"), s); }}
              className={`w-64 shrink-0 rounded-2xl border p-2 ${over === s ? "border-accent bg-accent/5" : "border-line"}`}>
              <div className="px-1 pb-2"><div className="label">{STAGE_LABEL[s]} · {col(s).length}</div>{total > 0 && <div className="text-xs text-muted">{chf(total)}</div>}</div>
              <div className="grid gap-2">{col(s).map((c) => <Item key={c.id} c={c} />)}</div>
            </div>);
        })}
      </div>
    </div>
  );
}
