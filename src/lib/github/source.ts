import { AppError, isAbort } from "../errors";
import { getKV, type KV } from "../cache/db";
import { Limiter, throwIfAborted } from "../util/limiter";
import { isBinaryPath, isGeneratedSource, isLfsPointer, LIMITS, looksBinary } from "../util/files";
import { GitHubClient, getGitHubClient } from "./client";
import { FULL_SHA_RE, SHORT_SHA_RE, type ParsedRepoUrl } from "./parseGithubUrl";
import { RepoTree, type GitTreeItem, type TreeEntry } from "./tree";

export type RefType = "branch" | "tag" | "commit";

export interface ResolvedRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Branch or tag name, or the commit SHA the visitor asked for. */
  refName: string;
  refType: RefType;
  /** Immutable commit for this session. */
  commitSha: string;
  /** File or directory path inside the repository ("" for the root). */
  path: string;
  description?: string;
  htmlUrl: string;
}

export interface RepoRefs {
  branches: string[];
  tags: string[];
}

export interface BlobResult {
  text: string;
  sha: string;
  size: number;
  generated: boolean;
  /** Where the content came from on this request. */
  from: "cache" | "raw" | "api";
}

export interface RepositorySource {
  resolve(parsed: ParsedRepoUrl, signal?: AbortSignal): Promise<ResolvedRepo>;
  loadTree(repo: ResolvedRepo, signal?: AbortSignal): Promise<RepoTree>;
  loadDirectory(repo: ResolvedRepo, tree: RepoTree, dirPath: string, signal?: AbortSignal): Promise<void>;
  /** Fetches many file contents at once into the blob cache (Git transport). Optional. */
  prefetchBlobs?(repo: ResolvedRepo, entries: TreeEntry[], signal?: AbortSignal): Promise<void>;
  /** Loads a whole folder subtree in one request (large repositories). Optional. */
  loadSubtree?(repo: ResolvedRepo, tree: RepoTree, dirPath: string, signal?: AbortSignal): Promise<void>;
  /** Makes sure every directory on the way to `path` is loaded (lazy trees). */
  ensurePath(repo: ResolvedRepo, tree: RepoTree, path: string, signal?: AbortSignal): Promise<TreeEntry | undefined>;
  fetchBlob(repo: ResolvedRepo, entry: TreeEntry, signal?: AbortSignal): Promise<BlobResult>;
  /** Local folders: the file's current version, or null when it did not change. Optional. */
  checkFile?(repo: ResolvedRepo, entry: TreeEntry): Promise<TreeEntry | null>;
  /** The commit a branch points to now (to offer an update). Optional. */
  headOf?(repo: ResolvedRepo, branch: string, signal?: AbortSignal): Promise<string | null>;
  /** Branches whose latest commit is `sha` (to name a pinned commit). Optional. */
  branchesAt?(repo: ResolvedRepo, sha: string, signal?: AbortSignal): Promise<string[]>;
  /** Branches and tags of the repository (for switching). Optional. */
  listRefs?(repo: ResolvedRepo, signal?: AbortSignal): Promise<RepoRefs>;
  /** Local folders: whether files can be saved back (folder handle, supporting browser). Optional. */
  canWrite?(repo: ResolvedRepo): Promise<boolean>;
  /** Local folders: saves a text file (asks for write access first) and returns its new entry. Optional. */
  writeFile?(repo: ResolvedRepo, path: string, text: string): Promise<TreeEntry>;
  /** URLs an image can be shown from, best first (a blob: URL for local files). Optional. */
  imageUrls?(repo: ResolvedRepo, entry: TreeEntry): Promise<string[]>;
  githubUrl(repo: ResolvedRepo, path?: string, kind?: "blob" | "tree", lines?: { start: number; end: number }): string;
}

interface RepoResponse {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  description: string | null;
  html_url: string;
  private: boolean;
  size: number;
}

interface RefResponse {
  ref: string;
  object: { sha: string; type: "commit" | "tag" | "tree" | "blob" };
}

interface TreeResponse {
  sha: string;
  tree: GitTreeItem[];
  truncated: boolean;
}

export interface GitHubSourceOptions {
  client?: GitHubClient;
  kv?: KV;
  fetch?: typeof fetch;
  rawBase?: string;
  /** "raw-first" uses raw.githubusercontent.com and falls back to the REST blob API. */
  contentMode?: "raw-first" | "api";
}

export class GitHubSource implements RepositorySource {
  private readonly client: GitHubClient;
  private readonly kvOverride?: KV;
  private readonly fetchImpl: typeof fetch;
  private readonly rawBase: string;
  contentMode: "raw-first" | "api";
  private readonly contentLimiter = new Limiter(LIMITS.contentConcurrency);
  /** Set once raw content fetches fail (for example CORS), to stop retrying them. */
  private rawBroken = false;

