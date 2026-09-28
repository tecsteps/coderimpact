import { beforeAll, describe, expect, it } from "vitest";
import { Language, Query } from "web-tree-sitter";
import { join } from "node:path";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, host, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;
const P = "src/main/kotlin/com/acme/shop/";
const ORDER = `${P}model/Order.kt`;
const ITEM = `${P}model/Item.kt`;
const SERVICE = `${P}service/OrderService.kt`;
const FORMATTER = `${P}util/PriceFormatter.kt`;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("kotlin/shop"));
});

function resolveAt(path: string, needle: string, onLineWith = needle, nth = 0) {
  const line = lineOf(texts, path, onLineWith);
  const c = col(texts, path, line, needle, nth);
  const hit = index.occurrenceAt(path, line, c);
  if (!hit) throw new Error(`no occurrence at ${path}:${line}:${c}`);
  return index.resolveOccurrence(path, hit.index);
}

function resolved(path: string, needle: string, onLineWith = needle, nth = 0) {
  const r = resolveAt(path, needle, onLineWith, nth);
  if (r.status !== "resolved") throw new Error(`${needle}: ${r.status}`);
  return r;
}

describe("Kotlin adapter", () => {
  it("compiles the tags and locals queries", async () => {
    await host.index("A.kt", "kotlin", "class A");
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-kotlin.wasm"));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("kotlin", kind);
      expect(src).toBeTruthy();
      expect(() => new Query(language, src!)).not.toThrow();
    }
  });

  it("records classes, objects, constructors, methods and top-level functions as blocks", () => {
    for (const path of index.paths()) expect(index.get(path)!.hasErrors, path).toBe(false);
    const fi = index.get(ORDER)!;
    expect(fi.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual([
      "class:Order",
      "method:Order.constructor",
      "method:Order.addItem",
      "method:Order.total",
      "method:Order.describe",
      "method:Order.summary",
      "method:Order.empty",
    ]);
    expect(fi.blocks[0].signature).toBe("class Order(private val id: String)");
    const item = index.get(ITEM)!;
    expect(item.blocks.map((b) => b.label)).toEqual(["Item", "Item.price", "Item.describe"]);
    expect(item.decls.filter((d) => d.kind === "property").map((d) => d.fqn)).toEqual(["Item.sku", "Item.cents"]);
    const fmt = index.get(FORMATTER)!;
    expect(fmt.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual(["class:PriceFormatter", "method:PriceFormatter.format", "function:formatAll"]);
    expect(fmt.decls.find((d) => d.name === "CURRENCY")!.scope).toBe("member");
    const iface = index.get(`${P}service/Service.kt`)!;
    expect(iface.decls[0].kind).toBe("interface");
    expect(iface.blocks.map((b) => b.label)).toEqual(["Service", "Service.run"]);
  });

  it("resolves a constructor call Foo() to the class in another file", () => {
    const r = resolved(SERVICE, "Order", "val order = Order(key)");
    expect(r.precision).toBe("name");
    expect(r.kind).toBe("class");
    expect(r.defs[0].path).toBe(ORDER);
    expect(r.defs[0].line).toBe(lineOf(texts, ORDER, "class Order("));
    expect(resolved(SERVICE, "Item", "Item(\"sku-", 1).defs[0].path).toBe(ITEM);
  });

  it("resolves type references and supertypes", () => {
    expect(resolved(SERVICE, "OrderRepository", "private val repo: OrderRepository").defs[0].path).toBe(`${P}repo/OrderRepository.kt`);
    const s = resolved(SERVICE, "Service", ") : Service", 1);
    expect(s.kind).toBe("interface");
    expect(resolved(SERVICE, "Order", "): Order {").kind).toBe("class");
  });

  it("resolves obj.method(), Object.method() and companion calls across files", () => {
    expect(resolved(SERVICE, "addItem").defs[0].label).toBe("Order.addItem");
    expect(resolved(SERVICE, "format", "PriceFormatter.format(").defs[0].label).toBe("PriceFormatter.format");
    const obj = resolved(SERVICE, "PriceFormatter", "PriceFormatter.format(");
    expect(obj.kind).toBe("class");
    expect(obj.defs[0].path).toBe(FORMATTER);
    expect(resolved(SERVICE, "empty", "Order.empty()").defs[0].label).toBe("Order.empty");
    expect(resolved(ORDER, "price", "item.price()").defs[0].label).toBe("Item.price");
  });

  it("resolves a top-level function called from another file", () => {
    const r = resolved(SERVICE, "formatAll", "formatAll(listOf(");
    expect(r.kind).toBe("function");
    expect(r.defs[0].path).toBe(FORMATTER);
  });

  it("prefers members for obj.name() and top-level functions for a bare name", () => {
    const bare = resolved(SERVICE, "format", "println(format(message))");
    expect(bare.defs[0].path).toBe(`${P}util/Text.kt`);
    expect(bare.kind).toBe("function");
    const member = resolved(FORMATTER, "format", "PriceFormatter.format(v)", 1);
    expect(member.defs[0].label).toBe("PriceFormatter.format");
  });

  it("resolves a val constructor parameter used as a receiver", () => {
    const r = resolved(SERVICE, "repo", "repo.save(");
    expect(r.defs[0].label).toBe("OrderService.repo");
    expect(r.kind).toBe("property");
  });

  it("lists callers with their enclosing function", () => {
    const total = resolved(ORDER, "total", "fun total()");
    const where = index.callers(total.key).refs.map((c) => `${c.path.split("/").pop()}:${c.line}:${c.enclosing}`);
    const at = (s: string) => lineOf(texts, SERVICE, s);
    expect(where).toEqual([
      `Order.kt:${lineOf(texts, ORDER, 'return id + ": " + total()')}:Order.describe`,
      `OrderService.kt:${at("PriceFormatter.format(order.total())")}:OrderService.run`,
      `OrderService.kt:${at("formatAll(listOf(")}:OrderService.run`,
      `OrderService.kt:${at("if (order.total() > 0)")}:OrderService.place`,
    ]);
    const fmt = resolved(FORMATTER, "format", "fun format(cents: Long)");
    expect(index.callers(fmt.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.run", "formatAll"]);
    const log = resolved(SERVICE, "log", "private fun log(");
    expect(index.callers(log.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.run", "OrderService.run"]);
  });

  it("gives candidates for a method declared in two classes", () => {
    const r = resolveAt(SERVICE, "describe", "log(order.describe())");
    expect(r.status).toBe("candidates");
    if (r.status !== "candidates") return;
    expect(r.candidates.map((c) => c.label).sort()).toEqual(["Item.describe", "Order.describe"]);
    const same = resolved(ORDER, "describe", "fun summary()");
    expect(same.defs[0].label).toBe("Order.describe");
  });

  it("finds same-file references of locals, parameters and loop variables", () => {
    const order = resolved(SERVICE, "order", "val order = Order(key)");
    expect(order.scope).toBe("local");
    const at = (s: string) => lineOf(texts, SERVICE, s);
    expect(index.references(order.key).refs.map((x) => x.line)).toEqual([at("order.addItem("), at("repo.save(key, order)"), at("if (order.total()"), at("if (order.total()")]);
    expect(resolved(SERVICE, "order", "PriceFormatter.format(order.total())").defs[0].line).toBe(at('val order = place("o-1"'));
    expect(resolved(SERVICE, "key", "repo.save(key, order)").defs[0].line).toBe(at("fun place(key: String"));
    const item = resolved(ORDER, "item", "sum += item.price()");
    expect(item.defs[0].line).toBe(lineOf(texts, ORDER, "for (item in items)"));
    expect(index.references(resolved(ORDER, "sum", "var sum = 0L").key).refs).toHaveLength(2);
    const v = resolved(FORMATTER, "v", "PriceFormatter.format(v)", 1);
    expect(v.scope).toBe("local");
  });

  it("reports library calls as external", () => {
    expect(resolveAt(SERVICE, "println").status).toBe("external");
    expect(resolveAt(SERVICE, "listOf").status).toBe("external");
  });
});
