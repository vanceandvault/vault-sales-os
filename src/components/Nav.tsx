"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

const ITEMS = [
  { href: "/", label: "Heute", icon: Icon.today }, { href: "/pipeline", label: "Pipeline", icon: Icon.pipeline },
  { href: "/leads", label: "Leads", icon: Icon.leads }, { href: "/activity", label: "Aktivität", icon: Icon.activity }, { href: "/more", label: "Mehr", icon: Icon.more },
];
const active = (p: string, h: string) => (h === "/" ? p === "/" : p.startsWith(h));

export function Nav() {
  const p = usePathname();
  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-bg p-5 md:flex">
        <div className="mb-8"><div className="text-lg font-semibold tracking-[0.2em]">VAULT</div><div className="label">Sales OS</div></div>
        <nav className="flex flex-col gap-1">
          {ITEMS.map((i) => (
            <Link key={i.href} href={i.href} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${active(p, i.href) ? "bg-card text-accent" : "text-muted hover:bg-white/5 hover:text-white"}`}>{i.icon}{i.label}</Link>
          ))}
          <Link href="/search" className="mt-4 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-muted hover:bg-white/5">{Icon.search}Suche</Link>
        </nav>
      </aside>
      <nav aria-label="Hauptnavigation" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {ITEMS.map((i) => (
            <li key={i.href}><Link href={i.href} aria-current={active(p, i.href) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider ${active(p, i.href) ? "text-accent" : "text-muted"}`}>{i.icon}{i.label}</Link></li>
          ))}
        </ul>
      </nav>
    </>
  );
}