  constructor(opts: GitHubSourceOptions = {}) {
    this.client = opts.client ?? getGitHubClient();
    this.kvOverride = opts.kv;
    this.fetchImpl = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.rawBase = (opts.rawBase ?? "https://raw.githubusercontent.com").replace(/\/$/, "");
    this.contentMode = opts.contentMode ?? "raw-first";
  }

  private get kv(): KV {
    return this.kvOverride ?? getKV();
  }

  private async repoInfo(parsed: ParsedRepoUrl, signal?: AbortSignal): Promise<RepoResponse> {
    try {
      return await this.client.request<RepoResponse>(`/repos/${enc(parsed.owner)}/${enc(parsed.repo)}`, { signal });
    } catch (e) {
      if (e instanceof AppError && e.kind === "not-found" && e.details.status !== 409) {
        throw new AppError(
          "not-found",
          `${parsed.owner}/${parsed.repo} does not exist, or it is private. CoderImpact can only open public repositories.`,
          { status: 404 },
        );
      }
      throw e;
    }
  }

  async resolve(parsed: ParsedRepoUrl, signal?: AbortSignal): Promise<ResolvedRepo> {
    const info = await this.repoInfo(parsed, signal);
    const owner = info.owner.login;
    const repo = info.name;
    const base = {
      owner,
      repo,
      defaultBranch: info.default_branch,
      description: info.description ?? undefined,
      htmlUrl: info.html_url,
    };

    if (parsed.refAndPath.length === 0) {
      const sha = await this.branchSha(owner, repo, info.default_branch, signal);
      return { ...base, refName: info.default_branch, refType: "branch", commitSha: sha, path: "" };
    }

    const segments = parsed.refAndPath;
    const first = segments[0];

    // A commit SHA as the ref.
    if (SHORT_SHA_RE.test(first)) {
      const sha = await this.commitSha(owner, repo, first, signal).catch((e) => {
        if (e instanceof AppError && e.kind === "not-found") return null;
        throw e;
      });
      if (sha) {
        return { ...base, refName: FULL_SHA_RE.test(first) ? sha : first, refType: "commit", commitSha: sha, path: segments.slice(1).join("/") };
      }
    }

    // Branch or tag names may contain slashes: ask GitHub which refs start with
    // the first segment and keep those that match a prefix of the segments.
    const [heads, tags] = await Promise.all([
      this.matchingRefs(owner, repo, "heads", first, signal),
      this.matchingRefs(owner, repo, "tags", first, signal),
    ]);
    const candidates = refCandidates(heads, tags, segments);
    if (candidates.length === 0) {
      throw new AppError("not-found", `No branch, tag or commit named "${first}" exists in ${owner}/${repo}.`);
    }
    if (candidates.length > 1) {
      throw new AppError(
        "ambiguous-ref",
        "This link matches more than one branch or tag, so the file path is ambiguous. Pick the one you meant.",
        { candidates: candidates.map((c) => `${c.type}:${c.name}`) },
      );
    }
    const c = candidates[0];
    const sha = await this.peel(owner, repo, c.ref.object, signal);
    return { ...base, refName: c.name, refType: c.type, commitSha: sha, path: segments.slice(c.depth).join("/") };
  }

  private async branchSha(owner: string, repo: string, branch: string, signal?: AbortSignal): Promise<string> {
    const r = await this.client.request<RefResponse>(
      `/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${branch.split("/").map(enc).join("/")}`,
      { signal },
    );
    return this.peel(owner, repo, r.object, signal);
  }

  private async commitSha(owner: string, repo: string, ref: string, signal?: AbortSignal): Promise<string> {
    const text = await this.client.request<string>(`/repos/${enc(owner)}/${enc(repo)}/commits/${enc(ref)}`, {
      signal,
      accept: "application/vnd.github.sha",
      text: true,
      immutable: FULL_SHA_RE.test(ref),
    });
    const sha = text.trim();
    if (!FULL_SHA_RE.test(sha)) throw new AppError("not-found", `Commit ${ref} was not found.`);
    return sha;
  }

  private async matchingRefs(owner: string, repo: string, ns: "heads" | "tags", prefix: string, signal?: AbortSignal) {
    return this.client.request<RefResponse[]>(
      `/repos/${enc(owner)}/${enc(repo)}/git/matching-refs/${ns}/${enc(prefix)}`,
      { signal },
    );
  }

  /** Follows annotated tags to the commit they point at. */
  private async peel(owner: string, repo: string, obj: RefResponse["object"], signal?: AbortSignal): Promise<string> {
    let cur = obj;
    for (let i = 0; i < 5 && cur.type === "tag"; i++) {
      const tag = await this.client.request<{ object: RefResponse["object"] }>(
        `/repos/${enc(owner)}/${enc(repo)}/git/tags/${cur.sha}`,
        { signal, immutable: true },
      );
      cur = tag.object;
    }
    return cur.sha;
  }

