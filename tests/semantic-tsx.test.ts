import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("tsx/dashboard"));
});

function resolveAt(path: string, needle: string, nth = 0, onLineWith = needle) {
  const line = lineOf(texts, path, onLineWith);
  const c = col(texts, path, line, needle, nth);
  const hit = index.occurrenceAt(path, line, c);
  if (!hit) throw new Error(`no occurrence at ${path}:${line}:${c}`);
  return index.resolveOccurrence(path, hit.index);
}

function resolvedAt(path: string, needle: string, nth = 0, onLineWith = needle) {
  const r = resolveAt(path, needle, nth, onLineWith);
  if (r.status !== "resolved") throw new Error(`${needle}: ${r.status}`);
  return r;
}

describe("TSX queries", () => {
  it("compile against the grammar", async () => {
    const root = join(import.meta.dirname, "..");
    await Parser.init({ locateFile: (f: string) => join(root, "node_modules/web-tree-sitter", f) });
    const language = await Language.load(readFileSync(join(root, "public/grammars/tree-sitter-tsx.wasm")));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("tsx", kind);
      expect(src, kind).toBeTruthy();
      expect(() => new Query(language, src!).delete()).not.toThrow();
    }
  });
});

describe("TSX adapter", () => {
  it("parses every fixture file without errors", () => {
    for (const p of index.paths()) expect(index.get(p)!.hasErrors, p).toBe(false);
  });

  it("records a class component with constructor, methods and handler fields", () => {
    const fi = index.get("src/App.tsx")!;
    expect(fi.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual([
      "class:AppState",
      "function:Layout",
      "class:App",
      "method:App.constructor",
      "method:App.handleSelect",
      "method:App.componentDidMount",
      "method:App.render",
      "function:bootstrap",
    ]);
    expect(fi.decls.find((d) => d.name === "AppState")!.kind).toBe("interface");
  });

  it("records arrow-function components and type aliases", () => {
    const fi = index.get("src/components/Avatar.tsx")!;
    expect(fi.blocks.map((b) => `${b.kind}:${b.label}@${b.startLine}-${b.endLine}`)).toEqual(["type:AvatarProps@3-6", "function:Avatar@8-15"]);
  });

  it("resolves JSX components across files", () => {
    const avatar = resolvedAt("src/components/UserList.tsx", "Avatar", 0, "<Avatar user");
    expect(avatar.precision).toBe("name");
    expect(avatar.defs[0]).toMatchObject({ path: "src/components/Avatar.tsx", line: 8, kind: "function" });
    const list = resolvedAt("src/App.tsx", "UserList", 0, "<UserList users");
    expect(list.defs[0]).toMatchObject({ path: "src/components/UserList.tsx", line: 13 });
    const layout = resolvedAt("src/App.tsx", "Layout", 0, '<Layout title="Users">');
    expect(layout.defs[0]).toMatchObject({ path: "src/App.tsx", line: 12 });
  });

  it("lists JSX usages as callers of a component", () => {
    const r = resolvedAt("src/components/Avatar.tsx", "Avatar", 0, "export const Avatar");
    expect(index.callers(r.key).refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`)).toEqual(["src/components/UserList.tsx:19:UserList"]);
    const list = resolvedAt("src/components/UserList.tsx", "UserList", 0, "export function UserList");
    expect(index.callers(list.key).refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`)).toEqual(["src/App.tsx:40:App.render"]);
  });

  it("resolves cross-file calls, new and types by name", () => {
    const client = resolvedAt("src/App.tsx", "ApiClient", 0, "new ApiClient(apiBase())");
    expect(client.defs[0]).toMatchObject({ path: "src/api.tsx", line: 6, kind: "class" });
    const user = resolvedAt("src/components/Avatar.tsx", "User", 0, "user: User;");
    expect(user.defs[0]).toMatchObject({ path: "src/api.tsx", line: 1, kind: "interface" });
    const props = resolvedAt("src/components/Avatar.tsx", "AvatarProps", 0, "}: AvatarProps)");
    expect(props.defs[0]).toMatchObject({ path: "src/components/Avatar.tsx", line: 3, kind: "type" });
  });

  it("prefers methods for obj.method() and top-level functions for bare calls", () => {
    const member = resolvedAt("src/App.tsx", "users", 1, "this.props.client.users()");
    expect(member.defs[0]).toMatchObject({ path: "src/api.tsx", line: 14, label: "ApiClient.users" });
    const bare = resolvedAt("src/components/UserList.tsx", "sortByName", 0, "const sorted = sortByName(users)");
    expect(bare.defs[0]).toMatchObject({ path: "src/components/UserList.tsx", line: 9, label: "sortByName" });
  });

  it("gives candidates for a name declared twice", () => {
    const r = resolveAt("src/App.tsx", "formatName", 0, "{formatName(title");
    if (r.status !== "candidates") throw new Error(r.status);
    expect(r.candidates.map((c) => c.path).sort()).toEqual(["src/api.tsx", "src/legacy/format.tsx"]);
  });

  it("finds same-file references of locals, props and callback parameters", () => {
    const sorted = resolvedAt("src/components/UserList.tsx", "sorted", 0, "const sorted");
    expect(sorted.scope).toBe("local");
    expect(index.references(sorted.key).refs.map((x) => x.line)).toEqual([17]);
    const u = resolvedAt("src/components/UserList.tsx", "u}", 0, "<Avatar user={u}");
    expect(u.defs[0].line).toBe(17);
    expect(index.references(u.key).refs.map((x) => x.line)).toEqual([18, 18, 19, 20]);
    const onSelect = resolvedAt("src/components/UserList.tsx", "onSelect", 0, "onSelect(u)");
    expect(onSelect.defs[0].line).toBe(13);
    const size = resolvedAt("src/components/Avatar.tsx", "size", 0, "width: size");
    expect(size.defs[0].line).toBe(8);
  });

  // .ts, .tsx and .js files share one name space.
  it("resolves a .tsx call to a function declared in a .ts file", () => {
    const r = resolvedAt("src/App.tsx", "apiBase", 0, "new ApiClient(apiBase())");
    expect(r.defs[0]).toMatchObject({ path: "src/config.ts", line: 1 });
  });
});
