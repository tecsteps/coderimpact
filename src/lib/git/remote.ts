import { AppError } from "../errors";
import { commitTree, parsePack, parseTree, type GitObject } from "./pack";
import { DELIM, FLUSH, packetLines, pktLine, readPackets } from "./pktline";

/**
 * A minimal Git protocol v2 client over smart HTTP
 * (https://git-scm.com/docs/protocol-v2): ls-refs, and shallow, partial fetches
 * (folders and names only, or specific file contents by id). In the browser it
 * talks to github.com through the same-origin relay at /api/git, because
 * github.com does not allow cross-site requests. An optional token is passed
 * through for private repositories later; it is never stored.
 */
export interface Ref {
  name: string;
  id: string;
  /** For annotated tags: the commit the tag points at. */
  peeled?: string;
  /** For symbolic refs such as HEAD: the ref it points at. */
  target?: string;
}

export interface GitTreeListing {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
}

export interface GitRemoteOptions {
  /** Base URL of the relay, for example "/api/git". Requests go to <base>/<owner>/<repo>/... */
  base: string;
  fetch?: typeof fetch;
  token?: string;
}

export class GitRemote {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;

  constructor(owner: string, repo: string, opts: GitRemoteOptions) {
    this.url = `${opts.base.replace(/\/$/, "")}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    this.fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.token = opts.token;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { "Git-Protocol": "version=2", ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async command(body: string, signal?: AbortSignal): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}/git-upload-pack`, {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/x-git-upload-pack-request",
          Accept: "application/x-git-upload-pack-result",
        }),
        body,
        signal,
        credentials: "omit",
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      throw new AppError("network", "Could not reach GitHub. Check your connection and try again.");
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new AppError("not-found", "This repository does not exist, or it is private.", { status: 404 });
    }
    if (res.status === 429) throw new AppError("rate-limit", "Too many repository requests. Try again in a minute.", { retryAfter: Number(res.headers.get("retry-after")) || 60 });
    if (!res.ok) throw new AppError("server", `GitHub responded with ${res.status}.`, { status: res.status });
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Lists refs matching the prefixes, with HEAD's target and peeled tags. */
  async lsRefs(prefixes: string[], signal?: AbortSignal): Promise<Ref[]> {
    const body =
      pktLine("command=ls-refs\n") +
      DELIM +
      pktLine("peel\n") +
      pktLine("symrefs\n") +
      prefixes.map((p) => pktLine(`ref-prefix ${p}\n`)).join("") +
      FLUSH;
    const lines = packetLines(await this.command(body, signal));
    return lines.map((line) => {
      const [id, name, ...attrs] = line.split(" ");
      const ref: Ref = { id, name };
      for (const a of attrs) {
        if (a.startsWith("symref-target:")) ref.target = a.slice(14);
        if (a.startsWith("peeled:")) ref.peeled = a.slice(7);
      }
      return ref;
    });
  }

  /** Fetches a packfile for the wanted ids and returns its objects. */
  async fetchObjects(wants: string[], opts: { depth?: number; filter?: string; signal?: AbortSignal } = {}): Promise<Map<string, GitObject>> {
    const body =
      pktLine("command=fetch\n") +
      DELIM +
      pktLine("no-progress\n") +
      pktLine("ofs-delta\n") +
      wants.map((w) => pktLine(`want ${w}\n`)).join("") +
      (opts.depth ? pktLine(`deepen ${opts.depth}\n`) : "") +
      (opts.filter ? pktLine(`filter ${opts.filter}\n`) : "") +
      pktLine("done\n") +
      FLUSH;
    const res = await this.command(body, opts.signal);
    // Response sections; the packfile section is side-band multiplexed.
    const chunks: Uint8Array[] = [];
    let inPack = false;
    const dec = new TextDecoder();
    for (const p of readPackets(res)) {
      if (p.kind !== "data") continue;
      if (!inPack) {
        if (dec.decode(p.data).trim() === "packfile") inPack = true;
        continue;
      }
      const band = p.data[0];
      if (band === 1) chunks.push(p.data.subarray(1));
      else if (band === 3) throw new AppError("server", `GitHub: ${dec.decode(p.data.subarray(1)).trim()}`);
    }
    if (!inPack) throw new AppError("server", "GitHub did not send a packfile.");
    const size = chunks.reduce((n, c) => n + c.length, 0);
    const pack = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) {
      pack.set(c, o);
      o += c.length;
    }
    return parsePack(pack);
  }

  /**
   * The complete file list of a commit in one request: a shallow (depth 1),
   * partial (no file contents) fetch, then a walk over the tree objects.
   */
  async listTree(commit: string, signal?: AbortSignal): Promise<GitTreeListing[]> {
    const objects = await this.fetchObjects([commit], { depth: 1, filter: "blob:none", signal });
    const c = objects.get(commit);
    if (c?.type !== "commit") throw new AppError("not-found", `Commit ${commit.slice(0, 7)} was not found.`);
    const out: GitTreeListing[] = [];
    const walk = (treeId: string, prefix: string) => {
      const t = objects.get(treeId);
      if (!t) return;
      for (const e of parseTree(t.data)) {
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        const type = entryType(e.mode);
        out.push({ path, mode: e.mode, type, sha: e.id });
        if (type === "tree") walk(e.id, path);
      }
    };
    walk(commitTree(c.data), "");
    return out;
  }

  /** File contents by blob id, many per request. */
  async fetchBlobs(ids: string[], signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
    const objects = await this.fetchObjects(ids, { signal });
    const out = new Map<string, Uint8Array>();
    for (const id of ids) {
      const o = objects.get(id);
      if (o?.type === "blob") out.set(id, o.data);
    }
    return out;
  }
}

/** Tree entry kind from its mode: folder, submodule commit, or file. */
function entryType(mode: string): GitTreeListing["type"] {
  if (mode === "040000") return "tree";
  if (mode === "160000") return "commit";
  return "blob";
}