  async loadTree(repo: ResolvedRepo, signal?: AbortSignal): Promise<RepoTree> {
    const base = `/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/trees/${repo.commitSha}`;
    const res = await this.client.request<TreeResponse>(`${base}?recursive=1`, { signal, immutable: true });
    if (!res.truncated) {
      if (res.tree.length > LIMITS.maxTreeEntries) {
        throw new AppError("repo-too-large", `This repository has ${res.tree.length.toLocaleString()} files, more than CoderImpact can browse.`);
      }
      return RepoTree.fromRecursive(res.tree);
    }
    // GitHub truncated the recursive listing (100,000 entries or 7 MB). Keep what it
    // returned and complete it within a small request budget: listings of the
    // folders on the cut-off path, and whole subtrees of the folders after it.
    const tree = RepoTree.fromTruncated(res.tree);
    await this.completeTree(repo, tree, signal).catch(() => undefined);
    return tree;
  }

  /** Extra API requests spent completing a truncated tree when a repository opens. */
  static readonly TREE_COMPLETION_BUDGET = 8;

  private async completeTree(repo: ResolvedRepo, tree: RepoTree, signal?: AbortSignal) {
    let budget = GitHubSource.TREE_COMPLETION_BUDGET;
    const base = `/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/trees`;
    const shaOf = (dir: string) => (dir === "" ? repo.commitSha : tree.get(dir)?.sha);
    const depth = (p: string) => (p === "" ? 0 : p.split("/").length);
    while (budget > 0) {
      // Shallow folders first: a partly listed folder is completed with one listing,
      // an unlisted folder with one recursive request for its whole subtree.
      const jobs = [
        ...tree.incompleteDirs().map((path) => ({ path, recursive: false })),
        ...tree.pendingDirs().map((e) => ({ path: e.path, recursive: true })),
      ].sort((a, b) => depth(a.path) - depth(b.path) || Number(a.recursive) - Number(b.recursive) || a.path.localeCompare(b.path));
      const job = jobs[0];
      if (!job || depth(job.path) > 2) break;
      const sha = shaOf(job.path);
      if (!sha) break;
      const r = await this.client.request<TreeResponse>(`${base}/${sha}${job.recursive ? "?recursive=1" : ""}`, { signal, immutable: true });
      budget--;
      if (job.recursive) tree.addRecursive(job.path, r.tree, r.truncated);
      else tree.addDirectory(job.path, r.tree);
    }
  }

  async loadDirectory(repo: ResolvedRepo, tree: RepoTree, dirPath: string, signal?: AbortSignal): Promise<void> {
    if (tree.isLoaded(dirPath)) return;
    const entry = tree.get(dirPath);
    if (entry?.type !== "tree") throw new AppError("not-found", `Folder ${dirPath} was not found.`);
    const res = await this.client.request<TreeResponse>(
      `/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/trees/${entry.sha}`,
      { signal, immutable: true },
    );
    tree.addDirectory(dirPath, res.tree);
  }

  async loadSubtree(repo: ResolvedRepo, tree: RepoTree, dirPath: string, signal?: AbortSignal): Promise<void> {
    const entry = tree.get(dirPath);
    if (entry?.type !== "tree") return;
    const res = await this.client.request<TreeResponse>(
      `/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/trees/${entry.sha}?recursive=1`,
      { signal, immutable: true },
    );
    tree.addRecursive(dirPath, res.tree, res.truncated);
  }

