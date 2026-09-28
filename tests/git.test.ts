import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDelta, commitTree, parsePack, parseTree } from "../src/lib/git/pack";
import { packetLines, pktLine } from "../src/lib/git/pktline";
import { GitRemote } from "../src/lib/git/remote";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

/** A real repository with two similar versions of a file, so git produces deltas. */
function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ci-git-"));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "slug"));
  const body = Array.from({ length: 200 }, (_, i) => `// line ${i} of a long enough file to be worth deltifying`).join("\n");
  writeFileSync(join(dir, "slug/normalize.go"), `package slug\n${body}\n`);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "one");
  writeFileSync(join(dir, "slug/normalize.go"), `package slug\n${body}\n// changed\n`);
  writeFileSync(join(dir, "slug/other.go"), `package slug\n${body}\n// other\n`);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "two");
  return dir;
}

function packOf(dir: string, revs: string): Uint8Array {
  return new Uint8Array(execFileSync("git", ["pack-objects", "--stdout", "--revs", "--delta-base-offset", "--window=10", "--depth=10"], { cwd: dir, input: revs + "\n" }));
}

describe("Git pack reader", () => {
  const dir = fixtureRepo();
  const head = git(dir, "rev-parse", "HEAD");

  it("reads every object of a real pack, including offset deltas, with correct ids", async () => {
    const objects = await parsePack(packOf(dir, "HEAD"));
    const expected = git(dir, "rev-list", "--objects", "--all").split("\n").map((l) => l.split(" ")[0]);
    for (const id of expected) expect(objects.has(id)).toBe(true);
    const tree = parseTree(objects.get(commitTree(objects.get(head)!.data))!.data);
    expect(tree.map((t) => t.name).sort()).toEqual(["README.md", "slug"]);
    const slug = parseTree(objects.get(tree.find((t) => t.name === "slug")!.id)!.data);
    const file = objects.get(slug.find((t) => t.name === "normalize.go")!.id)!;
    expect(new TextDecoder().decode(file.data)).toBe(git(dir, "show", "HEAD:slug/normalize.go") + "\n");
  });

  it("applies copy and insert delta instructions", () => {
    const base = new TextEncoder().encode("hello world");
    // base size 11, result size 12: copy 6 bytes from 0, insert "there!"
    const delta = new Uint8Array([11, 12, 0x90, 6, 6, ..."there!".split("").map((c) => c.charCodeAt(0))]);
    expect(new TextDecoder().decode(applyDelta(base, delta))).toBe("hello there!");
  });

  it("frames pkt-lines", () => {
    expect(pktLine("command=ls-refs\n")).toBe("0014command=ls-refs\n");
    const buf = new TextEncoder().encode("0014command=ls-refs\n0001000a peel\n0000");
    expect(packetLines(buf)).toEqual(["command=ls-refs", " peel"]);
  });
});

describe("GitRemote over a local smart-HTTP stand-in", () => {
  const dir = fixtureRepo();
  const head = git(dir, "rev-parse", "HEAD");

  /** Answers the client's requests with `git upload-pack --stateless-rpc` (protocol v2), like GitHub. */
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const out = execFileSync("git", ["-c", "uploadpack.allowFilter=true", "-c", "uploadpack.allowAnySHA1InWant=true", "upload-pack", "--stateless-rpc", dir], {
      input: Buffer.from(String(init.body)),
      env: { ...process.env, GIT_PROTOCOL: "version=2" },
    });
    return new Response(new Uint8Array(out), { status: 200 });
  }) as unknown as typeof fetch;

  const remote = new GitRemote("o", "r", { base: "/api/git", fetch: fetchImpl });

  it("resolves HEAD and branches with ls-refs", async () => {
    const refs = await remote.lsRefs(["HEAD", "refs/heads/main"]);
    expect(refs.find((r) => r.name === "HEAD")).toMatchObject({ id: head, target: "refs/heads/main" });
    expect(refs.find((r) => r.name === "refs/heads/main")?.id).toBe(head);
  });

  it("lists the complete tree without file contents", async () => {
    const list = await remote.listTree(head);
    expect(list.map((e) => `${e.type} ${e.path}`).sort()).toEqual(["blob README.md", "blob slug/normalize.go", "blob slug/other.go", "tree slug"]);
  });

  it("fetches file contents by id in one request", async () => {
    const list = await remote.listTree(head);
    const ids = list.filter((e) => e.type === "blob").map((e) => e.sha);
    const blobs = await remote.fetchBlobs(ids);
    expect(blobs.size).toBe(3);
    const readme = list.find((e) => e.path === "README.md")!;
    expect(new TextDecoder().decode(blobs.get(readme.sha))).toBe("# fixture\n");
  });
});
