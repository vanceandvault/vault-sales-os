import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams; const sb = await supabaseServer();
  const { data } = q && q.trim().length >= 2 ? await sb.rpc("search_all", { q: q.trim().slice(0, 100) }) : { data: null };
  return (
    <div><PageHeader title="Suche" back="/more" />
      <form><input name="q" defaultValue={q} autoFocus className="input" type="search" placeholder="Firma, Kontakt, Telefon, E-Mail, Notiz, Nachricht …" /></form>
      <div className="mt-4 grid gap-2">{q && !data?.length && <Empty>Keine Treffer für „{q}“.</Empty>}
        {data?.map((r: { kind: string; id: string; lead_id: string | null; title: string; snippet: string }) => (
          <Link key={r.kind + r.id} href={r.lead_id ? `/leads/${r.lead_id}` : "/leads"} className="card block py-3"><div className="flex justify-between"><b className="text-sm">{r.title}</b><span className="chip text-muted">{r.kind}</span></div>{r.snippet && <p className="mt-1 line-clamp-2 text-sm text-muted">{r.snippet}</p>}</Link>))}</div></div>
  );
}
