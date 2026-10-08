// LinkedIn archive parsing. Isomorphic (browser + Node). Treats all content as untrusted data.
import { unzipSync } from "fflate";
import Papa from "papaparse";

export const LIMITS = {
  maxArchiveBytes: 400 * 1024 * 1024, // whole ZIP read into memory on the phone
  maxCsvBytes: 120 * 1024 * 1024,     // uncompressed messages.csv
  maxMessagesPerBatch: 1500,
  maxBatchChars: 2_500_000,           // stays well below Netlify's 6 MB request limit
};

export class ImportError extends Error {}

export type RawRow = {
  conversationId: string; title: string; from: string; fromUrl: string; to: string; toUrls: string;
  date: Date; subject: string; content: string;
};
export type ParsedCsv = { rows: RawRow[]; skipped: { line: number; reason: string }[] };

const norm = (s: unknown) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const HEADERS: Record<string, string[]> = {
  conversationId: ["conversation id"], title: ["conversation title"], from: ["from"], fromUrl: ["sender profile url"],
  to: ["to"], toUrls: ["recipient profile urls"], date: ["date"], subject: ["subject"], content: ["content"],
  draft: ["is message draft"],
};

export function parseLinkedInDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(UTC|Z))?$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
  return isNaN(d.getTime()) ? null : d;
}

export function parseMessagesCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase() });
  const fields = res.meta.fields ?? [];
  const col = (k: string) => HEADERS[k].find((h) => fields.includes(h));
  const missing = ["from", "to", "date", "content"].filter((k) => !col(k));
  if (missing.length) {
    throw new ImportError(`Unbekanntes Messages.csv-Format: Spalte(n) fehlen (${missing.join(", ")}). Gefunden: ${fields.join(", ") || "keine"}. LinkedIn hat das Format evtl. geändert – nichts wurde importiert.`);
  }
  const get = (r: Record<string, string>, k: string) => { const c = col(k); return c ? String(r[c] ?? "") : ""; };
  const rows: RawRow[] = []; const skipped: ParsedCsv["skipped"] = [];
  res.data.forEach((r, i) => {
    const line = i + 2;
    if (/^(true|yes|1)$/i.test(get(r, "draft").trim())) return skipped.push({ line, reason: "Entwurf" });
    const date = parseLinkedInDate(get(r, "date"));
    if (!date) return skipped.push({ line, reason: `Ungültiges Datum "${get(r, "date").slice(0, 30)}"` });
    const content = get(r, "content").replace(/\r\n?/g, "\n").trim(); const subject = get(r, "subject").trim();
    if (!content && !subject) return skipped.push({ line, reason: "Leere Nachricht" });
    rows.push({ conversationId: get(r, "conversationId").trim(), title: get(r, "title").trim(), from: get(r, "from").trim(),
      fromUrl: get(r, "fromUrl").trim(), to: get(r, "to").trim(), toUrls: get(r, "toUrls").trim(), date, subject, content });
  });
  if (!rows.length && !skipped.length) throw new ImportError("Die Datei enthält keine Nachrichten.");
  return { rows, skipped };
}

/** Extracts messages.csv from the ZIP without extracting anything else; no file is ever written to disk. */
export function extractMessagesCsv(zip: Uint8Array): string {
  if (zip.length > LIMITS.maxArchiveBytes) throw new ImportError(`Archiv zu gross (max. ${LIMITS.maxArchiveBytes / 1048576} MB). Bitte bei LinkedIn nur „Nachrichten“ exportieren.`);
  if (!(zip[0] === 0x50 && zip[1] === 0x4b)) throw new ImportError("Das ist keine gültige ZIP-Datei.");
  let found: { name: string; size: number } | null = null; let tooBig = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter(f) {
        const parts = f.name.split(/[\\/]/);
        if (parts.some((p) => p === ".." ) || f.name.startsWith("/")) return false; // path traversal: ignored, never extracted
        if (parts[parts.length - 1].toLowerCase() !== "messages.csv") return false;
        if (f.originalSize > LIMITS.maxCsvBytes) { tooBig = true; return false; }
        if (found && found.name.split("/").length <= parts.length) return false;   // prefer the shallowest messages.csv
        found = { name: f.name, size: f.originalSize }; return true;
      },
    });
  } catch { throw new ImportError("ZIP-Archiv ist beschädigt oder nicht lesbar."); }
  const names = Object.keys(files);
  if (!names.length) throw new ImportError(tooBig ? "messages.csv ist zu gross." : "Im Archiv wurde keine messages.csv gefunden. Bitte den LinkedIn-Export mit „Nachrichten“ verwenden.");
  const data = files[names.sort((a, b) => a.split("/").length - b.split("/").length)[0]];
  if (data.length > LIMITS.maxCsvBytes) throw new ImportError("messages.csv ist zu gross.");
  return new TextDecoder("utf-8").decode(data);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const normName = (s: string) => norm(s).toLowerCase();
