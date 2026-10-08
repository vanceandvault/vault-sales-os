# VAULT SALES OS

Privater, sprachgesteuerter Sales-Assistent für VAULT STUDIO (Single-User, deutsch, iPhone-PWA).
Next.js 15 · Tailwind 4 · Supabase (Postgres + Auth + RLS) · Netlify.

## Einrichtung (alles im Gratis-Tarif möglich)
1. **Supabase** (Free): neues Projekt → *SQL Editor*: `supabase/migrations/0001…0003` der Reihe nach ausführen.
   *Authentication → Providers → Email*: **„Allow new users to sign up“ ausschalten**, dann unter *Users* deinen einzigen Benutzer anlegen (E-Mail + starkes Passwort).
2. **Netlify** (Free): Repo verbinden. Environment variables laut `.env.example` setzen
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OWNER_EMAIL`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`). Schlüssel stehen nur serverseitig.
3. iPhone: Seite in Safari öffnen → Teilen → *Zum Home-Bildschirm*.

## Kosten / bezahlte Dienste – bitte entscheiden
| Dienst | Wofür | Kosten | Gratis-Alternative |
|---|---|---|---|
| Supabase, Netlify | DB, Login, Hosting | gratis | – |
| **Groq** (Whisper) | Sprache → Text | Free-Tier (Limits) | ohne Key: Text statt Sprache eintippen |
| **Anthropic Claude API** | Sprachupdate verstehen, Antwortvorschläge, Ask VAULT, LinkedIn-Analyse | nutzungsbasiert (typ. wenige CHF/Monat bei Einzelnutzung) | ohne Key funktionieren CRM, Pipeline, LinkedIn-Import/-Sync, Follow-ups; die KI-Funktionen melden klar „nicht konfiguriert“ |

Hinweis: Supabase Free pausiert Projekte nach ~1 Woche Inaktivität – einmal öffnen reaktiviert.

## Tests
- `npm test` – Unit-Tests (LinkedIn-Parser/Fingerprints, deutsche Datumslogik, Priorität, Umsatz, Ziele, Lead-Matching, KI-Pipeline mit Mock).
- `npm run test:db` – echte PostgreSQL: Migrationen, atomare Funktionen, RLS, Sync-Idempotenz.
- `node e2e/run.mjs` – End-to-End mit echtem Build + Chromium gegen echte Postgres/PostgREST (Auth-Stub, **KI-Anbieter gemockt**); deckt Abnahmetests A–E, G, H ab.

## Architektur-Notizen
- **LinkedIn-ZIP wird im Browser entpackt** (nur `messages.csv`, ZIP-Slip/Grössenlimits); es gehen nur Nachrichten in Batches an den Server (Netlify-Limit 6 MB). ZIP wird nie gespeichert.
- Dedupe: SHA-256-Fingerprint (Konversation + Zeit + Absender + Inhalt + Vorkommen) mit `unique(user_id, fingerprint)`; Import = idempotenter Sync.
- Sync schreibt nur `linkedin_*`, Review-Flags und Vorschläge – nie CRM-Felder. Stufenänderungen/„Antwort erhalten“ werden als Vorschlag zur Freigabe angezeigt.
- Pro Lead höchstens **eine** offene nächste Aktion (partieller Unique-Index) → keine doppelten Follow-ups.
- Gewonnen nur mit ausdrücklicher Bestätigung; Zahlung wird nie automatisch als eingegangen markiert.
- KI liefert validiertes JSON (zod); sie schreibt nie selbst in die DB. Transkripte/LinkedIn-Texte gelten als untrusted Daten.

## Status (ehrlich)
**Fertig & getestet:** Login, Today, Leads, Detail, Call-Modus, Pipeline (Drag&Drop Desktop / Selector mobil), Aktivität, Voice-Flow inkl. Bestätigung und Offline-Entwürfen, LinkedIn-Import/Sync, Review-Queue, Umsatz/Zahlungen, Ziele-Rechner, Partner/Provisionen, Suche, Export/Löschen, PWA-Manifest.
**Nicht verifiziert:** echte Anthropic-/Groq-Antworten (Qualität, Schweizerdeutsch), echtes Supabase-Auth, iPhone-Test F (Dateien-App) und Installation auf dem Gerät – bitte nach dem Deploy manuell prüfen.
**Offen / vereinfacht:** Push-Benachrichtigungen (nicht umgesetzt; nur In-App-Hinweise auf TODAY), Phase 4 (Partnerportal, Onboarding-Übergabe, Rechnungs-Integration), Audio-Aufbewahrung (Audio wird nicht gespeichert), Rate-Limit ist pro Server-Instanz, Funnel-Phasen sind Näherungen anhand der aktuellen Phase, Englisch-UI.
