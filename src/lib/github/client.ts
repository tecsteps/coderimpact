import { AppError, isAbort } from "../errors";
import { getKV, type KV } from "../cache/db";
import { Limiter } from "../util/limiter";
import { LIMITS } from "../util/files";

export interface RateLimitState {
  limit: number;
  remaining: number;
  /** Epoch ms. */
  resetAt: number;
  resource?: string;
}

interface CachedResponse {
  etag?: string;
  body: unknown;
  storedAt: number;
  immutable?: boolean;
}

export interface GitHubClientOptions {
  fetch?: typeof fetch;
  kv?: KV;
  apiBase?: string;
  now?: () => number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Response never changes (addressed by SHA): serve from cache without revalidating. */
  immutable?: boolean;
  accept?: string;
  /** Return response text instead of JSON. */
  text?: boolean;
}

type Listener = (s: RateLimitState) => void;

/**
 * Unauthenticated GitHub REST client. Never sends credentials. Honors the
 * x-ratelimit-* and Retry-After headers, revalidates metadata with ETags (a 304
 * does not count against the limit), and falls back to cached data when offline.
 */
export class GitHubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly kvOverride?: KV;
  readonly apiBase: string;
  private readonly now: () => number;
  private readonly limiter = new Limiter(LIMITS.apiConcurrency);
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<Listener>();
  rate: RateLimitState | null = null;
  /** Epoch ms before which we should not send requests (secondary limits). */
  private blockedUntil = 0;

  constructor(opts: GitHubClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.kvOverride = opts.kv;
    this.apiBase = (opts.apiBase ?? "https://api.github.com").replace(/\/$/, "");
    this.now = opts.now ?? (() => Date.now());
  }

  private get kv(): KV {
    return this.kvOverride ?? getKV();
  }

  onRateLimit(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private updateRate(res: Response) {
    const limit = res.headers.get("x-ratelimit-limit");
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (limit == null || remaining == null || reset == null) return;
    this.rate = {
      limit: Number(limit),
      remaining: Number(remaining),
      resetAt: Number(reset) * 1000,
      resource: res.headers.get("x-ratelimit-resource") ?? undefined,
    };
    const snapshot = this.rate;
    this.listeners.forEach((l) => l(snapshot));
  }

  /** True when we know the next API request would be rejected. */
  isRateLimited(): boolean {
    const now = this.now();
    if (now < this.blockedUntil) return true;
    return !!this.rate && this.rate.remaining <= 0 && now < this.rate.resetAt;
  }

  private rateLimitError(retryAfter?: number): AppError {
    const resetAt = retryAfter ? this.now() + retryAfter * 1000 : this.rate?.resetAt ?? this.blockedUntil;
    return new AppError("rate-limit", "GitHub's rate limit for unauthenticated requests has been reached.", {
      resetAt,
      retryAfter,
      limit: this.rate?.limit,
    });
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path}`;
    const key = `${opts.accept ?? "json"}|${url}`;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = this.doRequest<T>(url, key, opts).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doRequest<T>(url: string, key: string, opts: RequestOptions): Promise<T> {
    const cached = await this.kv.get<CachedResponse>("http", key).catch(() => undefined);
    if (cached && (cached.immutable || opts.immutable)) return cached.body as T;
    if (this.isRateLimited()) {
      if (cached) return cached.body as T;
      throw this.rateLimitError();
    }

    const headers = requestHeaders(opts, cached);
    let res: Response;
    try {
      res = await this.limiter.run(
        () => this.fetchImpl(url, { headers, signal: opts.signal, credentials: "omit", cache: "no-cache" }),
        opts.signal,
      );
    } catch (e) {
      if (isAbort(e)) throw e;
      if (cached) return cached.body as T;
      throw unreachableError(url);
    }

    this.updateRate(res);

    if (res.status === 304 && cached) return cached.body as T;
    if (res.ok) return (await this.storeBody(res, key, opts)) as T;
    return this.failed<T>(res, url, cached);
  }

  /** Reads a successful response and caches it for revalidation and offline use. */
  private async storeBody(res: Response, key: string, opts: RequestOptions): Promise<unknown> {
    const body = opts.text ? await res.text() : await res.json();
    const etag = res.headers.get("etag") ?? undefined;
    await this.kv
      .put<CachedResponse>("http", key, { etag, body, storedAt: this.now(), immutable: opts.immutable })
      .catch(() => undefined);
    return body;
  }

  /** A 403 is a rate limit only when GitHub says so; otherwise it is a real refusal. */
  private isRateLimitResponse(res: Response, message: string, retryAfter: number | undefined): boolean {
    if (res.status === 429) return true;
    return res.status === 403 && (/rate limit/i.test(message) || this.rate?.remaining === 0 || !!retryAfter);
  }

  /** Turns an error response into an AppError, or serves cached data where that is still useful. */
  private async failed<T>(res: Response, url: string, cached: CachedResponse | undefined): Promise<T> {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    let message = "";
    try {
      message = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* no body */
    }

    if (this.isRateLimitResponse(res, message, retryAfter)) {
      if (retryAfter) this.blockedUntil = this.now() + retryAfter * 1000;
      if (cached) return cached.body as T;
      throw this.rateLimitError(retryAfter);
    }
    if (res.status === 404 || res.status === 451) {
      throw new AppError("not-found", message || "Not found.", { status: res.status, url });
    }
    if (res.status === 409) {
      throw new AppError("not-found", "This repository is empty.", { status: 409, url });
    }
    if (res.status === 422) {
      throw new AppError("not-found", message || "GitHub could not process this request.", { status: 422, url });
    }
    if (cached) return cached.body as T;
    throw new AppError("server", `GitHub responded with ${res.status}. Try again in a moment.`, {
      status: res.status,
      url,
    });
  }
}

function requestHeaders(opts: RequestOptions, cached: CachedResponse | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: opts.accept ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Revalidating with the ETag: a 304 does not count against the rate limit.
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  return headers;
}

function unreachableError(url: string): AppError {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return offline
    ? new AppError("offline", "You are offline and this data is not cached yet.")
    : new AppError("network", "Could not reach GitHub. Check your connection and try again.", { url });
}

let shared: GitHubClient | null = null;
export function getGitHubClient(): GitHubClient {
  shared ??= new GitHubClient();
  return shared;
}
