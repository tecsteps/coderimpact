import { beforeAll, describe, expect, it } from "vitest";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { defaultImportAlias } from "../src/lib/lang/go";
import { col, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("go/slugkit"));
});

function resolveAt(path: string, needle: string, nth = 0, onLineWith = needle) {
  const line = lineOf(texts, path, onLineWith);
  const c = col(texts, path, line, needle, nth);
  const hit = index.occurrenceAt(path, line, c);
  if (!hit) throw new Error(`no occurrence at ${path}:${line}:${c}`);
  return index.resolveOccurrence(path, hit.index);
}

describe("Go adapter", () => {
  it("records package, imports and blocks", () => {
    const fi = index.get("slug/normalize.go")!;
    expect(fi.packageName).toBe("slug");
    expect(fi.imports.map((i) => i.alias)).toEqual(["errors", "strings", "unicode", "translit"]);
    const fn = fi.blocks.find((b) => b.name === "normalize")!;
    expect(fn.kind).toBe("function");
    expect(fn.declLine).toBe(15);
    expect(fn.endLine).toBe(29);
    expect(fn.signature).toBe("func normalize(s string) (string, error)");
  });

  it("labels receiver methods", () => {
    const fi = index.get("slug/options.go")!;
    expect(fi.blocks.find((b) => b.name === "truncate")!.label).toBe("(*config).truncate");
  });

  it("resolves a parameter to its declaration in the same file", () => {
    const r = resolveAt("slug/normalize.go", "s", 0, 'if s == ""');
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.defs[0].line).toBe(15);
    expect(r.scope).toBe("local");
  });

  it("finds same-file references of a local variable", () => {
    const r = resolveAt("slug/normalize.go", "b", 0, "var b strings.Builder");
    if (r.status !== "resolved") throw new Error(r.status);
    const refs = index.references(r.key);
    expect(refs.refs.map((x) => x.line)).toEqual([23, 25, 28]);
  });

  it("resolves an import alias to the other package", () => {
    const r = resolveAt("cmd/slugkit/main.go", "Make");
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.defs[0].path).toBe("slug/normalize.go");
    expect(r.defs[0].line).toBe(32);
  });

  it("resolves a package-level function called from another file in the package", () => {
    const r = resolveAt("slug/normalize.go", "defaultConfig");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].path).toBe("slug/options.go");
  });

  it("lists callers of normalize, excluding a shadowing local function", () => {
    const r = resolveAt("slug/normalize.go", "normalize", 0, "func normalize(");
    if (r.status !== "resolved") throw new Error(r.status);
    const callers = index.callers(r.key);
    const where = callers.refs.map((c) => `${c.path}:${c.line}:${c.enclosing}`).sort();
    expect(where).toEqual(["slug/normalize.go:37:Make", "slug/normalize_test.go:8:TestNormalize"]);
    // The call on line 14 of the test goes to the closure declared on line 13, not the package function.
    const shadow = resolveAt("slug/normalize_test.go", "normalize", 0, '_ = normalize("x")');
    if (shadow.status !== "resolved") throw new Error(shadow.status);
    expect(shadow.scope).toBe("local");
    expect(shadow.defs[0].line).toBe(13);
  });

  it("resolves methods through a known receiver type", () => {
    const r = resolveAt("slug/normalize.go", "truncate");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].path).toBe("slug/options.go");
    expect(r.defs[0].label).toBe("(*config).truncate");
  });

  it("resolves selector chains through struct fields", () => {
    const r = resolveAt("slug/options.go", "Hard", 0, "_ = c.limits.Hard()");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].label).toBe("limits.Hard");
  });

  it("reports dependencies outside the module as external", () => {
    const r = resolveAt("slug/normalize.go", "ToLower");
    expect(r.status).toBe("external");
  });

  it("resolves an internal package function", () => {
    const r = resolveAt("slug/normalize.go", "ToASCII");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].path).toBe("internal/translit/translit.go");
    const refs = index.references(r.key);
    expect(refs.refs).toHaveLength(1);
  });

  it("gives candidates for methods on values of unknown type", () => {
    const r = resolveAt("slug/normalize.go", "WriteRune");
    expect(["candidates", "external", "unresolved"]).toContain(r.status);
    expect(r.status).not.toBe("resolved");
  });

  it("derives default import aliases", () => {
    expect(defaultImportAlias("gopkg.in/yaml.v3")).toBe("yaml");
    expect(defaultImportAlias("github.com/go-chi/chi/v5")).toBe("chi");
    expect(defaultImportAlias("github.com/mattn/go-sqlite3")).toBe("sqlite3");
  });
});
