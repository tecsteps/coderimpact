import { AppError, isAppError } from "../errors";
import { baseUrl } from "../config";
import { getKV, type KV } from "../cache/db";
import { GitRemote, type Ref } from "../git/remote";
import { isBinaryPath, isGeneratedSource, isLfsPointer, LIMITS, looksBinary } from "../util/files";
import { FULL_SHA_RE, SHORT_SHA_RE, type ParsedRepoUrl } from "./parseGithubUrl";
import { GitHubSource, type GitHubSourceOptions, type ResolvedRepo, type RepoRefs } from "./source";
import { RepoTree, type GitTreeItem, type TreeEntry } from "./tree";

/** Blob ids per batched Git fetch while indexing. */
export const BLOB_BATCH = 300;

/**
 * Reads repositories over the Git protocol through the same-origin relay
 * (/api/git): refs, complete file lists and batched file contents, without
 * GitHub's REST API or its 60 requests per hour. Single files for reading
 * still come from raw.githubusercontent.com. If the relay is not reachable
 * (for example on a static host without it), everything falls back to the
 * REST API behavior of GitHubSource.
 */
export class GitSource extends GitHubSource {
  private readonly relay: string;
  private readonly gitFetch?: typeof fetch;
  private relayBroken = false;
  private readonly kvOverride2?: KV;

  constructor(opts: GitHubSourceOptions & { relay?: string; gitFetch?: typeof fetch } = {}) {
    super(opts);
    this.relay = opts.relay ?? baseUrl("api/git");
    this.gitFetch = opts.gitFetch;
    this.kvOverride2 = opts.kv;
  }

  private get store(): KV {
    return this.kvOverride2 ?? getKV();
  }

  private remote(owner: string, repo: string): GitRemote {
    return new GitRemote(owner, repo, { base: this.relay, fetch: this.gitFetch });
  }

  /** Relay failures that mean "use the REST API instead". */
  private isRelayProblem(e: unknown): boolean {
    return !isAppError(e) || e.kind === "network" || e.kind === "server";
  }

