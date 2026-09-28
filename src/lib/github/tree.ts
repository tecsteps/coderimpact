export type EntryType = "blob" | "tree" | "commit";

export interface TreeEntry {
  path: string;
  name: string;
  type: EntryType;
  sha: string;
  size?: number;
  mode: string;
}

export interface GitTreeItem {
  path: string;
  mode: string;
  type: EntryType;
  sha: string;
  size?: number;
}

/** One collator for every comparison: localeCompare with options builds one per call. */
const NAME_ORDER = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function sortEntries(a: TreeEntry, b: TreeEntry) {
  const ad = a.type === "tree" ? 0 : 1;
  const bd = b.type === "tree" ? 0 : 1;
  if (ad !== bd) return ad - bd;
  return NAME_ORDER.compare(a.name, b.name);
}

/**
 * A repository file tree. Either complete (from a recursive, non-truncated
 * response) or lazy, where directories are loaded one level at a time.
 */
export class RepoTree {
  /** True when every directory is loaded. */
  complete: boolean;
  private readonly children = new Map<string, TreeEntry[]>();
  private readonly entries = new Map<string, TreeEntry>();
  /** Folders whose listing is known to be incomplete (on the path where GitHub cut off). */
  private readonly incomplete = new Set<string>();
  /** Set when GitHub reported a truncated recursive tree. */
  readonly truncated: boolean;

  constructor(opts: { complete: boolean; truncated: boolean }) {
    this.complete = opts.complete;
    this.truncated = opts.truncated;
  }

  static fromRecursive(items: GitTreeItem[]): RepoTree {
    const t = new RepoTree({ complete: true, truncated: false });
    t.mergeListing("", items);
    return t;
  }

  /**
   * A local folder: everything listed except `lazyDirs` (dependencies, build
   * output), which are listed when opened.
   */
  static fromLocal(items: GitTreeItem[], lazyDirs: string[], truncated: boolean): RepoTree {
    const t = RepoTree.fromRecursive(items);
    for (const d of lazyDirs) t.children.delete(d);
    t.complete = lazyDirs.length === 0 && !truncated;
    return t;
  }

  static lazy(rootItems: GitTreeItem[], truncated: boolean): RepoTree {
    const t = new RepoTree({ complete: false, truncated });
    t.addDirectory("", rootItems);
    return t;
  }

  /**
   * Starts from GitHub's truncated recursive listing. Everything listed before
   * the cut-off is complete; the folders on the path to the last entry are
   * only partly listed and are completed later.
   */
  static fromTruncated(items: GitTreeItem[]): RepoTree {
    const t = new RepoTree({ complete: false, truncated: true });
    t.addRecursive("", items, true);
    return t;
  }

  /**
   * Merges a recursive listing of `dirPath`. When `truncated`, the folders on
   * the path to the last entry stay marked incomplete.
   */
  addRecursive(dirPath: string, items: GitTreeItem[], truncated: boolean) {
    this.mergeListing(dirPath, items);
    this.incomplete.delete(dirPath);
    const lastItem = items.at(-1);
    if (truncated && lastItem) this.markCutOff(dirPath, lastItem);
  }

  /** Records every entry of a recursive listing of `dirPath` and sets each folder's children. */
  private mergeListing(dirPath: string, items: GitTreeItem[]) {
    const byDir = new Map<string, TreeEntry[]>();
    byDir.set(dirPath, []);
    for (const it of items) {
      const entry = toEntry(it, dirPath);
      this.entries.set(entry.path, entry);
      const dir = parentOf(entry.path);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(entry);
      if (entry.type === "tree" && !byDir.has(entry.path)) byDir.set(entry.path, []);
    }
    for (const [dir, list] of byDir) this.children.set(dir, list.toSorted(sortEntries));
  }

  /** Marks the folders around the entry where a truncated listing stopped. */
  private markCutOff(dirPath: string, lastItem: GitTreeItem) {
    const last = toEntry(lastItem, dirPath).path;
    // The last entry's folder and all its ancestors (up to dirPath) are only partly listed.
    let d = parentOf(last);
    for (;;) {
      this.incomplete.add(d);
      if (d === dirPath || d === "") break;
      d = parentOf(d);
    }
    // A listed folder with no entries after the cut-off is unknown, not empty.
    if (lastItem.type === "tree") this.children.delete(last);
  }

  /** Folders known to exist whose listing is not loaded yet. */
  pendingDirs(): TreeEntry[] {
    const out: TreeEntry[] = [];
    for (const e of this.entries.values()) if (e.type === "tree" && !this.isLoaded(e.path)) out.push(e);
    return out;
  }

  /** All folder entries currently known. */
  folders(): TreeEntry[] {
    const out: TreeEntry[] = [];
    for (const e of this.entries.values()) if (e.type === "tree") out.push(e);
    return out;
  }

  /** Incomplete folders, shallowest first. */
  incompleteDirs(): string[] {
    return [...this.incomplete].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  }

  /** Adds one directory level from a non-recursive tree response. */
  addDirectory(dirPath: string, items: GitTreeItem[]) {
    const list = items.map((it) => toEntry(it, dirPath)).sort(sortEntries);
    for (const e of list) this.entries.set(e.path, e);
    this.children.set(dirPath, list);
    this.incomplete.delete(dirPath);
  }

  /** Replaces one entry (a local file saved again). */
  updateEntry(entry: TreeEntry) {
    this.entries.set(entry.path, entry);
    const dir = parentOf(entry.path);
    const list = this.children.get(dir);
    if (list) this.children.set(dir, list.map((e) => (e.path === entry.path ? entry : e)));
  }

  isLoaded(dirPath: string): boolean {
    return this.children.has(dirPath) && !this.incomplete.has(dirPath);
  }

  list(dirPath: string): TreeEntry[] | undefined {
    return this.children.get(dirPath);
  }

  get(path: string): TreeEntry | undefined {
    return this.entries.get(path);
  }

  /** All file (blob) entries currently known. */
  files(): TreeEntry[] {
    const out: TreeEntry[] = [];
    for (const e of this.entries.values()) if (e.type === "blob") out.push(e);
    return out;
  }

  get size(): number {
    return this.entries.size;
  }

}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function toEntry(it: GitTreeItem, dirPath: string): TreeEntry {
  const path = dirPath ? `${dirPath}/${it.path}` : it.path;
  const i = path.lastIndexOf("/");
  return { path, name: i >= 0 ? path.slice(i + 1) : path, type: it.type, sha: it.sha, size: it.size, mode: it.mode };
}
