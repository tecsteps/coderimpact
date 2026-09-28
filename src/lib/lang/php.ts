import type { Node, Tree } from "web-tree-sitter";
import { adapterVersion } from "./versions";
import type { Block, Decl, DeclKind, FileIndex, Occurrence, OccurrenceRole, PhpUse, Span, Target } from "./types";

/**
 * PHP adapter: namespaces, `use` aliases (class, function, const, grouped),
 * classes/interfaces/traits/enums with methods, properties and constants,
 * functions, function-scoped variables, and call sites. Member calls on
 * `$this`, `self`, `static`, `parent`, named classes and variables with a known
 * class (type hints, `new`) resolve; everything else is a candidate list, and
 * dynamic calls such as `$this->{$m}()` are reported as unresolvable.
 */

const PRIMITIVE = new Set([
  "int", "integer", "float", "double", "string", "bool", "boolean", "array", "mixed", "void", "null",
  "callable", "iterable", "object", "never", "false", "true", "resource", "numeric",
]);

function span(n: Node): Span {
  return { line: n.startPosition.row + 1, col: n.startPosition.column, endLine: n.endPosition.row + 1, endCol: n.endPosition.column };
}

function signatureOf(n: Node, source: string): string {
  const body = n.childForFieldName("body");
  const end = body ? body.startIndex : n.endIndex;
  return stripTrailingSemicolon(source.slice(n.startIndex, end).replace(/\s+/g, " ")).trim();
}

/** Drops a trailing `;` (with the whitespace around it). */
function stripTrailingSemicolon(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : text;
}

/** Whether a node has an anonymous `function` / `const` keyword child. */
function hasKeyword(n: Node, keyword: string): boolean {
  return n.children.some((c) => !c.isNamed && c.type === keyword);
}

function phpUseKind(n: Node): PhpUse["kind"] {
  if (hasKeyword(n, "function")) return "function";
  return hasKeyword(n, "const") ? "const" : "class";
}

function isClassName(n: Node): boolean {
  return n.type === "name" || n.type === "qualified_name";
}

/** The last `name` segment of a qualified name, or the name itself. */
function lastNameSegment(n: Node): Node {
  return n.type === "qualified_name" ? n.namedChildren.findLast((c) => c.type === "name") ?? n : n;
}

const CLASS_DECLARATIONS = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"]);
const LITERALS = new Set(["comment", "string", "encapsed_string", "heredoc", "nowdoc", "integer", "float"]);
const TYPE_NODES = new Set(["named_type", "optional_type", "union_type", "intersection_type"]);

interface ClassCtx {
  fqn: string;
  short: string;
  parentFqn?: string;
}

class VarScope {
  readonly vars = new Map<string, number>();
  readonly parent: VarScope | null;
  /** Arrow functions read the parent scope; closures only see `use` vars. */
  readonly inherits: boolean;
  constructor(parent: VarScope | null, inherits: boolean) {
    this.parent = parent;
    this.inherits = inherits;
  }
  lookup(name: string): number | undefined {
    const own = this.vars.get(name);
    if (own !== undefined) return own;
    return this.inherits && this.parent ? this.parent.lookup(name) : undefined;
  }
}

class PhpExtractor {
  readonly decls: Decl[] = [];
  readonly occurrences: Occurrence[] = [];
  readonly blocks: Block[] = [];
  readonly uses: PhpUse[] = [];
  namespace = "";
  private readonly classUses = new Map<string, string>();
  private readonly fnUses = new Map<string, string>();
  private readonly constUses = new Map<string, string>();
  private cls: ClassCtx | null = null;
  private readonly enclosing: string[] = [];
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  private addDecl(d: Omit<Decl, "id">): number {
    const id = this.decls.length;
    this.decls.push({ ...d, id });
    return id;
  }

  private occ(nameNode: Node, role: OccurrenceRole, target: Target, name = nameNode.text) {
    this.occurrences.push({ name, span: span(nameNode), role, target, enclosing: this.enclosing.at(-1) });
  }

  private qualify(name: string): string {
    return this.namespace ? `${this.namespace}\\${name}` : name;
  }