  async listRefs(repo: ResolvedRepo, signal?: AbortSignal): Promise<RepoRefs> {
    const refs = await this.remote(repo.owner, repo.repo).lsRefs(["refs/heads/", "refs/tags/"], signal);
    const names = (prefix: string) =>
      refs
        .map((r) => r.name)
        .filter((n) => n.startsWith(prefix) && !n.endsWith("^{}"))
        .map((n) => n.slice(prefix.length));
    // Tags newest version first (v0.19.1 before v0.2.0).
    const byVersionDesc = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });
    return { branches: names("refs/heads/"), tags: names("refs/tags/").toSorted(byVersionDesc) };
  }

  async branchesAt(repo: ResolvedRepo, sha: string, signal?: AbortSignal): Promise<string[]> {
    if (this.relayBroken) return [];
    const refs = await this.remote(repo.owner, repo.repo).lsRefs(["refs/heads/"], signal);
    return refs.filter((r) => r.id === sha && r.name.startsWith("refs/heads/")).map((r) => r.name.slice("refs/heads/".length));
  }

  async headOf(repo: ResolvedRepo, branch: string, signal?: AbortSignal): Promise<string | null> {
    if (this.relayBroken) return null;
    const refs = await this.remote(repo.owner, repo.repo).lsRefs([`refs/heads/${branch}`], signal);
    return refs.find((r) => r.name === `refs/heads/${branch}`)?.id ?? null;
  }

  async resolve(parsed: ParsedRepoUrl, signal?: AbortSignal): Promise<ResolvedRepo> {
    if (this.relayBroken) return super.resolve(parsed, signal);
    try {
      return await this.resolveOverGit(parsed, signal);
    } catch (e) {
      if (!this.isRelayProblem(e)) throw e;
      this.relayBroken = true;
      return super.resolve(parsed, signal);
    }
  }

  private async resolveOverGit(parsed: ParsedRepoUrl, signal?: AbortSignal): Promise<ResolvedRepo> {
    const { owner, repo } = parsed;
    const segments = parsed.refAndPath;
    const first = segments[0];
    const base = { owner, repo, htmlUrl: `https://github.com/${owner}/${repo}` };
    const g = this.remote(owner, repo);

    // A full commit SHA needs no lookup at all.
    if (first && FULL_SHA_RE.test(first)) {
      const head = await g.lsRefs(["HEAD"], signal);
      const def = head.find((r) => r.name === "HEAD")?.target?.replace(/^refs\/heads\//, "") ?? "main";
      return { ...base, defaultBranch: def, refName: first.toLowerCase(), refType: "commit", commitSha: first.toLowerCase(), path: segments.slice(1).join("/") };
    }

    const prefixes = ["HEAD"];
    if (first) prefixes.push(`refs/heads/${first}`, `refs/tags/${first}`);
    const refs = await g.lsRefs(prefixes, signal);
    const head = refs.find((r) => r.name === "HEAD");
    if (!head) throw new AppError("not-found", `${owner}/${repo} does not exist, or it is private. CoderImpact can only open public repositories.`, { status: 404 });
    const defaultBranch = head.target?.replace(/^refs\/heads\//, "") ?? "main";

    if (!first) return { ...base, defaultBranch, refName: defaultBranch, refType: "branch", commitSha: head.id, path: "" };

    const candidates = refCandidates(refs, segments);
    if (candidates.length === 1) {
      const c = candidates[0];
      return { ...base, defaultBranch, refName: c.name, refType: c.type, commitSha: c.id, path: segments.slice(c.depth).join("/") };
    }
    if (candidates.length > 1) {
      throw new AppError("ambiguous-ref", "This link matches more than one branch or tag, so the file path is ambiguous. Pick the one you meant.", {
        candidates: candidates.map((c) => `${c.type}:${c.name}`),
      });
    }
    // An abbreviated commit SHA: only the REST API can expand it.
    if (SHORT_SHA_RE.test(first)) return super.resolve(parsed, signal);
    throw new AppError("not-found", `No branch, tag or commit named "${first}" exists in ${owner}/${repo}.`);
  }

  async loadTree(repo: ResolvedRepo, signal?: AbortSignal): Promise<RepoTree> {
    if (this.relayBroken) return super.loadTree(repo, signal);
    const key = `git:${repo.owner}/${repo.repo}@${repo.commitSha}`.toLowerCase();
    let items = await this.store.get<GitTreeItem[]>("trees", key).catch(() => undefined);
    if (!items) {
      try {
        items = (await this.remote(repo.owner, repo.repo).listTree(repo.commitSha, signal)).map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha }));
      } catch (e) {
        if (!this.isRelayProblem(e)) throw e;
        this.relayBroken = true;
        return super.loadTree(repo, signal);
      }
      await this.store.put("trees", key, items).catch(() => undefined);
    }
    // The Git listing is complete: no truncation, no folders to load later.
    return RepoTree.fromRecursive(items);
  }

  /** Fetches many file contents in one Git request and stores them in the blob cache. */
  async prefetchBlobs(repo: ResolvedRepo, entries: TreeEntry[], signal?: AbortSignal): Promise<void> {
    if (this.relayBroken || entries.length === 0) return;
    const candidates = entries.filter((e) => e.type === "blob" && !isBinaryPath(e.path));
    const cached = await this.store.getMany("blobs", candidates.map((e) => `gh:${e.sha}`)).catch(() => candidates.map(() => undefined));
    const wanted = candidates.filter((_, i) => !cached[i]);
    if (wanted.length === 0) return;
    let blobs: Map<string, Uint8Array>;
    try {
      blobs = await this.remote(repo.owner, repo.repo).fetchBlobs([...new Set(wanted.map((e) => e.sha))], signal);
    } catch {
      return; // single-file downloads still work
    }
    const writes: { key: string; value: { text: string; size: number; generated: boolean } }[] = [];
    for (const [sha, bytes] of blobs) {
      // Git file lists carry no sizes: files over the display limit are never cached, so they stay "too large".
      if (bytes.length > LIMITS.maxDisplayBytes || looksBinary(bytes)) continue;
      const text = new TextDecoder("utf-8").decode(bytes);
      if (isLfsPointer(text)) continue;
      writes.push({ key: `gh:${sha}`, value: { text, size: bytes.length, generated: isGeneratedSource(text) } });
    }
    await this.store.putMany("blobs", writes).catch(() => undefined);
  }
}

/** Branch or tag names may contain slashes: keeps refs that match a prefix of the segments. */
function refCandidates(refs: Ref[], segments: string[]): { name: string; type: "branch" | "tag"; id: string; depth: number }[] {
  const candidates: { name: string; type: "branch" | "tag"; id: string; depth: number }[] = [];
  for (const r of refs) {
    const m = /^refs\/(heads|tags)\/(.+)$/.exec(r.name);
    if (!m || m[2].endsWith("^{}")) continue;
    const parts = m[2].split("/");
    if (parts.length <= segments.length && parts.every((p, i) => p === segments[i])) {
      candidates.push({ name: m[2], type: m[1] === "heads" ? "branch" : "tag", id: r.peeled ?? r.id, depth: parts.length });
    }
  }
  return candidates;
}
