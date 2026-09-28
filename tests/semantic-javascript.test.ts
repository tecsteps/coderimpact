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
  ({ index, texts } = await indexFixture("javascript/shop"));
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

describe("JavaScript queries", () => {
  it("compile against the grammar", async () => {
    const root = join(import.meta.dirname, "..");
    await Parser.init({ locateFile: (f: string) => join(root, "node_modules/web-tree-sitter", f) });
    const language = await Language.load(readFileSync(join(root, "public/grammars/tree-sitter-javascript.wasm")));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("javascript", kind);
      expect(src, kind).toBeTruthy();
      expect(() => new Query(language, src!).delete()).not.toThrow();
    }
  });
});

describe("JavaScript adapter", () => {
  it("parses every fixture file without errors", () => {
    for (const p of index.paths()) expect(index.get(p)!.hasErrors, p).toBe(false);
  });

  it("records classes, methods, the constructor and class-field arrows as blocks", () => {
    const fi = index.get("src/cart.js")!;
    const labels = fi.blocks.map((b) => `${b.kind}:${b.label}`);
    expect(labels).toEqual([
      "class:Cart",
      "method:Cart.constructor",
      "method:Cart.add",
      "method:Cart.total",
      "method:Cart.onChange",
      "function:summarize",
      "function:total",
      "function:sample",
    ]);
    const cls = fi.blocks.find((b) => b.name === "Cart")!;
    expect(cls.startLine).toBe(4);
    expect(cls.endLine).toBe(24);
    const add = fi.decls.find((d) => d.name === "add")!;
    expect(add).toMatchObject({ kind: "method", scope: "member", container: "Cart" });
  });

  it("records arrow functions assigned to const as functions", () => {
    const money = index.get("src/util/money.js")!;
    const sumOf = money.blocks.find((b) => b.name === "sumOf")!;
    expect(sumOf).toMatchObject({ kind: "function", startLine: 6, endLine: 12 });
    const view = index.get("src/view.jsx")!;
    expect(view.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual(["function:Price", "function:CartView"]);
  });

  it("resolves a cross-file function call by name", () => {
    const r = resolvedAt("src/cart.js", "sumOf", 0, "return sumOf(amounts)");
    expect(r.precision).toBe("name");
    expect(r.defs[0]).toMatchObject({ path: "src/util/money.js", line: 6 });
  });

  it("resolves new Foo() to the class in another file", () => {
    const r = resolvedAt("src/app.js", "Product", 0, "new Product(");
    expect(r.precision).toBe("name");
    expect(r.defs[0]).toMatchObject({ path: "src/models/product.js", line: 4, kind: "class" });
  });

  it("resolves an imported name to its exported declaration", () => {
    const r = resolvedAt("src/app.js", "summarize", 0, "import { Cart, summarize");
    expect(r.defs[0]).toMatchObject({ path: "src/cart.js", line: 26 });
  });

  it("prefers methods for obj.method() and top-level functions for bare calls", () => {
    const member = resolvedAt("src/app.js", "total", 0, "cart.total(), total([cart])");
    expect(member.defs[0]).toMatchObject({ path: "src/cart.js", line: 16, label: "Cart.total", kind: "method" });
    const bare = resolvedAt("src/app.js", "total", 1, "cart.total(), total([cart])");
    expect(bare.defs[0]).toMatchObject({ path: "src/cart.js", line: 31, label: "total", kind: "function" });
    const method = resolvedAt("src/app.js", "withDiscount");
    expect(method.defs[0].label).toBe("Product.withDiscount");
  });

  it("gives candidates for a name declared twice", () => {
    const r = resolveAt("src/app.js", "slugify", 0, "console.log(slugify(");
    expect(r.status).toBe("candidates");
    if (r.status !== "candidates") return;
    expect(r.candidates.map((c) => c.path).sort()).toEqual(["src/legacy/text.js", "src/util/money.js"]);
  });

  it("lists callers with their enclosing function or method", () => {
    const r = resolvedAt("src/util/money.js", "sumOf", 0, "export const sumOf");
    const where = index.callers(r.key).refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`);
    expect(where).toEqual(["src/cart.js:18:Cart.total", "src/cart.js:32:total"]);

    const total = resolvedAt("src/cart.js", "total", 0, "  total() {");
    const callers = index.callers(total.key).refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`);
    expect(callers).toEqual([
      "src/app.js:11:main",
      "src/cart.js:22:Cart.onChange",
      "src/cart.js:27:summarize",
      "src/cart.js:32:total",
      "src/view.jsx:6:CartView",
    ]);
  });

  it("treats JSX components as calls of the component", () => {
    const r = resolvedAt("src/view.jsx", "Price", 0, "<Price value");
    expect(r.defs[0]).toMatchObject({ path: "src/view.jsx", line: 3 });
    const callers = index.callers(r.key).refs.map((c) => `${c.line}:${c.enclosing}`);
    expect(callers).toEqual(["9:CartView"]);
  });

  it("finds same-file references of a local variable and parameters", () => {
    const acc = resolvedAt("src/util/money.js", "acc", 0, "let acc = 0");
    expect(acc.scope).toBe("local");
    expect(index.references(acc.key).refs.map((x) => x.line)).toEqual([9, 11]);

    const v = resolvedAt("src/util/money.js", "v", 0, "acc += v");
    expect(v.defs[0].line).toBe(8);

    const param = resolvedAt("src/models/product.js", "price", 1, "this.price = price");
    expect(param.scope).toBe("local");
    expect(param.defs[0].line).toBe(5);

    const destructured = resolvedAt("src/view.jsx", "cart", 0, "cart.total()");
    expect(destructured.defs[0].line).toBe(5);
  });
});
