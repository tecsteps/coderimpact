import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { Language, Query } from "web-tree-sitter";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("cpp/shapes"));
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

const labels = (path: string) => index.get(path)!.blocks.map((b) => `${b.kind}:${b.label}`);

describe("C++ queries", () => {
  it("compile against the grammar (tags and locals)", async () => {
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-cpp.wasm"));
    const tags = querySource("cpp", "tags");
    const locals = querySource("cpp", "locals");
    expect(tags).toBeTruthy();
    expect(locals).toBeTruthy();
    expect(() => new Query(language, tags!)).not.toThrow();
    expect(() => new Query(language, locals!)).not.toThrow();
  });

  it("parses every fixture file without errors", () => {
    for (const p of index.paths()) expect(index.get(p)!.hasErrors, p).toBe(false);
  });
});

describe("C++ declarations and blocks", () => {
  it("gives classes and their inline and declared methods explain blocks", () => {
    expect(labels("shape.hpp")).toEqual([
      "class:Shape",
      "method:Shape.~Shape",
      "method:Shape.area",
      "method:Shape.name",
      "class:Circle",
      "method:Circle.area",
      "method:Circle.scale",
      "class:Rect",
      "method:Rect.area",
      "method:Rect.perimeter",
    ]);
    const rect = index.get("shape.hpp")!.blocks.find((b) => b.label === "Rect")!;
    expect(rect.startLine).toBe(lineOf(texts, "shape.hpp", "class Rect"));
    expect(rect.signature).toBe("class Rect : public Shape");
    expect(labels("canvas.hpp")).toEqual(["class:Canvas", "method:Canvas.add", "method:Canvas.totalArea", "method:Canvas.count"]);
  });

  // The adapter derives a container only from nesting, so an out-of-line
  // definition `double Circle::area() const {...}` is a top-level method
  // labeled `area`, not `Circle.area` (see the engine note in the report).
  it("gives out-of-line methods and free functions blocks", () => {
    expect(labels("circle.cpp")).toEqual(["function:clamp_radius", "method:area", "method:scale", "function:make_unit_circle"]);
    const area = index.get("circle.cpp")!.blocks.find((b) => b.name === "area")!;
    expect(area.signature).toBe("double Circle::area() const");
    expect(area.endLine - area.startLine).toBe(2);
  });

  // Constructors are not declarations: they share the class name, and would
  // otherwise capture `geo::Circle` (a `::` member access) and `Circle` next
  // to an out-of-line `Circle::Circle`.
  it("does not declare constructors, so class names resolve to the class", () => {
    const shape = index.get("shape.hpp")!;
    expect(shape.decls.filter((d) => d.name === "Circle").map((d) => d.kind)).toEqual(["class"]);
    const qualified = resolvedAt("main.cpp", "Circle", 0, "geo::Circle c =");
    expect(qualified.defs.map((d) => `${d.path}:${d.label}`)).toEqual(["shape.hpp:Circle"]);
    const scope = resolvedAt("circle.cpp", "Circle", 0, "double Circle::area()");
    expect(scope.defs.map((d) => `${d.path}:${d.label}`)).toEqual(["shape.hpp:Circle"]);
    const ctor = resolvedAt("circle.cpp", "Circle", 0, "Circle::Circle(double radius)");
    expect(ctor.defs[0].label).toBe("Circle");
  });

  it("declares fields as members and namespace-scope variables as top level", () => {
    const radius = index.get("shape.hpp")!.decls.find((d) => d.name === "radius_")!;
    expect(radius.kind).toBe("property");
    expect(radius.container).toBe("Circle");
    expect(index.get("circle.cpp")!.decls.find((d) => d.name === "kPi")!.scope).toBe("top");
  });
});

