import type { Decl, DeclKind, FileIndex } from "./types";
import type { SemanticIndex } from "./semanticIndex";
import { nameSpaceOf } from "./registry";

/** One suggestion after `receiver.`, `receiver->` or `Receiver::`. */
export interface MemberCompletion {
  name: string;
  kind: DeclKind;
  /** The class (or Go type) that declares it. */
  container: string;
  signature?: string;
}

const CLASS_KINDS = new Set<DeclKind>(["class", "interface", "trait", "enum", "type"]);
const SELF = new Set(["this", "$this", "self", "static"]);

interface MemberTable {
  generation: number;
  /** Language namespace, then container short name, then its members. */
  byContainer: Map<string, Map<string, { decl: Decl; fi: FileIndex }[]>>;
  /** PHP class FQN -> parent FQN, for inherited members. */
  parents: Map<string, string>;
}

const tables = new WeakMap<SemanticIndex, MemberTable>();

function table(index: SemanticIndex): MemberTable {
  const cached = tables.get(index);
  if (cached?.generation === index.generation) return cached;
  const t: MemberTable = { generation: index.generation, byContainer: new Map(), parents: new Map() };
  for (const path of index.paths()) {
    const fi = index.get(path)!;
    const ns = nameSpaceOf(fi.language);
    for (const d of fi.decls) {
      if (d.fqn && d.extendsFqn && CLASS_KINDS.has(d.kind)) t.parents.set(d.fqn, d.extendsFqn);
      if (d.scope !== "member" || !d.container) continue;
      let byName = t.byContainer.get(ns);
      if (!byName) {
        byName = new Map();
        t.byContainer.set(ns, byName);
      }
      const list = byName.get(d.container) ?? [];
      list.push({ decl: d, fi });
      byName.set(d.container, list);
    }
  }
  tables.set(index, t);
  return t;
}

const shortName = (type: string) => type.split(/[\\.]/).pop()!.replace(/^\*/, "");

/** The class whose body contains `line`, innermost first. */
function enclosingClass(fi: FileIndex, line: number): Decl | undefined {
  return fi.decls
    .filter((d) => CLASS_KINDS.has(d.kind) && d.startLine <= line && line <= d.endLine)
    .sort((a, b) => b.startLine - a.startLine)[0];
}

/** The class a receiver stands for at `line`: this/self, a class name, or a variable with a known type. */
function receiverClass(fi: FileIndex, line: number, receiver: string, text?: string): { name: string; fqn?: string } | null {
  if (SELF.has(receiver)) {
    const cls = enclosingClass(fi, line);
    return cls ? { name: cls.name, fqn: cls.fqn } : null;
  }
  if (receiver === "parent") {
    const parent = enclosingClass(fi, line)?.extendsFqn;
    return parent ? { name: shortName(parent), fqn: parent } : null;
  }
  // A typed variable or parameter declared above, closest first.
  const typed = fi.decls
    .filter((d) => d.name === receiver && d.typeRef && d.startLine <= line)
    .sort((a, b) => b.startLine - a.startLine)[0];
  if (typed?.typeRef) return { name: shortName(typed.typeRef), fqn: typed.typeRef.includes("\\") ? typed.typeRef : undefined };
  if (/^[A-Z]/.test(receiver)) return { name: receiver };
  const declared = text ? typeFromText(text, receiver) : null;
  return declared ? { name: declared } : null;
}

const escapeRe = (s: string) => s.replace(/[$.*+?^{}()|[\]\\]/g, String.raw`\$&`);

/**
 * The declared type of a variable in the text being edited, closest to the
 * end: `x: Cart`, `x = new Cart`, `Cart x` / `Cart $x` (Java, C#, PHP), `x := Cart{`.
 */
export function typeFromText(text: string, variable: string): string | null {
  const v = escapeRe(variable);
  const patterns = [
    new RegExp(String.raw`(?<![\w$])${v}\??\s*:\s*([A-Z]\w*)`, "g"),
    new RegExp(String.raw`(?<![\w$])${v}\s*:?=\s*new\s+([A-Z]\w*)`, "g"),
    new RegExp(String.raw`(?<![\w$])${v}\s*:=\s*&?([A-Z]\w*)\s*\{`, "g"),
    new RegExp(String.raw`\b([A-Z]\w*)(?:<[^<>\n]*>)?\s+${v}(?![\w$])`, "g"),
  ];
  let best: { at: number; type: string } | null = null;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (!best || m.index > best.at) best = { at: m.index, type: m[1] };
    }
  }
  return best?.type ?? null;
}