  /** Resolves a class name as written in source to a fully qualified name. */
  resolveClass(raw: string): string | undefined {
    let t = raw.replace(/\s+/g, "");
    if (!t) return undefined;
    const lower = t.toLowerCase();
    if (lower === "self" || lower === "static") return this.cls?.fqn;
    if (lower === "parent") return this.cls?.parentFqn;
    if (PRIMITIVE.has(lower)) return undefined;
    if (t.startsWith("\\")) return t.slice(1);
    if (lower.startsWith("namespace\\")) return this.qualify(t.slice(10));
    const [first, ...rest] = t.split("\\");
    const aliased = this.classUses.get(first.toLowerCase());
    if (aliased) return rest.length ? `${aliased}\\${rest.join("\\")}` : aliased;
    t = this.qualify(t);
    return t;
  }

  private resolveFunction(raw: string): { fqn: string; fallback?: string } {
    const t = raw.replace(/\s+/g, "");
    if (t.startsWith("\\")) return { fqn: t.slice(1) };
    if (t.includes("\\")) {
      const [first, ...rest] = t.split("\\");
      const aliased = this.classUses.get(first.toLowerCase());
      return { fqn: aliased ? `${aliased}\\${rest.join("\\")}` : this.qualify(t) };
    }
    const used = this.fnUses.get(t.toLowerCase());
    if (used) return { fqn: used };
    return this.namespace ? { fqn: this.qualify(t), fallback: t } : { fqn: t };
  }

  run(root: Node) {
    this.visitStatements(root.namedChildren);
  }

  private visitStatements(nodes: Node[]) {
    for (const n of nodes) this.visitTop(n);
  }

  private visitTop(n: Node) {
    switch (n.type) {
      case "namespace_definition": {
        this.namespace = (n.childForFieldName("name")?.text ?? "").replace(/^\\/, "");
        this.classUses.clear();
        this.fnUses.clear();
        this.constUses.clear();
        const body = n.childForFieldName("body");
        if (body) this.visitStatements(body.namedChildren);
        return;
      }
      case "namespace_use_declaration":
        this.collectUse(n);
        return;
      case "class_declaration":
      case "interface_declaration":
      case "trait_declaration":
      case "enum_declaration":
        this.visitClass(n);
        return;
      case "function_definition":
        this.visitFunctionDef(n);
        return;
      default:
        this.visitExpr(n, new VarScope(null, false));
    }
  }

  private usesOfKind(kind: PhpUse["kind"]): Map<string, string> {
    if (kind === "function") return this.fnUses;
    return kind === "const" ? this.constUses : this.classUses;
  }

  private collectUse(n: Node) {
    const kind = phpUseKind(n);
    const group = n.childForFieldName("body");
    const prefixNode = n.namedChildren.find((c) => c.type === "namespace_name");
    const prefix = group && prefixNode ? prefixNode.text.replace(/^\\/, "") + "\\" : "";
    const clauses = (group ? group.namedChildren : n.namedChildren).filter((c) => c.type === "namespace_use_clause");
    for (const clause of clauses) {
      const nameNode = clause.namedChildren.find((c) => c.type === "qualified_name" || c.type === "name");
      const aliasNode = clause.childForFieldName("alias");
      if (!nameNode) continue;
      const clauseKind = hasKeyword(clause, "function") ? "function" : kind;
      const fqn = prefix + nameNode.text.replace(/^\\/, "");
      const alias = aliasNode?.text ?? fqn.split("\\").pop()!;
      this.uses.push({ alias, fqn, kind: clauseKind });
      this.usesOfKind(clauseKind).set(alias.toLowerCase(), fqn);
      if (clauseKind === "class") {
        const last = nameNode.type === "qualified_name" ? nameNode.childForFieldName("name") ?? nameNode : nameNode;
        this.occ(last, "ref", { t: "class", fqn }, last.text);
      }
    }
  }

