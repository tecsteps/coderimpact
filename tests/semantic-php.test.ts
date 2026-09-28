import { beforeAll, describe, expect, it } from "vitest";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { col, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;
const TOTALS = "src/Billing/InvoiceTotals.php";

beforeAll(async () => {
  ({ index, texts } = await indexFixture("php/invoicer"));
});

function resolveAt(path: string, needle: string, onLineWith = needle, nth = 0) {
  const line = lineOf(texts, path, onLineWith);
  const c = col(texts, path, line, needle, nth);
  const hit = index.occurrenceAt(path, line, c);
  if (!hit) throw new Error(`no occurrence at ${path}:${line}:${c}`);
  return index.resolveOccurrence(path, hit.index);
}

describe("PHP adapter", () => {
  it("records namespace, use aliases and class blocks", () => {
    const fi = index.get(TOTALS)!;
    expect(fi.namespace).toBe("Acme\\Invoicer\\Billing");
    expect(fi.uses).toEqual([
      { alias: "Cash", fqn: "Acme\\Invoicer\\Money\\Money", kind: "class" },
      { alias: "format_money", fqn: "Acme\\Invoicer\\Support\\format_money", kind: "function" },
    ]);
    expect(fi.blocks.find((b) => b.kind === "class")!.name).toBe("InvoiceTotals");
    expect(fi.blocks.find((b) => b.name === "net")!.label).toBe("InvoiceTotals::net");
  });

  it("resolves a use alias to the class in another namespace", () => {
    const r = resolveAt(TOTALS, "Cash", "new Cash(");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].path).toBe("src/Money/Money.php");
  });

  it("resolves $this->method() and lists callers", () => {
    const r = resolveAt(TOTALS, "net", "$net = $this->net(", 1);
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].line).toBe(lineOf(texts, TOTALS, "public function net("));
    const callers = index.callers(r.key);
    expect(callers.refs.map((c) => c.enclosing)).toEqual(["InvoiceTotals::gross"]);
  });

  it("follows the parent class for inherited methods", () => {
    const r = resolveAt(TOTALS, "round", "$this->round(");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].path).toBe("src/Billing/BaseTotals.php");
  });

  it("infers variable types from promoted properties and new", () => {
    const add = resolveAt(TOTALS, "add", "$sum->add(");
    if (add.status !== "resolved") throw new Error(add.status);
    expect(add.defs[0].path).toBe("src/Money/Money.php");
    const cents = resolveAt(TOTALS, "cents", "$net->cents()", 0);
    if (cents.status !== "resolved") throw new Error(cents.status);
    expect(cents.defs[0].label).toBe("Money::cents");
  });

  it("resolves self:: constants", () => {
    const r = resolveAt(TOTALS, "TAX_RATE", "self::TAX_RATE");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].line).toBe(lineOf(texts, TOTALS, "private const TAX_RATE"));
  });

  it("resolves namespaced functions imported with use function", () => {
    const r = resolveAt(TOTALS, "format_money", "return format_money(");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].path).toBe("src/Support/functions.php");
  });

  it("reports dynamic calls as unresolvable", () => {
    const line = lineOf(texts, TOTALS, "$this->{$method}()");
    const fi = index.get(TOTALS)!;
    const dyn = fi.occurrences.find((o) => o.span.line === line && o.target.t === "dynamic");
    expect(dyn).toBeDefined();
  });

  it("treats built-in functions as external", () => {
    const r = resolveAt("src/Support/functions.php", "number_format");
    expect(r.status).toBe("external");
  });

  it("finds variable references within a method", () => {
    const r = resolveAt(TOTALS, "$sum", "$sum = $this->zero;");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(index.references(r.key).refs.length).toBeGreaterThanOrEqual(3);
  });
});
