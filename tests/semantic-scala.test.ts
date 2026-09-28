import { beforeAll, describe, expect, it } from "vitest";
import { Language, Query } from "web-tree-sitter";
import { join } from "node:path";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, host, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;
const P = "src/main/scala/com/acme/shop/";
const ORDER = `${P}model/Order.scala`;
const ITEM = `${P}model/Item.scala`;
const SERVICE = `${P}service/OrderService.scala`;
const FORMATTER = `${P}util/PriceFormatter.scala`;
const REPO = `${P}repo/OrderRepository.scala`;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("scala/shop"));
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

describe("Scala adapter", () => {
  it("compiles the tags and locals queries", async () => {
    await host.index("A.scala", "scala", "class A");
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-scala.wasm"));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("scala", kind);
      expect(src).toBeTruthy();
      expect(() => new Query(language, src!)).not.toThrow();
    }
  });

  it("records classes, traits, objects and defs as blocks", () => {
    for (const path of index.paths()) expect(index.get(path)!.hasErrors, path).toBe(false);
    const fi = index.get(ORDER)!;
    expect(fi.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual([
      "class:Order",
      "method:Order.this",
      "method:Order.addItem",
      "method:Order.total",
      "method:Order.describe",
      "method:Order.summary",
      "class:Order",
      "method:Order.empty",
    ]);
    expect(fi.blocks[0].signature).toBe("class Order(val id: String)");
    expect(fi.decls.filter((d) => d.kind === "property").map((d) => d.fqn)).toEqual(["Order.id", "Order.items"]);
    // Local vals are not members.
    expect(fi.decls.find((d) => d.name === "sum")!.scope).toBe("local");
    const trait = index.get(`${P}service/Service.scala`)!;
    expect(trait.decls[0].kind).toBe("interface");
    expect(trait.blocks.map((b) => b.label)).toEqual(["Service", "Service.run"]);
    expect(index.get(FORMATTER)!.blocks.map((b) => b.label)).toEqual(["PriceFormatter", "PriceFormatter.format", "PriceFormatter.formatAll"]);
  });

  it("resolves a case class apply Foo() to the class in another file", () => {
    const r = resolved(SERVICE, "Item", 'order.addItem(Item("sku-"', 1);
    expect(r.precision).toBe("name");
    expect(r.kind).toBe("class");
    expect(r.defs[0].path).toBe(ITEM);
  });

  it("resolves new Foo() to the class and its companion object as one symbol", () => {
    // Both are top-level declarations named Order with the same key: one symbol, two definitions.
    const r = resolveAt(SERVICE, "Order", "new Order(key)");
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.defs.map((c) => `${c.path}:${c.kind}`)).toEqual([`${ORDER}:class`, `${ORDER}:class`]);
  });

  it("resolves type references and supertypes", () => {
    expect(resolved(SERVICE, "OrderRepository", "class OrderService(repo: OrderRepository)").defs[0].path).toBe(REPO);
    const s = resolved(SERVICE, "Service", "extends Service", 1);
    expect(s.kind).toBe("interface");
    expect(resolved(ORDER, "Item", "ListBuffer[Item]").defs[0].path).toBe(ITEM);
  });

  it("resolves obj.method() and Object.method() across files", () => {
    expect(resolved(SERVICE, "addItem").defs[0].label).toBe("Order.addItem");
    expect(resolved(SERVICE, "format", "PriceFormatter.format(")).toMatchObject({ precision: "name" });
    expect(resolved(SERVICE, "format", "PriceFormatter.format(").defs[0].label).toBe("PriceFormatter.format");
    const obj = resolved(SERVICE, "PriceFormatter", "PriceFormatter.format(");
    expect(obj.defs[0].path).toBe(FORMATTER);
    expect(resolved(SERVICE, "empty", "Order.empty()").defs[0].label).toBe("Order.empty");
    expect(resolved(ORDER, "price", "item.price()").defs[0].label).toBe("Item.price");
    expect(resolved(SERVICE, "save", "repo.save(").defs[0].path).toBe(REPO);
  });

  it("resolves a class parameter used as a receiver", () => {
    const r = resolved(SERVICE, "repo", "repo.save(");
    expect(r.defs[0].label).toBe("OrderService.repo");
  });

  it("lists callers with their enclosing def, even next to a local of the same name", () => {
    const total = resolved(ORDER, "total", "def total()");
    const where = index.callers(total.key).refs.map((c) => `${c.path.split("/").pop()}:${c.line}:${c.enclosing}`);
    const at = (s: string) => lineOf(texts, SERVICE, s);
    expect(where).toEqual([
      `Order.scala:${lineOf(texts, ORDER, 'id + ": " + total()')}:Order.describe`,
      `OrderService.scala:${at("val total = order.total()")}:OrderService.run`,
      `OrderService.scala:${at("if (order.total() > 0)")}:OrderService.place`,
    ]);
    const fmt = resolved(FORMATTER, "format", "def format(cents: Long)");
    expect(index.callers(fmt.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.run", "PriceFormatter.formatAll"]);
    const log = resolved(SERVICE, "log", "private def log(");
    expect(index.callers(log.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.run", "OrderService.run"]);
  });

  it("gives candidates for a method declared in two classes", () => {
    const r = resolveAt(SERVICE, "describe", "log(order.describe())");
    expect(r.status).toBe("candidates");
    if (r.status !== "candidates") return;
    expect(r.candidates.map((c) => c.label).sort()).toEqual(["Item.describe", "Order.describe"]);
    expect(resolved(ORDER, "describe", "def summary()").defs[0].label).toBe("Order.describe");
  });

  it("finds same-file references of locals and parameters", () => {
    const order = resolved(SERVICE, "order", "val order = new Order(key)");
    expect(order.scope).toBe("local");
    const at = (s: string) => lineOf(texts, SERVICE, s);
    expect(index.references(order.key).refs.map((x) => x.line)).toEqual([at("order.addItem("), at("repo.save(key, order)"), at("if (order.total()"), at("if (order.total()")]);
    expect(resolved(SERVICE, "order", "val total = order.total()").defs[0].line).toBe(at('val order = place("o-1"'));
    const total = resolved(SERVICE, "total", "PriceFormatter.format(total)");
    expect(total.scope).toBe("local");
    expect(total.defs[0].line).toBe(at("val total = order.total()"));
    expect(resolved(SERVICE, "key", "repo.save(key, order)").defs[0].line).toBe(at("def place(key: String"));
    // Parameters of two methods in one class do not share a scope.
    expect(resolved(REPO, "key", "store.get(key)").defs[0].line).toBe(lineOf(texts, REPO, "def find(key: String)"));
    const item = resolved(ORDER, "item", "sum += item.price()");
    expect(item.defs[0].line).toBe(lineOf(texts, ORDER, "for (item <- items)"));
    expect(index.references(resolved(ORDER, "sum", "var sum = 0L").key).refs).toHaveLength(2);
    expect(resolved(FORMATTER, "v", "format(v)", 1).scope).toBe("local");
    expect(resolved(FORMATTER, "euros", "s\"$euros").defs[0].line).toBe(lineOf(texts, FORMATTER, "val euros ="));
  });

  it("reports library calls as external", () => {
    expect(resolveAt(SERVICE, "println").status).toBe("external");
  });
});
