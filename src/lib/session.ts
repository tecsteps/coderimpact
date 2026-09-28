import { AppError, isAbort, toAppError } from "./errors";
import { getKV } from "./cache/db";
import type { ResolvedRepo, RepositorySource, BlobResult, RepoRefs } from "./github/source";
import type { RepoTree, TreeEntry } from "./github/tree";
import { adapterVersion } from "./lang/versions";
import { getParserClient } from "./lang/parserClient";
import { SemanticIndex, parseGoMod, type GoModule, type Resolution } from "./lang/semanticIndex";
import type { FileIndex, Target } from "./lang/types";
import { dirname, isBinaryPath, isSkippedForIndex, LIMITS, semanticLanguageFor, type SemanticLanguage } from "./util/files";
import { BLOB_BATCH } from "./github/gitSource";
import { isLocalOwner } from "./local/projects";

export interface IndexProgress {
  /** idle: nothing to do; running: working; paused: cancelled by the visitor; limited: hit a limit. */
  phase: "idle" | "running" | "paused" | "limited";
  indexed: number;
  /** Go and PHP files known in the tree. */
  total: number;
  /** How many files background indexing will cover (device dependent). */
  cap: number;
  failed: number;
  skipped: number;
  /** The module (folder with composer.json or go.mod) of the open file. */
  module?: { root: string; name: string; indexed: number; total: number };
  /** Files per second over the last few seconds. */
  rate?: number;
  /** Current step for the progress label. */
  current?: string;
  note?: string;
  /** Reading the indexes cached in this browser (after a reload): no parsing. */
  warming?: boolean;
}

export interface ScanProgress {
  phase: "idle" | "running" | "done" | "cancelled";
  fetched: number;
  total: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  col: number;
  length: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  filesSearched: number;
  truncated: boolean;
}

type Listener = () => void;

/** Indexing order: open file, its folder, what it imports, its module, the rest. */
const PRIORITY = { current: 0, package: 1, imported: 2, module: 3, background: 4 } as const;
const PRIORITY_LEVELS = 5;

/** Parallel file downloads and parses while indexing. raw.githubusercontent.com has no API rate limit. */
const INDEX_CONCURRENCY = 16;
const isTouchDevice = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/**
 * How many files background indexing covers. Measured on spryker-core: about
 * 26 MB of memory per 1,000 indexed files, so phones stop much earlier.
 */
