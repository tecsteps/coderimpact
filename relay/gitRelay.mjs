// Coderimpact Git relay.
//
// Browsers cannot call github.com's Git endpoint directly (no CORS), so the
// browser's Git client talks to this same-origin relay, which forwards smart
// HTTP protocol v2 requests to github.com and streams the answer back. It:
//   - forwards only to https://github.com/<owner>/<repo>.git/{info/refs,git-upload-pack}
//   - allows only the read-only upload-pack service (never receive-pack / push)
//   - caps request bodies and never follows redirects
//   - passes an Authorization header through (private repositories later)
//     without storing or logging it
//   - stores nothing and logs no content
import { readCapped } from "./body.mjs";

export const MAX_REQUEST_BYTES = 256 * 1024;
/** Until GitHub starts answering; the streamed answer itself is not cut off. */
const UPSTREAM_TIMEOUT_MS = 30_000;
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

function error(status, message) {
  return new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * The github.com URL for a request ({ url }), or an error response for anything but fetching ({ error }).
 * @param {Request} request
 * @param {string} owner
 * @param {string} name  repository name without ".git"
 * @param {string} op
 */
function relayTarget(request, owner, name, op) {
  if (op === "info/refs" && request.method === "GET") {
    if (new URL(request.url).searchParams.get("service") !== "git-upload-pack") return { error: error(400, "Only git-upload-pack is supported.") };
    return { url: `https://github.com/${owner}/${name}.git/info/refs?service=git-upload-pack` };
  }
  if (op === "git-upload-pack" && request.method === "POST") return { url: `https://github.com/${owner}/${name}.git/git-upload-pack` };
  return { error: error(405, "Only fetching is supported.") };
}

/**
 * The request body for a POST, capped; an error response when it is too large.
 * @param {Request} request
 * @returns {Promise<Uint8Array | Response | undefined>}
 */
async function readBody(request) {
  if (request.method !== "POST") return undefined;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REQUEST_BYTES) return error(413, "Request too large.");
  const body = await readCapped(request.body, MAX_REQUEST_BYTES);
  return body ?? error(413, "Request too large.");
}

/**
 * Headers sent to github.com: protocol v2, the upload-pack content type and any Authorization.
 * @param {Request} request
 */
function upstreamHeaders(request) {
  const headers = {
    "User-Agent": "git/2.47.0 (coderimpact-relay)",
    "Git-Protocol": "version=2",
  };
  const ct = request.headers.get("content-type");
  if (ct === "application/x-git-upload-pack-request") headers["Content-Type"] = ct;
  headers.Accept = request.method === "POST" ? "application/x-git-upload-pack-result" : "*/*";
  const auth = request.headers.get("authorization");
  if (auth) headers.Authorization = auth;
  return headers;
}

/**
 * @param {Request} request  path after the relay prefix: /<owner>/<repo>/(info/refs|git-upload-pack)
 * @param {string} path
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [env]
 */
export async function handleGitRelay(request, path, env = {}) {
  const parts = path.replace(/^\/+/, "").split("/");
  const [owner, repo, ...rest] = parts;
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo.replace(/\.git$/, ""))) return error(400, "Invalid repository.");
  const { url: target, error: refused } = relayTarget(request, owner, repo.replace(/\.git$/, ""), rest.join("/"));
  if (refused) return refused;

  const body = await readBody(request);
  if (body instanceof Response) return body;
  const headers = upstreamHeaders(request);

  // Cancelled when the visitor goes away, and when GitHub does not start answering in time.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), env.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  request.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  let upstream;
  try {
    upstream = await (env.fetch ?? fetch)(target, { method: request.method, headers, body, redirect: "manual", signal: ctl.signal });
  } catch {
    return error(502, "GitHub could not be reached.");
  } finally {
    clearTimeout(timer);
  }
  if (upstream.status >= 300 && upstream.status < 400) return error(404, "Repository not found.");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