  private visitClass(n: Node) {
    const nameNode = n.childForFieldName("name");
    if (!nameNode) return;
    const kindMap: Record<string, DeclKind> = {
      class_declaration: "class",
      interface_declaration: "interface",
      trait_declaration: "trait",
      enum_declaration: "enum",
    };
    const fqn = this.qualify(nameNode.text);
    const base = n.namedChildren.find((c) => c.type === "base_clause");
    const baseName = base?.namedChildren.find((c) => c.type === "name" || c.type === "qualified_name");
    const parentFqn = baseName ? this.resolveClass(baseName.text) : undefined;
    const id = this.addDecl({
      name: nameNode.text,
      kind: kindMap[n.type] ?? "class",
      span: span(nameNode),
      scope: "top",
      fqn,
      extendsFqn: parentFqn,
      signature: signatureOf(n, this.source),
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
    });
    this.occ(nameNode, "def", { t: "decl", decl: id });
    this.blocks.push({
      kind: "class",
      name: nameNode.text,
      label: nameNode.text,
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      declLine: nameNode.startPosition.row + 1,
      signature: signatureOf(n, this.source),
      decl: id,
    });
    // extends / implements references
    for (const clause of n.namedChildren.filter((c) => c.type === "base_clause" || c.type === "class_interface_clause")) {
      for (const ref of clause.namedChildren) this.classRef(ref);
    }

    const prev = this.cls;
    this.cls = { fqn, short: nameNode.text, parentFqn };
    const body = n.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) this.visitMember(member, fqn, nameNode.text);
    this.cls = prev;
  }

  private visitMember(m: Node, classFqn: string, short: string) {
    switch (m.type) {
      case "method_declaration":
        this.visitMethod(m, classFqn, short);
        return;
      case "property_declaration":
        this.declareProperties(m, classFqn, short);
        return;
      case "const_declaration":
        this.declareClassConstants(m, classFqn, short);
        return;
      case "enum_case":
        this.declareEnumCase(m, classFqn, short);
        return;
      case "use_declaration":
        for (const c of m.namedChildren) this.classRef(c);
        return;
      default:
        return;
    }
  }

  private visitMethod(m: Node, classFqn: string, short: string) {
    const nameNode = m.childForFieldName("name");
    if (!nameNode) return;
    const id = this.addDecl({
      name: nameNode.text,
      kind: "method",
      span: span(nameNode),
      scope: "member",
      container: short,
      fqn: classFqn,
      typeRef: this.typeOf(m.childForFieldName("return_type")),
      signature: signatureOf(m, this.source),
      startLine: m.startPosition.row + 1,
      endLine: m.endPosition.row + 1,
    });
    this.occ(nameNode, "def", { t: "decl", decl: id });
    const label = `${short}::${nameNode.text}`;
    this.blocks.push({ kind: "method", name: nameNode.text, label, startLine: m.startPosition.row + 1, endLine: m.endPosition.row + 1, declLine: nameNode.startPosition.row + 1, signature: signatureOf(m, this.source), decl: id });
    this.enclosing.push(label);
    const scope = new VarScope(null, false);
    this.declareParams(m.childForFieldName("parameters"), scope, classFqn, short);
    this.typeRefs(m.childForFieldName("return_type"));
    const body = m.childForFieldName("body");
    if (body) this.visitExpr(body, scope);
    this.enclosing.pop();
  }

  private declareProperties(m: Node, classFqn: string, short: string) {
    this.typeRefs(m.childForFieldName("type"));
    const typeFqn = this.typeOf(m.childForFieldName("type"));
    for (const el of m.namedChildren.filter((c) => c.type === "property_element")) {
      const v = el.childForFieldName("name") ?? el.namedChildren[0];
      const nameNode = v?.namedChildren[0] ?? v;
      if (!nameNode) continue;
      const id = this.addDecl({ name: nameNode.text, kind: "property", span: span(nameNode), scope: "member", container: short, fqn: classFqn, typeRef: typeFqn, startLine: m.startPosition.row + 1, endLine: m.endPosition.row + 1 });
      this.occ(nameNode, "def", { t: "decl", decl: id });
      const def = el.childForFieldName("default_value");
      if (def) this.visitExpr(def, new VarScope(null, false));
    }
  }

  private declareClassConstants(m: Node, classFqn: string, short: string) {
    for (const el of m.namedChildren.filter((c) => c.type === "const_element")) {
      const nameNode = el.namedChildren.find((c) => c.type === "name");
      if (!nameNode) continue;
      const id = this.addDecl({ name: nameNode.text, kind: "const", span: span(nameNode), scope: "member", container: short, fqn: classFqn, startLine: m.startPosition.row + 1, endLine: m.endPosition.row + 1 });
      this.occ(nameNode, "def", { t: "decl", decl: id });
      for (const v of el.namedChildren.slice(1)) this.visitExpr(v, new VarScope(null, false));
    }
  }

  private declareEnumCase(m: Node, classFqn: string, short: string) {
    const nameNode = m.childForFieldName("name") ?? m.namedChildren.find((c) => c.type === "name");
    if (!nameNode) return;
    const id = this.addDecl({ name: nameNode.text, kind: "const", span: span(nameNode), scope: "member", container: short, fqn: classFqn, startLine: m.startPosition.row + 1, endLine: m.endPosition.row + 1 });
    this.occ(nameNode, "def", { t: "decl", decl: id });
  }

  private visitFunctionDef(n: Node) {
    const nameNode = n.childForFieldName("name");
    if (!nameNode) return;
    const fqn = this.qualify(nameNode.text);
    const id = this.addDecl({ name: nameNode.text, kind: "function", span: span(nameNode), scope: "top", fqn, typeRef: this.typeOf(n.childForFieldName("return_type")), signature: signatureOf(n, this.source), startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1 });
    this.occ(nameNode, "def", { t: "decl", decl: id });
    this.blocks.push({ kind: "function", name: nameNode.text, label: nameNode.text, startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1, declLine: nameNode.startPosition.row + 1, signature: signatureOf(n, this.source), decl: id });
    this.enclosing.push(nameNode.text);
    const scope = new VarScope(null, false);
    this.declareParams(n.childForFieldName("parameters"), scope);
    this.typeRefs(n.childForFieldName("return_type"));
    const body = n.childForFieldName("body");
    if (body) this.visitExpr(body, scope);
    this.enclosing.pop();
  }

  private typeOf(typeNode: Node | null): string | undefined {
    if (!typeNode) return undefined;
    if (typeNode.type === "named_type") return this.resolveClass(typeNode.text);
    if (typeNode.type === "optional_type") return this.typeOf(typeNode.namedChildren[0] ?? null);
    return undefined;
  }

  /** Emits class references for every named type inside a type expression. */
  private typeRefs(typeNode: Node | null) {
    if (!typeNode) return;
    if (typeNode.type === "named_type") {
      const inner = typeNode.namedChildren[0];
      if (inner) this.classRef(inner);
      return;
    }
    for (const c of typeNode.namedChildren) this.typeRefs(c);
  }

  private classRef(n: Node) {
    if (n.type !== "name" && n.type !== "qualified_name") return;
    const fqn = this.resolveClass(n.text);
    if (!fqn) return;
    const last = lastNameSegment(n);
    this.occ(last, "ref", { t: "class", fqn }, last.text);
  }

  private declareParams(list: Node | null, scope: VarScope, classFqn?: string, short?: string) {
    for (const p of list?.namedChildren ?? []) {
      const typeNode = p.childForFieldName("type");
      this.typeRefs(typeNode);
      const v = p.childForFieldName("name");
      const nameNode = v?.namedChildren[0];
      if (!v || !nameNode) continue;
      const typeRef = this.typeOf(typeNode);
      const id = this.addDecl({ name: "$" + nameNode.text, kind: "param", span: span(v), scope: "local", typeRef, startLine: p.startPosition.row + 1, endLine: p.endPosition.row + 1 });
      scope.vars.set(nameNode.text, id);
      this.occ(v, "def", { t: "decl", decl: id }, "$" + nameNode.text);
      if (p.type === "property_promotion_parameter" && classFqn) {
        // Constructor promotion also declares a property.
        const pid = this.addDecl({ name: nameNode.text, kind: "property", span: span(nameNode), scope: "member", container: short, fqn: classFqn, typeRef, startLine: p.startPosition.row + 1, endLine: p.endPosition.row + 1 });
        this.occ(nameNode, "def", { t: "decl", decl: pid });
      }
      const def = p.childForFieldName("default_value");
      if (def) this.visitExpr(def, scope);
    }
  }

  /** Variable use or first assignment. */
  private variable(v: Node, scope: VarScope, assignType?: string, isAssignTarget = false) {
    const nameNode = v.namedChildren[0];
    if (nameNode?.type !== "name") {
      // $$var: variable variables are dynamic.
      return;
    }
    const name = nameNode.text;
    if (name === "this") return;
    const existing = scope.lookup(name);
    if (existing !== undefined) {
      this.occ(v, "ref", { t: "decl", decl: existing }, "$" + name);
      if (isAssignTarget && assignType && !this.decls[existing].typeRef) this.decls[existing].typeRef = assignType;
      return;
    }
    if (isAssignTarget) {
      const id = this.addDecl({ name: "$" + name, kind: "local", span: span(v), scope: "local", typeRef: assignType, startLine: v.startPosition.row + 1, endLine: v.endPosition.row + 1 });
      scope.vars.set(name, id);
      this.occ(v, "def", { t: "decl", decl: id }, "$" + name);
    }
  }

  private exprClass(n: Node | null, scope: VarScope): string | undefined {
    if (!n) return undefined;
    switch (n.type) {
      case "object_creation_expression": {
        const cn = n.namedChildren.find(isClassName);
        return cn ? this.resolveClass(cn.text) : undefined;
      }
      case "variable_name":
        return this.variableClass(n, scope);
      case "member_access_expression":
        return this.memberExprClass(n, scope, "$");
      case "member_call_expression":
      case "nullsafe_member_call_expression":
        return this.memberExprClass(n, scope, "m:");
      case "scoped_call_expression":
        return this.scopedCallClass(n);
      case "parenthesized_expression":
        return this.exprClass(n.namedChildren[0] ?? null, scope);
      default:
        return undefined;
    }
  }

  private variableClass(n: Node, scope: VarScope): string | undefined {
    const nm = n.namedChildren[0]?.text;
    if (nm === "this") return this.cls?.fqn;
    const d = nm ? scope.lookup(nm) : undefined;
    return d === undefined ? undefined : this.decls[d].typeRef;
  }

  /** `$obj->prop` (`@<class>::$prop`) and `$obj->method()` (`@<class>::m:method`). */
  private memberExprClass(n: Node, scope: VarScope, marker: "$" | "m:"): string | undefined {
    const objType = this.exprClass(n.childForFieldName("object"), scope);
    const name = n.childForFieldName("name");
    return objType && name?.type === "name" ? `@${objType}::${marker}${name.text}` : undefined;
  }

  private scopedCallClass(n: Node): string | undefined {
    const sc = n.childForFieldName("scope");
    const m = n.childForFieldName("name");
    const cls = sc && (sc.type === "relative_scope" || isClassName(sc)) ? this.resolveClass(sc.text) : undefined;
    return cls && m?.type === "name" ? `@${cls}::m:${m.text}` : undefined;
  }

  private visitExpr(n: Node | null | undefined, scope: VarScope): void {
    if (!n) return;
    if (LITERALS.has(n.type)) {
      if (n.type === "encapsed_string" || n.type === "heredoc") this.visitInterpolations(n, scope);
      return;
    }
    if (CLASS_DECLARATIONS.has(n.type)) {
      this.visitClass(n);
      return;
    }
    if (TYPE_NODES.has(n.type)) {
      this.typeRefs(n);
      return;
    }
    switch (n.type) {
      case "function_definition":
        this.visitFunctionDef(n);
        return;
      case "namespace_use_declaration":
        this.collectUse(n);
        return;
      case "assignment_expression":
      case "reference_assignment_expression":
        this.visitAssignment(n, scope);
        return;
      case "foreach_statement":
        this.visitForeach(n, scope);
        return;
      case "catch_clause":
        this.visitCatch(n, scope);
        return;
      case "variable_name":
        this.variable(n, scope);
        return;
      case "anonymous_function":
      case "anonymous_function_creation_expression":
        this.visitClosure(n, scope);
        return;
      case "arrow_function": {
        const inner = new VarScope(scope, true);
        this.declareParams(n.childForFieldName("parameters"), inner);
        this.visitExpr(n.childForFieldName("body"), inner);
        return;
      }
      case "object_creation_expression":
        this.visitNew(n, scope);
        return;
      case "function_call_expression":
        this.visitFunctionCall(n, scope);
        return;
      case "member_call_expression":
      case "nullsafe_member_call_expression":
      case "member_access_expression":
      case "nullsafe_member_access_expression":
        this.visitMemberAccess(n, scope);
        return;
      case "scoped_call_expression":
      case "class_constant_access_expression":
      case "scoped_property_access_expression":
        this.visitScopedAccess(n, scope);
        return;
      case "instanceof_expression":
        this.visitInstanceof(n, scope);
        return;
      case "name":
      case "qualified_name":
        // Bare constant names (e.g. PHP_EOL) are not tracked.
        return;
      default:
        for (const c of n.namedChildren) this.visitExpr(c, scope);
    }
  }

  /** Interpolated strings can hold variables and calls. */
  private visitInterpolations(n: Node, scope: VarScope) {
    for (const c of n.namedChildren) if (c.type !== "string_content" && c.type !== "escape_sequence") this.visitExpr(c, scope);
  }

  private visitInstanceof(n: Node, scope: VarScope) {
    const [left, right] = n.namedChildren;
    this.visitExpr(left, scope);
    if (right && isClassName(right)) this.classRef(right);
    else this.visitExpr(right, scope);
  }

  private visitAssignment(n: Node, scope: VarScope) {
    const left = n.childForFieldName("left");
    const right = n.childForFieldName("right");
    this.visitExpr(right, scope);
    if (left?.type === "variable_name") this.variable(left, scope, this.exprClass(right, scope), true);
    else if (left?.type === "list_literal" || left?.type === "array_creation_expression") {
      for (const v of descendantsOfType(left, "variable_name")) this.variable(v, scope, undefined, true);
    } else this.visitExpr(left, scope);
  }

  private visitForeach(n: Node, scope: VarScope) {
    const kids = n.namedChildren;
    const body = n.childForFieldName("body");
    this.visitExpr(kids[0], scope);
    for (const k of kids.slice(1)) {
      if (k === body || k.startIndex === body?.startIndex) continue;
      this.visitForeachTarget(k, scope);
    }
    this.visitExpr(body, scope);
  }

  /** `$v`, `$k => $v`, `&$v`: the loop variables are assigned. */
  private visitForeachTarget(k: Node, scope: VarScope) {
    if (k.type === "pair") {
      for (const v of k.namedChildren) {
        if (v.type === "variable_name") this.variable(v, scope, undefined, true);
        else this.visitExpr(v, scope);
      }
    } else if (k.type === "variable_name") this.variable(k, scope, undefined, true);
    else if (k.type === "by_ref") for (const v of descendantsOfType(k, "variable_name")) this.variable(v, scope, undefined, true);
    else this.visitExpr(k, scope);
  }

  private visitCatch(n: Node, scope: VarScope) {
    const typeList = n.childForFieldName("type") ?? n.namedChildren.find((c) => c.type === "type_list");
    for (const t of typeList?.namedChildren ?? []) this.typeRefs(t);
    for (const t of typeList?.namedChildren ?? []) if (isClassName(t)) this.classRef(t);
    const v = n.childForFieldName("name");
    if (v) this.variable(v, scope, undefined, true);
    this.visitExpr(n.childForFieldName("body"), scope);
  }

  /** Closures see only the variables they `use`. */
  private visitClosure(n: Node, scope: VarScope) {
    const inner = new VarScope(scope, false);
    const useClause = n.namedChildren.find((c) => c.type === "anonymous_function_use_clause");
    for (const v of useClause ? descendantsOfType(useClause, "variable_name") : []) {
      const nm = v.namedChildren[0]?.text;
      const outer = nm ? scope.lookup(nm) : undefined;
      if (nm && outer !== undefined) {
        inner.vars.set(nm, outer);
        this.occ(v, "ref", { t: "decl", decl: outer }, "$" + nm);
      }
    }
    this.declareParams(n.childForFieldName("parameters"), inner);
    this.visitExpr(n.childForFieldName("body"), inner);
  }

  private visitNew(n: Node, scope: VarScope) {
    const cn = n.namedChildren.find(isClassName);
    if (cn) this.classRef(cn);
    for (const c of n.namedChildren) if (c !== cn && c.startIndex !== cn?.startIndex) this.visitExpr(c, scope);
  }

  private visitFunctionCall(n: Node, scope: VarScope) {
    const fn = n.childForFieldName("function");
    if (fn && isClassName(fn)) {
      const target = this.resolveFunction(fn.text);
      const last = lastNameSegment(fn);
      const lname = last.text.toLowerCase();
      if (lname === "call_user_func" || lname === "call_user_func_array") {
        this.occ(last, "call", { t: "dynamic", reason: `${last.text}() calls a function chosen at runtime.` });
      } else this.occ(last, "call", { t: "function", ...target }, last.text);
    } else if (fn) {
      this.visitExpr(fn, scope);
      this.occ(fn, "call", { t: "dynamic", reason: "A variable function call is resolved at runtime." }, fn.text);
    }
    this.visitExpr(n.childForFieldName("arguments"), scope);
  }

  private visitMemberAccess(n: Node, scope: VarScope) {
    const obj = n.childForFieldName("object");
    const nameNode = n.childForFieldName("name");
    const isCall = n.type.endsWith("call_expression");
    const role: OccurrenceRole = isCall ? "call" : "ref";
    this.visitExpr(obj, scope);
    if (nameNode?.type === "name") {
      const cls = this.exprClass(obj, scope);
      const memberName = isCall ? nameNode.text : "$" + nameNode.text;
      const target: Target = cls ? { t: "member", typeRef: cls, name: memberName } : { t: "member?", name: memberName };
      this.occ(nameNode, role, target, nameNode.text);
    } else if (nameNode) {
      this.visitExpr(nameNode, scope);
      const shown = `${obj?.text ?? ""}->${nameNode.text}${isCall ? "()" : ""}`;
      const what = isCall ? "call" : "property access";
      this.occ(nameNode, role, { t: "dynamic", reason: `Dynamic ${what} ${shown} cannot be resolved.` }, nameNode.text);
    }
    this.visitExpr(n.childForFieldName("arguments"), scope);
  }

  /** The class on the left of `::`, recording a reference when it is named. */
  private scopeClass(scopeNode: Node | undefined, scope: VarScope): string | undefined {
    if (scopeNode?.type === "relative_scope") return this.resolveClass(scopeNode.text);
    if (scopeNode && isClassName(scopeNode)) {
      const cls = this.resolveClass(scopeNode.text);
      this.classRef(scopeNode);
      return cls;
    }
    this.visitExpr(scopeNode, scope);
    return this.exprClass(scopeNode ?? null, scope);
  }

  private visitScopedAccess(n: Node, scope: VarScope) {
    const scopeNode = n.childForFieldName("scope") ?? n.namedChildren[0];
    const nameNode = n.childForFieldName("name") ?? n.namedChildren[1];
    const cls = this.scopeClass(scopeNode, scope);
    if (nameNode?.type === "name" || nameNode?.type === "variable_name") this.scopedMember(n, nameNode, cls);
    this.visitExpr(n.childForFieldName("arguments"), scope);
  }

  private scopedMember(n: Node, nameNode: Node, cls: string | undefined) {
    const isProp = n.type === "scoped_property_access_expression";
    if (nameNode.type === "variable_name" && !isProp) {
      this.occ(nameNode, "call", { t: "dynamic", reason: `Dynamic static call ${n.text} cannot be resolved.` });
      return;
    }
    // Foo::class is the class name as a string, not a member.
    if (n.type === "class_constant_access_expression" && nameNode.text === "class") return;
    const memberName = isProp ? "$" + (nameNode.namedChildren[0]?.text ?? nameNode.text.replace(/^\$/, "")) : nameNode.text;
    const target: Target = cls ? { t: "member", typeRef: cls, name: memberName } : { t: "member?", name: memberName };
    this.occ(nameNode, n.type === "scoped_call_expression" ? "call" : "ref", target, nameNode.text.replace(/^\$/, ""));
  }
}

function descendantsOfType(n: Node, type: string): Node[] {
  const out: Node[] = [];
  const stack = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.type === type) out.push(cur);
    else stack.push(...cur.namedChildren);
  }
  return out;
}

export function extractPhp(tree: Tree, source: string, path: string): FileIndex {
  const ex = new PhpExtractor(source);
  ex.run(tree.rootNode);
  ex.blocks.sort((a, b) => a.startLine - b.startLine);
  return {
    path,
    language: "php",
    adapterVersion: adapterVersion("php"),
    namespace: ex.namespace,
    imports: [],
    uses: ex.uses,
    decls: ex.decls,
    occurrences: ex.occurrences,
    blocks: ex.blocks,
    hasErrors: tree.rootNode.hasError,
  };
}
