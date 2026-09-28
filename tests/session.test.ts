import { describe, expect, it } from "vitest";
import { RepoSession } from "../src/lib/session";
import { RepoTree, type GitTreeItem } from "../src/lib/github/tree";
import type { RepositorySource } from "../src/lib/github/source";

const blob = (path: string): GitTreeItem => ({ path, mode: "100644", type: "blob", sha: `sha-${path}`, size: 100 });
const dir = (path: string): GitTreeItem => ({ path, mode: "040000", type: "tree", sha: `sha-${path}` });

function session(items: GitTreeItem[]) {
  const source = { fetchBlob: async () => ({ text: "", sha: "", size: 0, generated: false, from: "cache" }) } as unknown as RepositorySource;
  const repo = { owner: "o", repo: "r", commitSha: "c".repeat(40), refName: "main", refType: "branch", defaultBranch: "main", path: "", htmlUrl: "" } as const;
  return new RepoSession(repo, RepoTree.fromRecursive(items), source);
}

describe("RepoSession", () => {
  const s = session([
    dir("Bundles"),
    dir("Bundles/Comment"),
    blob("Bundles/Comment/composer.json"),
    blob("Bundles/Comment/src/Spryker/Zed/Comment/Business/CommentFacade.php"),
    blob("Bundles/Comment/src/Spryker/Client/Comment/CommentFacade.php"),
    blob("Bundles/Checkout/src/Spryker/Zed/Checkout/Business/CheckoutFacade.php"),
    blob("go.mod"),
  ]);

  it("maps a PHP class name to its file like Composer's PSR-4 autoloader", () => {
    expect(s.fileForClass("Spryker\\Zed\\Comment\\Business\\CommentFacade")?.path).toBe("Bundles/Comment/src/Spryker/Zed/Comment/Business/CommentFacade.php");
    expect(s.fileForClass("\\Spryker\\Client\\Comment\\CommentFacade")?.path).toBe("Bundles/Comment/src/Spryker/Client/Comment/CommentFacade.php");
    expect(s.fileForClass("Spryker\\Zed\\Missing\\Nope")).toBeUndefined();
  });

  it("finds the module of a file by its nearest composer.json or go.mod", () => {
    expect(s.moduleRoot("Bundles/Comment/src/Spryker/Zed/Comment/Business/CommentFacade.php")).toBe("Bundles/Comment");
    expect(s.moduleRoot("Bundles/Checkout/src/Spryker/Zed/Checkout/Business/CheckoutFacade.php")).toBe("");
  });
});

describe("RepoSession.resolveDeep", () => {
  it("fetches exactly the declaring file of a PHP class instead of waiting for the full index", async () => {
    const { host } = await import("./helpers");
    const files: Record<string, string> = {
      "Bundles/Comment/src/Spryker/Zed/Comment/Business/CommentFacade.php": `<?php
namespace Spryker\\Zed\\Comment\\Business;

use Spryker\\Zed\\Kernel\\Business\\AbstractFacade;

class CommentFacade extends AbstractFacade
{
    public function add(): void
    {
        $this->getFactory();
    }
}
`,
      "Bundles/Kernel/src/Spryker/Zed/Kernel/Business/AbstractFacade.php": `<?php
namespace Spryker\\Zed\\Kernel\\Business;

abstract class AbstractFacade
{
    protected function getFactory() {}
}
`,
      "Bundles/Other/src/Spryker/Zed/Other/Unrelated.php": "<?php\nclass Unrelated {}\n",
    };
    const fetched: string[] = [];
    const source = {
      fetchBlob: async (_repo: unknown, entry: { path: string }) => {
        fetched.push(entry.path);
        return { text: files[entry.path], sha: entry.path, size: 1, generated: false, from: "cache" };
      },
    } as unknown as RepositorySource;
    const repo = { owner: "o", repo: "r", commitSha: "c".repeat(40), refName: "main", refType: "branch", defaultBranch: "main", path: "", htmlUrl: "" } as const;
    const tree = RepoTree.fromRecursive(Object.keys(files).map(blob));
    const s = new RepoSession(repo, tree, source, (path, lang, text) => host.index(path, lang, text));

    const current = "Bundles/Comment/src/Spryker/Zed/Comment/Business/CommentFacade.php";
    const fi = (await s.ensureIndexed(current))!;
    const extendsRef = fi.occurrences.findIndex((o) => o.name === "AbstractFacade" && o.span.line === 6);
    expect(s.index.resolveOccurrence(current, extendsRef).status).toBe("external");

    const r = await s.resolveDeep(current, extendsRef);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.defs[0].path).toBe("Bundles/Kernel/src/Spryker/Zed/Kernel/Business/AbstractFacade.php");

    // An inherited method resolves through the parent class that was just fetched.
    const call = fi.occurrences.findIndex((o) => o.name === "getFactory");
    const m = await s.resolveDeep(current, call);
    expect(m.status).toBe("resolved");
    // Only the two files that matter were fetched, not the whole repository.
    expect(fetched.sort()).toEqual([current, "Bundles/Kernel/src/Spryker/Zed/Kernel/Business/AbstractFacade.php"].sort());
  });
});
