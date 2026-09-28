import { describe, expect, it } from "vitest";
import { addFiles, LOCAL_OWNER } from "../src/lib/local/projects";
import { LocalSource, localSha } from "../src/lib/local/localSource";
import { parseRepoPath } from "../src/lib/github/parseGithubUrl";

function file(text: string, lastModified = 1_700_000_000_000) {
  return new File([text], "f", { lastModified });
}

async function project() {
  return addFiles("my app", [
    { path: "go.mod", file: file("module example.com/app\n") },
    { path: "main.go", file: file("package main\n\nfunc main() {}\n") },
    { path: "internal/util/slug.go", file: file("package util\n") },
    { path: "node_modules/left-pad/index.js", file: file("module.exports = 1;\n") },
    { path: "node_modules/left-pad/lib/x.js", file: file("x\n") },
    { path: "logo.png", file: file("\u0000PNG") },
  ]);
}

describe("local folders", () => {
  it("parses /~/<name>/tree/<id> URLs", () => {
    const p = parseRepoPath(`/~/my-app/blob/${"a".repeat(40)}/main.go`);
    expect(p.owner).toBe(LOCAL_OWNER);
    expect(p.refAndPath).toEqual(["a".repeat(40), "main.go"]);
  });

  it("resolves a project, lists it and leaves dependency folders unlisted", async () => {
    const p = await project();
    expect(p.slug).toBe("my-app");
    const src = new LocalSource();
    const repo = await src.resolve(parseRepoPath(`/~/${p.slug}/blob/${p.id}/main.go`));
    expect(repo).toMatchObject({ owner: "~", repo: "my-app", commitSha: p.id, path: "main.go", description: "my app" });
    const tree = await src.loadTree(repo);
    expect(tree.get("internal/util/slug.go")?.type).toBe("blob");
    expect(tree.get("node_modules")?.type).toBe("tree");
    expect(tree.isLoaded("node_modules")).toBe(false);
    expect(tree.get("node_modules/left-pad/index.js")).toBeUndefined();

    await src.loadDirectory(repo, tree, "node_modules");
    expect(tree.get("node_modules/left-pad")?.type).toBe("tree");
    await src.loadSubtree(repo, tree, "node_modules/left-pad");
    expect(tree.get("node_modules/left-pad/lib/x.js")?.type).toBe("blob");

    const blob = await src.fetchBlob(repo, tree.get("main.go")!);
    expect(blob.text).toContain("func main()");
    await expect(src.fetchBlob(repo, tree.get("logo.png")!)).rejects.toMatchObject({ kind: "binary" });
    expect(src.githubUrl()).toBe("");
  });

  it("opens /~/<name> without an id by the folder name", async () => {
    const p = await project();
    const repo = await new LocalSource().resolve(parseRepoPath(`/~/${p.slug}`));
    expect(repo.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("gives a file a new version id when it is saved again", () => {
    const a = localSha("main.go", 10, 1);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(localSha("main.go", 10, 1)).toBe(a);
    expect(localSha("main.go", 10, 2)).not.toBe(a);
    expect(localSha("other.go", 10, 1)).not.toBe(a);
  });

  it("asks to pick the folder again when an unknown id is opened", async () => {
    await expect(new LocalSource().resolve(parseRepoPath(`/~/gone/tree/${"b".repeat(40)}`))).rejects.toMatchObject({ kind: "not-found" });
  });
});
