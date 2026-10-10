import { NextResponse } from "next/server";
import { supabaseServer } from "./supabase/server";
import { rateLimit } from "./ratelimit";
import { AiUnavailable } from "./ai";

export const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, code }, { status });

/** Auth + rate limit for API routes. Data access always goes through the user's own session (RLS). */
export async function guard(bucket: string, max = 40) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { res: err("Nicht angemeldet", 401) } as const;
  if (!rateLimit(`${bucket}:${data.user.id}`, max)) return { res: err("Zu viele Anfragen – bitte kurz warten.", 429) } as const;
  return { sb, user: data.user } as const;
}

export function aiError(e: unknown) {
  if (e instanceof AiUnavailable) return err(e.message, 503, "ai_unavailable");
  const msg = e instanceof Error ? e.message : String(e);
  console.error("AI error", msg);
  // owner-only app: show the provider's reason (status + message, never keys) so setup problems are diagnosable
  const status = (e as { status?: number })?.status;
  const hint = status === 401 ? "API-Key ungültig" : status === 404 ? "Modell nicht gefunden – ANTHROPIC_MODEL prüfen" : status === 429 ? "Limit/Guthaben erreicht" : status === 400 && /credit/i.test(msg) ? "Guthaben leer" : "";
  const detail = [status, hint, msg.replace(/sk-[A-Za-z0-9_-]+/g, "***").slice(0, 160)].filter(Boolean).join(" · ");
  return err(`KI-Anfrage fehlgeschlagen (${detail}).`, 502, "ai_failed");
}
