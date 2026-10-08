// Date helpers for Europe/Zurich. All "dates" are plain YYYY-MM-DD strings to avoid timezone drift.
export const TZ = "Europe/Zurich";
export const zurichToday = (now = new Date()): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const toUTC = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
export const weekday = (s: string) => toUTC(s).getUTCDay(); // 0 = Sunday
export const diffDays = (a: string, b: string) => Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86400000);
/** DD.MM.YYYY */
export const formatCH = (s?: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "–");
export const formatCHDateTime = (iso: string) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const formatCHF = (n: number | null | undefined) =>
  "CHF " + new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(Math.round(Number(n ?? 0))).replace(/[’']/g, "'");
const WD = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
export const weekdayName = (s: string) => WD[weekday(s)][0].toUpperCase() + WD[weekday(s)].slice(1);

export type ParsedDate = { date: string; approximate: boolean; note?: string };

/** Resolves German date phrases ("Freitag", "übermorgen", "in 3 Tagen", "im Januar", "15.11.") deterministically. */
export function parseGermanDate(input: string, today: string): ParsedDate | null {
  const t = input.toLowerCase().replace(/[.,!]+$/g, "").trim();
  if (!t) return null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t); if (iso) return { date: iso[0], approximate: false };
  const num = /\b(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?(?!\d)/.exec(t);
  if (num) {
    const y0 = +today.slice(0, 4); let y = num[3] ? (num[3].length === 2 ? 2000 + +num[3] : +num[3]) : y0;
    let d = `${y}-${String(+num[2]).padStart(2, "0")}-${String(+num[1]).padStart(2, "0")}`;
    if (!num[3] && d < today) d = `${y + 1}${d.slice(4)}`;
    return Number.isNaN(toUTC(d).getTime()) ? null : { date: d, approximate: false };
  }
  if (t.includes("übermorgen")) return { date: addDays(today, 2), approximate: false };
  if (/(^|[^a-zäöü])morgen([^a-zäöüs]|$)/.test(t)) return { date: addDays(today, 1), approximate: false };
  if (/\bheute\b/.test(t)) return { date: today, approximate: false };
  const inN = /\bin\s+(\d+|einer|einem|zwei|drei|vier|fünf)\s+(tag|tagen|woche|wochen|monat|monaten)/.exec(t);
  if (inN) {
    const n = ({ einer: 1, einem: 1, zwei: 2, drei: 3, vier: 4, fünf: 5 } as Record<string, number>)[inN[1]] ?? +inN[1];
    const u = inN[2].startsWith("tag") ? 1 : inN[2].startsWith("woche") ? 7 : 30;
    return { date: addDays(today, n * u), approximate: u === 30 };
  }
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WD[i]}`).test(t)) {
      let delta = (i - weekday(today) + 7) % 7; if (delta === 0) delta = 7;
      if (/(nächste[rnms]?|kommende[rnms]?)\s+woche/.test(t)) { // "nächste Woche Freitag"
        const toMonday = ((8 - weekday(today)) % 7) || 7; delta = toMonday + ((i + 6) % 7);
      }
      return { date: addDays(today, delta), approximate: false };
    }
  }
  if (/(nächste[rnms]?|kommende[rnms]?)\s+woche/.test(t)) return { date: addDays(today, ((8 - weekday(today)) % 7) || 7), approximate: true, note: "Montag nächster Woche angenommen" };
  if (/ende\s+(der\s+)?woche/.test(t)) { const d = (5 - weekday(today) + 7) % 7; return { date: addDays(today, d), approximate: true, note: "Freitag angenommen" }; }
  for (let i = 0; i < 12; i++) {
    if (t.includes(MONTHS[i]) || (i === 2 && t.includes("maerz"))) {
      const y0 = +today.slice(0, 4); const mm = String(i + 1).padStart(2, "0");
      let d = `${y0}-${mm}-01`; if (d <= today) d = `${y0 + 1}-${mm}-01`;
      if (/mitte/.test(t)) d = d.slice(0, 8) + "15"; else if (/ende/.test(t)) d = d.slice(0, 8) + "28";
      return { date: d, approximate: true, note: "Nur Monat genannt – bitte genaues Datum prüfen" };
    }
  }
  return null;
}
