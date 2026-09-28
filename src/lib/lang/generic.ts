import type { Node, Query, Tree } from "web-tree-sitter";
import type { SemanticLanguage } from "./registry";
import { adapterVersion } from "./versions";
import type { Block, Decl, DeclKind, FileIndex, Occurrence, OccurrenceRole, Span } from "./types";

/**
 * Generic adapter for every language with standard Tree-sitter queries:
 *  - tags.scm: @definition.<kind> and @reference.<kind> with an @name capture
 *    (the queries GitHub's search-based code navigation uses)
 *  - locals.scm (optional): @local.scope, @local.definition, @local.reference
 *    to resolve variables to their declaration inside the file
 * Cross-file links are resolved later by name (SemanticIndex, precision "name").
 */
export interface GenericQueries {
  tags: Query;
  locals?: Query;
}

const CLASS_LIKE = new Set(["class", "interface", "module", "struct", "enum", "trait", "type", "object", "namespace", "impl", "union", "protocol"]);
const CALLABLE = new Set(["function", "method", "macro", "constructor"]);

function declKind(kind: string, insideClass: boolean): DeclKind {
  switch (kind) {
    case "function":
    case "macro":
      return insideClass ? "method" : "function";
    case "method":
    case "constructor":
      return "method";
    case "class":
    case "object":
    case "struct":
    case "module":
    case "namespace":
    case "impl":
    case "union":
      return "class";
    case "interface":
    case "protocol":
      return "interface";
    case "trait":
      return "trait";
    case "enum":
      return "enum";
    case "type":
      return "type";
    case "constant":
      return "const";
    case "field":
    case "property":
      return "property";
    default:
      return "var";
  }
}

function span(n: Node): Span {
  return { line: n.startPosition.row + 1, col: n.startPosition.column, endLine: n.endPosition.row + 1, endCol: n.endPosition.column };
}

function contains(outer: Node, inner: Node): boolean {
  return outer.startIndex <= inner.startIndex && inner.endIndex <= outer.endIndex && !(outer.startIndex === inner.startIndex && outer.endIndex === inner.endIndex);
}

