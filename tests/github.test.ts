import { describe, expect, it } from "vitest";
import { parseGithubInput, parseLineHash, formatLineHash } from "../src/lib/github/parseGithubUrl";
import { GitHubClient } from "../src/lib/github/client";
import { GitHubSource } from "../src/lib/github/source";
import { createMemoryKV } from "../src/lib/cache/db";
import { AppError } from "../src/lib/errors";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(routes: Record<string, Handler | object>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k + "?") || (k.endsWith("*") && url.startsWith(k.slice(0, -1))));
    if (!key) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const r = routes[key];
    if (typeof r === "function") return (r as Handler)(url, init);
    return new Response(JSON.stringify(r), { status: 200, headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "55", "x-ratelimit-reset": "2000000000" } });
  }) as typeof fetch;
}

const API = "https://api.github.com";
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);

function source(routes: Record<string, Handler | object>, calls: string[] = []) {
  const f = mockFetch(routes, calls);
  const kv = createMemoryKV();
  return new GitHubSource({ client: new GitHubClient({ fetch: f, kv }), kv, fetch: f });
}

const repoInfo = { full_name: "o/r", name: "r", owner: { login: "o" }, default_branch: "main", description: null, html_url: "https://github.com/o/r", private: false, size: 1 };

describe("parseGithubInput", () => {
  it("accepts shorthand, URLs, .git suffixes and ssh remotes", () => {
    expect(parseGithubInput("spf13/cobra")).toMatchObject({ owner: "spf13", repo: "cobra", kind: "repo" });
    expect(parseGithubInput("https://github.com/spf13/cobra.git")).toMatchObject({ repo: "cobra" });
    expect(parseGithubInput("github.com/spf13/cobra/")).toMatchObject({ owner: "spf13" });
    expect(parseGithubInput("git@github.com:spf13/cobra.git")).toMatchObject({ owner: "spf13", repo: "cobra" });
  });

  it("keeps the ref/path split unresolved for tree and blob links", () => {
    const p = parseGithubInput("https://github.com/o/r/blob/feature/x/src/main.go#L3-L9");
    expect(p.kind).toBe("blob");
    expect(p.refAndPath).toEqual(["feature", "x", "src", "main.go"]);
    expect(p.lines).toEqual({ start: 3, end: 9 });
  });

  it("opens the repository for other GitHub pages", () => {
    expect(parseGithubInput("https://github.com/o/r/issues/12")).toMatchObject({ kind: "repo", refAndPath: [] });
  });

  it("rejects other hosts and invalid names", () => {
    expect(() => parseGithubInput("https://gitlab.com/o/r")).toThrow(/github\.com/);
    expect(() => parseGithubInput("gitlab.com/o/r")).toThrow(/github\.com/);
    expect(() => parseGithubInput("just-one-part")).toThrow(AppError);
    expect(() => parseGithubInput("settings/profile")).toThrow(/owner/);
    expect(() => parseGithubInput("")).toThrow();
  });

  it("parses and formats line anchors", () => {
    expect(parseLineHash("#L7")).toEqual({ start: 7, end: 7 });
    expect(parseLineHash("#L9-L3")).toEqual({ start: 3, end: 9 });
    expect(parseLineHash("#L2-5")).toEqual({ start: 2, end: 5 });
    expect(parseLineHash("#readme")).toBeUndefined();
    expect(formatLineHash({ start: 4, end: 6 })).toBe("#L4-L6");
  });
});

