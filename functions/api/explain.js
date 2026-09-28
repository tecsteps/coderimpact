// Cloudflare Pages Function: the explanation backend (see relay/handler.mjs).
// Secret: OPENROUTER_API_KEY. Variables: OPENROUTER_MODEL, OPENROUTER_REASONING_EFFORT,
// optionally ALLOWED_ORIGINS (comma-separated). Allows the site's own origin and
// limits each visitor to a modest request rate.
import { explainSettings, handleExplain, MAX_BODY_BYTES } from "../../relay/handler.mjs";
import { forbidden, fromOwnSite } from "../../relay/guard.mjs";
import { readCappedText } from "../../relay/body.mjs";
import { createRateLimiter, tooManyRequests } from "../../relay/rateLimit.mjs";

/** Best-effort per-IP limit inside one isolate; OpenRouter's monthly cap is the hard ceiling. */
const limited = createRateLimiter({ windowMs: 60_000, max: 20 });

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const extra = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!fromOwnSite(request.headers, [url.origin, ...extra])) return forbidden();
  if (request.method === "POST" && limited(request.headers.get("cf-connecting-ip") ?? "unknown")) {
    return tooManyRequests("Too many explanations in a short time. Try again in a minute.");
  }
  let settings;
  try {
    settings = explainSettings(env);
  } catch (e) {
    console.error(e.message);
    return new Response(JSON.stringify({ error: { message: "The explanation backend is misconfigured." } }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const models = new Set(settings.model ? [settings.model] : []);
  const out = await handleExplain(
    {
      method: request.method,
      origin: request.headers.get("origin"),
      contentLength: request.headers.get("content-length") ? Number(request.headers.get("content-length")) : null,
      text: () => readCappedText(request.body, MAX_BODY_BYTES),
    },
    { allowedOrigins: [url.origin, ...extra], models, model: settings.model, reasoningEffort: settings.reasoningEffort, openrouterKey: env.OPENROUTER_API_KEY, referer: url.origin },
  );
  return new Response(out.body || null, { status: out.status, headers: out.headers });
}