export const normUrl = (u: string) => norm(u).toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");

/** The owner appears in (almost) every conversation; the most widespread sender name is "me". */
export function inferSelf(rows: RawRow[]): string | null {
  const byName = new Map<string, Set<string>>(); const display = new Map<string, string>();
  rows.forEach((r, i) => {
    const key = r.conversationId || `row${i}`;
    for (const n of [r.from, ...r.to.split(",")].map(norm).filter(Boolean)) {
      const k = n.toLowerCase(); display.set(k, n);
      (byName.get(k) ?? byName.set(k, new Set()).get(k)!).add(key);
    }
  });
  let best: string | null = null, bestN = 0;
  for (const [k, set] of byName) if (set.size > bestN) { best = k; bestN = set.size; }
  return best ? display.get(best)! : null;
}

export type OutMessage = { fingerprint: string; sender_name: string; sender_url: string; direction: "inbound" | "outbound"; sent_at: string; subject: string; content: string };
export type OutConversation = { conversation_key: string; title: string; participant_name: string; participant_url: string; messages: OutMessage[] };

export async function buildConversations(rows: RawRow[], selfName: string, selfUrl = ""): Promise<OutConversation[]> {
  const me = normName(selfName); const meUrl = normUrl(selfUrl);
  const isMe = (name: string, url: string) => (!!me && normName(name) === me) || (!!meUrl && normUrl(url) === meUrl);
  const groups = new Map<string, RawRow[]>();
  const keyOf = (r: RawRow) => {
    if (r.conversationId) return r.conversationId;
    const people = [r.from, ...r.to.split(",")].map(normName).filter((n) => n && n !== me).sort();
    return "p:" + people.join("|");
  };
  for (const r of rows) { const k = keyOf(r); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const out: OutConversation[] = [];
  for (const [key, rs] of groups) {
    rs.sort((a, b) => a.date.getTime() - b.date.getTime()); // stable: ties keep file order → stable occurrence index
    const seen = new Map<string, number>(); const messages: OutMessage[] = [];
    const others = new Map<string, { name: string; url: string; n: number }>();
    for (const r of rs) {
      const outbound = isMe(r.from, r.fromUrl);
      const base = [key, r.date.toISOString(), normName(r.from), norm(r.subject).toLowerCase(), norm(r.content).toLowerCase()].join("␟");
      const occ = (seen.get(base) ?? 0); seen.set(base, occ + 1);
      messages.push({ fingerprint: await sha256Hex(`${base}␟${occ}`), sender_name: r.from, sender_url: r.fromUrl,
        direction: outbound ? "outbound" : "inbound", sent_at: r.date.toISOString(), subject: r.subject, content: r.content });
      const cand = outbound
        ? { name: r.to.split(",")[0]?.trim() ?? "", url: r.toUrls.split(/[,\s]+/)[0] ?? "" }
        : { name: r.from, url: r.fromUrl };
      if (cand.name && !isMe(cand.name, cand.url)) {
        const o = others.get(normName(cand.name)) ?? { ...cand, n: 0 }; o.n++; others.set(normName(cand.name), o);
      }
    }
    const top = [...others.values()].sort((a, b) => b.n - a.n)[0];
    out.push({ conversation_key: key, title: rs[0].title, participant_name: top?.name ?? rs[0].title ?? "Unbekannt", participant_url: top?.url ?? "", messages });
  }
  return out.sort((a, b) => a.conversation_key.localeCompare(b.conversation_key));
}

/** Groups whole conversations into request-sized batches (a conversation is never split across batches). */
export function toBatches(convs: OutConversation[]): OutConversation[][] {
  const batches: OutConversation[][] = []; let cur: OutConversation[] = []; let msgs = 0, chars = 0;
  for (const c of convs) {
    const size = c.messages.reduce((n, m) => n + m.content.length + 260, 0);
    if (cur.length && (msgs + c.messages.length > LIMITS.maxMessagesPerBatch || chars + size > LIMITS.maxBatchChars)) {
      batches.push(cur); cur = []; msgs = 0; chars = 0;
    }
    cur.push(c); msgs += c.messages.length; chars += size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}