describe("C++ navigation", () => {
  it("resolves obj.method() and ptr->method() to the class member in another file", () => {
    const scale = resolvedAt("main.cpp", "scale", 0, "c.scale(2.0)");
    expect(scale.precision).toBe("name");
    expect(scale.defs.map((d) => `${d.path}:${d.label}`)).toEqual(["shape.hpp:Circle.scale"]);
    const perimeter = resolvedAt("main.cpp", "perimeter", 0, "rp->perimeter()");
    expect(perimeter.defs.map((d) => `${d.path}:${d.label}`)).toEqual(["shape.hpp:Rect.perimeter"]);
    const add = resolvedAt("main.cpp", "add", 0, "canvas.add(&c)");
    expect(add.defs.map((d) => `${d.path}:${d.label}`)).toEqual(["canvas.hpp:Canvas.add"]);
  });

  it("resolves a namespace-qualified free function call across files", () => {
    const r = resolvedAt("main.cpp", "make_unit_circle");
    expect(r.defs.map((d) => `${d.path}:${d.line}`)).toEqual([`circle.cpp:${lineOf(texts, "circle.cpp", "Circle make_unit_circle()")}`]);
  });

  it("prefers the member for obj.count() and the free function for count()", () => {
    const member = resolvedAt("main.cpp", "count", 0, "return count(canvas.count(), 0)");
    expect(member.defs[0].label).toBe("count");
    expect(member.defs[0].path).toBe("main.cpp");
    const call = resolvedAt("main.cpp", "count", 1, "return count(canvas.count(), 0)");
    expect(call.defs.map((d) => `${d.path}:${d.label}`)).toEqual(["canvas.hpp:Canvas.count"]);
  });

  it("offers every override as candidates for a virtual call", () => {
    const r = resolveAt("canvas.cpp", "area");
    if (r.status !== "candidates") throw new Error(r.status);
    expect(r.candidates.map((c) => c.label).sort()).toEqual(["Circle.area", "Rect.area", "Shape.area"]);
    expect(r.candidates.every((c) => c.path === "shape.hpp")).toBe(true);
  });

  it("resolves implicit this-> fields, statics and locals", () => {
    expect(resolvedAt("circle.cpp", "radius_", 0, "return kPi * radius_").defs[0].label).toBe("Circle.radius_");
    expect(resolvedAt("circle.cpp", "kPi", 0, "return kPi").defs[0].line).toBe(lineOf(texts, "circle.cpp", "static const double kPi"));
    const next = resolvedAt("circle.cpp", "next", 0, "clamp_radius(next)");
    expect(next.scope).toBe("local");
    const s = resolvedAt("canvas.cpp", "s", 1, "sum += s->area()");
    expect(s.defs[0].line).toBe(lineOf(texts, "canvas.cpp", "for (const geo::Shape *s"));
    expect(resolvedAt("canvas.cpp", "Shape", 0, "void Canvas::add(").defs[0].label).toBe("Shape");
  });

  it("lists callers with the enclosing function", () => {
    const decl = resolvedAt("shape.hpp", "scale", 0, "void scale(double factor);");
    expect(index.callers(decl.key).refs.map((c) => `${c.path}:${c.enclosing}`)).toEqual(["main.cpp:main"]);
    const count = resolvedAt("canvas.hpp", "count", 0, "int count() const");
    expect(index.callers(count.key).refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`)).toEqual([
      `main.cpp:${lineOf(texts, "main.cpp", "std::cout")}:main`,
      `main.cpp:${lineOf(texts, "main.cpp", "return count(")}:main`,
    ]);
    // Out-of-line methods enclose their calls under their bare name.
    const clamp = resolvedAt("circle.cpp", "clamp_radius", 0, "static double clamp_radius(");
    expect(index.callers(clamp.key).refs.map((c) => c.enclosing)).toEqual([undefined, "scale"]);
  });

  it("reports the standard library as external", () => {
    expect(resolveAt("canvas.cpp", "push_back").status).toBe("external");
  });
});

describe("C++ in .h headers", () => {
  it("parses a header with C++ constructs with the C++ grammar", async () => {
    const { host } = await import("./helpers");
    const fi = await host.index("include/widget.h", "c", "#pragma once\nnamespace ui {\nclass Widget {\npublic:\n  int width() const;\n};\n}\n");
    expect(fi.language).toBe("cpp");
    expect(fi.hasErrors).toBe(false);
    expect(fi.blocks.map((b) => b.label)).toContain("Widget");
  });

  it("keeps plain C headers on the C grammar", async () => {
    const { host } = await import("./helpers");
    const fi = await host.index("include/util.h", "c", "#pragma once\nint clamp(int v, int lo, int hi);\n");
    expect(fi.language).toBe("c");
  });
});
