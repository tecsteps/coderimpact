// Coderimpact explanation relay.
//
// A tiny, stateless, same-origin backend for explanations. It:
//   - accepts POST only (callers are checked by guard.mjs first)
//   - caps the payload size and validates its exact shape
//   - forwards only models listed in the published models.json
//   - sends OpenRouter models to OpenRouter with the deployment's key (a
//     server-side secret that never reaches the browser), reasoning off
//   - sends OpenCode free models to one fixed OpenCode endpoint, without a key
//   - never stores code and never logs bodies
// It does not broaden the context the browser decided to send.

export const UPSTREAM = "https://opencode.ai/inference/openai/v1/chat/completions";
export const OPENROUTER_UPSTREAM = "https://openrouter.ai/api/v1/chat/completions";
export const MAX_BODY_BYTES = 24 * 1024;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function json(status, body, headers = {}) {
  return { status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

/**
 * Loads the model allowlist from a models.json object: free models, and models
 * billed to the deployment (never to the visitor).
 */
export function allowedModels(modelsFile) {
  const out = new Set();
  for (const m of modelsFile?.models ?? []) {
    if (!m || typeof m.id !== "string") continue;
    const free = m.price?.input === 0 && m.price.output === 0;
    if (free || m.billing === "deployment") out.add(m.id);
  }
  return out;
}

/** OpenRouter's reasoning.effort values. */
export const REASONING_EFFORTS = ["max", "xhigh", "high", "medium", "low", "minimal", "none"];

/**
 * The explanation settings of a deployment, from its environment:
 * OPENROUTER_MODEL (any OpenRouter model id) and OPENROUTER_REASONING_EFFORT.
 * An unknown effort is a configuration error, not something to guess around.
 */
export function explainSettings(vars) {
  const model = (vars.OPENROUTER_MODEL ?? "").trim() || null;
  const reasoningEffort = (vars.OPENROUTER_REASONING_EFFORT ?? "none").trim();
  if (!REASONING_EFFORTS.includes(reasoningEffort)) {
    throw new Error(`OPENROUTER_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(", ")}; got "${reasoningEffort}".`);
  }
  return { model, reasoningEffort };
}

/** The model list the app reads (GET /api/explain), in the models.json shape. */
export function modelsDocument(model) {
  return {
    version: "env",
    generatedAt: "",
    ttlSeconds: 600,
    endpoint: "/api/explain",
    family: "chat-completions",
    models: model ? [{ id: model, rank: 1, provider: "openrouter", billing: "deployment" }] : [],
  };
}

/** OpenRouter ids look like "vendor/model"; OpenCode free model ids have no slash. */
export function isOpenRouterModel(id) {
  return id.includes("/");
}

const ALLOWED_KEYS = new Set(["model", "messages", "temperature", "max_tokens", "stream"]);

/** Why a message pair is not a system and a user message with text content, or null. */
function messagesProblem(messages) {
  if (!Array.isArray(messages) || messages.length !== 2) return "Exactly two messages (system, user) are required.";
  const [sys, user] = messages;
  for (const [m, role] of [[sys, "system"], [user, "user"]]) {
    if (!m || m.role !== role || typeof m.content !== "string") return "Messages must be a system and a user message with text content.";
    if (m.content.length > MAX_MESSAGE_CHARS) return "Message too long.";
    if (Object.keys(m).some((k) => k !== "role" && k !== "content")) return "Unexpected message fields.";
  }
  return null;
}

/** Why the request body cannot be forwarded, or null when it can. */
function payloadProblem(data, models) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Body must be a JSON object.";
  for (const k of Object.keys(data)) if (!ALLOWED_KEYS.has(k)) return `Field "${k}" is not accepted.`;
  if (typeof data.model !== "string" || !models.has(data.model)) return "Model is not on the free allowlist.";
  const problem = messagesProblem(data.messages);
  if (problem) return problem;
  if (data.stream) return "Streaming is not supported.";
  return null;
}

/** The exact payload to forward for a valid body: only known fields, clamped. */
function forwardedPayload(data) {
  const [sys, user] = data.messages;
  const temperature = typeof data.temperature === "number" ? Math.min(1, Math.max(0, data.temperature)) : 0.2;
  const max_tokens = typeof data.max_tokens === "number" ? Math.min(800, Math.max(16, Math.round(data.max_tokens))) : 600;
  return { model: data.model, messages: [{ role: "system", content: sys.content }, { role: "user", content: user.content }], temperature, max_tokens, stream: false };
}

/** Validates the request body and returns the exact payload to forward, or an error string. */
export function validatePayload(data, models) {
  return payloadProblem(data, models) ?? forwardedPayload(data);
}

/** Why the raw body cannot be used (too large, not JSON) as an error response, or the parsed JSON. */
async function readJson(req, cors) {
  if (req.contentLength !== null && req.contentLength > MAX_BODY_BYTES) return { error: json(413, { error: { message: "Payload too large." } }, cors) };
  // text() reads with the byte cap (relay/body.mjs) and returns null beyond it.
  const raw = await req.text();
  if (raw === null || new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return { error: json(413, { error: { message: "Payload too large." } }, cors) };
  try {
    return { data: JSON.parse(raw) };
  } catch {
    return { error: json(400, { error: { message: "Invalid JSON." } }, cors) };
  }
}

/** The upstream request: OpenRouter with the deployment's key, or OpenCode without one. */
function upstreamRequest(payload, env) {
  if (!isOpenRouterModel(payload.model)) {
    return { url: UPSTREAM, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
  }
  return {
    url: OPENROUTER_UPSTREAM,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.openrouterKey}`,
      "http-referer": env.referer ?? "https://coderimpact.com",
      "x-title": "Coderimpact",
    },
    body: JSON.stringify({ ...payload, reasoning: { effort: env.reasoningEffort ?? "none" } }),
  };
}

/** The CORS preflight answer. */
function preflight(corsOk, cors) {
  if (!corsOk) return { status: 403, headers: {}, body: "" };
  return { status: 204, headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" }, body: "" };
}

/**
 * @param {{ method: string, origin: string | null, contentLength: number | null, text: () => Promise<string | null> }} req
 * @param {{ allowedOrigins: string[], models: Set<string>, fetch?: typeof fetch, timeoutMs?: number, openrouterKey?: string, referer?: string, reasoningEffort?: string, model?: string | null }} env
 */
export async function handleExplain(req, env) {
  // Who may call is decided before this, by guard.mjs in every entry point;
  // here the origin only decides the CORS headers.
  const origin = req.origin;
  const corsOk = origin !== null && env.allowedOrigins.includes(origin);
  const cors = corsOk ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
  if (req.method === "OPTIONS") return preflight(corsOk, cors);
  // GET: which model this deployment explains with.
  if (req.method === "GET") return json(200, modelsDocument(env.model ?? [...env.models][0] ?? null), { ...cors, "cache-control": "no-cache" });
  if (req.method !== "POST") return json(405, { error: { message: "Use POST or GET." } }, cors);
  const body = await readJson(req, cors);
  if (body.error) return body.error;
  const payload = validatePayload(body.data, env.models);
  if (typeof payload === "string") return json(400, { error: { message: payload } }, cors);

  if (isOpenRouterModel(payload.model) && !env.openrouterKey) {
    return json(503, { error: { message: "The explanation backend is not configured (missing OpenRouter key)." } }, cors);
  }
  const fetchImpl = env.fetch ?? fetch;
  const target = upstreamRequest(payload, env);
  let upstream;
  try {
    upstream = await fetchImpl(target.url, {
      method: "POST",
      headers: target.headers,
      body: target.body,
      signal: AbortSignal.timeout(env.timeoutMs ?? 45_000),
    });
  } catch {
    return json(504, { error: { message: "The explanation service did not respond." } }, cors);
  }
  const text = (await upstream.text()).slice(0, MAX_RESPONSE_BYTES);
  const headers = { ...cors, "content-type": "application/json" };
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers["retry-after"] = retryAfter;
  return { status: upstream.status, headers, body: text };
}
