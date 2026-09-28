import { AppError } from "../errors";
import { Limiter } from "../util/limiter";
import { isBinaryPath, isGeneratedSource, LIMITS, looksBinary } from "../util/files";
import { FULL_SHA_RE, type ParsedRepoUrl } from "../github/parseGithubUrl";
import type { BlobResult, RepositorySource, ResolvedRepo } from "../github/source";
import { RepoTree, type GitTreeItem, type TreeEntry } from "../github/tree";
import { canWriteProject, LOCAL_OWNER, listProjects, requestWriteAccess, rootFor, setListing, type LocalRoot } from "./projects";

/**
 * Folders that are listed only when opened: dependencies, build output and
 * caches. `.git` is never listed.
 */
const LAZY_DIRS = new Set([
  "node_modules", "vendor", "bower_components", ".venv", "venv", "__pycache__", "target", "dist", "build", "out",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".gradle", ".idea", ".vscode", "coverage", "Pods", "DerivedData",
]);
const HIDDEN = new Set([".git", ".DS_Store"]);
/** Upper bound for the initial listing, so a home folder picked by mistake stays usable. */
const MAX_ENTRIES = 150_000;

/** Stable 40-hex id for a file version: changes when the file is saved again. */
export function localSha(path: string, size: number, lastModified: number): string {
  const input = `${path}\0${size}\0${lastModified}`;
  let out = "";
  for (let seed = 0; seed < 5; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b1);
    for (let i = 0; i < input.length; i++) {
      h ^= input.codePointAt(i)!;
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

function blobItem(path: string, fullPath: string, size = 0, lastModified = 0): GitTreeItem & { type: "blob" } {
  return { path, mode: "100644", type: "blob", sha: localSha(fullPath, size, lastModified), size };
}

/**
 * A RepositorySource for a folder on this computer. Files are read from disk
 * on demand and never cached or uploaded; the per-file semantic index is
 * cached by a content version id (path, size, modification time), so saved
 * changes are indexed again.
 */
export class LocalSource implements RepositorySource {
  private readonly limiter = new Limiter(32);

  async resolve(parsed: ParsedRepoUrl): Promise<ResolvedRepo> {
    let id = parsed.refAndPath[0];
    let rest = parsed.refAndPath.slice(1);
    if (!id || !FULL_SHA_RE.test(id)) {
      // /~/<name>: the most recently opened folder with that name.
      const match = (await listProjects()).find((p) => p.slug.toLowerCase() === parsed.repo.toLowerCase());
      if (!match) throw new AppError("not-found", `No local folder named ${parsed.repo} was opened in this browser.`);
      id = match.id;
      rest = [];
    }
    const { project } = await rootFor(id);
    return {
      owner: LOCAL_OWNER,
      repo: project.slug,
      defaultBranch: "local",
      refName: "local",
      refType: "commit",
      commitSha: id,
      path: rest.join("/"),
      description: project.name !== project.slug ? project.name : undefined,
      htmlUrl: "",
    };
  }

  private async root(repo: ResolvedRepo): Promise<LocalRoot> {
    return (await rootFor(repo.commitSha)).root;
  }

  /** Recursive listing of `dir` (relative paths), leaving heavy folders unlisted. */
  private async walk(root: LocalRoot, dir: string, lazyAtTop: boolean, onProgress?: (entries: number) => void): Promise<{ items: GitTreeItem[]; lazy: string[] }> {
    let lastReport = 0;
    const items: GitTreeItem[] = [];
    const lazy: string[] = [];
    const prefix = dir ? dir + "/" : "";
    const report = () => {
      if (onProgress && Date.now() - lastReport > 120) {
        lastReport = Date.now();
        onProgress(items.length);
      }
    };
    const visit = async (rel: string): Promise<void> => {
      if (items.length > MAX_ENTRIES) return;
      const entries = await this.limiter.run(() => root.list(rel ? prefix + rel : dir)).catch(() => []);
      const subdirs: string[] = [];
      for (const e of entries) {
        if (HIDDEN.has(e.name)) continue;
        const path = rel ? `${rel}/${e.name}` : e.name;
        if (e.kind === "directory") {
          items.push({ path, mode: "040000", type: "tree", sha: "" });
          if (lazyAtTop && LAZY_DIRS.has(e.name)) lazy.push(path);
          else subdirs.push(path);
        } else items.push(blobItem(path, prefix + path, e.size, e.lastModified));
      }
      report();
      await Promise.all(subdirs.map(visit));
    };
    await visit("");
    return { items, lazy };
  }

  async loadTree(repo: ResolvedRepo): Promise<RepoTree> {
    const root = await this.root(repo);
    setListing({ phase: "listing", entries: 0 });
    try {
      const { items, lazy } = await this.walk(root, "", true, (n) => setListing({ phase: "listing", entries: n }));
      return RepoTree.fromLocal(items, lazy, items.length > MAX_ENTRIES);
    } finally {
      setListing({ phase: "idle", entries: 0 });
    }
  }

  async loadDirectory(repo: ResolvedRepo, tree: RepoTree, dirPath: string): Promise<void> {
    const root = await this.root(repo);
    const entries = await root.list(dirPath);
    const prefix = dirPath ? dirPath + "/" : "";
    tree.addDirectory(
      dirPath,
      entries
        .filter((e) => !HIDDEN.has(e.name))
        .map((e) =>
          e.kind === "directory"
            ? { path: e.name, mode: "040000", type: "tree" as const, sha: "" }
            : blobItem(e.name, prefix + e.name, e.size, e.lastModified),
        ),
    );
  }

  /** Lists a whole unlisted folder, e.g. `vendor/` when a PHP class lives there. */
  async loadSubtree(repo: ResolvedRepo, tree: RepoTree, dirPath: string): Promise<void> {
    const root = await this.root(repo);
    const { items } = await this.walk(root, dirPath, false);
    tree.addRecursive(dirPath, items, false);
  }

  async ensurePath(repo: ResolvedRepo, tree: RepoTree, path: string): Promise<TreeEntry | undefined> {
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!tree.isLoaded(dir)) await this.loadDirectory(repo, tree, dir);
    }
    return tree.get(path);
  }

  async fetchBlob(repo: ResolvedRepo, entry: TreeEntry): Promise<BlobResult> {
    if (entry.type !== "blob") throw new AppError("not-found", `${entry.path} is a folder.`);
    if (isBinaryPath(entry.path)) throw new AppError("binary", `${entry.path} is a binary file. CoderImpact shows text files only.`);
    if ((entry.size ?? 0) > LIMITS.maxDisplayBytes) {
      throw new AppError("too-large", `${entry.path} is larger than ${Math.round(LIMITS.maxDisplayBytes / 1000)} KB, so CoderImpact does not load it.`, { size: entry.size });
    }
    const root = await this.root(repo);
    const file = await this.limiter.run(() => root.read(entry.path)).catch((e) => {
      throw e instanceof AppError ? e : new AppError("not-found", `${entry.path} could not be read. It may have been moved or deleted; reload the folder.`);
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksBinary(bytes)) throw new AppError("binary", `${entry.path} is a binary file. CoderImpact shows text files only.`);
    if (bytes.length > LIMITS.maxDisplayBytes) {
      throw new AppError("too-large", `${entry.path} is larger than ${Math.round(LIMITS.maxDisplayBytes / 1000)} KB, so CoderImpact does not load it.`, { size: bytes.length });
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    return { text, sha: entry.sha, size: bytes.length, generated: isGeneratedSource(text), from: "cache" };
  }

  async checkFile(repo: ResolvedRepo, entry: TreeEntry): Promise<TreeEntry | null> {
    const file = await (await this.root(repo)).read(entry.path);
    const sha = localSha(entry.path, file.size, file.lastModified);
    return sha === entry.sha ? null : { ...entry, sha, size: file.size };
  }

  canWrite(repo: ResolvedRepo): Promise<boolean> {
    return canWriteProject(repo.commitSha);
  }

  async writeFile(repo: ResolvedRepo, path: string, text: string): Promise<TreeEntry> {
    if (!(await requestWriteAccess(repo.commitSha))) {
      throw new AppError("local-access", "Saving needs permission to change files in this folder. Your browser asks once; nothing is uploaded.");
    }
    const root = await this.root(repo);
    if (!root.write) throw new AppError("local-access", "This folder was opened in a way that cannot save files. Choose it again with Open a local folder.");
    const file = await root.write(path, text);
    return { ...blobItem(path, path, file.size, file.lastModified), name: path.slice(path.lastIndexOf("/") + 1) } as TreeEntry;
  }

  async imageUrls(repo: ResolvedRepo, entry: TreeEntry): Promise<string[]> {
    const file = await (await this.root(repo)).read(entry.path);
    return [URL.createObjectURL(file)];
  }

  githubUrl(): string {
    return "";
  }
}