type MemberList = Map<string, { decl: Decl; fi: FileIndex }[]>;

const matcher = (prefix: string) => {
  const want = prefix.replace(/^\$/, "").toLowerCase();
  return (d: Decl) => d.name.replace(/^\$/, "").toLowerCase().startsWith(want);
};

const toItem = ({ decl }: { decl: Decl }): MemberCompletion => ({ name: decl.name, kind: decl.kind, container: decl.container!, signature: decl.signature });

/** Members of a class and then its parents (PHP); the nearest declaration of a name wins. */
function classMembers(t: MemberTable, byName: MemberList, cls: { name: string; fqn?: string }, matches: (d: Decl) => boolean): MemberCompletion[] {
  const seen = new Set<string>();
  const items: MemberCompletion[] = [];
  let name: string | undefined = cls.name;
  let fqn = cls.fqn;
  for (let depth = 0; name && depth < 8; depth++) {
    for (const m of byName.get(name) ?? []) {
      if (seen.has(m.decl.name) || !matches(m.decl)) continue;
      seen.add(m.decl.name);
      items.push(toItem(m));
    }
    fqn = fqn ? t.parents.get(fqn) : undefined;
    name = fqn ? shortName(fqn) : undefined;
  }
  return items;
}

/** Every member name with the prefix, when the receiver's class is unknown. */
function anyMembers(byName: MemberList, matches: (d: Decl) => boolean): MemberCompletion[] {
  const seen = new Set<string>();
  const items: MemberCompletion[] = [];
  for (const list of byName.values()) {
    for (const m of list) {
      if (seen.has(m.decl.name) || !matches(m.decl)) continue;
      seen.add(m.decl.name);
      items.push(toItem(m));
      if (items.length >= 200) return items;
    }
  }
  return items;
}

/**
 * Members for a completion list after `receiver` at `line` of `path`. The
 * class comes from the index (this/self, class names, typed variables); PHP
 * adds inherited members. Unknown receivers get every member name that
 * matches the prefix, so the list still helps.
 */
export function memberCompletions(
  index: SemanticIndex,
  path: string,
  line: number,
  receiver: string,
  prefix: string,
  /** The text being edited, up to the cursor: finds declared variable types the index does not record. */
  text?: string,
): { items: MemberCompletion[]; exact: boolean } {
  const fi = index.get(path);
  const t = table(index);
  const byName = fi ? t.byContainer.get(nameSpaceOf(fi.language)) : undefined;
  if (!fi || !byName) return { items: [], exact: false };
  const matches = matcher(prefix);
  const cls = receiverClass(fi, line, receiver, text);
  const own = cls ? classMembers(t, byName, cls, matches) : [];
  if (own.length) return { items: own, exact: true };
  return { items: prefix ? anyMembers(byName, matches) : [], exact: false };
}

const isWordChar = (c: string | undefined) => !!c && /\w/.test(c);
const ACCESS_OPS = ["?->", "->", "::", "?.", "."];

/** Steps left over a word and an optional PHP `$`. */
function wordStart(s: string, end: number): number {
  let i = end;
  while (i > 0 && isWordChar(s[i - 1])) i--;
  return i > 0 && s[i - 1] === "$" ? i - 1 : i;
}

function skipSpaces(s: string, end: number): number {
  let i = end;
  while (i > 0 && (s[i - 1] === " " || s[i - 1] === "\t")) i--;
  return i;
}

/**
 * The member access the cursor is in (text before the cursor on its line):
 * `cart.to` gives receiver "cart", op ".", typed "to". A scan from the end,
 * no regex backtracking.
 */
export function memberAccessAt(before: string): { receiver: string; op: string; typed: string } | null {
  const typedStart = wordStart(before, before.length);
  const typed = before.slice(typedStart);
  let i = skipSpaces(before, typedStart);
  const op = ACCESS_OPS.find((o) => before.slice(0, i).endsWith(o));
  if (!op) return null;
  i = skipSpaces(before, i - op.length);
  const receiver = before.slice(wordStart(before, i), i);
  return /^\$?[A-Za-z_]/.test(receiver) ? { receiver, op, typed } : null;
}
