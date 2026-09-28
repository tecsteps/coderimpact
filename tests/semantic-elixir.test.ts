import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Query } from "web-tree-sitter";
import { querySource } from "../src/lib/lang/queries";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { col, host, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("elixir/shop"));
});

function resolveAt(path: string, needle: string, nth = 0, onLineWith = needle) {
  const line = lineOf(texts, path, onLineWith);
  const c = col(texts, path, line, needle, nth);
  const hit = index.occurrenceAt(path, line, c);
  if (!hit) throw new Error(`no occurrence at ${path}:${line}:${c}`);
  return index.resolveOccurrence(path, hit.index);
}

function keyAt(path: string, needle: string, nth = 0, onLineWith = needle): string {
  const r = resolveAt(path, needle, nth, onLineWith);
  if (r.status !== "resolved") throw new Error(`${needle}: ${r.status}`);
  return r.key;
}

const where = (locs: { path: string; line: number; enclosing?: string }[]) => locs.map((l) => `${l.path}:${l.line}:${l.enclosing ?? ""}`).sort();

const CART = "lib/shop/cart.ex";
const PRICING = "lib/shop/pricing.ex";
const RECEIPT = "lib/shop/receipt.ex";
const CLI = "lib/shop/cli.ex";

describe("Elixir (generic adapter)", () => {
  it("compiles the tags and locals queries", async () => {
    await host.index("probe.ex", "elixir", "x = 1\n");
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-elixir.wasm"));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("elixir", kind);
      expect(src, kind).toBeTruthy();
      const q = new Query(language, src!);
      expect(q.captureNames.length).toBeGreaterThan(0);
      q.delete();
    }
  });

  it("records modules and functions as declarations and explain blocks", () => {
    const fi = index.get(CART)!;
    expect(fi.hasErrors).toBe(false);
    expect(fi.blocks.map((b) => `${b.kind} ${b.label}`)).toEqual([
      "class Shop.Cart",
      "method Shop.Cart.new",
      "method Shop.Cart.add",
      "method Shop.Cart.total",
      "method Shop.Cart.sum",
    ]);
    expect(fi.decls.find((d) => d.name === "Shop.Cart")).toMatchObject({ kind: "class", scope: "top" });
    expect(fi.decls.find((d) => d.name === "sum")).toMatchObject({ kind: "method", scope: "member", container: "Shop.Cart" });
    const total = fi.blocks.find((b) => b.name === "total")!;
    expect(total.signature).toBe("def total(cart) do");
    expect([total.startLine, total.endLine]).toEqual([12, 15]);
    // Module attributes with a value are constants of the module.
    expect(index.get(PRICING)!.decls.find((d) => d.name === "rate")).toMatchObject({ kind: "const", scope: "member" });
  });

  it("does not record def, defmodule or alias as calls", () => {
    const names = index.get(CART)!.occurrences.map((o) => o.name);
    for (const kw of ["def", "defp", "defmodule", "alias", "defstruct"]) expect(names).not.toContain(kw);
  });

  it("resolves a remote call to a function in another file", () => {
    const r = resolveAt(CART, "with_tax");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.precision).toBe("name");
    expect(r.defs[0]).toMatchObject({ path: PRICING, label: "Shop.Pricing.with_tax" });
    const piped = resolveAt(CLI, "add", 0, "|> Cart.add(%{name: \"Book\"");
    if (piped.status !== "resolved") throw new Error(piped.status);
    expect(piped.defs[0]).toMatchObject({ path: CART, label: "Shop.Cart.add" });
  });

  it("resolves a fully qualified module name", () => {
    const r = resolveAt(CART, "Shop.Pricing", 0, "alias Shop.Pricing");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0]).toMatchObject({ path: PRICING, kind: "class" });
  });

  it("resolves local calls, pipes, captures and module attributes in the same module", () => {
    const local = resolveAt(CART, "sum", 0, "subtotal = sum(");
    if (local.status !== "resolved") throw new Error(local.status);
    expect(local.defs[0].label).toBe("Shop.Cart.sum");
    const pipe = resolveAt(PRICING, "round_price", 0, "|> round_price()");
    if (pipe.status !== "resolved") throw new Error(pipe.status);
    expect(pipe.defs[0].line).toBe(lineOf(texts, PRICING, "def round_price"));
    const capture = resolveAt(RECEIPT, "line", 1, "&line/1");
    if (capture.status !== "resolved") throw new Error(capture.status);
    expect(capture.defs[0].label).toBe("Shop.Receipt.line");
    const attr = resolveAt(PRICING, "rate", 0, "Kernel.*(1 + @rate)");
    if (attr.status !== "resolved") throw new Error(attr.status);
    expect(attr.defs[0].line).toBe(2);
  });

  it("prefers the function for Cart.total(...) over a local variable named total", () => {
    const remote = resolveAt(RECEIPT, "total", 1, "total = Cart.total(cart)");
    if (remote.status !== "resolved") throw new Error(remote.status);
    expect(remote.defs[0]).toMatchObject({ path: CART, label: "Shop.Cart.total" });
    const variable = resolveAt(RECEIPT, "total", 0, "Pricing.format(total)");
    if (variable.status !== "resolved") throw new Error(variable.status);
    expect(variable.scope).toBe("local");
    expect(variable.defs[0].line).toBe(7);
  });

  it("lists callers with their enclosing Module.function", () => {
    const total = index.callers(keyAt(CART, "total", 0, "def total(cart)"));
    expect(where(total.refs)).toEqual(["lib/shop/cli.ex:12:Shop.CLI.main", "lib/shop/receipt.ex:7:Shop.Receipt.render"]);
    const add = index.callers(keyAt(CART, "add", 0, "def add("));
    expect(where(add.refs)).toEqual(["lib/shop/cli.ex:8:Shop.CLI.main", "lib/shop/cli.ex:9:Shop.CLI.main"]);
    const roundPrice = index.callers(keyAt(PRICING, "round_price", 0, "def round_price"));
    expect(where(roundPrice.refs)).toEqual(["lib/shop/pricing.ex:17:Shop.Pricing.format", "lib/shop/pricing.ex:8:Shop.Pricing.with_tax"]);
    const render = index.callers(keyAt(RECEIPT, "render", 0, "def render"));
    expect(where(render.refs)).toEqual(["lib/shop/cli.ex:11:Shop.CLI.main", "lib/shop/receipt.ex:13:Shop.Receipt.format"]);
  });

  it("uses the module qualifier when a function name is declared in two modules", () => {
    const r = resolveAt(CLI, "format", 0, "Shop.Pricing.format(");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs.map((c) => c.label)).toEqual(["Shop.Pricing.format"]);
  });

  it("resolves parameters and variables inside their function clause", () => {
    const param = resolveAt(CART, "cart", 0, "subtotal = sum(cart.items)");
    if (param.status !== "resolved") throw new Error(param.status);
    expect(param.scope).toBe("local");
    expect(param.defs[0].line).toBe(lineOf(texts, CART, "def total(cart)"));
    // `cart` in add/2 is another variable.
    const other = resolveAt(CART, "cart", 0, "%{cart | items");
    if (other.status !== "resolved") throw new Error(other.status);
    expect(other.defs[0].line).toBe(lineOf(texts, CART, "def add(cart, item)"));
    // Anonymous function parameters.
    const acc = resolveAt(CART, "acc", 1, "acc + item.price");
    if (acc.status !== "resolved") throw new Error(acc.status);
    expect(acc.defs[0].col).toBe(col(texts, CART, 18, "acc"));
  });

  it("finds same-file references of a local variable", () => {
    const subtotal = index.references(keyAt(CART, "subtotal", 0, "subtotal = "));
    expect(subtotal.refs.map((x) => x.line)).toEqual([14]);
    expect(subtotal.refs.every((x) => x.role === "ref")).toBe(true);
    const lines = index.references(keyAt(RECEIPT, "lines", 0, "lines = "));
    expect(lines.refs.map((x) => x.line)).toEqual([8]);
    const amount = index.references(keyAt(PRICING, "amount", 0, "def round_price(amount)"));
    expect(amount.refs.map((x) => `${x.line}:${x.col}`)).toEqual(["14:41", "14:66"]);
  });

  it.todo("resolves a multi-clause function (discount/2) to all of its clauses instead of candidates");
  it.todo("resolves an aliased module reference (Cart after `alias Shop.Cart`) to Shop.Cart");
  it.todo("resolves Pricing.format in receipt.ex by its module alias instead of the same-file Receipt.format");
});
