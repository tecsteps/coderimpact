import { AppError } from "../errors";
import { baseUrl, type SnapshotInfo } from "../config";
import { isBinaryPath, isGeneratedSource, LIMITS } from "../util/files";
import type { ParsedRepoUrl } from "./parseGithubUrl";
import { githubUrl, type BlobResult, type RepositorySource, type ResolvedRepo } from "./source";
import { RepoTree, type GitTreeItem, type TreeEntry } from "./tree";

/** File format written by scripts/build-snapshot.mjs. */
export interface RepoSnapshot {
  owner: string;
  repo: string;
  defaultBranch: string;
  refName: string;
  commitSha: string;
  description?: string;
  htmlUrl: string;
  createdAt: string;
  tree: GitTreeItem[];
  /** Text content by path. Files missing here were too large, binary or skipped. */
  files: Record<string, string>;
}

/**
 * A RepositorySource backed by bundled snapshots of public repositories at a
 * pinned commit. Used where the page cannot reach GitHub (the claude.ai
 * Artifact build). Everything else in the reader is identical.
 */
export class SnapshotSource implements RepositorySource {
  private readonly snapshots: SnapshotInfo[];
  private readonly loaded = new Map<string, Promise<RepoSnapshot>>();

  constructor(snapshots: SnapshotInfo[]) {
    this.snapshots = snapshots;
  }

  list(): SnapshotInfo[] {
    return this.snapshots;
  }

  private info(owner: string, repo: string): SnapshotInfo | undefined {
    return this.snapshots.find((s) => s.owner.toLowerCase() === owner.toLowerCase() && s.repo.toLowerCase() === repo.toLowerCase());
  }

  private load(info: SnapshotInfo): Promise<RepoSnapshot> {
    const key = `${info.owner}/${info.repo}`;
    let p = this.loaded.get(key);
    if (!p) {
      p = fetch(baseUrl(info.file)).then((r) => {
        if (!r.ok) throw new AppError("not-found", `The snapshot of ${key} could not be loaded.`);
        return r.json() as Promise<RepoSnapshot>;
      });
      this.loaded.set(key, p);
      p.catch(() => this.loaded.delete(key));
    }
    return p;
  }

  async resolve(parsed: ParsedRepoUrl): Promise<ResolvedRepo> {
    const info = this.info(parsed.owner, parsed.repo);
    if (!info) {
      const names = this.snapshots.map((s) => `${s.owner}/${s.repo}`).join(" and ");
      throw new AppError(
        "not-found",
        `This demo runs inside a claude.ai Artifact, which cannot reach GitHub, so it includes snapshots of ${names} only. The deployed app opens any public repository.`,
      );
    }
    const snap = await this.load(info);
    const base = {
      owner: snap.owner,
      repo: snap.repo,
      defaultBranch: snap.defaultBranch,
      refName: snap.refName,
      refType: "branch" as const,
      commitSha: snap.commitSha,
      description: snap.description,
      htmlUrl: snap.htmlUrl,
    };
    const segs = parsed.refAndPath;
    if (segs.length === 0) return { ...base, path: "" };
    const first = segs[0];
    if (snap.commitSha.startsWith(first) && first.length >= 7) return { ...base, path: segs.slice(1).join("/") };
    const refParts = snap.refName.split("/");
    if (refParts.every((p, i) => segs[i] === p)) return { ...base, path: segs.slice(refParts.length).join("/") };
    throw new AppError("not-found", `This snapshot contains ${snap.refName} at ${snap.commitSha.slice(0, 7)} only.`);
  }

  async loadTree(repo: ResolvedRepo): Promise<RepoTree> {
    const info = this.info(repo.owner, repo.repo);
    if (!info) throw new AppError("not-found", "Snapshot not found.");
    const snap = await this.load(info);
    return RepoTree.fromRecursive(snap.tree);
  }

  async loadDirectory(): Promise<void> {
    /* snapshots are complete */
  }

  async ensurePath(_repo: ResolvedRepo, tree: RepoTree, path: string) {
    return tree.get(path);
  }

  async fetchBlob(repo: ResolvedRepo, entry: TreeEntry): Promise<BlobResult> {
    if (entry.type === "commit") throw new AppError("submodule", `${entry.name} is a Git submodule that points to another repository.`);
    if (isBinaryPath(entry.path)) throw new AppError("binary", `${entry.path} is a binary file. Coderimpact shows text files only.`);
    if ((entry.size ?? 0) > LIMITS.maxDisplayBytes) {
      throw new AppError("too-large", `${entry.path} is larger than ${Math.round(LIMITS.maxDisplayBytes / 1000)} KB, so Coderimpact does not load it.`, { size: entry.size });
    }
    const info = this.info(repo.owner, repo.repo)!;
    const snap = await this.load(info);
    const text = snap.files[entry.path];
    if (text === undefined) {
      throw new AppError("not-found", `${entry.path} is not included in this snapshot (large, binary or generated files are left out).`);
    }
    return { text, sha: entry.sha, size: text.length, generated: isGeneratedSource(text), from: "cache" };
  }

  githubUrl(repo: ResolvedRepo, path = "", kind: "blob" | "tree" = "blob", lines?: { start: number; end: number }) {
    return githubUrl(repo, path, kind, lines);
  }
}