/** First line of a declaration, up to its body. */
function signatureOf(def: Node, source: string): string {
  const text = source.slice(def.startIndex, Math.min(def.endIndex, def.startIndex + 400));
  return stripBodyOpener(text.split("\n")[0]).replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Drops a trailing `{` or `:` (with the whitespace around it) that opens the body. */
function stripBodyOpener(line: string): string {
  const trimmed = line.trimEnd();
  const last = trimmed.at(-1);
  return last === "{" || last === ":" ? trimmed.slice(0, -1).trimEnd() : line;
}

/** obj.name, obj->name, obj?.name, Mod::name: the reference is a member access. */
function isMemberAccess(name: Node, source: string): boolean {
  let i = name.startIndex - 1;
  while (i >= 0 && (source[i] === " " || source[i] === "\t")) i--;
  const two = source.slice(Math.max(0, i - 1), i + 1);
  return source[i] === "." || two === "->" || two === "?." || two === "::";
}

/** `Money.format` / `Billing::Invoice.new`: the capitalised receiver, when there is one. */
function receiverOf(name: Node, source: string): string | undefined {
  const before = source.slice(Math.max(0, name.startIndex - 160), name.startIndex).trimEnd();
  let sep = 0;
  if (before.endsWith("->") || before.endsWith("::")) sep = 2;
  else if (before.endsWith(".")) sep = 1;
  if (!sep) return undefined;
  const chain = receiverChain(before.slice(0, -sep).trimEnd());
  return chain?.split(/::|\./).findLast(Boolean);
}

const isWordChar = (c: string) => /\w/.test(c);
const isUpper = (c: string) => c >= "A" && c <= "Z";

/**
 * The longest suffix of `text` shaped like `Pkg.Mod::Type::Inner`: a
 * capitalised head of word characters and dots, then `::Capitalised` parts.
 * Scans backwards instead of using a regex, which backtracks badly here.
 */
/** The head ends at `end`: its start is the leftmost capital in the run of word chars and dots. */
function headStart(text: string, end: number): number | undefined {
  let k = end;
  while (k > 0 && (isWordChar(text[k - 1]) || text[k - 1] === ".")) k--;
  for (let i = k; i < end; i++) if (isUpper(text[i])) return i;
  return undefined;
}

function receiverChain(text: string): string | undefined {
  let best: number | undefined;
  let end = text.length;
  for (;;) {
    best = headStart(text, end) ?? best;
    // Or the text up to here is a `::Capitalised` part, and the head lies further left.
    let j = end;
    while (j > 0 && isWordChar(text[j - 1])) j--;
    if (j === end || j < 2 || !isUpper(text[j]) || text.slice(j - 2, j) !== "::") break;
    end = j - 2;
  }
  return best === undefined ? undefined : text.slice(best);
}

interface Def {
  kind: string;
  name: Node;
  node: Node;
}

interface Ref {
  kind: string;
  name: Node;
}

interface Scope {
  node: Node;
  names: Map<string, number>;
}

/** What one file's extraction builds up, shared by the passes below. */
interface Extraction {
  source: string;
  defs: Def[];
  refs: Ref[];
  decls: Decl[];
  blocks: Block[];
  occurrences: Occurrence[];
  declOfDef: Map<Def, number>;
  /** Start offsets of names that already have an occurrence. */
  recorded: Set<number>;
  enclosingOf: (n: Node) => string | undefined;
}

const width = (n: Node) => n.endIndex - n.startIndex;

/** The smallest def strictly containing `n`; the first one wins a tie. */
function innermostDef(defs: Def[], n: Node): Def | undefined {
  let best: Def | undefined;
  for (const d of defs) if (contains(d.node, n) && (!best || width(d.node) < width(best.node))) best = d;
  return best;
}

function qualified(container: string | undefined, name: string): string {
  return container ? `${container}.${name}` : name;
}

function scopeOf(insideFunction: boolean, insideClass: boolean): Decl["scope"] {
  if (insideFunction) return "local";
  return insideClass ? "member" : "top";
}

function blockKindOf(defKind: string, kind: DeclKind): Block["kind"] {
  if (CLASS_LIKE.has(defKind)) return defKind === "type" ? "type" : "class";
  return kind === "method" ? "method" : "function";
}

function collectTags(tags: Query, root: Node): { defs: Def[]; refs: Ref[] } {
  const defs: Def[] = [];
  const refs: Ref[] = [];
  for (const m of tags.matches(root)) {
    const nameCap = m.captures.find((c) => c.name === "name");
    const main = m.captures.find((c) => c.name.startsWith("definition.") || c.name.startsWith("reference."));
    if (!nameCap || !main) continue;
    const [group, kind] = main.name.split(".");
    if (group === "definition") defs.push({ kind, name: nameCap.node, node: main.node });
    else refs.push({ kind, name: nameCap.node });
  }
  return { defs, refs };
}

/** A name can be matched by several patterns: keep one definition per name node. */
function uniqueDefinitions(defs: Def[]): Def[] {
  const seen = new Set<number>();
  return defs
    .toSorted((a, b) => a.node.startIndex - b.node.startIndex || b.node.endIndex - a.node.endIndex)
    .filter((d) => {
      if (seen.has(d.name.startIndex)) return false;
      seen.add(d.name.startIndex);
      return true;
    });
}

function addDeclarations(x: Extraction) {
  for (const d of x.defs) {
    const parent = innermostDef(x.defs, d.node);
    const insideClass = !!parent && CLASS_LIKE.has(parent.kind);
    const insideFunction = !!parent && CALLABLE.has(parent.kind);
    const kind = declKind(d.kind, insideClass);
    const id = x.decls.length;
    const container = insideClass ? parent.name.text : undefined;
    x.decls.push({
      id,
      name: d.name.text,
      kind,
      span: span(d.name),
      scope: scopeOf(insideFunction, insideClass),
      container,
      fqn: qualified(container, d.name.text),
      signature: signatureOf(d.node, x.source),
      startLine: d.node.startPosition.row + 1,
      endLine: d.node.endPosition.row + 1,
    });
    x.declOfDef.set(d, id);
    if (CALLABLE.has(d.kind) || CLASS_LIKE.has(d.kind)) {
      x.blocks.push({
        kind: blockKindOf(d.kind, kind),
        name: d.name.text,
        label: qualified(container, d.name.text),
        startLine: d.node.startPosition.row + 1,
        endLine: d.node.endPosition.row + 1,
        declLine: d.name.startPosition.row + 1,
        signature: signatureOf(d.node, x.source),
        decl: id,
      });
    }
  }
}

function addDefinitionOccurrences(x: Extraction) {
  for (const d of x.defs) {
    x.occurrences.push({ name: d.name.text, span: span(d.name), role: "def", target: { t: "decl", decl: x.declOfDef.get(d)! }, enclosing: x.enclosingOf(d.name) });
    x.recorded.add(d.name.startIndex);
  }
}

// ---------- Locals: variables and parameters resolve to their declaration in the file ----------

function collectLocals(locals: Query, root: Node): { scopes: Scope[]; localDefs: Node[]; localRefs: Node[] } {
  const scopes: Scope[] = [{ node: root, names: new Map() }];
  const localDefs: Node[] = [];
  const localRefs: Node[] = [];
  for (const c of locals.captures(root)) {
    if (c.name === "local.scope") scopes.push({ node: c.node, names: new Map() });
    else if (c.name === "local.definition" || c.name.startsWith("local.definition.")) localDefs.push(c.node);
    else if (c.name === "local.reference") localRefs.push(c.node);
  }
  return { scopes, localDefs, localRefs };
}

/**
 * Functions declared inside functions (Scala/Kotlin local defs, C# local
 * functions) are tag definitions; bind them in their scope so calls to
 * them resolve here instead of to a same-named member elsewhere.
 */
function bindLocalFunctions(x: Extraction, scopes: Scope[]) {
  for (const d of x.defs) {
    const id = x.declOfDef.get(d)!;
    if (x.decls[id].scope !== "local") continue;
    // The declaration node itself is often a scope: bind in the scope around it.
    let best: Scope = scopes[0];
    for (const s of scopes) if (contains(s.node, d.node) && width(s.node) <= width(best.node)) best = s;
    if (!best.names.has(d.name.text)) best.names.set(d.name.text, id);
  }
}

function addLocalDefinitions(x: Extraction, scopes: Scope[], localDefs: Node[]) {
  const innermost = (n: Node): Scope => {
    let best = scopes[0];
    for (const s of scopes) if (s.node.startIndex <= n.startIndex && n.endIndex <= s.node.endIndex && width(s.node) <= width(best.node)) best = s;
    return best;
  };
  for (const n of localDefs) {
    if (x.recorded.has(n.startIndex)) continue;
    const scope = innermost(n);
    if (scope.names.has(n.text)) continue;
    const id = x.decls.length;
    x.decls.push({ id, name: n.text, kind: "local", span: span(n), scope: "local", startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1 });
    scope.names.set(n.text, id);
    x.occurrences.push({ name: n.text, span: span(n), role: "def", target: { t: "decl", decl: id }, enclosing: x.enclosingOf(n) });
    x.recorded.add(n.startIndex);
  }
}

function addLocalReferences(x: Extraction, scopes: Scope[], localRefs: Node[]) {
  for (const n of localRefs) {
    if (x.recorded.has(n.startIndex)) continue;
    // Walk outward through enclosing scopes.
    const chain = scopes
      .filter((s) => s.node.startIndex <= n.startIndex && n.endIndex <= s.node.endIndex)
      .toSorted((a, b) => width(a.node) - width(b.node));
    const hit = chain.map((s) => s.names.get(n.text)).find((id) => id !== undefined);
    if (hit === undefined) continue;
    const role: OccurrenceRole = x.refs.some((r) => r.name.startIndex === n.startIndex && r.kind === "call") ? "call" : "ref";
    x.occurrences.push({ name: n.text, span: span(n), role, target: { t: "decl", decl: hit }, enclosing: x.enclosingOf(n) });
    x.recorded.add(n.startIndex);
  }
}

function resolveLocals(x: Extraction, locals: Query, root: Node) {
  const { scopes, localDefs, localRefs } = collectLocals(locals, root);
  bindLocalFunctions(x, scopes);
  addLocalDefinitions(x, scopes, localDefs);
  addLocalReferences(x, scopes, localRefs);
}

/**
 * Remaining tag references: matched to declarations by name, across files.
 * When several patterns match one name, the call wins over a plain reference.
 */
function addNameReferences(x: Extraction) {
  const classDefs = x.defs.filter((d) => CLASS_LIKE.has(d.kind));
  const isCall = (k: string) => k === "call" || k === "send";
  x.refs.sort((a, b) => a.name.startIndex - b.name.startIndex || Number(isCall(b.kind)) - Number(isCall(a.kind)));
  for (const r of x.refs) {
    if (x.recorded.has(r.name.startIndex)) continue;
    x.recorded.add(r.name.startIndex);
    const role: OccurrenceRole = isCall(r.kind) ? "call" : "ref";
    x.occurrences.push({
      name: r.name.text,
      span: span(r.name),
      role,
      target: {
        t: "name",
        name: r.name.text,
        member: isMemberAccess(r.name, x.source),
        inClass: innermostDef(classDefs, r.name)?.name.text,
        receiver: receiverOf(r.name, x.source),
      },
      enclosing: x.enclosingOf(r.name),
    });
  }
}

export function extractGeneric(lang: SemanticLanguage, tree: Tree, source: string, path: string, queries: GenericQueries): FileIndex {
  const root = tree.rootNode;
  const tags = collectTags(queries.tags, root);
  const defs = uniqueDefinitions(tags.defs);
  const decls: Decl[] = [];
  const declOfDef = new Map<Def, number>();
  const callableDefs = defs.filter((d) => CALLABLE.has(d.kind));
  const x: Extraction = {
    source,
    defs,
    refs: tags.refs,
    decls,
    blocks: [],
    occurrences: [],
    declOfDef,
    recorded: new Set(),
    enclosingOf: (n) => {
      const best = innermostDef(callableDefs, n);
      if (!best) return undefined;
      const decl = decls[declOfDef.get(best)!];
      return qualified(decl.container, decl.name);
    },
  };

  addDeclarations(x);
  addDefinitionOccurrences(x);
  if (queries.locals) resolveLocals(x, queries.locals, root);
  addNameReferences(x);

  x.occurrences.sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);
  x.blocks.sort((a, b) => a.startLine - b.startLine);
  return {
    path,
    language: lang,
    adapterVersion: adapterVersion(lang),
    imports: [],
    uses: [],
    decls,
    occurrences: x.occurrences,
    blocks: x.blocks,
    hasErrors: root.hasError,
  };
}
