import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseMessagesCsv, extractMessagesCsv, buildConversations, inferSelf, toBatches, ImportError } from "@/lib/linkedin";

const H = `CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,IS MESSAGE DRAFT\n`;
const row = (i: number, from: string, to: string, content: string, conv = "c1") =>
  `${conv},,${from},https://www.linkedin.com/in/${from.toLowerCase()},${to},https://www.linkedin.com/in/${to.toLowerCase()},2026-09-01 ${String(10 + i).padStart(2, "0")}:00:00 UTC,,"${content}",INBOX,\n`;
const csv = (n: number) => H + Array.from({ length: n }, (_, i) => row(i + 1, i % 2 ? "Elena" : "Milos", i % 2 ? "Milos" : "Elena", `Nachricht ${i + 1}, mit Komma\nund Zeile`)).join("");
const zip = (text: string, path = "Basic_LinkedInDataExport/messages.csv") => zipSync({ [path]: strToU8(text), "other/connections.csv": strToU8("x") });

describe("LinkedIn parser", () => {
  it("finds messages.csv inside a ZIP and parses 12 messages", () => {
    const { rows, skipped } = parseMessagesCsv(extractMessagesCsv(zip(csv(12))));
    expect(rows).toHaveLength(12); expect(skipped).toHaveLength(0);
    expect(rows[0].content).toContain("mit Komma\nund Zeile");
  });
  it("rejects non-ZIP, missing messages.csv and unknown formats clearly", () => {
    expect(() => extractMessagesCsv(strToU8("hello"))).toThrow(ImportError);
    expect(() => extractMessagesCsv(zipSync({ "a.txt": strToU8("x") }))).toThrow(/keine messages\.csv/);
    expect(() => parseMessagesCsv("A,B\n1,2\n")).toThrow(/Format/);
  });
  it("ignores path-traversal entries", () => {
    expect(() => extractMessagesCsv(zipSync({ "../messages.csv": strToU8(csv(1)) }))).toThrow(/keine messages\.csv/);
  });
  it("reports skipped rows instead of dropping silently", () => {
    const bad = H + row(1, "A", "B", "ok") + `c1,,A,,B,,not-a-date,,x,INBOX,\n`;
    const r = parseMessagesCsv(bad); expect(r.rows).toHaveLength(1); expect(r.skipped[0].reason).toMatch(/Datum/);
  });
  it("supports the older export without conversation id", () => {
    const old = `FROM,TO,DATE,SUBJECT,CONTENT,FOLDER\nMilos,Elena,2026-09-01 10:00:00 UTC,,Hallo,INBOX\n`;
    expect(parseMessagesCsv(old).rows).toHaveLength(1);
  });
});

describe("conversation building & fingerprints", () => {
  const build = async (n: number) => buildConversations(parseMessagesCsv(csv(n)).rows, "Elena");
  it("infers self and directions", async () => {
    const rows = parseMessagesCsv(csv(12)).rows;
    expect(inferSelf(rows)).toMatch(/Elena|Milos/); // symmetrical in a single conversation – settings value decides
    const [c] = await build(12);
    expect(c.messages).toHaveLength(12); expect(c.participant_name).toBe("Milos");
    expect(c.messages.filter((m) => m.direction === "outbound")).toHaveLength(6);
  });
  it("is stable across archives: 12 → 18 keeps the first 12 fingerprints", async () => {
    const a = (await build(12))[0].messages.map((m) => m.fingerprint);
    const b = (await build(18))[0].messages.map((m) => m.fingerprint);
    expect(b.slice(0, 12)).toEqual(a); expect(new Set(b).size).toBe(18);
  });
  it("keeps genuinely identical messages (same second) but stays stable", async () => {
    const same = H + row(1, "Milos", "Elena", "ok") + row(1, "Milos", "Elena", "ok");
    const x = (await buildConversations(parseMessagesCsv(same).rows, "Elena"))[0].messages;
    const y = (await buildConversations(parseMessagesCsv(same).rows, "Elena"))[0].messages;
    expect(new Set(x.map((m) => m.fingerprint)).size).toBe(2); expect(x).toEqual(y);
  });
  it("batches never split a conversation", async () => {
    const convs = await buildConversations(parseMessagesCsv(H + row(1, "A", "Elena", "x", "c1") + row(1, "B", "Elena", "y", "c2")).rows, "Elena");
    expect(toBatches(convs).flat()).toHaveLength(2);
  });
});
