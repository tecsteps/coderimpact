// Best-effort per-visitor rate limit for one isolate or process. Only admitted
// requests are counted, expired timestamps are dropped per key, and when too
// many keys are tracked the least recently seen ones are evicted (never all at once).

/**
 * @param {{ windowMs: number, max: number, maxKeys?: number }} opts
 * @returns {(key: string, now?: number) => boolean} true when the request is over the limit
 */
export function createRateLimiter({ windowMs, max, maxKeys = 5000 }) {
  /** key -> admitted timestamps, oldest first; Map order = least recently seen first */
  const hits = new Map();
  return function limited(key, now = Date.now()) {
    const recent = hits.get(key) ?? [];
    let expired = 0;
    while (expired < recent.length && now - recent[expired] >= windowMs) expired++;
    if (expired) recent.splice(0, expired);
    hits.delete(key);
    if (recent.length >= max) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return false;
  };
}

/** The 429 answer. */
export function tooManyRequests(message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "60" },
  });
}
