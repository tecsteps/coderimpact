import { beforeAll, describe, expect, it } from "vitest";
import { Language, Query } from "web-tree-sitter";
import { join } from "node:path";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, host, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;
const P = "src/main/java/com/acme/shop/";
const ORDER = `${P}model/Order.java`;
const ITEM = `${P}model/Item.java`;
const SERVICE = `${P}service/OrderService.java`;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("java/shop"));
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

describe("Java adapter", () => {
  it("compiles the tags and locals queries", async () => {
    await host.index("A.java", "java", "class A {}");
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-java.wasm"));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("java", kind);
      expect(src).toBeTruthy();
      expect(() => new Query(language, src!)).not.toThrow();
    }
  });

  it("records classes, interfaces, constructors and methods as blocks", () => {
    const fi = index.get(ORDER)!;
    expect(fi.hasErrors).toBe(false);
    const labels = fi.blocks.map((b) => `${b.kind}:${b.label}`);
    expect(labels).toEqual([
      "class:Order",
      "method:Order.Order",
      "method:Order.empty",
      "method:Order.addItem",
      "method:Order.total",
      "method:Order.describe",
      "method:Order.summary",
    ]);
    const cls = fi.blocks[0];
    expect(cls.declLine).toBe(lineOf(texts, ORDER, "public class Order"));
    expect(cls.signature).toBe("public class Order");
    const iface = index.get(`${P}service/Service.java`)!.blocks.map((b) => `${b.kind}:${b.label}`);
    expect(iface).toEqual(["class:Service", "method:Service.run"]);
    expect(index.get(`${P}service/Service.java`)!.decls.find((d) => d.name === "Service")!.kind).toBe("interface");
  });

  it("resolves new Foo() to the class in another file, not its constructor", () => {
    const r = resolved(SERVICE, "Order", "Order order = new Order(key)", 1);
    expect(r.precision).toBe("name");
    expect(r.kind).toBe("class");
    expect(r.defs[0].path).toBe(ORDER);
    expect(r.defs[0].line).toBe(lineOf(texts, ORDER, "public class Order"));
  });

  it("resolves type references in declarations and implements clauses", () => {
    const t = resolved(SERVICE, "OrderRepository", "private final OrderRepository repo");
    expect(t.defs[0].path).toBe(`${P}repo/OrderRepository.java`);
    const i = resolved(SERVICE, "Service", "implements Service", 1);
    expect(i.defs[0].path).toBe(`${P}service/Service.java`);
    expect(i.kind).toBe("interface");
  });

  it("resolves obj.method() and Type.staticMethod() across files", () => {
    const add = resolved(SERVICE, "addItem");
    expect(add.defs[0].label).toBe("Order.addItem");
    expect(add.defs[0].path).toBe(ORDER);
    const fmt = resolved(SERVICE, "format", "PriceFormatter.format(");
    expect(fmt.defs[0].label).toBe("PriceFormatter.format");
    const cls = resolved(SERVICE, "PriceFormatter", "PriceFormatter.format(");
    expect(cls.kind).toBe("class");
    expect(cls.defs[0].path).toBe(`${P}util/PriceFormatter.java`);
    const empty = resolved(SERVICE, "empty", "Order.empty()");
    expect(empty.defs[0].label).toBe("Order.empty");
    expect(resolved(SERVICE, "Order", "Order.empty()", 1).kind).toBe("class");
  });

  it("resolves a field receiver and this.field to the field declaration", () => {
    const recv = resolved(SERVICE, "repo", "repo.save(");
    expect(recv.defs[0].label).toBe("OrderService.repo");
    const field = resolved(SERVICE, "repo", "this.repo = repo", 0);
    expect(field.defs[0].label).toBe("OrderService.repo");
    const param = resolved(SERVICE, "repo", "this.repo = repo", 1);
    expect(param.scope).toBe("local");
    expect(param.defs[0].line).toBe(lineOf(texts, SERVICE, "public OrderService(OrderRepository repo)"));
  });

  it("lists callers with their enclosing method", () => {
    const total = resolved(ORDER, "total", "public long total()");
    const where = index.callers(total.key).refs.map((c) => `${c.path.split("/").pop()}:${c.enclosing}`).sort();
    expect(where).toEqual(["Order.java:Order.describe", "OrderService.java:OrderService.run"]);
    const log = resolved(SERVICE, "log", "private void log(");
    expect(index.callers(log.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.run", "OrderService.run"]);
    const place = resolved(SERVICE, "place", "public Order place(");
    expect(index.callers(place.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.run"]);
  });

  it("gives candidates for a method declared in two classes", () => {
    const r = resolveAt(SERVICE, "describe", "log(order.describe())");
    expect(r.status).toBe("candidates");
    if (r.status !== "candidates") return;
    expect(r.candidates.map((c) => c.label).sort()).toEqual(["Item.describe", "Order.describe"]);
    // Inside Order.java the bare call prefers the declaration in the same file.
    const same = resolved(ORDER, "describe", "return describe();");
    expect(same.defs[0].label).toBe("Order.describe");
    expect(same.defs[0].path).toBe(ORDER);
    const refs = index.references(same.key);
    expect(refs.possible.map((x) => x.path)).toEqual([SERVICE]);
  });

  it("finds same-file references of locals and parameters", () => {
    const order = resolved(SERVICE, "order", "Order order = new Order(key)");
    expect(order.scope).toBe("local");
    const lines = index.references(order.key).refs.map((x) => x.line);
    const at = (s: string) => lineOf(texts, SERVICE, s);
    expect(lines).toEqual([at("order.addItem("), at("repo.save(key, order)"), at("return order != null"), at("return order != null")]);
    // The local in run() is a different declaration.
    const runOrder = resolved(SERVICE, "order", "order.total()");
    expect(runOrder.defs[0].line).toBe(at("Order order = place("));
    const key = resolved(SERVICE, "key", "repo.save(key, order)");
    expect(key.defs[0].line).toBe(at("public Order place("));
    const item = resolved(ORDER, "item", "sum += item.price()");
    expect(item.defs[0].line).toBe(lineOf(texts, ORDER, "for (Item item : items)"));
  });

  it("reports library calls as external", () => {
    const r = resolveAt(SERVICE, "println");
    expect(r.status).toBe("external");
  });
});
