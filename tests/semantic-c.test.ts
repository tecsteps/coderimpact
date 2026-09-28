import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { Language, Query } from "web-tree-sitter";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("c/inventory"));
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

describe("C queries", () => {
  it("compile against the grammar (tags and locals)", async () => {
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-c.wasm"));
    const tags = querySource("c", "tags");
    const locals = querySource("c", "locals");
    expect(tags).toBeTruthy();
    expect(locals).toBeTruthy();
    expect(() => new Query(language, tags!)).not.toThrow();
    expect(() => new Query(language, locals!)).not.toThrow();
  });

  it("parses every fixture file without errors", () => {
    for (const p of index.paths()) expect(index.get(p)!.hasErrors, p).toBe(false);
  });
});

describe("C declarations and blocks", () => {
  it("gives structs and functions explain blocks", () => {
    const h = index.get("inventory.h")!;
    expect(h.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual(["class:Item", "class:Inventory"]);
    const inventory = h.blocks.find((b) => b.name === "Inventory")!;
    expect(inventory.startLine).toBe(lineOf(texts, "inventory.h", "typedef struct Inventory {"));
    expect(inventory.endLine).toBe(lineOf(texts, "inventory.h", "} Inventory;"));

    const c = index.get("inventory.c")!;
    expect(c.blocks.map((b) => `${b.kind}:${b.label}`)).toEqual([
      "function:clamp",
      "function:find_slot",
      "function:inventory_init",
      "function:inventory_add",
      "function:item_value",
      "function:inventory_total",
    ]);
    const add = c.blocks.find((b) => b.name === "inventory_add")!;
    expect(add.signature).toBe("int inventory_add(Inventory *inv, const char *name, double price, int quantity)");
    expect(add.endLine - add.startLine).toBe(12);
  });

  it("declares struct fields as members and `typedef struct X {...} X` once", () => {
    const h = index.get("inventory.h")!;
    expect(h.decls.filter((d) => d.name === "Inventory").map((d) => d.kind)).toEqual(["class"]);
    const count = h.decls.find((d) => d.name === "count")!;
    expect(count.kind).toBe("property");
    expect(count.container).toBe("Inventory");
  });

  it("declares macros, constants and file-scope variables", () => {
    const u = index.get("util.h")!;
    expect(u.decls.find((d) => d.name === "MAX_ITEMS")!.kind).toBe("const");
    expect(u.blocks.map((b) => b.label)).toEqual(["MIN"]);
    const g = index.get("inventory.c")!.decls.find((d) => d.name === "added_count")!;
    expect(g.scope).toBe("top");
  });

  it("does not declare function prototypes: the header has no function decls", () => {
    const h = index.get("inventory.h")!;
    expect(h.decls.filter((d) => d.kind === "function")).toEqual([]);
  });
});

describe("C navigation", () => {
  it("resolves a call to a function defined in another file", () => {
    const r = resolvedAt("main.c", "inventory_add", 0, 'inventory_add(&inv, "apple"');
    expect(r.precision).toBe("name");
    expect(r.defs.map((d) => `${d.path}:${d.line}`)).toEqual([`inventory.c:${lineOf(texts, "inventory.c", "int inventory_add(")}`]);
  });

  // Prototype in a .h and definition in a .c: only the definition (the one with
  // a body) is a declaration, so the definition wins everywhere, including a
  // click on the prototype itself, which jumps to the body.
  it("resolves a header prototype to the definition in the .c file", () => {
    const r = resolvedAt("inventory.h", "inventory_total");
    expect(r.defs.map((d) => d.path)).toEqual(["inventory.c"]);
    const local = resolvedAt("main.c", "report_print", 0, "void report_print(const Inventory *inv);");
    expect(local.defs.map((d) => d.path)).toEqual(["report.c"]);
  });

  it("resolves macros, types and struct fields", () => {
    expect(resolvedAt("inventory.c", "MAX_ITEMS").defs[0].path).toBe("util.h");
    expect(resolvedAt("inventory.c", "MIN").defs[0].path).toBe("util.h");
    expect(resolvedAt("main.c", "Inventory", 0, "Inventory inv;").defs[0].path).toBe("inventory.h");
    const field = resolvedAt("inventory.c", "count", 0, "inv->count = 0;");
    expect(field.defs[0].label).toBe("Inventory.count");
    expect(resolvedAt("inventory.c", "added_count", 0, "added_count++").defs[0].line).toBe(3);
  });

  it("resolves parameters and locals within the function", () => {
    const param = resolveAt("inventory.c", "name", 1, "item->name = name;");
    if (param.status !== "resolved") throw new Error(param.status);
    expect(param.scope).toBe("local");
    expect(param.defs[0].line).toBe(lineOf(texts, "inventory.c", "int inventory_add("));
    // The field on the left of the same line resolves to the struct member.
    const field = resolvedAt("inventory.c", "name", 0, "item->name = name;");
    expect(field.defs[0].label).toBe("Item.name");
    const slot = resolvedAt("inventory.c", "slot", 0, "if (slot < 0)");
    expect(slot.scope).toBe("local");
    expect(index.references(slot.key).refs.map((x) => x.line)).toEqual([24, 25, 28, 33]);
  });

  it("prefers the static helper in the same file when two files define it", () => {
    const inReport = resolvedAt("report.c", "clamp", 0, "int shown = clamp(");
    expect(inReport.defs.map((d) => d.path)).toEqual(["report.c"]);
    const inInventory = resolvedAt("inventory.c", "clamp", 0, "inv->count = clamp(");
    expect(inInventory.defs.map((d) => d.path)).toEqual(["inventory.c"]);
  });

  it("lists callers of a function with their enclosing function", () => {
    const r = resolvedAt("inventory.c", "inventory_total", 0, "long inventory_total(");
    const callers = index.callers(r.key);
    expect(callers.refs.map((c) => `${c.path}:${c.enclosing}`).sort()).toEqual(["main.c:main", "report.c:report_print"]);
    const value = resolvedAt("inventory.c", "item_value", 0, "long item_value(");
    expect(index.callers(value.key).refs.map((c) => `${c.path}:${c.enclosing}`).sort()).toEqual(["inventory.c:inventory_total", "report.c:report_print"]);
  });

  it("reports library functions as external", () => {
    expect(resolveAt("report.c", "printf").status).toBe("external");
  });

  // Known limit of the engine: generic keys are `N|c|<name>`, so the two
  // file-local `static clamp` functions share one key and their callers merge.
  it("merges callers of same-named static functions (engine limit)", () => {
    const r = resolvedAt("inventory.c", "clamp", 0, "static int clamp(");
    expect(r.defs.map((d) => d.path).sort()).toEqual(["inventory.c", "report.c"]);
    expect(index.callers(r.key).refs.map((c) => c.enclosing).sort()).toEqual(["inventory_add", "report_print"]);
  });
});
