// Standalone relay server: `node relay/server.mjs`
//   PORT             (default 8787)
//   ALLOWED_ORIGINS  comma-separated, e.g. https://coderimpact.example
//   OPENROUTER_API_KEY  key for OpenRouter (server-side only)
//   OPENROUTER_MODEL    the model explanations use, e.g. openai/gpt-6-luna
//   OPENROUTER_REASONING_EFFORT  max, xhigh, high, medium, low, minimal or none (default none)
import { createServer } from "node:http";
import { explainSettings, handleExplain, MAX_BODY_BYTES } from "./handler.mjs";
import { fromOwnSite } from "./guard.mjs";
import { readCappedText } from "./body.mjs";
import { createRateLimiter } from "./rateLimit.mjs";

const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4173").split(",").map((s) => s.trim()).filter(Boolean);
const settings = explainSettings(process.env);
const models = new Set(settings.model ? [settings.model] : []);
/** Per client address: the model is paid by this deployment. */
const limited = createRateLimiter({ windowMs: 60_000, max: 20 });
/** Explanations waiting on the model at once, over all clients. */
const MAX_IN_FLIGHT = 8;
let inFlight = 0;

createServer(async (req, res) => {
  if (req.url !== "/api/explain") {
    res.writeHead(404).end();
    return;
  }
  const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  if (!fromOwnSite(headers, allowedOrigins)) {
    res.writeHead(403, { "content-type": "application/json" }).end('{"error":{"message":"This API only serves Coderimpact\'s own pages."}}');
    return;
  }
  if (req.method === "POST" && (limited(req.socket.remoteAddress ?? "unknown") || inFlight >= MAX_IN_FLIGHT)) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "60" }).end('{"error":{"message":"Too many explanations in a short time. Try again in a minute."}}');
    return;
  }
  inFlight++;
  try {
    const out = await handleExplain(
      {
        method: req.method ?? "GET",
        origin: req.headers.origin ?? null,
        contentLength: req.headers["content-length"] ? Number(req.headers["content-length"]) : null,
        text: () => readCappedText(req, MAX_BODY_BYTES),
      },
      { allowedOrigins, models, model: settings.model, reasoningEffort: settings.reasoningEffort, openrouterKey: process.env.OPENROUTER_API_KEY },
    );
    res.writeHead(out.status, out.headers).end(out.body);
  } catch {
    res.writeHead(500, { "content-type": "application/json" }).end('{"error":{"message":"The explanation failed."}}');
  } finally {
    inFlight--;
  }
}).listen(port, () => console.log(`Coderimpact relay on :${port} for ${allowedOrigins.join(", ")}`));