  async ensurePath(repo: ResolvedRepo, tree: RepoTree, path: string, signal?: AbortSignal) {
    if (!path) return undefined;
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!tree.isLoaded(dir)) {
        if (!tree.get(dir)) return undefined;
        await this.loadDirectory(repo, tree, dir, signal);
      }
    }
    return tree.get(path);
  }

  async fetchBlob(repo: ResolvedRepo, entry: TreeEntry, signal?: AbortSignal): Promise<BlobResult> {
    if (entry.type === "commit") {
      throw new AppError("submodule", `${entry.name} is a Git submodule that points to another repository.`);
    }
    if (entry.type !== "blob") throw new AppError("not-found", `${entry.path} is a folder.`);
    if (isBinaryPath(entry.path)) {
      throw new AppError("binary", `${entry.path} is a binary file. CoderImpact shows text files only.`);
    }
    if ((entry.size ?? 0) > LIMITS.maxDisplayBytes) {
      throw new AppError("too-large", `${entry.path} is larger than ${Math.round(LIMITS.maxDisplayBytes / 1000)} KB, so CoderImpact does not load it.`, {
        size: entry.size,
      });
    }
    const key = `gh:${entry.sha}`;
    const cached = await this.kv.get<{ text: string; size: number; generated: boolean }>("blobs", key);
    if (cached && cached.size <= LIMITS.maxDisplayBytes) return { ...cached, sha: entry.sha, from: "cache" };

    const { bytes, from } = await this.contentLimiter.run(() => this.download(repo, entry, signal), signal);
    if (looksBinary(bytes)) {
      throw new AppError("binary", `${entry.path} is a binary file. CoderImpact shows text files only.`);
    }
    if (bytes.length > LIMITS.maxDisplayBytes) {
      // Git file lists carry no sizes, so the limit is also checked after download.
      throw new AppError("too-large", `${entry.path} is larger than ${Math.round(LIMITS.maxDisplayBytes / 1000)} KB, so CoderImpact does not load it.`, { size: bytes.length });
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    if (isLfsPointer(text)) {
      throw new AppError("lfs", `${entry.path} is stored with Git LFS. Only the pointer file is in the repository.`);
    }
    const value = { text, size: bytes.length, generated: isGeneratedSource(text) };
    await this.kv.put("blobs", key, value).catch(() => undefined);
    return { ...value, sha: entry.sha, from };
  }

  async imageUrls(repo: ResolvedRepo, entry: TreeEntry): Promise<string[]> {
    const path = entry.path.split("/").map(enc).join("/");
    return [
      `${this.rawBase}/${enc(repo.owner)}/${enc(repo.repo)}/${repo.commitSha}/${path}`,
      // Images stored with Git LFS are served from the media host.
      `https://media.githubusercontent.com/media/${enc(repo.owner)}/${enc(repo.repo)}/${repo.commitSha}/${path}`,
    ];
  }

  private async download(repo: ResolvedRepo, entry: TreeEntry, signal?: AbortSignal) {
    throwIfAborted(signal);
    if (this.contentMode === "raw-first" && !this.rawBroken) {
      const url = `${this.rawBase}/${enc(repo.owner)}/${enc(repo.repo)}/${repo.commitSha}/${entry.path.split("/").map(enc).join("/")}`;
      try {
        const res = await this.fetchImpl(url, { signal, credentials: "omit" });
        if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), from: "raw" as const };
        if (res.status !== 404) this.rawBroken = res.status === 403 || res.status === 429;
      } catch (e) {
        if (isAbort(e)) throw e;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          throw new AppError("offline", "You are offline and this file is not cached yet.");
        }
        // Likely a CORS or network block: use the REST API from now on.
        this.rawBroken = true;
      }
    }
    const text = await this.client.request<string>(
      `/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/blobs/${entry.sha}`,
      { signal, accept: "application/vnd.github.raw", text: true, immutable: true },
    );
    return { bytes: new TextEncoder().encode(text), from: "api" as const };
  }

  githubUrl(repo: ResolvedRepo, path = "", kind: "blob" | "tree" = "blob", lines?: { start: number; end: number }) {
    return githubUrl(repo, path, kind, lines);
  }
}

function enc(s: string) {
  return encodeURIComponent(s);
}

/** The github.com URL for a file, folder or line range at the session's commit. */
export function githubUrl(
  repo: Pick<ResolvedRepo, "owner" | "repo" | "commitSha">,
  path = "",
  kind: "blob" | "tree" = "blob",
  lines?: { start: number; end: number },
): string {
  if (repo.owner === "~") return ""; // a local folder
  const base = `https://github.com/${repo.owner}/${repo.repo}`;
  if (!path) return kind === "tree" ? `${base}/tree/${repo.commitSha}` : base;
  return `${base}/${kind}/${repo.commitSha}/${path.split("/").map(enc).join("/")}${lineAnchor(lines)}`;
}

function lineAnchor(lines?: { start: number; end: number }): string {
  if (!lines) return "";
  return lines.start === lines.end ? `#L${lines.start}` : `#L${lines.start}-L${lines.end}`;
}

/** Keeps the branches and tags whose (slash-separated) name is a prefix of the URL segments. */
function refCandidates(heads: RefResponse[], tags: RefResponse[], segments: string[]): { name: string; type: "branch" | "tag"; ref: RefResponse; depth: number }[] {
  const candidates: { name: string; type: "branch" | "tag"; ref: RefResponse; depth: number }[] = [];
  for (const [list, type] of [[heads, "branch"], [tags, "tag"]] as const) {
    for (const r of list) {
      const name = r.ref.replace(/^refs\/(heads|tags)\//, "");
      const parts = name.split("/");
      if (parts.length <= segments.length && parts.every((p, i) => p === segments[i])) {
        candidates.push({ name, type, ref: r, depth: parts.length });
      }
    }
  }
  return candidates;
}

let sharedSource: GitHubSource | null = null;
export function getSource(): GitHubSource {
  sharedSource ??= new GitHubSource();
  return sharedSource;
}