describe("GitHubSource.resolve", () => {
  it("resolves the default branch to an immutable commit", async () => {
    const s = source({
      [`${API}/repos/o/r`]: repoInfo,
      [`${API}/repos/o/r/git/ref/heads/main`]: { ref: "refs/heads/main", object: { sha: SHA, type: "commit" } },
    });
    const r = await s.resolve(parseGithubInput("o/r"));
    expect(r).toMatchObject({ refName: "main", refType: "branch", commitSha: SHA, path: "" });
  });

  it("splits branch names containing slashes using GitHub metadata", async () => {
    const s = source({
      [`${API}/repos/o/r`]: repoInfo,
      [`${API}/repos/o/r/git/matching-refs/heads/feature`]: [
        { ref: "refs/heads/feature/x", object: { sha: SHA, type: "commit" } },
        { ref: "refs/heads/features", object: { sha: SHA2, type: "commit" } },
      ],
      [`${API}/repos/o/r/git/matching-refs/tags/feature`]: [],
    });
    const r = await s.resolve(parseGithubInput("https://github.com/o/r/blob/feature/x/src/main.go"));
    expect(r).toMatchObject({ refName: "feature/x", refType: "branch", commitSha: SHA, path: "src/main.go" });
  });

  it("reports an ambiguous ref/path split instead of guessing", async () => {
    const s = source({
      [`${API}/repos/o/r`]: repoInfo,
      [`${API}/repos/o/r/git/matching-refs/heads/release`]: [
        { ref: "refs/heads/release", object: { sha: SHA, type: "commit" } },
        { ref: "refs/heads/release/v2", object: { sha: SHA2, type: "commit" } },
      ],
      [`${API}/repos/o/r/git/matching-refs/tags/release`]: [],
    });
    await expect(s.resolve(parseGithubInput("o/r/tree/release/v2/docs"))).rejects.toMatchObject({
      kind: "ambiguous-ref",
      details: { candidates: ["branch:release", "branch:release/v2"] },
    });
  });

  it("peels annotated tags to their commit", async () => {
    const s = source({
      [`${API}/repos/o/r`]: repoInfo,
      [`${API}/repos/o/r/git/matching-refs/heads/v1.0.0`]: [],
      [`${API}/repos/o/r/git/matching-refs/tags/v1.0.0`]: [{ ref: "refs/tags/v1.0.0", object: { sha: SHA2, type: "tag" } }],
      [`${API}/repos/o/r/git/tags/${SHA2}`]: { object: { sha: SHA, type: "commit" } },
    });
    const r = await s.resolve(parseGithubInput("o/r/tree/v1.0.0"));
    expect(r).toMatchObject({ refType: "tag", commitSha: SHA });
  });

  it("accepts commit SHAs as the ref", async () => {
    const s = source({
      [`${API}/repos/o/r`]: repoInfo,
      [`${API}/repos/o/r/commits/abc1234`]: () => new Response(SHA, { status: 200 }),
    });
    const r = await s.resolve(parseGithubInput("o/r/blob/abc1234/a/b.go"));
    expect(r).toMatchObject({ refType: "commit", commitSha: SHA, path: "a/b.go" });
  });

  it("explains missing or private repositories", async () => {
    const s = source({});
    await expect(s.resolve(parseGithubInput("o/missing"))).rejects.toMatchObject({ kind: "not-found", message: /private/ });
  });
});

