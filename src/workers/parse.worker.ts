/// <reference lib="webworker" />
import { ParserHost } from "../lib/lang/parserHost";
import type { SemanticLanguage } from "../lib/util/files";

/**
 * Parser worker: parses source with Tree-sitter off the UI thread and
 * returns a FileIndex. Jobs can be cancelled before they start.
 */
declare const self: DedicatedWorkerGlobalScope;

// Grammars are published next to the app: <base>/grammars/, one level above this worker's assets/ folder.
// In dev the worker is served from /src/workers/, and public/ is at the root.
const grammarsBase = import.meta.env.DEV ? new URL("/grammars/", self.location.origin).href : new URL("../grammars/", import.meta.url).href;
const host = new ParserHost((file) => new URL(file, grammarsBase).href);
const cancelled = new Set<number>();

type Msg =
  | { type: "index"; id: number; path: string; lang: SemanticLanguage; text: string }
  | { type: "cancel"; id: number };

let queue = Promise.resolve();

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelled.add(msg.id);
    return;
  }
  queue = queue.then(async () => {
    if (cancelled.delete(msg.id)) {
      self.postMessage({ id: msg.id, error: "cancelled" });
      return;
    }
    try {
      const index = await host.index(msg.path, msg.lang, msg.text);
      self.postMessage({ id: msg.id, index });
    } catch (err) {
      self.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
