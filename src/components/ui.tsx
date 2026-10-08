import Link from "next/link";
import type { ReactNode } from "react";
import { STAGE_LABEL } from "@/lib/voice";

export const Temp = ({ t }: { t: string }) => {
  const m: Record<string, string> = { hot: "border-accent/60 text-accent", warm: "border-blue text-blue", cold: "border-line text-muted" };
  return <span className={`chip ${m[t] ?? m.cold}`}>{t === "hot" ? "Heiss" : t === "warm" ? "Warm" : "Kalt"}</span>;
};
export const Stage = ({ s }: { s: string }) => <span className="chip text-white/80">{STAGE_LABEL[s] ?? s}</span>;
export const Demo = () => <span className="chip border-dashed text-muted">Demo</span>;

export function Stat({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return <div><div className={`whitespace-nowrap text-xl font-semibold tracking-tight md:text-3xl ${accent ? "text-accent" : ""}`}>{value}</div><div className="label mt-1">{label}</div></div>;
}
export function PageHeader({ title, sub, back, right }: { title: string; sub?: string; back?: string; right?: ReactNode }) {
  return (
    <header className="pt-safe mb-6 flex items-start justify-between gap-3 pt-6">
      <div>
        {back && <Link href={back} className="label mb-2 inline-block hover:text-white">← Zurück</Link>}
        {sub && <div className="label mb-1">{sub}</div>}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      </div>{right}
    </header>
  );
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="card border-dashed text-center text-sm text-muted">{children}</div>;
export function ErrorNote({ message }: { message?: string | null }) {
  return message ? <div role="alert" className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{message}</div> : null;
}

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  today: <svg viewBox="0 0 24 24" width="22" height="22" {...P}><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v3M16 3v3"/></svg>,
  pipeline: <svg viewBox="0 0 24 24" width="22" height="22" {...P}><path d="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z"/></svg>,
  leads: <svg viewBox="0 0 24 24" width="22" height="22" {...P}><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16.5 5.5a3 3 0 010 5.6M18 14.8c1.9.6 3 2.2 3 4.7"/></svg>,
  activity: <svg viewBox="0 0 24 24" width="22" height="22" {...P}><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>,
  more: <svg viewBox="0 0 24 24" width="22" height="22" {...P}><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>,
  mic: <svg viewBox="0 0 24 24" width="26" height="26" {...P} strokeWidth={2}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>,
  search: <svg viewBox="0 0 24 24" width="20" height="20" {...P}><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>,
};