describe("trees", () => {
  it("builds a complete tree from a recursive response", async () => {
    const s = source({
      [`${API}/repos/o/r/git/trees/${SHA}`]: {
        sha: SHA,
        truncated: false,
        tree: [
          { path: "src", mode: "040000", type: "tree", sha: "t1" },
          { path: "src/a.go", mode: "100644", type: "blob", sha: "b1", size: 10 },
          { path: "lib", mode: "160000", type: "commit", sha: "c1" },
        ],
      },
    });
    const tree = await s.loadTree({ owner: "o", repo: "r", commitSha: SHA } as never);
    expect(tree.complete).toBe(true);
    expect(tree.list("")!.map((e) => e.name)).toEqual(["lib", "src"].sort().filter(() => true).length ? ["src", "lib"] : []);
    expect(tree.get("lib")!.type).toBe("commit");
  });

  it("keeps GitHub's partial listing when the tree is truncated and completes it within a budget", async () => {
    const calls: string[] = [];
    const tree = (sha: string, items: object[], truncated = false) => ({ sha, truncated, tree: items });
    const s = source(
      {
        [`${API}/repos/o/r/git/trees/${SHA}`]: (url) =>
          new Response(
            JSON.stringify(
              url.includes("recursive")
                ? // Cut off inside Bundles/Beta: Alpha is complete, Beta is partial, later folders are missing.
                  tree(SHA, [
                    { path: "Bundles", mode: "040000", type: "tree", sha: "t-b" },
                    { path: "Bundles/Alpha", mode: "040000", type: "tree", sha: "t-alpha" },
                    { path: "Bundles/Alpha/Checkout.php", mode: "100644", type: "blob", sha: "b1", size: 5 },
                    { path: "Bundles/Beta", mode: "040000", type: "tree", sha: "t-beta" },
                    { path: "Bundles/Beta/A.php", mode: "100644", type: "blob", sha: "b2", size: 5 },
                  ], true)
                : tree(SHA, [
                    { path: "Bundles", mode: "040000", type: "tree", sha: "t-b" },
                    { path: "frontend", mode: "040000", type: "tree", sha: "t-f" },
                    { path: "go.mod", mode: "100644", type: "blob", sha: "m" },
                  ]),
            ),
            { status: 200 },
          ),
        [`${API}/repos/o/r/git/trees/t-b`]: tree("t-b", [
          { path: "Alpha", mode: "040000", type: "tree", sha: "t-alpha" },
          { path: "Beta", mode: "040000", type: "tree", sha: "t-beta" },
          { path: "Gamma", mode: "040000", type: "tree", sha: "t-gamma" },
        ]),
        [`${API}/repos/o/r/git/trees/t-f`]: tree("t-f", [{ path: "app.ts", mode: "100644", type: "blob", sha: "f1", size: 5 }]),
        [`${API}/repos/o/r/git/trees/t-beta`]: tree("t-beta", [
          { path: "A.php", mode: "100644", type: "blob", sha: "b2", size: 5 },
          { path: "B.php", mode: "100644", type: "blob", sha: "b3", size: 5 },
        ]),
        [`${API}/repos/o/r/git/trees/t-gamma`]: tree("t-gamma", [{ path: "G.php", mode: "100644", type: "blob", sha: "g1", size: 5 }]),
      },
      calls,
    );
    const t = await s.loadTree({ owner: "o", repo: "r", commitSha: SHA } as never);
    expect(t.truncated).toBe(true);
    // Files listed before the cut-off are searchable right away.
    expect(t.get("Bundles/Alpha/Checkout.php")?.sha).toBe("b1");
    // The partial folder was completed, the unlisted folders were fetched whole.
    expect(t.get("Bundles/Beta/B.php")).toBeDefined();
    expect(t.get("frontend/app.ts")).toBeDefined();
    expect(t.get("Bundles/Gamma/G.php")).toBeDefined();
    expect(t.pendingDirs()).toEqual([]);
    expect(calls.filter((c) => c.includes("/git/trees/")).length).toBeLessThanOrEqual(1 + GitHubSource.TREE_COMPLETION_BUDGET);
  });
});

