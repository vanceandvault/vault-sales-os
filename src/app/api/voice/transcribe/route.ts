import { err, guard } from "@/lib/api";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX = 20 * 1024 * 1024;
export async function POST(req: Request) {
  const g = await guard("stt", 30); if ("res" in g) return g.res;
  if (!process.env.GROQ_API_KEY) return err("Spracherkennung nicht konfiguriert (GROQ_API_KEY fehlt). Du kannst den Text stattdessen eintippen.", 503, "stt_unavailable");
  let form: FormData; try { form = await req.formData(); } catch { return err("Ungültige Anfrage"); }
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) return err("Keine Audioaufnahme erhalten.", 400, "no_audio");
  if (file.size > MAX) return err("Aufnahme zu lang (max. 20 MB).", 413);
  if (!/^(audio|video)\//.test(file.type)) return err("Ungültiges Audioformat.", 415);

  const out = new FormData();
  out.set("file", file, file.name || "voice.m4a"); out.set("model", "whisper-large-v3-turbo"); out.set("language", "de");
  out.set("response_format", "json"); out.set("temperature", "0");
  out.set("prompt", "Verkaufsnotiz auf Deutsch oder Schweizerdeutsch. Begriffe: VAULT STUDIO, Starter-Paket, Franken, Angebot, nachfassen, LinkedIn, GmbH, AG.");
  let r: Response;
  try { r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: out, signal: AbortSignal.timeout(25_000) }); }
  catch { return err("Netzwerkfehler bei der Spracherkennung. Bitte erneut versuchen.", 502, "stt_network"); }
  if (!r.ok) { console.error("STT", r.status); return err(r.status === 429 ? "Spracherkennung ausgelastet – bitte in einer Minute erneut." : "Transkription fehlgeschlagen.", 502, "stt_failed"); }
  const text = String(((await r.json()) as { text?: string }).text ?? "").trim();
  if (text.length < 3) return err("Keine Sprache erkannt. Bitte näher am Mikrofon erneut aufnehmen.", 422, "no_speech");
  return Response.json({ transcript: text });
}
