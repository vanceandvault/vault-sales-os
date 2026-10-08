import { createLead } from "@/app/actions";
import { ErrorNote, PageHeader } from "@/components/ui";
import { zurichToday } from "@/lib/dates";

export default async function NewLead({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div><PageHeader title="Neuer Lead" back="/leads" sub="Firma oder Kontakt genügt" /><ErrorNote message={error} />
      <form action={createLead} className="grid gap-3">
        <input className="input" name="company" placeholder="Firma" autoFocus /><input className="input" name="contact" placeholder="Kontaktperson" />
        <details className="card"><summary className="label cursor-pointer">Weitere Angaben (optional)</summary>
          <div className="mt-3 grid gap-3"><input className="input" name="position" placeholder="Funktion" /><input className="input" name="phone" type="tel" placeholder="Telefon" /><input className="input" name="email" type="email" placeholder="E-Mail" />
            <input className="input" name="linkedin" placeholder="LinkedIn-Profil-URL" /><input className="input" name="industry" placeholder="Branche" /><input className="input" name="website" placeholder="Website" /><input className="input" name="location" placeholder="Ort" />
            <input className="input" name="source" placeholder="Quelle (LinkedIn, Kaltakquise, Empfehlung …)" /><input className="input" name="deal_value" inputMode="decimal" placeholder="Potenzial CHF" />
            <select className="input" name="temperature" defaultValue="cold"><option value="hot">Heiss</option><option value="warm">Warm</option><option value="cold">Kalt</option></select></div></details>
        <div className="card grid gap-3"><div className="label">Erste Aktion</div><input className="input" name="next_title" placeholder="Erstkontakt aufnehmen" /><input className="input" type="date" name="next_due" defaultValue={zurichToday()} /></div>
        <button className="btn btn-primary">Lead anlegen</button></form></div>
  );
}