describe("GitHubClient", () => {
  it("revalidates with ETags and serves 304s from cache", async () => {
    let n = 0;
    const f = mockFetch({
      [`${API}/x`]: (_u, init) => {
        n++;
        const inm = (init?.headers as Record<string, string>)["If-None-Match"];
        if (inm === '"v1"') return new Response(null, { status: 304 });
        return new Response(JSON.stringify({ v: 1 }), { status: 200, headers: { etag: '"v1"' } });
      },
    });
    const c = new GitHubClient({ fetch: f, kv: createMemoryKV() });
    expect(await c.request("/x")).toEqual({ v: 1 });
    expect(await c.request("/x")).toEqual({ v: 1 });
    expect(n).toBe(2);
  });

  it("does not request immutable resources twice", async () => {
    let n = 0;
    const f = mockFetch({ [`${API}/y`]: () => (n++, new Response("{}", { status: 200 })) });
    const c = new GitHubClient({ fetch: f, kv: createMemoryKV() });
    await c.request("/y", { immutable: true });
    await c.request("/y", { immutable: true });
    expect(n).toBe(1);
  });

  it("turns an exhausted rate limit into a rate-limit error with the reset time and stops sending", async () => {
    let n = 0;
    const f = mockFetch({
      [`${API}/z`]: () => (
        n++,
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" },
        })
      ),
    });
    const c = new GitHubClient({ fetch: f, kv: createMemoryKV(), now: () => 1_000_000_000_000 });
    await expect(c.request("/z")).rejects.toMatchObject({ kind: "rate-limit", details: { resetAt: 2_000_000_000_000, limit: 60 } });
    await expect(c.request("/z")).rejects.toMatchObject({ kind: "rate-limit" });
    expect(n).toBe(1);
  });

  it("honors Retry-After on secondary rate limits", async () => {
    const f = mockFetch({ [`${API}/s`]: () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }) });
    const c = new GitHubClient({ fetch: f, kv: createMemoryKV(), now: () => 5_000 });
    await expect(c.request("/s")).rejects.toMatchObject({ kind: "rate-limit", details: { retryAfter: 30, resetAt: 35_000 } });
    expect(c.isRateLimited()).toBe(true);
  });

  it("serves stale cached data when the network fails", async () => {
    let fail = false;
    const f = mockFetch({
      [`${API}/n`]: () => {
        if (fail) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { etag: '"e"' } });
      },
    });
    const c = new GitHubClient({ fetch: f, kv: createMemoryKV() });
    await c.request("/n");
    fail = true;
    expect(await c.request("/n")).toEqual({ ok: true });
  });
});

describe("blobs", () => {
  const repo = { owner: "o", repo: "r", commitSha: SHA } as never;
  const entry = (path: string, size = 10) => ({ path, name: path.split("/").pop()!, type: "blob" as const, sha: "s-" + path, size, mode: "100644" });

  it("fetches from the raw host by commit and caches by blob SHA", async () => {
    const calls: string[] = [];
    const s = source({ [`https://raw.githubusercontent.com/o/r/${SHA}/a.go`]: () => new Response("package a\n") }, calls);
    expect((await s.fetchBlob(repo, entry("a.go"))).from).toBe("raw");
    expect((await s.fetchBlob(repo, entry("a.go"))).from).toBe("cache");
    expect(calls).toHaveLength(1);
  });

  it("falls back to the REST blob API when the raw host fails", async () => {
    const s = source({
      [`https://raw.githubusercontent.com/o/r/${SHA}/b.go`]: () => {
        throw new TypeError("blocked by CORS");
      },
      [`${API}/repos/o/r/git/blobs/s-b.go`]: () => new Response("package b\n"),
    });
    const b = await s.fetchBlob(repo, entry("b.go"));
    expect(b.from).toBe("api");
    expect(b.text).toBe("package b\n");
  });

  it("refuses binaries, large files, submodules and LFS pointers", async () => {
    const s = source({
      [`https://raw.githubusercontent.com/o/r/${SHA}/data.txt`]: () => new Response(new Uint8Array([1, 0, 2])),
      [`https://raw.githubusercontent.com/o/r/${SHA}/big.bin.txt`]: () => new Response("x"),
      [`https://raw.githubusercontent.com/o/r/${SHA}/model.txt`]: () => new Response("version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n"),
    });
    await expect(s.fetchBlob(repo, entry("logo.png"))).rejects.toMatchObject({ kind: "binary" });
    await expect(s.fetchBlob(repo, entry("data.txt"))).rejects.toMatchObject({ kind: "binary" });
    await expect(s.fetchBlob(repo, entry("big.bin.txt", 5_000_000))).rejects.toMatchObject({ kind: "too-large" });
    await expect(s.fetchBlob(repo, { ...entry("vendor/lib"), type: "commit" })).rejects.toMatchObject({ kind: "submodule" });
    await expect(s.fetchBlob(repo, entry("model.txt"))).rejects.toMatchObject({ kind: "lfs" });
  });
});
