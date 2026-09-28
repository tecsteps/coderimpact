import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { Language, Query } from "web-tree-sitter";
import type { SemanticIndex } from "../src/lib/lang/semanticIndex";
import { querySource } from "../src/lib/lang/queries";
import { col, indexFixture, lineOf } from "./helpers";

let index: SemanticIndex;
let texts: Map<string, string>;

beforeAll(async () => {
  ({ index, texts } = await indexFixture("rust/ledger"));
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

const ACCOUNT = "src/account.rs";
const MONEY = "src/money.rs";
const REPORT = "src/report.rs";
const MAIN = "src/main.rs";
const labels = (path: string) => index.get(path)!.blocks.map((b) => `${b.kind}:${b.label}`);

describe("Rust queries", () => {
  it("compile against the grammar (tags and locals)", async () => {
    const language = await Language.load(join(import.meta.dirname, "../public/grammars/tree-sitter-rust.wasm"));
    const tags = querySource("rust", "tags");
    const locals = querySource("rust", "locals");
    expect(tags).toBeTruthy();
    expect(locals).toBeTruthy();
    expect(() => new Query(language, tags!)).not.toThrow();
    expect(() => new Query(language, locals!)).not.toThrow();
  });

  it("parses every fixture file without errors", () => {
    for (const p of index.paths()) expect(index.get(p)!.hasErrors, p).toBe(false);
  });
});

describe("Rust declarations and blocks", () => {
  it("gives traits, structs, impls, methods and functions explain blocks", () => {
    expect(labels(ACCOUNT)).toEqual([
      "class:Summary",
      "method:Summary.summary",
      "method:Summary.headline",
      "class:Account",
      "class:Account",
      "method:Account.new",
      "method:Account.deposit",
      "method:Account.record",
      "method:Account.total",
      "class:Account",
      "method:Account.summary",
      "function:parse",
      "function:open",
    ]);
    const blocks = index.get(ACCOUNT)!.blocks;
    expect(blocks.filter((b) => b.label === "Account").map((b) => b.signature)).toEqual(["pub struct Account", "impl Account", "impl Summary for Account"]);
    expect(labels(MONEY)).toContain("method:Money.fmt");
  });

  it("classifies traits, fields and constants", () => {
    const decls = index.get(ACCOUNT)!.decls;
    expect(decls.find((d) => d.name === "Summary")!.kind).toBe("trait");
    const history = decls.find((d) => d.name === "history")!;
    expect(history.kind).toBe("property");
    expect(history.container).toBe("Account");
    expect(index.get(MONEY)!.decls.find((d) => d.name === "CENTS_PER_UNIT")!.kind).toBe("const");
  });
});

describe("Rust navigation", () => {
  it("resolves self.method() to the method of the same impl", () => {
    const r = resolvedAt(ACCOUNT, "record", 0, "self.record(amount)");
    expect(r.defs.map((d) => d.label)).toEqual(["Account.record"]);
  });

  it("resolves obj.method() and Type::assoc() across files", () => {
    const deposit = resolvedAt(MAIN, "deposit", 0, "alice.deposit(deposit)");
    expect(deposit.precision).toBe("name");
    expect(deposit.defs.map((d) => `${d.path}:${d.label}`)).toEqual([`${ACCOUNT}:Account.deposit`]);
    const fromCents = resolvedAt(MAIN, "from_cents");
    expect(fromCents.defs.map((d) => `${d.path}:${d.label}`)).toEqual([`${MONEY}:Money.from_cents`]);
    const add = resolvedAt(ACCOUNT, "add", 0, "self.balance.add(amount)");
    expect(add.defs.map((d) => `${d.path}:${d.label}`)).toEqual([`${MONEY}:Money.add`]);
  });

  it("resolves module-qualified free functions across files", () => {
    const open = resolvedAt(MAIN, "open", 0, 'account::open("bob');
    expect(open.defs.map((d) => `${d.path}:${d.label}`)).toEqual([`${ACCOUNT}:open`]);
    const render = resolvedAt(MAIN, "render");
    expect(render.defs[0].path).toBe(REPORT);
  });

  it("prefers the method for account.total() and the free function for total()", () => {
    const member = resolvedAt(REPORT, "total", 0, "sum.add(account.total())");
    expect(member.defs.map((d) => `${d.path}:${d.label}`)).toEqual([`${ACCOUNT}:Account.total`]);
    const bare = resolvedAt(REPORT, "total", 0, "let grand = total(accounts)");
    expect(bare.defs.map((d) => `${d.path}:${d.label}`)).toEqual([`${REPORT}:total`]);
  });

  it("offers both parse functions as candidates for money::parse (name collision)", () => {
    const r = resolveAt(MAIN, "parse");
    if (r.status !== "candidates") throw new Error(r.status);
    expect(r.candidates.map((c) => c.path).sort()).toEqual([ACCOUNT, MONEY]);
    // Inside account.rs, the bare call prefers the function in the same file.
    const local = resolvedAt(ACCOUNT, "parse", 0, "    parse(line)");
    expect(local.defs.map((d) => d.path)).toEqual([ACCOUNT]);
  });

  // The `Type::` qualifier picks Account::new over Money::new.
  it("resolves Account::new by its qualifier although Money::new exists too", () => {
    const r = resolveAt(MAIN, "new", 0, 'Account::new("alice")');
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.defs.map((c) => c.label)).toEqual(["Account.new"]);
  });

  it("offers the trait method and its implementation for self.summary()", () => {
    const r = resolveAt(ACCOUNT, "summary", 0, "let text = self.summary()");
    if (r.status !== "candidates") throw new Error(r.status);
    expect(r.candidates.map((c) => c.label).sort()).toEqual(["Account.summary", "Summary.summary"]);
    const provided = resolvedAt(REPORT, "headline");
    expect(provided.defs[0].label).toBe("Summary.headline");
  });

  it("resolves the implemented trait, consts and fields", () => {
    expect(resolvedAt(ACCOUNT, "Summary", 0, "impl Summary for Account").defs[0].line).toBe(lineOf(texts, ACCOUNT, "pub trait Summary"));
    expect(resolvedAt(MONEY, "CENTS_PER_UNIT", 0, "units * CENTS_PER_UNIT").defs[0].line).toBe(lineOf(texts, MONEY, "pub const CENTS_PER_UNIT"));
    expect(resolvedAt(ACCOUNT, "history", 0, "self.history.push").defs[0].label).toBe("Account.history");
  });

  it("resolves let bindings, parameters and loop variables locally", () => {
    const sum = resolvedAt(ACCOUNT, "sum", 0, "sum = sum.add(*entry)");
    expect(sum.scope).toBe("local");
    expect(sum.defs[0].line).toBe(lineOf(texts, ACCOUNT, "let mut sum"));
    const entry = resolvedAt(ACCOUNT, "entry", 0, "sum = sum.add(*entry)");
    expect(entry.defs[0].line).toBe(lineOf(texts, ACCOUNT, "for entry in"));
    const amount = resolvedAt(ACCOUNT, "amount", 0, "self.history.push(amount)");
    expect(amount.defs[0].line).toBe(lineOf(texts, ACCOUNT, "fn record("));
    // A local shadows the method of the same name.
    const deposit = resolvedAt(MAIN, "deposit", 1, "alice.deposit(deposit)");
    expect(deposit.scope).toBe("local");
    // Identifiers used inside a macro call still reach the local.
    expect(resolvedAt(ACCOUNT, "text", 0, 'format!("== {} ==", text)').defs[0].line).toBe(lineOf(texts, ACCOUNT, "let text"));
  });

  it("lists callers with the impl-qualified enclosing label", () => {
    const record = resolvedAt(ACCOUNT, "record", 0, "fn record(");
    expect(index.callers(record.key).refs.map((c) => `${c.path}:${c.enclosing}`)).toEqual([`${ACCOUNT}:Account.deposit`]);
    const fromCents = resolvedAt(MONEY, "from_cents", 0, "pub fn from_cents(");
    expect(index.callers(fromCents.key).refs.map((c) => `${c.path}:${c.enclosing}`)).toEqual([
      `${ACCOUNT}:Account.total`,
      `${MAIN}:main`,
      `${MONEY}:Money.add`,
      `${MONEY}:parse`,
      `${REPORT}:total`,
    ]);
    const total = resolvedAt(ACCOUNT, "total", 0, "pub fn total(&self)");
    expect(index.callers(total.key).refs.map((c) => `${c.path}:${c.enclosing}`)).toEqual([`${REPORT}:total`]);
    // `self.total()` inside `format!(...)` is a token tree: a reference, not a call.
    const refs = index.references(total.key).refs;
    expect(refs.map((c) => `${c.path}:${c.role}:${c.enclosing}`)).toEqual([`${ACCOUNT}:ref:Account.summary`, `${REPORT}:call:total`]);
  });

  it("does not match module paths to functions of the same name", () => {
    const line = lineOf(texts, MONEY, "use std::fmt;");
    expect(index.occurrenceAt(MONEY, line, col(texts, MONEY, line, "fmt"))).toBeUndefined();
  });

  // The impl blocks are declarations named after their type (they are the
  // container of the methods), so a type name has one symbol with several
  // definitions: the struct first, then every impl block.
  it("resolves a type name to the struct and its impl blocks", () => {
    const r = resolvedAt(MAIN, "Money", 0, "Money::from_cents(0)");
    expect(r.defs.map((d) => d.line)).toEqual([
      lineOf(texts, MONEY, "pub struct Money"),
      lineOf(texts, MONEY, "impl Money"),
      lineOf(texts, MONEY, "impl fmt::Display for Money"),
    ]);
  });
});
