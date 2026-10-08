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
  console.error("AI error", e instanceof Error ? e.message : e);
  return err("KI-Anfrage fehlgeschlagen. Bitte erneut versuchen.", 502, "ai_failed");
}
