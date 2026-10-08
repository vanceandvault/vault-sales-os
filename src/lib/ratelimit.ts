// Best-effort limiter (per server instance). Auth is the real gate; this just caps accidental/abusive AI spend.
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max = 40, windowMs = 10 * 60_000): boolean {
  const now = Date.now(); const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
