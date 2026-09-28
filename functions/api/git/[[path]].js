// Cloudflare Pages Function: the Git relay (see relay/gitRelay.mjs).
import { handleGitRelay } from "../../../relay/gitRelay.mjs";
import { forbidden, fromOwnSite } from "../../../relay/guard.mjs";
import { createRateLimiter, tooManyRequests } from "../../../relay/rateLimit.mjs";

/** Best-effort per-IP limit inside one isolate. */
const limited = createRateLimiter({ windowMs: 60_000, max: 240 });

export async function onRequest({ request, params }) {
  if (!fromOwnSite(request.headers, [new URL(request.url).origin])) return forbidden();
  if (limited(request.headers.get("cf-connecting-ip") ?? "unknown")) return tooManyRequests("Too many repository requests. Try again in a minute.");
  const path = Array.isArray(params.path) ? params.path.join("/") : String(params.path ?? "");
  return handleGitRelay(request, path);
}
