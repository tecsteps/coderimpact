import type { TokenTuple } from "../../workers/highlight.worker";

export type { TokenTuple };

interface Result {
  lines: TokenTuple[][];
}

type Pending = { resolve: (r: Result) => void; reject: (e: Error) => void };

/** Client for the Shiki worker with a small LRU of recent results. */
class HighlightClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly cache = new Map<string, Promise<Result>>();

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("../../workers/highlight.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<{ id: number; lines?: TokenTuple[][]; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.lines) p.resolve({ lines: e.data.lines });
        else p.reject(new Error(e.data.error ?? "Highlighting failed"));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(e.message || "Highlighter failed"));
        this.pending.clear();
        this.worker = null;
      };
    }
    return this.worker;
  }

  highlight(cacheKey: string, code: string, lang: string, theme: string): Promise<Result> {
    const key = `${cacheKey}|${lang}|${theme}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const id = this.nextId++;
    const worker = this.ensure();
    const p = new Promise<Result>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, code, lang, theme });
    });
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, p);
    while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    return p;
  }
}

export const highlightClient = new HighlightClient();
