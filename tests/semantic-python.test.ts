import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Query } from "web-tree-sitter";
import { querySource } from "../src/lib/lang/queries";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { col, host, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("python/shop"));
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

describe("Python (generic adapter)", () => {
  it("compiles the tags and locals queries", async () => {
    await host.index("probe.py", "python", "x = 1\n");
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-python.wasm"));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("python", kind);
      expect(src, kind).toBeTruthy();
      const q = new Query(language, src!);
      expect(q.captureNames.length).toBeGreaterThan(0);
      q.delete();
    }
  });

  it("records classes, methods and functions as declarations and explain blocks", () => {
    const fi = index.get("shop/models.py")!;
    expect(fi.hasErrors).toBe(false);
    expect(fi.blocks.map((b) => `${b.kind} ${b.label}`)).toEqual([
      "class LineItem",
      "method LineItem.__init__",
      "method LineItem.subtotal",
      "class Order",
      "method Order.__init__",
      "method Order.add",
      "method Order.total",
      "function apply_tax",
    ]);
    const total = fi.decls.find((d) => d.name === "total")!;
    expect(total).toMatchObject({ kind: "method", scope: "member", container: "Order" });
    expect(fi.decls.find((d) => d.name === "apply_tax")).toMatchObject({ kind: "function", scope: "top" });
    expect(fi.decls.find((d) => d.name === "TAX_RATE")).toMatchObject({ kind: "const", scope: "top" });
    // A class attribute is a member of its class.
    expect(fi.decls.find((d) => d.name === "currency")).toMatchObject({ kind: "property", scope: "member", container: "Order" });
    const block = fi.blocks.find((b) => b.label === "Order.total")!;
    expect(block.signature).toBe("def total(self)");
    expect(block.declLine).toBe(lineOf(texts, "shop/models.py", "def total(self)"));
  });

  it("resolves a function called from another file", () => {
    const r = resolveAt("shop/reports.py", "describe", 0, "describe(order) for order");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.precision).toBe("name");
    expect(r.defs[0].path).toBe("shop/formatting.py");
    expect(r.defs[0].line).toBe(lineOf(texts, "shop/formatting.py", "def describe("));
  });

  it("resolves an imported name to its declaration", () => {
    const r = resolveAt("shop/reports.py", "LineItem", 0, "from shop.models import");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0]).toMatchObject({ path: "shop/models.py", kind: "class" });
  });

  it("resolves a class instantiation and a module constant", () => {
    const cls = resolveAt("shop/reports.py", "Order", 0, 'Order("Ada")');
    if (cls.status !== "resolved") throw new Error(cls.status);
    expect(cls.defs[0].label).toBe("Order");
    const constant = resolveAt("shop/models.py", "TAX_RATE", 0, "return round(");
    if (constant.status !== "resolved") throw new Error(constant.status);
    expect(constant.defs[0].line).toBe(1);
  });

  it("resolves self.method() and obj.method() to the member", () => {
    const viaSelf = resolveAt("shop/reports.py", "render", 0, "self.render(valid)");
    if (viaSelf.status !== "resolved") throw new Error(viaSelf.status);
    expect(viaSelf.defs[0].label).toBe("Report.render");
    const viaObj = resolveAt("shop/formatting.py", "subtotal");
    if (viaObj.status !== "resolved") throw new Error(viaObj.status);
    expect(viaObj.precision).toBe("name");
    expect(viaObj.defs[0]).toMatchObject({ path: "shop/models.py", label: "LineItem.subtotal" });
  });

  it("prefers the member for obj.total() and the function for a bare total()", () => {
    const member = resolveAt("shop/reports.py", "total", 0, "sum(order.total()");
    if (member.status !== "resolved") throw new Error(member.status);
    expect(member.defs[0]).toMatchObject({ path: "shop/models.py", label: "Order.total" });
    const bare = resolveAt("shop/reports.py", "total", 0, "summary = total(valid)");
    if (bare.status !== "resolved") throw new Error(bare.status);
    expect(bare.defs[0]).toMatchObject({ path: "shop/reports.py", label: "total", kind: "function" });
  });

  it("lists callers with their enclosing function or method", () => {
    const formatPrice = index.callers(keyAt("shop/formatting.py", "format_price", 0, "def format_price"));
    expect(where(formatPrice.refs)).toEqual(["shop/formatting.py:13:describe_item", "shop/formatting.py:8:describe"]);
    const orderTotal = index.callers(keyAt("shop/models.py", "total", 0, "def total(self)"));
    expect(where(orderTotal.refs)).toEqual(["shop/formatting.py:7:describe", "shop/reports.py:7:total"]);
    const subtotal = index.callers(keyAt("shop/models.py", "subtotal", 0, "def subtotal"));
    expect(where(subtotal.refs)).toEqual(["shop/formatting.py:13:describe_item", "shop/models.py:28:Order.total"]);
    const validate = index.callers(keyAt("shop/validation.py", "validate", 0, "def validate"));
    expect(validate.refs).toEqual([]);
    expect(where(validate.possible)).toEqual(["shop/reports.py:15:Report.build"]);
  });

  it("gives candidates for a name declared twice", () => {
    const r = resolveAt("shop/reports.py", "validate", 0, "if validate(order)");
    if (r.status !== "candidates") throw new Error(r.status);
    expect(r.candidates.map((c) => c.path).sort()).toEqual(["shop/legacy.py", "shop/validation.py"]);
  });

  it("reports builtins as external", () => {
    expect(resolveAt("shop/models.py", "round").status).toBe("external");
  });

  it("resolves parameters and local variables inside their function", () => {
    const param = resolveAt("shop/models.py", "amount", 0, "return round(amount");
    if (param.status !== "resolved") throw new Error(param.status);
    expect(param.scope).toBe("local");
    expect(param.defs[0].line).toBe(lineOf(texts, "shop/models.py", "def apply_tax(amount)"));
    // `amount` in Order.total is a different variable than the parameter of apply_tax.
    const local = resolveAt("shop/models.py", "amount", 0, "return apply_tax(amount)");
    if (local.status !== "resolved") throw new Error(local.status);
    expect(local.defs[0].line).toBe(lineOf(texts, "shop/models.py", "amount = 0"));
  });

  it("finds same-file references of a local variable", () => {
    const key = keyAt("shop/models.py", "amount", 0, "amount = 0");
    const refs = index.references(key);
    expect(refs.refs.map((x) => x.line)).toEqual([28, 29]);
    expect(refs.refs.every((x) => x.role === "ref")).toBe(true);
    const valid = index.references(keyAt("shop/reports.py", "valid", 0, "valid = ["));
    expect(valid.refs.map((x) => x.line)).toEqual([16, 17]);
  });

  it("binds comprehension and loop variables", () => {
    const r = resolveAt("shop/formatting.py", "item", 1, "describe_item(item) for item");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.scope).toBe("local");
    expect(r.defs[0].line).toBe(6);
  });

  it("does not let a local variable capture obj.attribute of the same name", () => {
    // describe() has a local `total`; `order.total()` still calls Order.total.
    const call = resolveAt("shop/formatting.py", "total", 1, "total = order.total()");
    if (call.status !== "resolved") throw new Error(call.status);
    expect(call.defs[0].label).toBe("Order.total");
    const local = resolveAt("shop/formatting.py", "total", 0, "format_price(total)");
    if (local.status !== "resolved") throw new Error(local.status);
    expect(local.scope).toBe("local");
    expect(local.defs[0].line).toBe(7);
    // `self.items` in Order.add: `items` is an attribute, not a variable.
    const line = lineOf(texts, "shop/models.py", "self.items.append(item)");
    expect(index.occurrenceAt("shop/models.py", line, col(texts, "shop/models.py", line, "items"))).toBeUndefined();
  });
});
