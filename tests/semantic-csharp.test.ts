import { beforeAll, describe, expect, it } from "vitest";
import { Language, Query } from "web-tree-sitter";
import { join } from "node:path";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, host, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;
const ORDER = "Models/Order.cs";
const ITEM = "Models/Item.cs";
const SERVICE = "Services/OrderService.cs";

beforeAll(async () => {
  ({ index, texts } = await indexFixture("csharp/shop"));
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

describe("C# adapter", () => {
  it("compiles the tags and locals queries", async () => {
    await host.index("A.cs", "csharp", "class A {}");
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-c_sharp.wasm"));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("csharp", kind);
      expect(src).toBeTruthy();
      expect(() => new Query(language, src!)).not.toThrow();
    }
  });

  it("records classes, interfaces, constructors and methods as blocks", () => {
    const fi = index.get(ORDER)!;
    expect(fi.hasErrors).toBe(false);
    expect(fi.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual([
      "class:Order",
      "method:Order.Order",
      "method:Order.Empty",
      "method:Order.AddItem",
      "method:Order.Total",
      "method:Order.Describe",
      "method:Order.Summary",
    ]);
    expect(fi.blocks[0].signature).toBe("public class Order");
    // A class inside a block-scoped namespace is still a top-level declaration.
    const item = index.get(ITEM)!;
    expect(item.decls.find((d) => d.name === "Item" && d.kind === "class")!.scope).toBe("top");
    expect(item.blocks.map((b) => b.label)).toEqual(["Item", "Item.Item", "Item.Price", "Item.Describe"]);
    expect(item.decls.find((d) => d.name === "Cents")!.kind).toBe("property");
    const iface = index.get("Services/IService.cs")!;
    expect(iface.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual(["class:IService", "method:IService.Run"]);
    expect(iface.decls[0].kind).toBe("interface");
  });

  it("resolves new Foo() to the class in another file, not its constructor", () => {
    const r = resolved(SERVICE, "Order", "var order = new Order(key)");
    expect(r.precision).toBe("name");
    expect(r.kind).toBe("class");
    expect(r.defs[0].path).toBe(ORDER);
    expect(r.defs[0].line).toBe(lineOf(texts, ORDER, "public class Order"));
    expect(resolved(SERVICE, "Item", "new Item(", 1).defs[0].path).toBe(ITEM);
  });

  it("resolves type references in fields, parameters, returns and base lists", () => {
    expect(resolved(SERVICE, "OrderRepository", "private readonly OrderRepository repo").defs[0].path).toBe("Data/OrderRepository.cs");
    expect(resolved(SERVICE, "OrderRepository", "public OrderService(OrderRepository repo)").defs[0].path).toBe("Data/OrderRepository.cs");
    expect(resolved(SERVICE, "Order", "public Order Place(").kind).toBe("class");
    const i = resolved(SERVICE, "IService", "OrderService : IService");
    expect(i.kind).toBe("interface");
    expect(i.defs[0].path).toBe("Services/IService.cs");
    expect(resolved(ORDER, "Item", "List<Item> items").defs[0].path).toBe(ITEM);
  });

  it("resolves obj.Method() and Type.StaticMethod() across files", () => {
    const add = resolved(SERVICE, "AddItem");
    expect(add.defs[0].label).toBe("Order.AddItem");
    expect(resolved(SERVICE, "Format", "PriceFormatter.Format(", 1).defs[0].label).toBe("PriceFormatter.Format");
    const cls = resolved(SERVICE, "PriceFormatter", "PriceFormatter.Format(");
    expect(cls.kind).toBe("class");
    expect(cls.defs[0].path).toBe("Util/PriceFormatter.cs");
    expect(resolved(SERVICE, "Empty", "Order.Empty()").defs[0].label).toBe("Order.Empty");
    expect(resolved(SERVICE, "Order", "Order.Empty()", 1).kind).toBe("class");
    expect(resolved(ORDER, "Price", "item.Price()").defs[0].label).toBe("Item.Price");
  });

  it("resolves a field receiver and this.field to the field declaration", () => {
    expect(resolved(SERVICE, "repo", "repo.Save(").defs[0].label).toBe("OrderService.repo");
    expect(resolved(SERVICE, "repo", "this.repo = repo", 0).defs[0].label).toBe("OrderService.repo");
    const param = resolved(SERVICE, "repo", "this.repo = repo", 1);
    expect(param.scope).toBe("local");
    expect(param.defs[0].line).toBe(lineOf(texts, SERVICE, "public OrderService(OrderRepository repo)"));
  });

  it("lists callers with their enclosing method", () => {
    const total = resolved(ORDER, "Total", "public long Total()");
    const where = index.callers(total.key).refs.map((c) => `${c.path}:${c.enclosing}`).sort();
    expect(where).toEqual([`${ORDER}:Order.Describe`, `${SERVICE}:OrderService.Run`]);
    const log = resolved(SERVICE, "Log", "private void Log(");
    expect(index.callers(log.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.Run", "OrderService.Run"]);
    const place = resolved(SERVICE, "Place", "public Order Place(");
    expect(index.callers(place.key).refs.map((c) => c.enclosing)).toEqual(["OrderService.Run"]);
  });

  it("gives candidates for a method declared in two classes", () => {
    const r = resolveAt(SERVICE, "Describe", "Log(order.Describe())");
    expect(r.status).toBe("candidates");
    if (r.status !== "candidates") return;
    expect(r.candidates.map((c) => c.label).sort()).toEqual(["Item.Describe", "Order.Describe"]);
    const same = resolved(ORDER, "Describe", "return Describe();");
    expect(same.defs[0].label).toBe("Order.Describe");
    expect(index.references(same.key).possible.map((x) => x.path)).toEqual([SERVICE]);
  });

  it("finds same-file references of locals and parameters", () => {
    const order = resolved(SERVICE, "order", "var order = new Order(key)");
    expect(order.scope).toBe("local");
    const at = (s: string) => lineOf(texts, SERVICE, s);
    expect(index.references(order.key).refs.map((x) => x.line)).toEqual([at("order.AddItem("), at("repo.Save(key, order)"), at("return order != null"), at("return order != null")]);
    expect(resolved(SERVICE, "order", "order.Total()").defs[0].line).toBe(at("Order order = Place("));
    expect(resolved(SERVICE, "key", "repo.Save(key, order)").defs[0].line).toBe(at("public Order Place("));
    const item = resolved(ORDER, "item", "sum += item.Price()");
    expect(item.defs[0].line).toBe(lineOf(texts, ORDER, "foreach (var item in items)"));
    expect(index.references(resolved(ORDER, "sum", "long sum = 0").key).refs).toHaveLength(2);
  });

  it("reports library calls as external", () => {
    expect(resolveAt(SERVICE, "WriteLine").status).toBe("external");
  });
});