function indexCap(): number {
  const mem = (typeof navigator !== "undefined" && (navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 4;
  if (isTouchDevice()) return mem >= 8 ? 8_000 : 4_000;
  return mem >= 8 ? 30_000 : 12_000;
}

/** Text kept in memory for search and previews; beyond this, background files are read back from the cache. */
const textBudgetChars = () => (isTouchDevice() ? 10_000_000 : 40_000_000);

interface FileLookup {
  semantic: TreeEntry[];
  byDir: Map<string, TreeEntry[]>;
  byName: Map<string, TreeEntry[]>;
}

/**
 * Everything the reader knows about one repository at one commit: tree,
 * fetched files, semantic index and background work. Kept in memory for the
 * browser session and backed by the persistent cache.
 */
let sessionCount = 0;

export class RepoSession {
  readonly repo: ResolvedRepo;
  readonly tree: RepoTree;
  readonly index = new SemanticIndex();
  readonly texts = new Map<string, string>();
  private textChars = 0;
  private readonly source: RepositorySource;
  private readonly listeners = new Set<Listener>();
  version = 0;
  progress: IndexProgress = { phase: "idle", indexed: 0, total: 0, cap: indexCap(), failed: 0, skipped: 0 };
  scan: ScanProgress = { phase: "idle", fetched: 0, total: 0 };
  /** Priority buckets, and each path's current priority. */
  private buckets: string[][] = Array.from({ length: PRIORITY_LEVELS }, () => []);
  /** Read position per bucket (Array.shift is too slow for tens of thousands of entries). */
  private heads: number[] = Array.from({ length: PRIORITY_LEVELS }, () => 0);
  /** Batched Git prefetches of file contents, by path. */
  private readonly prefetching = new Map<string, Promise<void>>();
  private readonly prefetched = new Set<string>();
  private prefetchRunning = 0;
  private readonly queued = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<FileIndex | null>>();
  private backgroundCtl = new AbortController();
  private scanCtl: AbortController | null = null;
  private startup: { modulesReady: Promise<void>; warm: Promise<void> } | null = null;
  private backgroundQueued = false;
  private lookup: FileLookup | null = null;
  private lookupTreeSize = -1;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingWrites: { key: string; value: FileIndex }[] = [];
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly rateWindow: number[] = [];
  private readonly triedSubtrees = new Set<string>();

  /** Parses a file into a FileIndex; the browser uses the worker pool. */
  private readonly parse: (path: string, lang: SemanticLanguage, text: string, signal?: AbortSignal) => Promise<FileIndex>;

  constructor(
    repo: ResolvedRepo,
    tree: RepoTree,
    source: RepositorySource,
    parse?: (path: string, lang: SemanticLanguage, text: string, signal?: AbortSignal) => Promise<FileIndex>,
  ) {
    this.repo = repo;
    this.tree = tree;
    this.source = source;
    this.parse = parse ?? ((path, lang, text, signal) => getParserClient().index(path, lang, text, signal));
    this.progress.total = this.files().semantic.length;
  }

  /**
   * Starts reading go.mod files and the indexes cached in this browser
   * (idempotent). The app calls it right after creating a session; anything
   * that needs either result also starts it on first use.
   */
  start(): void {
    this.boot();
  }

  private boot() {
    if (!this.startup) {
      const modulesReady = this.loadGoModules();
      this.startup = { modulesReady, warm: modulesReady.then(() => this.loadCachedIndexes()) };
    }
    return this.startup;
  }

  private get modulesReady(): Promise<void> {
    return this.boot().modulesReady;
  }

  /** Resolves once the indexes cached in this browser are loaded. */
  private get warm(): Promise<void> {
    return this.boot().warm;
  }

  /**
   * After a reload, every file indexed before is still in the browser cache.
   * Read them all in a few bulk transactions instead of one by one through
   * the indexing queue; only files that are new or changed are parsed.
   */
  private async loadCachedIndexes() {
    const files = this.files().semantic.slice(0, this.progress.cap);
    if (files.length === 0) return;
    this.progress.warming = true;
    this.emit();
    const kv = getKV();
    const CHUNK = 1500;
    try {
      for (let i = 0; i < files.length; i += CHUNK) {
        const batch = files.slice(i, i + CHUNK).filter((f) => !this.index.has(f.path));
        const keys = batch.map((f) => this.indexKey(f, semanticLanguageFor(f.path)!));
        const hits = await kv.getMany<FileIndex>("indexes", keys);
        hits.forEach((fi, j) => {
          if (!fi || this.index.has(batch[j].path)) return;
          this.index.add(fi.path === batch[j].path ? fi : { ...fi, path: batch[j].path });
        });
        this.progress.indexed = this.index.fileCount;
        this.updateModuleProgress();
        this.emit();
        // Let the page paint between chunks.
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch {
      /* no cache: the queue indexes everything */
    } finally {
      this.progress.warming = false;
      this.emit();
    }
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Notifies the UI now (user-visible changes). */
  private emit() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Notifies the UI at most a few times per second (background progress). */
  private emitSoon() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, 300);
  }

  /** Distinguishes sessions of the same commit (a local folder listed again). */
  readonly instance = ++sessionCount;

  get key(): string {
    return `${this.repo.owner}/${this.repo.repo}@${this.repo.commitSha}`;
  }

  /** File lists by folder and by name, rebuilt only when the tree grows. */
  private files(): FileLookup {
    if (this.lookup && this.lookupTreeSize === this.tree.size) return this.lookup;
    const semantic: TreeEntry[] = [];
    const byDir = new Map<string, TreeEntry[]>();
    const byName = new Map<string, TreeEntry[]>();
    for (const f of this.tree.files()) {
      const key = f.name.toLowerCase();
      const list = byName.get(key);
      if (list) list.push(f);
      else byName.set(key, [f]);
      if (!semanticLanguageFor(f.path) || isSkippedForIndex(f.path) || (f.size ?? 0) > LIMITS.maxIndexBytes) continue;
      semantic.push(f);
      const d = dirname(f.path);
      const dl = byDir.get(d);
      if (dl) dl.push(f);
      else byDir.set(d, [f]);
    }
    this.lookup = { semantic, byDir, byName };
    this.lookupTreeSize = this.tree.size;
    return this.lookup;
  }

  semanticFiles(): TreeEntry[] {
    return this.files().semantic;
  }

  private async loadGoModules() {
    const mods = this.tree.files().filter((f) => f.name === "go.mod" && !isSkippedForIndex(f.path));
    const goDirs = new Set(this.tree.files().filter((f) => f.path.endsWith(".go")).map((f) => dirname(f.path)));
    this.index.setGoDirs(goDirs);
    const found: GoModule[] = [];
    await Promise.all(
      mods.slice(0, 20).map(async (m) => {
        try {
          const blob = await this.source.fetchBlob(this.repo, m, this.backgroundCtl.signal);
          const path = parseGoMod(blob.text);
          if (path) found.push({ dir: dirname(m.path), path });
        } catch {
          /* ignore unreadable go.mod */
        }
      }),
    );
    this.index.setGoModules(found);
  }

  // ---------- Files ----------

  private keepText(path: string, text: string) {
    if (this.texts.has(path)) return;
    this.texts.set(path, text);
    this.textChars += text.length;
    this.textsVersion++;
  }

  /** Changes whenever a file text is kept or dropped: searches over texts re-run on it, not on every progress tick. */
  textsVersion = 0;

  /** Recently split file texts, so result lists do not split a file once per row. */
  private readonly lineCache = new Map<string, { text: string; lines: string[] }>();

  /** The lines of a file whose text is loaded, or undefined. */
  lines(path: string): string[] | undefined {
    const text = this.texts.get(path);
    if (text === undefined) return undefined;
    const hit = this.lineCache.get(path);
    if (hit?.text === text) return hit.lines;
    const lines = text.split("\n");
    this.lineCache.delete(path);
    this.lineCache.set(path, { text, lines });
    if (this.lineCache.size > 64) this.lineCache.delete(this.lineCache.keys().next().value!);
    return lines;
  }

  private readonly fileVersions = new Map<string, number>();

  /** Changes whenever a local file was saved again; components reload it then. */
  fileVersion(path: string): number {
    return this.fileVersions.get(path) ?? 0;
  }

  /**
   * Local folders: picks up a file saved in another app. Returns true when it
   * changed; the text is reloaded and the file indexed again.
   */
  async refreshFile(path: string): Promise<boolean> {
    const entry = this.tree.get(path);
    if (entry?.type !== "blob" || !this.source.checkFile) return false;
    const next = await this.source.checkFile(this.repo, entry).catch(() => null);
    if (!next) return false;
    this.replaceEntry(next);
    return true;
  }

  /** A new version of a file: drops its text, indexes it again and tells the views. */
  private replaceEntry(next: TreeEntry, text?: string) {
    const path = next.path;
    this.tree.updateEntry(next);
    const old = this.texts.get(path);
    if (old !== undefined) {
      this.texts.delete(path);
      this.textChars -= old.length;
      this.textsVersion++;
    }
    if (text !== undefined) this.keepText(path, text);
    if (this.index.has(path) || (text !== undefined && semanticLanguageFor(path))) {
      this.index.remove(path);
      this.progress.indexed = this.index.fileCount;
      this.updateModuleProgress();
      if (semanticLanguageFor(path)) this.enqueue(path, PRIORITY.current);
    }
    this.fileVersions.set(path, this.fileVersion(path) + 1);
    this.emit();
  }

  /** Local folders in browsers that can save files. */
  async canEdit(): Promise<boolean> {
    return (await this.source.canWrite?.(this.repo).catch(() => false)) ?? false;
  }

  /**
   * Local folders: saves a file to disk (asks for write access on the first
   * save) and indexes the new version. Throws "conflict" when the file was
   * changed on disk since it was opened, unless `force`.
   */
  async saveFile(path: string, text: string, opts: { force?: boolean } = {}): Promise<void> {
    const entry = this.tree.get(path);
    if (entry?.type !== "blob" || !this.source.writeFile) throw new AppError("local-access", "This file cannot be saved here.");
    if (!opts.force && this.source.checkFile) {
      const onDisk = await this.source.checkFile(this.repo, entry).catch(() => null);
      if (onDisk) throw new AppError("conflict", `${entry.name} was changed on disk since you opened it.`);
    }
    const next = await this.source.writeFile(this.repo, path, text);
    this.replaceEntry({ ...entry, sha: next.sha, size: next.size }, text);
  }

  /** Local folders: lists one folder again, so new and deleted files show up. */
  async refreshDirectory(dir: string): Promise<void> {
    if (!this.source.checkFile || !this.tree.isLoaded(dir)) return;
    const before = (this.tree.list(dir) ?? []).map((e) => `${e.path}:${e.sha}`).join("|");
    await this.source.loadDirectory(this.repo, this.tree, dir).catch(() => undefined);
    const after = (this.tree.list(dir) ?? []).map((e) => `${e.path}:${e.sha}`).join("|");
    if (before !== after) {
      this.progress.total = this.files().semantic.length;
      this.emit();
    }
  }

  /** Branches whose latest commit is the one being read; empty where unknown. */
  async branchesAtCommit(signal?: AbortSignal): Promise<string[]> {
    if (!this.source.branchesAt) return [];
    return this.source.branchesAt(this.repo, this.repo.commitSha, signal);
  }

  /** Branches and tags to switch to; empty where the source cannot list them. */
  async listRefs(signal?: AbortSignal): Promise<RepoRefs> {
    if (!this.source.listRefs) return { branches: [], tags: [] };
    return this.source.listRefs(this.repo, signal);
  }

  /** GitHub: the commit the branch points to now, when it moved past this session's commit. */
  async newerCommit(branch: string, signal?: AbortSignal): Promise<string | null> {
    if (!this.source.headOf) return null;
    const head = await this.source.headOf(this.repo, branch, signal).catch(() => null);
    return head && head !== this.repo.commitSha ? head : null;
  }

  async loadFile(path: string, signal?: AbortSignal): Promise<BlobResult> {
    const entry = (await this.source.ensurePath(this.repo, this.tree, path, signal)) ?? this.tree.get(path);
    if (!entry) throw new AppError("not-found", `${path} does not exist at this commit.`);
    const blob = await this.source.fetchBlob(this.repo, entry, signal);
    if (!this.texts.has(path)) {
      this.keepText(path, blob.text);
      this.emit();
    }
    return blob;
  }

  async loadDirectory(path: string, signal?: AbortSignal) {
    if (this.tree.isLoaded(path)) return;
    await this.source.ensurePath(this.repo, this.tree, path + "/x", signal).catch(() => undefined);
    if (!this.tree.isLoaded(path)) await this.source.loadDirectory(this.repo, this.tree, path, signal);
    this.progress.total = this.files().semantic.length;
    this.emit();
  }

  // ---------- Modules and direct resolution ----------

  /** Nearest folder at or above `path` with a composer.json or go.mod ("" for the root). */
  moduleRoot(path: string): string {
    let d = dirname(path);
    for (;;) {
      const prefix = d ? `${d}/` : "";
      if (this.tree.get(`${prefix}composer.json`) || this.tree.get(`${prefix}go.mod`)) return d;
      if (!d) return "";
      d = dirname(d);
    }
  }

  private moduleFiles(root: string): TreeEntry[] {
    const prefix = root ? `${root}/` : "";
    return this.files().semantic.filter((f) => f.path.startsWith(prefix));
  }

  /**
   * Finds the file that declares a PHP class by its fully qualified name, the
   * way Composer's PSR-4 and PSR-0 autoloaders map namespaces to folders: the
   * file named after the class whose path ends with the most namespace segments.
   */
  fileForClass(fqn: string): TreeEntry | undefined {
    const parts = fqn.replace(/^\\/, "").split("\\").filter(Boolean);
    if (parts.length === 0) return undefined;
    const candidates = this.files().byName.get(`${parts.at(-1)!.toLowerCase()}.php`) ?? [];
    let best: TreeEntry | undefined;
    let bestScore = 0;
    for (const c of candidates) {
      const dirs = c.path.split("/").slice(0, -1).map((s) => s.toLowerCase());
      let score = 1;
      for (let i = parts.length - 2, j = dirs.length - 1; i >= 0 && j >= 0 && parts[i].toLowerCase() === dirs[j]; i--, j--) score++;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return bestScore >= Math.min(2, parts.length) ? best : undefined;
  }

  /** Loads an unlisted folder named after a namespace segment (large repositories), at most once each. */
  private async loadFolderForClass(fqn: string, signal?: AbortSignal): Promise<boolean> {
    const segments = new Set(fqn.split("\\").map((s) => s.toLowerCase()));
    const pending = this.tree.pendingDirs().filter((d) => segments.has(d.name.toLowerCase()) && !this.triedSubtrees.has(d.path));
    let loaded = false;
    for (const d of pending.slice(0, 2)) {
      this.triedSubtrees.add(d.path);
      try {
        await this.source.loadSubtree?.(this.repo, this.tree, d.path, signal);
        loaded = true;
      } catch {
        /* rate limit or network: stay with what we have */
      }
    }
    if (loaded) {
      this.progress.total = this.files().semantic.length;
      this.emit();
    }
    return loaded;
  }

  /** Files that could turn an unresolved target into an exact answer. */
  private async filesForTarget(fi: FileIndex, target: Target, signal?: AbortSignal): Promise<string[]> {
    if (fi.language === "php") return this.phpFilesForTarget(target, signal);
    // Go: every file of the imported package, or of the package of a qualified type.
    const dir = this.goPackageDir(fi, target);
    if (dir === null || dir === undefined) return [];
    return (this.files().byDir.get(dir) ?? []).map((f) => f.path);
  }

  /** The class files a PHP class or member target names, loading their folder when unlisted. */
  private async phpFilesForTarget(target: Target, signal?: AbortSignal): Promise<string[]> {
    const fqns: string[] = [];
    if (target.t === "class") fqns.push(target.fqn);
    if (target.t === "member") {
      const m = /^@?([A-Za-z0-9_\\]+)/.exec(target.typeRef);
      if (m) fqns.push(m[1]);
    }
    const out: string[] = [];
    for (const fqn of fqns) {
      let f = this.fileForClass(fqn);
      if (!f && (await this.loadFolderForClass(fqn, signal))) f = this.fileForClass(fqn);
      if (f) out.push(f.path);
    }
    return out;
  }

  /** The folder of the Go package a target points into (null or undefined when unknown). */
  private goPackageDir(fi: FileIndex, target: Target): string | null | undefined {
    const importPath = goImportPath(fi, target);
    if (importPath) return this.index.importDir(importPath);
    return target.t === "pkg" || target.t === "member" ? dirname(fi.path) : null;
  }

  /**
   * Resolves an occurrence, fetching and indexing the exact files that can
   * answer it (the class file for a PHP name, the package for a Go import)
   * instead of waiting for the whole repository to be indexed.
   */
  async resolveDeep(path: string, index: number, signal?: AbortSignal): Promise<Resolution> {
    let r = this.index.resolveOccurrence(path, index);
    const fi = this.index.get(path);
    if (!fi) return r;
    for (let round = 0; round < 4 && r.status !== "resolved" && r.status !== "dynamic"; round++) {
      const occ = fi.occurrences[index];
      let needed = (await this.filesForTarget(fi, occ.target, signal)).filter((p) => !this.index.has(p));
      // PHP members may live on a parent class: follow extends of the classes indexed so far.
      if (needed.length === 0 && fi.language === "php" && occ.target.t === "member") {
        needed = this.parentClassFiles(occ.target.typeRef).filter((p) => !this.index.has(p));
      }
      if (needed.length === 0) break;
      await Promise.all(needed.slice(0, 40).map((p) => this.ensureIndexed(p)));
      r = this.index.resolveOccurrence(path, index);
    }
    this.emit();
    return r;
  }

  private parentClassFiles(typeRef: string): string[] {
    const out: string[] = [];
    let fqn = /^@?([A-Za-z0-9_\\]+)/.exec(typeRef)?.[1];
    for (let i = 0; fqn && i < 6; i++) {
      const file = this.fileForClass(fqn);
      if (!file) break;
      const fi = this.index.get(file.path);
      if (!fi) {
        out.push(file.path);
        break;
      }
      fqn = fi.decls.find((d) => d.fqn?.toLowerCase() === fqn!.toLowerCase() && d.scope === "top")?.extendsFqn;
    }
    return out;
  }

  // ---------- Indexing ----------

  /**
   * Keyed by the file's Git blob SHA: an unchanged file is never parsed twice,
   * across commits too. Local file ids come from path, size and time, not the
   * content, so they carry the folder's id: two folders never share an index.
   */
  private indexKey(entry: TreeEntry, lang: SemanticLanguage) {
    const scope = isLocalOwner(this.repo.owner) ? `${this.repo.commitSha}:` : "";
    return `${adapterVersion(lang)}:${scope}${entry.sha}:${entry.path}`;
  }

  /** Stable function reference to imageUrls, for components' effect dependencies. */
  readonly imageUrlsFn = (path: string) => this.imageUrls(path);

  /** Where an image file can be shown from; empty when this source cannot serve images. */
  async imageUrls(path: string): Promise<string[]> {
    const entry = this.tree.get(path);
    if (!entry || !this.source.imageUrls) return [];
    return this.source.imageUrls(this.repo, entry);
  }

  startIndexing() {
    if (this.backgroundQueued || this.progress.phase === "paused") return;
    this.warm.then(() => {
      if (!this.backgroundQueued && this.progress.phase !== "paused") this.queueBackground();
    });
  }

  focusFile(path: string) {
    const lang = semanticLanguageFor(path);
    if (!lang) {
      this.startIndexing();
      return;
    }
    this.enqueue(path, PRIORITY.current);
    for (const f of this.files().byDir.get(dirname(path)) ?? []) {
      if (semanticLanguageFor(f.path) === lang) this.enqueue(f.path, PRIORITY.package);
    }
    const root = this.moduleRoot(path);
    const moduleFiles = this.moduleFiles(root);
    this.progress.module = { root, name: root.split("/").pop() || this.repo.repo, indexed: 0, total: moduleFiles.length };
    this.updateModuleProgress();
    this.ensureIndexed(path).then((fi) => this.enqueueAround(fi, moduleFiles));
  }

  /** Once the open file is indexed: the files it imports, then its module, then the rest. */
  private async enqueueAround(fi: FileIndex | null, moduleFiles: TreeEntry[]) {
    if (!fi) return;
    await this.modulesReady;
    if (fi.language === "go") this.enqueueGoImports(fi);
    else if (fi.language === "php") this.enqueuePhpUses(fi);
    for (const f of moduleFiles) this.enqueue(f.path, PRIORITY.module);
    if (!this.backgroundQueued && this.progress.phase !== "paused") this.queueBackground();
  }

  private enqueueGoImports(fi: FileIndex) {
    for (const imp of fi.imports) {
      const d = this.index.importDir(imp.path);
      if (d === null) continue;
      for (const f of this.files().byDir.get(d) ?? []) this.enqueue(f.path, PRIORITY.imported);
    }
  }

  private enqueuePhpUses(fi: FileIndex) {
    for (const u of fi.uses) {
      const f = u.kind === "class" ? this.fileForClass(u.fqn) : undefined;
      if (f) this.enqueue(f.path, PRIORITY.imported);
    }
  }

  /** Counts the focused module's indexed files from scratch (module changes, cache loads, removals). */
  private updateModuleProgress() {
    const m = this.progress.module;
    if (!m) return;
    const prefix = m.root ? `${m.root}/` : "";
    let n = 0;
    for (const p of this.index.paths()) if (p.startsWith(prefix)) n++;
    m.indexed = Math.min(n, m.total);
  }

  /** One more indexed file: counted without walking the whole index. */
  private countModuleFile(path: string) {
    const m = this.progress.module;
    if (m && (!m.root || path.startsWith(`${m.root}/`))) m.indexed = Math.min(m.indexed + 1, m.total);
  }

  private queueBackground() {
    this.backgroundQueued = true;
    const files = this.files().semantic;
    const cap = this.progress.cap;
    files.slice(0, cap).forEach((f) => this.enqueue(f.path, PRIORITY.background, false));
    this.pump();
    this.progress.note = this.backgroundNote(files.length, cap);
  }

  /** Why background indexing will not cover everything, if it will not. */
  private backgroundNote(fileCount: number, cap: number): string | undefined {
    if (fileCount > cap) {
      return `This device indexes up to ${cap.toLocaleString()} files in the background. Opening a file always indexes its module and the files it uses.`;
    }
    const pending = this.tree.pendingDirs().length;
    if (pending === 0) return undefined;
    if (this.repo.owner === "~") return "Dependency and build folders (node_modules, vendor and similar) are listed and indexed when you open them.";
    return `${pending.toLocaleString()} folders of this large repository are not listed by GitHub yet; they are indexed when opened.`;
  }

  private enqueue(path: string, priority: number, start = true) {
    if (this.index.has(path) || this.inflight.has(path)) return;
    const prev = this.queued.get(path);
    if (prev !== undefined && prev <= priority) return;
    this.queued.set(path, priority);
    this.buckets[priority].push(path);
    if (start) this.pump();
  }

  /** Next path in priority order (stale bucket entries are skipped). */
  private next(): string | undefined {
    for (let p = 0; p < PRIORITY_LEVELS; p++) {
      const bucket = this.buckets[p];
      while (this.heads[p] < bucket.length) {
        const path = bucket[this.heads[p]++];
        if (this.queued.get(path) === p) {
          this.queued.delete(path);
          return path;
        }
      }
      if (this.heads[p] > 0 && this.heads[p] === bucket.length) {
        this.buckets[p] = [];
        this.heads[p] = 0;
      }
    }
    return undefined;
  }

  /**
   * Fetches the contents of the next queued files in batches over Git (one
   * request per few hundred files) ahead of the parser workers.
   */
  private prefetchAhead() {
    const source = this.source;
    if (!source.prefetchBlobs || this.prefetchRunning >= 2) return;
    const batch: TreeEntry[] = [];
    for (let p = 0; p < PRIORITY_LEVELS && batch.length < BLOB_BATCH; p++) {
      const bucket = this.buckets[p];
      for (let i = this.heads[p]; i < bucket.length && batch.length < BLOB_BATCH; i++) {
        const path = bucket[i];
        if (this.queued.get(path) !== p || this.prefetched.has(path) || this.texts.has(path) || this.index.has(path)) continue;
        const entry = this.tree.get(path);
        if (entry) batch.push(entry);
      }
    }
    if (batch.length === 0) return;
    for (const e of batch) this.prefetched.add(e.path);
    this.prefetchRunning++;
    const done = source
      .prefetchBlobs(this.repo, batch, this.backgroundCtl.signal)
      .catch(() => undefined)
      .finally(() => {
        this.prefetchRunning--;
        for (const e of batch) this.prefetching.delete(e.path);
        this.prefetchAhead();
      });
    for (const e of batch) this.prefetching.set(e.path, done);
    this.prefetchAhead();
  }

  pauseIndexing() {
    this.backgroundCtl.abort();
    this.backgroundCtl = new AbortController();
    for (let p = PRIORITY.module; p < PRIORITY_LEVELS; p++) {
      for (const path of this.buckets[p]) if (this.queued.get(path) === p) this.queued.delete(path);
      this.buckets[p] = [];
    }
    this.progress.phase = "paused";
    this.progress.current = undefined;
    this.emit();
  }

  resumeIndexing() {
    this.progress.phase = "idle";
    this.backgroundQueued = false;
    const m = this.progress.module;
    if (m) for (const f of this.moduleFiles(m.root)) this.enqueue(f.path, PRIORITY.module, false);
    this.queueBackground();
    this.emit();
  }

  /** Resolves when the file's index is available (null for unsupported languages or failures). */
  ensureIndexed(path: string): Promise<FileIndex | null> {
    const existing = this.index.get(path);
    if (existing) return Promise.resolve(existing);
    const inflight = this.inflight.get(path);
    if (inflight) return inflight;
    this.queued.delete(path);
    const p = this.indexOne(path, undefined, true);
    this.inflight.set(path, p);
    p.finally(() => this.inflight.delete(path));
    return p;
  }

  private queueWrite(key: string, value: FileIndex) {
    this.pendingWrites.push({ key, value });
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      const batch = this.pendingWrites.splice(0);
      getKV()
        .putMany("indexes", batch)
        .catch(() => undefined);
    }, 500);
  }

  private async indexOne(path: string, signal?: AbortSignal, keep = false): Promise<FileIndex | null> {
    const lang = semanticLanguageFor(path);
    if (!lang) return null;
    await this.modulesReady;
    const entry = this.tree.get(path);
    if (!entry) return null;
    const key = this.indexKey(entry, lang);
    try {
      const cached = await getKV().get<FileIndex>("indexes", key);
      let fi: FileIndex | null;
      if (cached) fi = cached.path === path ? cached : { ...cached, path };
      else fi = await this.parseFresh(entry, lang, key, signal, keep);
      if (!fi) return null;
      const isNew = !this.index.has(path);
      this.index.add(fi);
      this.progress.indexed = this.index.fileCount;
      if (isNew) this.countModuleFile(path);
      this.trackRate();
      this.emitSoon();
      return fi;
    } catch (e) {
      if (isAbort(e)) return null;
      this.recordIndexFailure(e);
      return null;
    }
  }

  /** Fetches (or reuses) a file's text and parses it; null when it is too large to index. */
  private async parseFresh(entry: TreeEntry, lang: SemanticLanguage, key: string, signal: AbortSignal | undefined, keep: boolean): Promise<FileIndex | null> {
    const path = entry.path;
    const prefetch = this.prefetching.get(path);
    if (prefetch) await prefetch;
    let text = this.texts.get(path);
    if (text === undefined) {
      const blob = await this.source.fetchBlob(this.repo, entry, signal);
      text = blob.text;
      if (keep || this.textChars < textBudgetChars()) this.keepText(path, text);
    }
    if (text.length > LIMITS.maxIndexBytes) {
      this.progress.skipped++;
      return null;
    }
    const fi = await this.parse(path, lang, text, signal);
    this.queueWrite(key, fi);
    return fi;
  }

  private recordIndexFailure(e: unknown) {
    if (toAppError(e).kind === "rate-limit") {
      this.progress.phase = "limited";
      this.progress.note = "Paused: GitHub's rate limit was reached.";
    } else this.progress.failed++;
    this.emitSoon();
  }

  private trackRate() {
    const now = Date.now();
    this.rateWindow.push(now);
    while (this.rateWindow.length && now - this.rateWindow[0] > 5000) this.rateWindow.shift();
    this.progress.rate = this.rateWindow.length / 5;
  }

  /** Worker loops currently draining the queue. */
  private active = 0;

  /**
   * Keeps up to INDEX_CONCURRENCY workers draining the queue. Called whenever
   * work is queued, so work that arrives later is picked up in parallel too.
   */
  private pump() {
    this.prefetchAhead();
    const want = Math.min(INDEX_CONCURRENCY, this.queued.size) - this.active;
    for (let i = 0; i < want; i++) this.runWorker();
  }

  private async runWorker() {
    this.active++;
    try {
      for (;;) {
        if (this.progress.phase === "limited") return;
        const path = this.next();
        if (!path) return;
        if (this.index.has(path)) continue;
        this.progress.phase = "running";
        this.progress.current = path;
        const inflight = this.inflight.get(path);
        if (inflight) {
          await inflight;
          continue;
        }
        const p = this.indexOne(path, this.backgroundCtl.signal);
        this.inflight.set(path, p);
        await p.finally(() => this.inflight.delete(path));
      }
    } finally {
      this.active--;
      if (this.active === 0) {
        if (this.progress.phase === "running") this.progress.phase = "idle";
        this.progress.current = undefined;
        this.progress.rate = undefined;
        this.emit();
        if (this.queued.size > 0 && this.progress.phase === "idle") this.pump();
      }
    }
  }

  // ---------- Search ----------

  /** Filename search over the loaded tree: files first, then matching folders. */
  findFiles(query: string, limit = 200): TreeEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: { e: TreeEntry; s: number }[] = [];
    for (const e of [...this.tree.files(), ...this.tree.folders()]) {
      const p = e.path.toLowerCase();
      const n = e.name.toLowerCase();
      let s: number;
      if (n === q) s = 0;
      else if (n.startsWith(q)) s = 1;
      else if (n.includes(q)) s = 2;
      else if (p.includes(q)) s = 3;
      else if (subsequence(q, p)) s = 5;
      else continue;
      // Folders rank after files with the same match quality.
      scored.push({ e, s: s * 1000 + p.length + (e.type === "tree" ? 500 : 0) });
    }
    return scored
      .toSorted((a, b) => a.s - b.s)
      .slice(0, limit)
      .map((x) => x.e);
  }

  /** Literal content search over files already fetched in this session. */
  searchText(query: string, opts: { caseSensitive?: boolean; wholeWord?: boolean; limit?: number } = {}): SearchResult {
    const limit = opts.limit ?? 500;
    const matches: SearchMatch[] = [];
    if (!query) return { matches, filesSearched: 0, truncated: false };
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const re = new RegExp(opts.wholeWord ? String.raw`(?<![\w$])${escaped}(?![\w$])` : escaped, opts.caseSensitive ? "g" : "gi");
    let files = 0;
    // Code-unit order, as the default sort gives: stable and locale-independent.
    const paths = [...this.texts.keys()].toSorted(compareCodeUnits);
    for (const path of paths) {
      files++;
      if (collectMatches(path, this.texts.get(path)!, re, matches, limit)) return { matches, filesSearched: files, truncated: true };
    }
    return { matches, filesSearched: files, truncated: false };
  }

  /** Text files a bounded repository scan would fetch. */
  scannableFiles(): TreeEntry[] {
    return this.tree
      .files()
      .filter((f) => !isBinaryPath(f.path) && !isSkippedForIndex(f.path) && (f.size ?? 0) <= LIMITS.maxIndexBytes && !f.mode.startsWith("12"));
  }

  /** Fetches up to LIMITS.maxScanFiles text files so content search covers them. Cancellable. */
  async scanRepository() {
    if (this.scan.phase === "running") return;
    const ctl = new AbortController();
    this.scanCtl = ctl;
    const files = this.scannableFiles().filter((f) => !this.texts.has(f.path)).slice(0, LIMITS.maxScanFiles);
    this.scan = { phase: "running", fetched: 0, total: files.length };
    this.emit();
    let i = 0;
    const worker = async () => {
      while (i < files.length && !ctl.signal.aborted) {
        const f = files[i++];
        try {
          const blob = await this.source.fetchBlob(this.repo, f, ctl.signal);
          this.keepText(f.path, blob.text);
        } catch (e) {
          if (isAbort(e)) return;
          if (toAppError(e).kind === "rate-limit") ctl.abort();
        }
        this.scan = { ...this.scan, fetched: this.scan.fetched + 1 };
        if (this.scan.fetched % 10 === 0) this.emit();
      }
    };
    await Promise.all(Array.from({ length: LIMITS.contentConcurrency }, worker));
    this.scan = { ...this.scan, phase: ctl.signal.aborted ? "cancelled" : "done" };
    this.scanCtl = null;
    this.emit();
  }

  cancelScan() {
    this.scanCtl?.abort();
  }

  dispose() {
    this.backgroundCtl.abort();
    this.scanCtl?.abort();
  }
}

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Adds the matches of `re` in one file's lines; true once `limit` matches are collected. */
function collectMatches(path: string, text: string, re: RegExp, matches: SearchMatch[], limit: number): boolean {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let m = re.exec(lines[i]);
    while (m) {
      matches.push({ path, line: i + 1, col: m.index, length: m[0].length, text: lines[i].slice(0, 400) });
      if (matches.length >= limit) return true;
      if (m[0].length === 0) re.lastIndex++;
      m = re.exec(lines[i]);
    }
  }
  return false;
}

/** The import path a Go target refers to: an import itself, or the package of a qualified type. */
function goImportPath(fi: FileIndex, target: Target): string | undefined {
  if (target.t === "import") return target.importPath;
  if (target.t === "member" && !target.typeRef.startsWith("@") && target.typeRef.includes(".")) {
    const alias = target.typeRef.split(".")[0];
    return fi.imports.find((i) => i.alias === alias)?.path;
  }
  return undefined;
}

function subsequence(q: string, s: string): boolean {
  let j = 0;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) j++;
  return j === q.length;
}
