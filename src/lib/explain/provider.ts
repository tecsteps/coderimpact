import { baseUrl, loadConfig, type RuntimeConfig } from "../config";
import type { ChatMessage } from "./prompt";

/** Published by the discovery job (scripts/discover-models.mjs). */
export interface ModelsFile {
  version: string;
  generatedAt: string;
  ttlSeconds: number;
  endpoint: string;
  family: "chat-completions";
  models: {
    id: string;
    rank: number;
    price: { input: number; output: number };
    /** "deployment": paid by the site operator through the backend, never by the visitor. */
    billing?: "free" | "deployment";
    provider?: string;
    smoke?: { passed: number; total: number; medianMs?: number };
  }[];
}

export type ProviderState =
  | { state: "loading" }
  | { state: "ready"; models: string[] }
  | { state: "unavailable"; reason: string; retryable: boolean };

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export interface ExplanationProvider {
  state(): ProviderState;
  subscribe(l: () => void): () => void;
  complete(messages: ChatMessage[], signal?: AbortSignal): Promise<{ text: string; model: string }>;
  retry(): void;
}

interface Health {
  cooldownUntil?: number;
  failures?: number;
  lastOkAt?: number;
}

const HEALTH_KEY = "ci.modelHealth";

function readHealth(): Record<string, Health> {
  try {
    return JSON.parse(localStorage.getItem(HEALTH_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeHealth(h: Record<string, Health>) {
  try {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(h));
  } catch {
    /* ignore */
  }
}

/**
 * Models the browser may use: free models, and models billed to the deployment
 * through its backend. A model that would bill the visitor is never selected.
 */
export function freeModels(file: ModelsFile | null | undefined): ModelsFile["models"] {
  if (!file || !Array.isArray(file.models)) return [];
  return file.models
    .filter((m) => m && typeof m.id === "string" && ((m.price?.input === 0 && m.price.output === 0) || m.billing === "deployment"))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * OpenCode free chat models via the OpenAI-compatible Chat Completions API,
 * called directly from the browser without a key, or through the optional
 * same-origin relay. Rotates to the next ranked model on rate limits and
 * timeouts. Access-control refusals disable explanations; they are never
 * worked around.
 */
export class OpenCodeProvider implements ExplanationProvider {
  private current: ProviderState = { state: "loading" };
  private readonly listeners = new Set<() => void>();
  private config: RuntimeConfig | null = null;
  private models: ModelsFile["models"] = [];
  private init: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { fetch?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  state(): ProviderState {
    return this.current;
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    this.ensure();
    return () => this.listeners.delete(l);
  }

  private set(s: ProviderState) {
    this.current = s;
    this.listeners.forEach((l) => l());
  }

  retry() {
    this.init = null;
    this.set({ state: "loading" });
    this.ensure();
  }

  private ensure(): Promise<void> {
    this.init ??= this.load();
    return this.init;
  }

  private async load() {
    this.config = await loadConfig();
    if (this.config.ai.mode === "off") {
      this.set({ state: "unavailable", reason: "Explanations are turned off for this deployment. Navigation and search still work.", retryable: false });
      return;
    }
    let file: ModelsFile | null = null;
    try {
      const res = await this.fetchImpl(baseUrl(this.config.ai.modelsUrl), { cache: "no-cache" });
      if (res.ok) file = (await res.json()) as ModelsFile;
    } catch {
      file = null;
    }
    this.models = freeModels(file);
    if (this.models.length === 0) {
      this.set({
        state: "unavailable",
        reason: "No free explanation model is available right now. Navigation and search still work.",
        retryable: true,
      });
      return;
    }
    this.set({ state: "ready", models: this.models.map((m) => m.id) });
  }

  private endpoint(): string {
    const ai = this.config!.ai;
    return ai.mode === "relay" ? baseUrl(ai.relayUrl) : ai.endpoint;
  }

  async complete(messages: ChatMessage[], signal?: AbortSignal): Promise<{ text: string; model: string }> {
    await this.ensure();
    // A retryable "unavailable" (no model list yet, network) is re-checked on the next request.
    if (this.current.state === "unavailable" && this.current.retryable) {
      this.init = null;
      await this.ensure();
    }
    const st = this.current;
    if (st.state === "unavailable") throw new ProviderError(st.reason, st.retryable);
    const health = readHealth();
    const now = Date.now();
    const order = [...this.models].sort((a, b) => {
      const ca = (health[a.id]?.cooldownUntil ?? 0) > now ? 1 : 0;
      const cb = (health[b.id]?.cooldownUntil ?? 0) > now ? 1 : 0;
      return ca - cb || a.rank - b.rank;
    });
    let lastError = "The free models did not respond.";

    for (const model of order.slice(0, 4)) {
      if ((health[model.id]?.cooldownUntil ?? 0) > now && order.some((m) => (health[m.id]?.cooldownUntil ?? 0) <= now)) continue;
      const outcome = await this.attempt(model.id, messages, health, signal);
      if ("text" in outcome) return { text: outcome.text, model: model.id };
      lastError = outcome.error;
    }
    throw new ProviderError(`${lastError} Try again in a minute.`, true);
  }

  /**
   * Asks one model. Returns its answer, or why to move on to the next model;
   * throws when explanations cannot work at all (or the caller aborted).
   */
  private async attempt(id: string, messages: ChatMessage[], health: Record<string, Health>, signal?: AbortSignal): Promise<{ text: string } | { error: string }> {
    const timeout = AbortSignal.timeout(this.config!.ai.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        signal: combined,
        body: JSON.stringify({ model: id, messages, temperature: 0.2, max_tokens: 500, stream: false }),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (timeout.aborted) {
        this.cooldown(health, id, 60);
        return { error: `${id} timed out.` };
      }
      // A TypeError here in direct mode is almost always CORS or a network block.
      const reason =
        this.config!.ai.mode === "direct"
          ? "The browser could not reach the explanation service (blocked by CORS or the network). Navigation and search still work."
          : "The explanation relay could not be reached. Navigation and search still work.";
      this.set({ state: "unavailable", reason, retryable: true });
      throw new ProviderError(reason, true);
    }
    return res.ok ? this.answer(res, id, health) : this.failure(res, id, health);
  }

  /** A successful response: its text, or an empty answer that cools the model down. */
  private async answer(res: Response, id: string, health: Record<string, Health>): Promise<{ text: string } | { error: string }> {
    const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text === "string" && text.trim()) {
      health[id] = { lastOkAt: Date.now(), failures: 0 };
      writeHealth(health);
      return { text };
    }
    this.cooldown(health, id, 120);
    return { error: `${id} returned an empty answer.` };
  }

  /** An error response: cools the model down, or stops on an access-control refusal. */
  private async failure(res: Response, id: string, health: Record<string, Health>): Promise<{ error: string }> {
    const body = await res.text().catch(() => "");
    const message = extractMessage(body);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 60;
      this.cooldown(health, id, retryAfter);
      return { error: `${id} is rate limited.` };
    }
    if (res.status === 401 || res.status === 403) {
      // Access control: do not try to get around it.
      const detail = message ? ': "' + message + '"' : ".";
      const reason = `The explanation service refused anonymous access${detail} Navigation and search still work.`;
      this.set({ state: "unavailable", reason, retryable: false });
      throw new ProviderError(reason, false);
    }
    if (res.status === 404 || res.status === 400 || res.status === 422) {
      this.cooldown(health, id, 3600);
      const detail = message ? ": " + message : ".";
      return { error: `${id} is not available${detail}` };
    }
    this.cooldown(health, id, 90);
    return { error: `${id} failed with ${res.status}.` };
  }

  private cooldown(h: Record<string, Health>, id: string, seconds: number) {
    h[id] = { ...h[id], cooldownUntil: Date.now() + seconds * 1000, failures: (h[id]?.failures ?? 0) + 1 };
    writeHealth(h);
  }
}

function extractMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message;
    return (m ?? "").slice(0, 200);
  } catch {
    return body.slice(0, 120);
  }
}

let shared: OpenCodeProvider | null = null;
export function getProvider(): OpenCodeProvider {
  shared ??= new OpenCodeProvider();
  return shared;
}
