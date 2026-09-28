import { openDB, type IDBPDatabase } from "idb";

/**
 * Persistent browser cache. Stores:
 *  - blobs:        content-addressed file text, keyed by `<source>:<git blob sha>`
 *  - http:         GitHub metadata responses with ETags, keyed by URL
 *  - trees:        Git trees, keyed by `<owner>/<repo>@<tree sha>`
 *  - indexes:      per-file semantic indexes, keyed by repo, commit, adapter version and path
 *  - explanations: AI explanations, keyed by a hash of prompt version, task and sent context
 */
export type StoreName = "blobs" | "http" | "trees" | "indexes" | "explanations";
const STORES: StoreName[] = ["blobs", "http", "trees", "indexes", "explanations"];
const DB_NAME = "coderimpact";
const DB_VERSION = 1;

export interface KV {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  /** Reads several entries in one transaction. */
  getMany<T>(store: StoreName, keys: string[]): Promise<(T | undefined)[]>;
  put<T>(store: StoreName, key: string, value: T): Promise<void>;
  /** Writes several entries in one transaction. */
  putMany<T>(store: StoreName, entries: { key: string; value: T }[]): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  count(store: StoreName): Promise<number>;
  clearAll(): Promise<void>;
}

class MemoryKV implements KV {
  private readonly maps = new Map<StoreName, Map<string, unknown>>();
  private m(store: StoreName) {
    let map = this.maps.get(store);
    if (!map) {
      map = new Map();
      this.maps.set(store, map);
    }
    return map;
  }
  async get<T>(store: StoreName, key: string) {
    return this.m(store).get(key) as T | undefined;
  }
  async getMany<T>(store: StoreName, keys: string[]) {
    return keys.map((k) => this.m(store).get(k) as T | undefined);
  }
  async put<T>(store: StoreName, key: string, value: T) {
    this.m(store).set(key, value);
  }
  async putMany<T>(store: StoreName, entries: { key: string; value: T }[]) {
    for (const e of entries) this.m(store).set(e.key, e.value);
  }
  async delete(store: StoreName, key: string) {
    this.m(store).delete(key);
  }
  async count(store: StoreName) {
    return this.m(store).size;
  }
  async clearAll() {
    this.maps.clear();
  }
}

class IdbKV implements KV {
  private readonly dbp: Promise<IDBPDatabase>;
  constructor(dbp: Promise<IDBPDatabase>) {
    this.dbp = dbp;
  }
  async get<T>(store: StoreName, key: string) {
    return (await (await this.dbp).get(store, key)) as T | undefined;
  }
  async getMany<T>(store: StoreName, keys: string[]) {
    if (keys.length === 0) return [];
    const tx = (await this.dbp).transaction(store, "readonly");
    const out = (await Promise.all(keys.map((k) => tx.store.get(k)))) as (T | undefined)[];
    await tx.done;
    return out;
  }
  async put<T>(store: StoreName, key: string, value: T) {
    await (await this.dbp).put(store, value, key);
  }
  async putMany<T>(store: StoreName, entries: { key: string; value: T }[]) {
    if (entries.length === 0) return;
    const tx = (await this.dbp).transaction(store, "readwrite");
    await Promise.all([...entries.map((e) => tx.store.put(e.value, e.key)), tx.done]);
  }
  async delete(store: StoreName, key: string) {
    await (await this.dbp).delete(store, key);
  }
  async count(store: StoreName) {
    return (await this.dbp).count(store);
  }
  async clearAll() {
    const db = await this.dbp;
    const tx = db.transaction(STORES, "readwrite");
    await Promise.all(STORES.map((s) => tx.objectStore(s).clear()));
    await tx.done;
  }
}

/** Wraps a KV so storage failures (quota, private mode) degrade to memory instead of breaking reads. */
class SafeKV implements KV {
  private readonly primary: KV;
  private readonly fallback = new MemoryKV();
  private broken = false;
  constructor(primary: KV) {
    this.primary = primary;
  }
  private async attempt<R>(fn: (kv: KV) => Promise<R>): Promise<R> {
    if (this.broken) return fn(this.fallback);
    try {
      return await fn(this.primary);
    } catch (e) {
      console.warn("Browser cache unavailable, using memory only.", e);
      this.broken = true;
      return fn(this.fallback);
    }
  }
  get<T>(store: StoreName, key: string) {
    return this.attempt((kv) => kv.get<T>(store, key));
  }
  getMany<T>(store: StoreName, keys: string[]) {
    return this.attempt((kv) => kv.getMany<T>(store, keys));
  }
  put<T>(store: StoreName, key: string, value: T) {
    return this.attempt((kv) => kv.put(store, key, value));
  }
  putMany<T>(store: StoreName, entries: { key: string; value: T }[]) {
    return this.attempt((kv) => kv.putMany(store, entries));
  }
  delete(store: StoreName, key: string) {
    return this.attempt((kv) => kv.delete(store, key));
  }
  count(store: StoreName) {
    return this.attempt((kv) => kv.count(store));
  }
  clearAll() {
    return this.attempt((kv) => kv.clearAll());
  }
}

let instance: KV | null = null;

export function getKV(): KV {
  if (instance) return instance;
  if (typeof indexedDB === "undefined") {
    instance = new MemoryKV();
    return instance;
  }
  const dbp = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    },
  });
  instance = new SafeKV(new IdbKV(dbp));
  return instance;
}

export function createMemoryKV(): KV {
  return new MemoryKV();
}

export interface CacheUsage {
  /** Bytes used by this origin, when the browser reports it. */
  usage?: number;
  quota?: number;
  counts: Record<StoreName, number>;
}

export async function cacheUsage(): Promise<CacheUsage> {
  const kv = getKV();
  const counts = {} as Record<StoreName, number>;
  for (const s of STORES) counts[s] = await kv.count(s).catch(() => 0);
  let usage: number | undefined;
  let quota: number | undefined;
  try {
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage;
    quota = est?.quota;
  } catch {
    /* not supported */
  }
  return { usage, quota, counts };
}

export async function clearCache(): Promise<void> {
  await getKV().clearAll();
}
