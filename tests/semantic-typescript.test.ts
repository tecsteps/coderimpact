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
  ({ index, texts } = await indexFixture("typescript/inventory"));
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

describe("TypeScript queries", () => {
  it("compile against the grammar", async () => {
    const root = join(import.meta.dirname, "..");
    await Parser.init({ locateFile: (f: string) => join(root, "node_modules/web-tree-sitter", f) });
    const language = await Language.load(readFileSync(join(root, "public/grammars/tree-sitter-typescript.wasm")));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("typescript", kind);
      expect(src, kind).toBeTruthy();
      expect(() => new Query(language, src!).delete()).not.toThrow();
    }
  });
});

describe("TypeScript adapter", () => {
  it("parses every fixture file without errors", () => {
    for (const p of index.paths()) expect(index.get(p)!.hasErrors, p).toBe(false);
  });

  it("records classes, the constructor, methods and class-field arrows as blocks", () => {
    const fi = index.get("src/store.ts")!;
    expect(fi.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual([
      "class:BaseStore",
      "method:BaseStore.describe",
      "class:MemoryStore",
      "method:MemoryStore.constructor",
      "method:MemoryStore.find",
      "method:MemoryStore.save",
      "method:MemoryStore.refill",
      "method:MemoryStore.count",
      "method:MemoryStore.describe",
    ]);
    const refill = fi.blocks.find((b) => b.name === "refill")!;
    expect(refill).toMatchObject({ startLine: 23, endLine: 29, signature: "refill(sku: Sku, amount: number): Item | undefined" });
  });

  it("records interfaces, type aliases and enums", () => {
    const fi = index.get("src/types.ts")!;
    const decls = fi.decls.filter((d) => d.scope !== "local").map((d) => `${d.kind}:${d.fqn}`);
    expect(decls).toEqual(["type:Sku", "enum:Status", "interface:Item", "interface:Repository", "method:Repository.find", "method:Repository.save"]);
    expect(fi.blocks.map((b) => b.name)).toEqual(["Sku", "Status", "Item", "Repository", "find", "save"]);
  });

  it("records arrow functions assigned to const as functions", () => {
    const fi = index.get("src/item.ts")!;
    expect(fi.blocks.map((b) => `${b.kind}:${b.label}@${b.startLine}-${b.endLine}`)).toEqual(["function:createItem@3-6", "function:restock@8-11"]);
  });

  it("resolves cross-file calls and new by name", () => {
    const call = resolvedAt("src/store.ts", "restock", 0, "const next = restock(");
    expect(call.precision).toBe("name");
    expect(call.defs[0]).toMatchObject({ path: "src/item.ts", line: 8, kind: "function" });
    const cls = resolvedAt("src/main.ts", "MemoryStore", 0, "new MemoryStore(");
    expect(cls.defs[0]).toMatchObject({ path: "src/store.ts", line: 8, kind: "class" });
  });

  it("resolves type references to interfaces, aliases and enums", () => {
    expect(resolvedAt("src/item.ts", "Item", 1, "): Item {").defs[0]).toMatchObject({ path: "src/types.ts", line: 8, kind: "interface" });
    expect(resolvedAt("src/store.ts", "Sku", 0, "new Map<Sku, Item>").defs[0]).toMatchObject({ path: "src/types.ts", line: 1, kind: "type" });
    expect(resolvedAt("src/item.ts", "Status", 0, "Status.Active").defs[0]).toMatchObject({ path: "src/types.ts", line: 3, kind: "enum" });
    expect(resolvedAt("src/store.ts", "Repository", 0, "implements Repository").defs[0].line).toBe(14);
    expect(resolvedAt("src/store.ts", "BaseStore", 0, "extends BaseStore").defs[0].line).toBe(4);
  });

  it("prefers methods for obj.method() and top-level functions for bare calls", () => {
    const member = resolvedAt("src/main.ts", "count", 0, "store.count(), count([found])");
    expect(member.defs[0]).toMatchObject({ path: "src/store.ts", line: 31, label: "MemoryStore.count" });
    const bare = resolvedAt("src/main.ts", "count", 1, "store.count(), count([found])");
    expect(bare.defs[0]).toMatchObject({ path: "src/report.ts", line: 5, label: "count" });
    expect(resolvedAt("src/main.ts", "refill").defs[0].label).toBe("MemoryStore.refill");
  });

  it("gives candidates for a name declared twice", () => {
    const fn = resolveAt("src/main.ts", "formatLine", 0, "console.log(formatLine(");
    if (fn.status !== "candidates") throw new Error(fn.status);
    expect(fn.candidates.map((c) => c.path).sort()).toEqual(["src/legacy.ts", "src/report.ts"]);
    // By name, an interface signature and its implementation are both candidates.
    const save = resolveAt("src/main.ts", "save", 0, "store.save(");
    if (save.status !== "candidates") throw new Error(save.status);
    expect(save.candidates.map((c) => c.label).sort()).toEqual(["MemoryStore.save", "Repository.save"]);
  });

  it("lists callers with their enclosing function or method", () => {
    const r = resolvedAt("src/item.ts", "createItem", 0, "export function createItem");
    expect(index.callers(r.key).refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`)).toEqual(["src/item.ts:10:restock", "src/main.ts:7:run"]);
    const count = resolvedAt("src/store.ts", "count", 0, "count = ()");
    expect(index.callers(count.key).refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`)).toEqual(["src/main.ts:11:run", "src/store.ts:34:MemoryStore.describe"]);
  });

  it("finds same-file references of locals and parameters", () => {
    const total = resolvedAt("src/report.ts", "total", 0, "let total = 0");
    expect(total.scope).toBe("local");
    expect(index.references(total.key).refs.map((x) => x.line)).toEqual([8, 10]);
    const loopVar = resolvedAt("src/report.ts", "item", 0, "total += item.qty");
    expect(loopVar.defs[0].line).toBe(7);
    const param = resolvedAt("src/store.ts", "amount", 0, "restock(current, amount)");
    expect(param.defs[0].line).toBe(23);
    const shorthand = resolvedAt("src/item.ts", "status", 0, "return { sku, qty, status }");
    expect(shorthand.defs[0].line).toBe(4);
    // `qty` in restock is its own local, not createItem's parameter.
    const inner = resolvedAt("src/item.ts", "qty", 0, "return createItem(item.sku, qty)");
    expect(inner.defs[0].line).toBe(9);
  });
});
