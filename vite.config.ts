import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain ESM module without types
import { explainSettings, handleExplain, MAX_BODY_BYTES } from "./relay/handler.mjs";
// @ts-expect-error plain ESM module without types
import { handleGitRelay } from "./relay/gitRelay.mjs";
// @ts-expect-error plain ESM module without types
import { fromOwnSite } from "./relay/guard.mjs";
// @ts-expect-error plain ESM module without types
import { readCapped, readCappedText } from "./relay/body.mjs";

/** Serves the explanation relay at /api/explain during `vite` and `vite preview`. */
function relayPlugin(vars: Record<string, string>): Plugin {
  const openrouterKey = vars.OPENROUTER_API_KEY;
  // Fails the dev server with a clear message when OPENROUTER_REASONING_EFFORT is not an OpenRouter value.
  const settings = explainSettings(vars);
  const middleware = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => {
    if (req.url?.startsWith("/api/")) {
      const host = req.headers.host ?? "localhost";
      const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
      if (!fromOwnSite(headers, [`http://${host}`, `https://${host}`])) {
        res.writeHead(403, { "content-type": "application/json" }).end('{"error":{"message":"This API only serves Coderimpact\'s own pages."}}');
        return;
      }
    }
    if (req.url?.startsWith("/api/git/")) {
      const body: Uint8Array | null = req.method === "POST" ? await readCapped(req, 256 * 1024) : null;
      if (req.method === "POST" && body === null) {
        res.writeHead(413, { "content-type": "application/json" }).end('{"error":{"message":"Request too large."}}');
        return;
      }
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: body ?? undefined,
      });
      const out: Response = await handleGitRelay(request, new URL(request.url).pathname.slice("/api/git".length));
      res.writeHead(out.status, Object.fromEntries(out.headers.entries()));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    if (!req.url?.startsWith("/api/explain")) return next();
    const host = req.headers.host ?? "localhost";
    const models = new Set(settings.model ? [settings.model] : []);
    const out = await handleExplain(
      {
        method: req.method ?? "GET",
        origin: req.headers.origin ?? null,
        contentLength: req.headers["content-length"] ? Number(req.headers["content-length"]) : null,
        text: () => readCappedText(req, MAX_BODY_BYTES),
      },
      { allowedOrigins: [`http://${host}`, `https://${host}`], models, model: settings.model, reasoningEffort: settings.reasoningEffort, openrouterKey, referer: `http://${host}` },
    );
    res.writeHead(out.status, out.headers).end(out.body);
  };
  return {
    name: "coderimpact-relay",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

// `vite build --mode artifact` builds the claude.ai Artifact demo: relative
// paths, hash routing, bundled repository snapshots (an Artifact cannot reach
// GitHub) and a small Shiki bundle. Explanations still use OpenCode.
export default defineConfig(({ mode }) => {
  const artifact = mode === "artifact";
  // Server-side only: read from .env for the local relay, never exposed to the client bundle.
  const vars = loadEnv(mode, process.cwd(), "");
  return {
  base: artifact ? "./" : "/",
  publicDir: artifact ? "artifact/public" : "public",
  define: artifact ? { "import.meta.env.VITE_ROUTER": JSON.stringify("hash") } : {},
  plugins: [react(), tailwindcss(), relayPlugin(vars)],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      ...(artifact ? [{ find: /^\.\/shikiBundle$/, replacement: fileURLToPath(new URL("./src/workers/shikiBundle.artifact.ts", import.meta.url)) }] : []),
    ],
  },
  worker: { format: "es" as const },
  build: { target: "es2022", chunkSizeWarningLimit: 1500, outDir: artifact ? "dist-artifact" : "dist" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
  };
});
