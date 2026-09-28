import type { SemanticLanguage } from "../util/files";
import type { FileIndex } from "./types";

/** A job in a worker; `cleanup` removes its abort listener once it settled. */
type Pending = { resolve: (f: FileIndex) => void; reject: (e: Error) => void; worker: number; cleanup: () => void };

/** Parser workers to run: one per spare CPU core, at most four. */
function poolSize(): number {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2;
  return Math.max(1, Math.min(4, cores - 1));
}

/**
 * Talks to a small pool of parser workers. Parsing never happens on the UI
 * thread, and several files parse at once on multi-core devices.
 */
export class ParserClient {
  private workers: (Worker | null)[] = [];
  private load: number[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly size = poolSize();

  private spawn(i: number): Worker {
    const w = new Worker(new URL("../../workers/parse.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; index?: FileIndex; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      this.load[p.worker]--;
      p.cleanup();
      if (e.data.index) p.resolve(e.data.index);
      else p.reject(new Error(e.data.error ?? "Parse failed"));
    };
    w.onerror = (e) => {
      for (const [id, p] of this.pending) {
        if (p.worker !== i) continue;
        p.cleanup();
        p.reject(new Error(e.message || "Parser worker failed"));
        this.pending.delete(id);
      }
      this.load[i] = 0;
      this.workers[i] = null;
    };
    this.workers[i] = w;
    this.load[i] = 0;
    return w;
  }

  /** The least busy worker, started on first use. */
  private pick(): number {
    let best = 0;
    for (let i = 0; i < this.size; i++) {
      if (!this.workers[i]) return i;
      if ((this.load[i] ?? 0) < (this.load[best] ?? 0)) best = i;
    }
    return best;
  }

  index(path: string, lang: SemanticLanguage, text: string, signal?: AbortSignal): Promise<FileIndex> {
    const id = this.nextId++;
    const wi = this.pick();
    const worker = this.workers[wi] ?? this.spawn(wi);
    this.load[wi] = (this.load[wi] ?? 0) + 1;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        this.load[wi]--;
        return reject(new DOMException("Aborted", "AbortError"));
      }
      const onAbort = () => {
        if (!this.pending.has(id)) return;
        worker.postMessage({ type: "cancel", id });
        this.pending.delete(id);
        this.load[wi]--;
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, { resolve, reject, worker: wi, cleanup: () => signal?.removeEventListener("abort", onAbort) });
      worker.postMessage({ type: "index", id, path, lang, text });
    });
  }
}

let shared: ParserClient | null = null;
export function getParserClient(): ParserClient {
  shared ??= new ParserClient();
  return shared;
}
