import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Query } from "web-tree-sitter";
import { querySource } from "../src/lib/lang/queries";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { col, host, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("ruby/billing"));
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

const INVOICE = "lib/billing/invoice.rb";
const REPORTS = "lib/reports.rb";
const HELPERS = "lib/helpers.rb";

describe("Ruby (generic adapter)", () => {
  it("compiles the tags and locals queries", async () => {
    await host.index("probe.rb", "ruby", "x = 1\n");
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-ruby.wasm"));
    for (const kind of ["tags", "locals"] as const) {
      const src = querySource("ruby", kind);
      expect(src, kind).toBeTruthy();
      const q = new Query(language, src!);
      expect(q.captureNames.length).toBeGreaterThan(0);
      q.delete();
    }
  });

  it("records modules, classes and methods as declarations and explain blocks", () => {
    const fi = index.get(INVOICE)!;
    expect(fi.hasErrors).toBe(false);
    expect(fi.blocks.map((b) => `${b.kind} ${b.label}`)).toEqual([
      "class Billing",
      "class Billing.Invoice",
      "method Invoice.initialize",
      "method Invoice.add_line",
      "method Invoice.total",
      "method Invoice.to_s",
      "method Invoice.header",
    ]);
    expect(fi.decls.find((d) => d.name === "Invoice")).toMatchObject({ kind: "class", scope: "member", container: "Billing" });
    expect(fi.decls.find((d) => d.name === "total")).toMatchObject({ kind: "method", scope: "member", container: "Invoice" });
    // Class methods (`def self.format`) belong to their module.
    const money = index.get("lib/billing/money.rb")!;
    expect(money.blocks.map((b) => b.label)).toEqual(["Billing", "Billing.Money", "Money.format", "Money.round"]);
    expect(money.blocks.find((b) => b.label === "Money.format")!.signature).toBe("def self.format(cents)");
  });

  it("records top-level defs as functions", () => {
    const fi = index.get(HELPERS)!;
    expect(fi.blocks.map((b) => `${b.kind} ${b.label}`)).toEqual(["function format", "function banner"]);
    expect(fi.decls.find((d) => d.name === "banner")).toMatchObject({ kind: "function", scope: "top" });
  });

  it("resolves a top-level method called from another file", () => {
    const r = resolveAt(REPORTS, "banner");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.precision).toBe("name");
    expect(r.defs[0]).toMatchObject({ path: HELPERS, line: lineOf(texts, HELPERS, "def banner") });
  });

  it("resolves a namespaced constant and an instance method across files", () => {
    const cls = resolveAt(REPORTS, "Invoice", 0, "Billing::Invoice.new");
    if (cls.status !== "resolved") throw new Error(cls.status);
    expect(cls.defs[0]).toMatchObject({ path: INVOICE, label: "Billing.Invoice" });
    const m = resolveAt(REPORTS, "add_line", 1, '.add_line("Pen"');
    if (m.status !== "resolved") throw new Error(m.status);
    expect(m.defs[0]).toMatchObject({ path: INVOICE, label: "Invoice.add_line" });
    const other = resolveAt(INVOICE, "LineItem", 0, "LineItem.new");
    if (other.status !== "resolved") throw new Error(other.status);
    expect(other.defs[0].path).toBe("lib/billing/line_item.rb");
  });

  it("resolves calls without receiver and without parentheses", () => {
    const r = resolveAt(INVOICE, "header", 0, 'header + "\\n"');
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs[0].label).toBe("Invoice.header");
    // `total` inside Invoice: both Invoice#total and LineItem#total exist, the same file wins.
    const total = resolveAt(INVOICE, "total", 0, "Money.format(total)");
    if (total.status !== "resolved") throw new Error(total.status);
    expect(total.defs[0].label).toBe("Invoice.total");
  });

  it("prefers the class method for Money.format and the top-level method for a bare format", () => {
    const member = resolveAt(INVOICE, "format", 0, "Money.format(total)");
    if (member.status !== "resolved") throw new Error(member.status);
    expect(member.defs[0]).toMatchObject({ path: "lib/billing/money.rb", label: "Money.format" });
    const bare = resolveAt(REPORTS, "format", 0, 'puts format("Lines');
    if (bare.status !== "resolved") throw new Error(bare.status);
    expect(bare.defs[0]).toMatchObject({ path: HELPERS, label: "format", kind: "function" });
  });

  it("lists callers with their enclosing method", () => {
    const format = index.callers(keyAt(HELPERS, "format", 0, "def format"));
    expect(where(format.refs)).toEqual(["lib/helpers.rb:7:banner", "lib/reports.rb:7:print_invoice"]);
    const moneyFormat = index.callers(keyAt("lib/billing/money.rb", "format", 0, "def self.format"));
    expect(where(moneyFormat.refs)).toEqual(["lib/billing/invoice.rb:22:Invoice.to_s"]);
    const header = index.callers(keyAt(INVOICE, "header", 0, "def header"));
    expect(where(header.refs)).toEqual(["lib/billing/invoice.rb:22:Invoice.to_s"]);
    const buildSample = index.callers(keyAt(REPORTS, "build_sample", 0, "def build_sample"));
    expect(where(buildSample.refs)).toEqual(["lib/reports.rb:16:", "lib/reports.rb:17:"]);
  });

  it("gives candidates for a method name declared in two classes", () => {
    const r = resolveAt(REPORTS, "total", 0, "build_sample.total");
    if (r.status !== "candidates") throw new Error(r.status);
    expect(r.candidates.map((c) => c.label).sort()).toEqual(["Invoice.total", "LineItem.total"]);
    const possible = index.callers(keyAt("lib/billing/line_item.rb", "total", 0, "def total")).possible;
    expect(where(possible)).toEqual(["lib/reports.rb:17:"]);
  });

  it("resolves parameters and local variables inside their method", () => {
    const first = resolveAt(REPORTS, "invoice", 0, "puts invoice.to_s");
    if (first.status !== "resolved") throw new Error(first.status);
    expect(first.scope).toBe("local");
    expect(first.defs[0].line).toBe(lineOf(texts, REPORTS, "def print_invoice(invoice)"));
    const second = resolveAt(REPORTS, "invoice", 0, '.add_line("Book"');
    if (second.status !== "resolved") throw new Error(second.status);
    expect(second.defs[0].line).toBe(lineOf(texts, REPORTS, "invoice = Billing::Invoice.new"));
  });

  it("finds same-file references of a local variable, also inside a block", () => {
    const sum = index.references(keyAt(INVOICE, "sum", 0, "sum = 0"));
    expect(sum.defs.map((d) => d.line)).toEqual([16]);
    expect(sum.refs.map((x) => x.line)).toEqual([17, 18]);
    expect(sum.refs.every((x) => x.role === "ref")).toBe(true);
    const blockParam = resolveAt(INVOICE, "line", 2, "line.amount");
    if (blockParam.status !== "resolved") throw new Error(blockParam.status);
    expect(blockParam.scope).toBe("local");
    expect(blockParam.defs[0].line).toBe(17);
  });

  it("does not let a local variable capture a method call of the same name", () => {
    // banner has a local `line`; `title.length` and `.join` are calls, and the local is only read.
    const line = index.references(keyAt(HELPERS, "line", 0, "line = "));
    expect(line.refs.map((x) => `${x.line}:${x.col}`)).toEqual(["7:3", "7:24"]);
  });

  it.todo("resolves a module reopened in several files (Billing) to all of its definitions instead of candidates");
  it.todo("resolves line.amount / obj.total by the receiver's class instead of same-file tie-breaking");
});
