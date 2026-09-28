import type { Node, Tree } from "web-tree-sitter";
import { adapterVersion } from "./versions";
import type { Block, Decl, DeclKind, FileIndex, GoImport, Occurrence, OccurrenceRole, Span, Target } from "./types";

/**
 * Go adapter. Per file it records declarations, lexical scopes (so shadowed
 * names bind to the right declaration), imports with aliases, receiver
 * methods, selector expressions and call sites. Cross-file resolution happens
 * in SemanticIndex. This is syntax-directed name resolution, not a type
 * checker: selectors on values with unknown types become candidates.
 */

const BUILTIN_FUNCS = new Set([
  "append", "cap", "clear", "close", "complex", "copy", "delete", "imag", "len", "make", "max",
  "min", "new", "panic", "print", "println", "real", "recover",
]);
const BUILTIN_TYPES = new Set([
  "bool", "byte", "complex64", "complex128", "error", "float32", "float64", "int", "int8", "int16",
  "int32", "int64", "rune", "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
  "any", "comparable",
]);
const BUILTIN_CONSTS = new Set(["true", "false", "iota", "nil"]);

/** The package name Go uses by default for an import path (heuristic when the package is not indexed). */
export function defaultImportAlias(importPath: string): string {
  const parts = importPath.split("/");
  let last = parts.at(-1) ?? importPath;
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts.at(-2) ?? last;
  last = last.replace(/\.v\d+$/, "").replace(/^go-/, "").replace(/[-.]go$/, "");
  return last.replace(/[-.]/g, "_");
}

function span(n: Node): Span {
  return {
    line: n.startPosition.row + 1,
    col: n.startPosition.column,
    endLine: n.endPosition.row + 1,
    endCol: n.endPosition.column,
  };
}

/**
 * A type reference string: `T`, `pkg.T`, a package-level variable
 * `@pkgvar:name` / `@pkgvar:alias.Name`, or a field chain `@<typeRef>><field>`.
 */
function typeRefOf(n: Node | null): string | undefined {
  if (!n) return undefined;
  switch (n.type) {
    case "type_identifier":
      return BUILTIN_TYPES.has(n.text) ? undefined : n.text;
    case "pointer_type":
      return typeRefOf(n.namedChildren[0] ?? null);
    case "qualified_type": {
      const pkg = n.childForFieldName("package")?.text;
      const name = n.childForFieldName("name")?.text;
      return pkg && name ? `${pkg}.${name}` : undefined;
    }
    case "generic_type":
      return typeRefOf(n.childForFieldName("type"));
    case "parenthesized_type":
      return typeRefOf(n.namedChildren[0] ?? null);
    default:
      return undefined;
  }
}

/** Infers the type of an initializer expression when it is syntactically obvious. */
function inferExprType(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "composite_literal") return typeRefOf(n.childForFieldName("type"));
  if (n.type === "unary_expression" && n.text.startsWith("&")) return inferExprType(n.childForFieldName("operand"));
  if (n.type === "parenthesized_expression") return inferExprType(n.namedChildren[0]);
  return undefined;
}

/** Drops a trailing `{` (with the whitespace around it) from a declaration's first line. */
function stripOpeningBrace(line: string): string {
  const trimmed = line.trimEnd();
  return trimmed.endsWith("{") ? trimmed.slice(0, -1).trimEnd() : line;
}

function methodLabel(recvType: string | undefined, pointer: boolean, name: string): string {
  if (!recvType) return name;
  const receiver = pointer ? `(*${recvType})` : recvType;
  return `${receiver}.${name}`;
}

/** Nodes without references to record. */
const SKIPPED_NODES = new Set([
  "comment", "interpreted_string_literal", "raw_string_literal", "rune_literal", "int_literal",
  "float_literal", "imaginary_literal", "label_name", "package_clause", "import_declaration",
]);
/** Nodes that open a lexical scope for everything inside them. */
const SCOPE_NODES = new Set([
  "block", "if_statement", "for_statement", "expression_switch_statement", "select_statement",
  "expression_case", "default_case", "type_case", "communication_case",
]);

function signatureOf(n: Node, source: string): string {
  const body = n.childForFieldName("body");
  const end = body ? body.startIndex : n.endIndex;
  return source.slice(n.startIndex, end).replace(/\s+/g, " ").trim();
}

class Scope {
  readonly names = new Map<string, number>();
  readonly parent: Scope | null;
  constructor(parent: Scope | null) {
    this.parent = parent;
  }
  lookup(name: string): number | undefined {
    return this.names.get(name) ?? this.parent?.lookup(name);
  }
}

class GoExtractor {
  readonly decls: Decl[] = [];
  readonly occurrences: Occurrence[] = [];
  readonly blocks: Block[] = [];
  readonly imports: GoImport[] = [];
  private readonly importByAlias = new Map<string, string>();
  private readonly dotImports: string[] = [];
  private readonly fileScope = new Scope(null);
  private readonly enclosing: string[] = [];
  packageName = "";
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  private addDecl(d: Omit<Decl, "id">): number {
    const id = this.decls.length;
    this.decls.push({ ...d, id });
    return id;
  }

  private occ(nameNode: Node, role: OccurrenceRole, target: Target) {
    this.occurrences.push({
      name: nameNode.text,
      span: span(nameNode),
      role,
      target,
      enclosing: this.enclosing.at(-1),
    });
  }

  private declare(scope: Scope, nameNode: Node, kind: DeclKind, extra: Partial<Decl> = {}, whole?: Node): number | undefined {
    const name = nameNode.text;
    if (name === "_") return undefined;
    const id = this.addDecl({
      name,
      kind,
      span: span(nameNode),
      scope: scope === this.fileScope ? "top" : "local",
      startLine: (whole ?? nameNode).startPosition.row + 1,
      endLine: (whole ?? nameNode).endPosition.row + 1,
      ...extra,
    });
    scope.names.set(name, id);
    this.occ(nameNode, "def", { t: "decl", decl: id });
    return id;
  }

  run(root: Node) {
    // Pass 1: package clause, imports and top-level declarations, so that
    // references to later declarations in the same file resolve.
    for (const child of root.namedChildren) this.declareTopLevel(child);
    // Pass 2: walk everything for references, bodies and local scopes.
    for (const child of root.namedChildren) this.visitTopLevel(child);
  }

  private declareTopLevel(child: Node) {
    switch (child.type) {
      case "package_clause":
        this.packageName = child.namedChildren[0]?.text ?? "";
        break;
      case "import_declaration":
        this.collectImports(child);
        break;
      case "function_declaration":
        this.declareTopFunction(child);
        break;
      case "type_declaration":
        for (const spec of child.namedChildren) this.declareTypeSpec(spec, this.fileScope, child);
        break;
      case "var_declaration":
      case "const_declaration":
        this.declareTopValues(child);
        break;
      default:
        break; // methods are not in the package scope; handled in pass 2
    }
  }

  private declareTopFunction(fn: Node) {
    const name = fn.childForFieldName("name");
    if (!name) return;
    this.declareTop(name, "function", fn, {
      signature: signatureOf(fn, this.source),
      typeRef: resultTypeRef(fn.childForFieldName("result")),
    });
  }

  private declareTopValues(decl: Node) {
    const kind = decl.type === "var_declaration" ? "var" : "const";
    for (const spec of specsOf(decl)) {
      const typeRef = typeRefOf(spec.childForFieldName("type"));
      const values = spec.childForFieldName("value")?.namedChildren ?? [];
      spec.childrenForFieldName("name").forEach((n, i) => this.declareTop(n, kind, spec, { typeRef: typeRef ?? inferExprType(values[i]) }));
    }
  }

  private visitTopLevel(child: Node) {
    switch (child.type) {
      case "function_declaration":
        this.visitFunction(child, false);
        break;
      case "method_declaration":
        this.visitFunction(child, true);
        break;
      case "type_declaration":
        for (const spec of child.namedChildren) this.visitTypeSpecBody(spec);
        break;
      case "var_declaration":
      case "const_declaration":
        for (const spec of specsOf(child)) {
          this.visit(spec.childForFieldName("type"), this.fileScope);
          this.visit(spec.childForFieldName("value"), this.fileScope);
        }
        break;
      default:
        break;
    }
  }

  private declareTop(nameNode: Node, kind: DeclKind, whole: Node, extra: Partial<Decl> = {}) {
    const name = nameNode.text;
    if (name === "_" || (name === "init" && kind === "function")) {
      // init functions can repeat and cannot be referenced.
      if (name === "init") {
        const id = this.addDecl({ name, kind, span: span(nameNode), scope: "top", startLine: whole.startPosition.row + 1, endLine: whole.endPosition.row + 1, ...extra });
        this.occ(nameNode, "def", { t: "decl", decl: id });
      }
      return;
    }
    this.declare(this.fileScope, nameNode, kind, extra, whole);
  }

  private collectImports(decl: Node) {
    const specs: Node[] = [];
    for (const c of decl.namedChildren) {
      if (c.type === "import_spec") specs.push(c);
      else if (c.type === "import_spec_list") specs.push(...c.namedChildren.filter((s) => s.type === "import_spec"));
    }
    for (const spec of specs) {
      const pathNode = spec.childForFieldName("path");
      if (!pathNode) continue;
      const path = pathNode.text.replace(/^["`]|["`]$/g, "");
      const nameNode = spec.childForFieldName("name");
      const alias = nameNode ? nameNode.text : defaultImportAlias(path);
      this.imports.push({ alias, path, line: spec.startPosition.row + 1 });
      if (alias === ".") this.dotImports.push(path);
      else if (alias !== "_") this.importByAlias.set(alias, path);
    }
  }

  private declareTypeSpec(spec: Node, scope: Scope, whole: Node) {
    if (spec.type !== "type_spec" && spec.type !== "type_alias") return;
    const name = spec.childForFieldName("name");
    const typeNode = spec.childForFieldName("type");
    if (!name) return;
    const kind: DeclKind = typeNode?.type === "interface_type" ? "interface" : "type";
    const container = whole.namedChildren.length > 1 ? spec : whole;
    const id = this.declare(scope, name, kind, {
      signature: `type ${stripOpeningBrace(spec.text.split("\n")[0])}`.replace(/\s+/g, " "),
    }, container);
    if (id === undefined) return;
    this.blocks.push({
      kind: "type",
      name: name.text,
      label: name.text,
      startLine: container.startPosition.row + 1,
      endLine: container.endPosition.row + 1,
      declLine: name.startPosition.row + 1,
      signature: this.decls[id].signature ?? name.text,
      decl: id,
    });
    // Struct fields and interface methods become members of the type.
    if (typeNode?.type === "struct_type") this.declareStructFields(typeNode, name.text);
    else if (typeNode?.type === "interface_type") this.declareInterfaceMethods(typeNode, name.text);
  }

  private declareStructFields(struct: Node, typeName: string) {
    const list = struct.namedChildren.find((c) => c.type === "field_declaration_list");
    for (const field of list?.namedChildren ?? []) {
      if (field.type !== "field_declaration") continue;
      const ftype = field.childForFieldName("type");
      const names = field.childrenForFieldName("name");
      if (names.length === 0 && ftype) {
        this.declareEmbeddedField(field, ftype, typeName);
        continue;
      }
      for (const fn of names) {
        const fid = this.addDecl({ name: fn.text, kind: "field", span: span(fn), scope: "member", container: typeName, typeRef: typeRefOf(ftype), startLine: field.startPosition.row + 1, endLine: field.endPosition.row + 1 });
        this.occ(fn, "def", { t: "decl", decl: fid });
      }
    }
  }

  /** Embedded field: its name is the type name. */
  private declareEmbeddedField(field: Node, ftype: Node, typeName: string) {
    const tref = typeRefOf(ftype);
    const shortName = tref?.split(".").pop();
    if (!shortName) return;
    const fid = this.addDecl({ name: shortName, kind: "field", span: span(ftype), scope: "member", container: typeName, typeRef: tref, startLine: field.startPosition.row + 1, endLine: field.endPosition.row + 1 });
    const nameNode = ftype.type === "pointer_type" ? (ftype.namedChildren[0] ?? ftype) : ftype;
    this.occ(nameNode, "def", { t: "decl", decl: fid });
  }

  private declareInterfaceMethods(iface: Node, typeName: string) {
    for (const m of iface.namedChildren) {
      if (m.type !== "method_elem" && m.type !== "method_spec") continue;
      const mn = m.childForFieldName("name");
      if (!mn) continue;
      const mid = this.addDecl({ name: mn.text, kind: "method", span: span(mn), scope: "member", container: typeName, signature: m.text.replace(/\s+/g, " "), startLine: m.startPosition.row + 1, endLine: m.endPosition.row + 1 });
      this.occ(mn, "def", { t: "decl", decl: mid });
    }
  }

  private visitTypeSpecBody(spec: Node) {
    const typeNode = spec.childForFieldName("type");
    const tparams = spec.childForFieldName("type_parameters");
    const scope = new Scope(this.fileScope);
    if (tparams) this.declareTypeParams(tparams, scope);
    if (!typeNode) return;
    if (typeNode.type === "struct_type") {
      const list = typeNode.namedChildren.find((c) => c.type === "field_declaration_list");
      for (const field of list?.namedChildren ?? []) this.visit(field.childForFieldName("type"), scope);
    } else if (typeNode.type === "interface_type") {
      for (const m of typeNode.namedChildren) {
        if (m.type === "method_elem" || m.type === "method_spec") {
          this.visit(m.childForFieldName("parameters"), scope);
          this.visit(m.childForFieldName("result"), scope);
        } else this.visit(m, scope);
      }
    } else this.visit(typeNode, scope);
  }

  private declareTypeParams(list: Node, scope: Scope) {
    for (const p of list.namedChildren) {
      if (p.type !== "type_parameter_declaration") continue;
      for (const n of p.childrenForFieldName("name")) this.declare(scope, n, "type");
      this.visit(p.childForFieldName("type"), scope);
    }
  }

  private visitFunction(fn: Node, isMethod: boolean) {
    const nameNode = fn.childForFieldName("name");
    if (!nameNode) return;
    const scope = new Scope(this.fileScope);
    const { declId, label } = isMethod ? this.declareMethod(fn, nameNode, scope) : this.functionDecl(fn, nameNode, scope);

    if (declId !== undefined && declId >= 0) {
      this.blocks.push({
        kind: isMethod ? "method" : "function",
        name: nameNode.text,
        label,
        startLine: fn.startPosition.row + 1,
        endLine: fn.endPosition.row + 1,
        declLine: nameNode.startPosition.row + 1,
        signature: signatureOf(fn, this.source),
        decl: declId,
      });
    }

    this.enclosing.push(label);
    this.declareParams(fn.childForFieldName("parameters"), scope);
    this.declareParams(fn.childForFieldName("result"), scope);
    const body = fn.childForFieldName("body");
    if (body) this.visitChildren(body, scope);
    this.enclosing.pop();
  }

  /** Declares a method (a member of its receiver type) and its receiver in the function scope. */
  private declareMethod(fn: Node, nameNode: Node, scope: Scope): { declId: number; label: string } {
    const recv = fn.childForFieldName("receiver");
    const param = recv?.namedChildren.find((c) => c.type === "parameter_declaration");
    const rtype = param?.childForFieldName("type") ?? null;
    const recvType = typeRefOf(rtype);
    const label = methodLabel(recvType, rtype?.type === "pointer_type", nameNode.text);
    const declId = this.addDecl({
      name: nameNode.text,
      kind: "method",
      span: span(nameNode),
      scope: "member",
      container: recvType,
      typeRef: resultTypeRef(fn.childForFieldName("result")),
      signature: signatureOf(fn, this.source),
      startLine: fn.startPosition.row + 1,
      endLine: fn.endPosition.row + 1,
    });
    this.occ(nameNode, "def", { t: "decl", decl: declId });
    // Receiver type parameters, e.g. func (l *List[T]) ...
    const gen = rtype?.type === "pointer_type" ? rtype.namedChildren[0] : rtype;
    if (gen?.type === "generic_type") this.declareReceiverTypeParams(gen, scope);
    if (param) {
      for (const n of param.childrenForFieldName("name")) this.declare(scope, n, "param", { typeRef: recvType });
      if (gen?.type === "generic_type") this.visitTypeRefOnly(gen.childForFieldName("type"), scope);
      else this.visit(rtype, scope);
    }
    return { declId, label };
  }

  private declareReceiverTypeParams(gen: Node, scope: Scope) {
    const args = gen.childForFieldName("type_arguments");
    for (const a of args?.namedChildren ?? []) {
      const id = a.type === "type_elem" ? a.namedChildren[0] : a;
      if (id?.type === "type_identifier") this.declare(scope, id, "type");
    }
  }

  /** The declaration pass 1 made for a function, and its type parameters in the function scope. */
  private functionDecl(fn: Node, nameNode: Node, scope: Scope): { declId: number | undefined; label: string } {
    let declId = this.fileScope.names.get(nameNode.text);
    if (declId === undefined || this.decls[declId]?.span.line !== nameNode.startPosition.row + 1) {
      declId = this.decls.findIndex((d) => d.span.line === nameNode.startPosition.row + 1 && d.span.col === nameNode.startPosition.column);
    }
    const tparams = fn.childForFieldName("type_parameters");
    if (tparams) this.declareTypeParams(tparams, scope);
    return { declId, label: nameNode.text };
  }

  private visitTypeRefOnly(n: Node | null, scope: Scope) {
    if (n) this.visit(n, scope);
  }

  private declareParams(list: Node | null, scope: Scope) {
    if (!list) return;
    if (list.type !== "parameter_list") {
      // Single unnamed result type.
      this.visit(list, scope);
      return;
    }
    for (const p of list.namedChildren) {
      if (p.type !== "parameter_declaration" && p.type !== "variadic_parameter_declaration") continue;
      const t = p.childForFieldName("type");
      this.visit(t, scope);
      const typeRef = p.type === "variadic_parameter_declaration" ? undefined : typeRefOf(t);
      for (const n of p.childrenForFieldName("name")) this.declare(scope, n, "param", { typeRef });
    }
  }

  private visitChildren(n: Node, scope: Scope) {
    for (const c of n.namedChildren) this.visit(c, scope);
  }

  private visit(n: Node | null | undefined, scope: Scope): void {
    if (!n || SKIPPED_NODES.has(n.type)) return;
    if (SCOPE_NODES.has(n.type)) {
      this.visitChildren(n, new Scope(scope));
      return;
    }
    switch (n.type) {
      case "type_switch_statement":
        this.visitTypeSwitch(n, scope);
        break;
      case "func_literal":
        this.visitFuncLiteral(n, scope);
        break;
      case "short_var_declaration":
        this.visitShortVarDeclaration(n, scope);
        break;
      case "range_clause":
        this.visitRangeClause(n, scope);
        break;
      case "var_declaration":
      case "const_declaration":
        this.visitValueDeclaration(n, scope);
        break;
      case "type_declaration":
        for (const spec of n.namedChildren) {
          this.declareTypeSpec(spec, scope, n);
          this.visitTypeSpecBody(spec);
        }
        break;
      case "keyed_element":
        this.visitKeyedElement(n, scope);
        break;
      case "selector_expression":
        this.visitSelector(n, scope);
        break;
      case "qualified_type":
        this.visitQualifiedType(n);
        break;
      case "type_identifier":
        if (!BUILTIN_TYPES.has(n.text)) this.reference(n, scope, "ref");
        break;
      case "identifier":
        this.reference(n, scope, isCallee(n) ? "call" : "ref");
        break;
      case "field_identifier":
        // Bare field identifiers outside selectors (struct keys etc.) are not resolvable here.
        break;
      default:
        this.visitChildren(n, scope);
    }
  }

  private visitTypeSwitch(n: Node, scope: Scope) {
    const inner = new Scope(scope);
    this.visit(n.childForFieldName("initializer"), inner);
    this.visit(n.childForFieldName("value"), inner);
    const alias = n.childForFieldName("alias");
    for (const c of n.namedChildren) {
      if (c.type !== "type_case" && c.type !== "default_case") continue;
      const caseScope = new Scope(inner);
      for (const a of alias?.namedChildren ?? []) if (a.type === "identifier") this.declare(caseScope, a, "local");
      this.visitChildren(c, caseScope);
    }
  }

  private visitFuncLiteral(n: Node, scope: Scope) {
    const inner = new Scope(scope);
    this.declareParams(n.childForFieldName("parameters"), inner);
    this.declareParams(n.childForFieldName("result"), inner);
    const body = n.childForFieldName("body");
    if (body) this.visitChildren(body, inner);
  }

  private visitShortVarDeclaration(n: Node, scope: Scope) {
    const left = n.childForFieldName("left");
    const right = n.childForFieldName("right");
    this.visit(right, scope);
    const values = right?.namedChildren ?? [];
    left?.namedChildren.forEach((id, i) => {
      if (id.type !== "identifier") {
        this.visit(id, scope);
        return;
      }
      // `:=` redeclares names already in the same scope (assignment).
      const existing = scope.names.get(id.text);
      if (existing !== undefined) this.occ(id, "ref", { t: "decl", decl: existing });
      else this.declare(scope, id, "local", { typeRef: this.shortVarTypeRef(values, left.namedChildren.length, i, scope) });
    });
  }

  /** `a, b := x, y` pairs names with values; `v, err := f()` types the first name by f's result. */
  private shortVarTypeRef(values: Node[], names: number, i: number, scope: Scope): string | undefined {
    if (values.length === names) return this.typeOfExpr(values[i], scope);
    if (i === 0 && values.length === 1 && values[0].type === "call_expression") return this.typeOfExpr(values[0], scope);
    return undefined;
  }

  private visitRangeClause(n: Node, scope: Scope) {
    const left = n.childForFieldName("left");
    const right = n.childForFieldName("right");
    this.visit(right, scope);
    const isDecl = n.children.some((c) => c.type === ":=");
    for (const id of left?.namedChildren ?? []) {
      if (isDecl && id.type === "identifier") this.declare(scope, id, "local");
      else this.visit(id, scope);
    }
  }

  private visitValueDeclaration(n: Node, scope: Scope) {
    const kind = n.type === "var_declaration" ? "local" : "const";
    for (const spec of specsOf(n)) {
      const t = spec.childForFieldName("type");
      const value = spec.childForFieldName("value");
      this.visit(t, scope);
      this.visit(value, scope);
      const values = value?.namedChildren ?? [];
      spec.childrenForFieldName("name").forEach((id, i) => this.declare(scope, id, kind, { typeRef: typeRefOf(t) ?? inferExprType(values[i]) }));
    }
  }

  /** In composite literals the key is usually a struct field name, not a variable. */
  private visitKeyedElement(n: Node, scope: Scope) {
    const key = n.childForFieldName("key") ?? n.namedChildren[0];
    const value = n.childForFieldName("value") ?? n.namedChildren[1];
    const keyInner = key?.type === "literal_element" ? key.namedChildren[0] : key;
    if (keyInner && keyInner.type !== "identifier") this.visit(keyInner, scope);
    this.visit(value, scope);
  }

  private visitQualifiedType(n: Node) {
    const pkg = n.childForFieldName("package");
    const name = n.childForFieldName("name");
    if (!pkg || !name) return;
    const importPath = this.importByAlias.get(pkg.text);
    if (importPath) this.occ(name, "ref", { t: "import", importPath, name: name.text });
  }

  private reference(n: Node, scope: Scope, role: OccurrenceRole) {
    const name = n.text;
    if (name === "_") return;
    const local = scope.lookup(name);
    if (local !== undefined) {
      this.occ(n, role, { t: "decl", decl: local });
      return;
    }
    if (BUILTIN_FUNCS.has(name) || BUILTIN_CONSTS.has(name) || BUILTIN_TYPES.has(name)) return;
    if (this.importByAlias.has(name)) return; // a package name used on its own
    if (this.dotImports.length > 0) {
      // Could come from a dot-import or from another file in this package.
      this.occ(n, role, { t: "pkg", name });
      return;
    }
    this.occ(n, role, { t: "pkg", name });
  }

  private visitSelector(n: Node, scope: Scope) {
    const operand = n.childForFieldName("operand");
    const field = n.childForFieldName("field");
    if (!operand || !field) return this.visitChildren(n, scope);
    const role: OccurrenceRole = isCallee(n) ? "call" : "ref";

    if (operand.type === "identifier") {
      const name = operand.text;
      const local = scope.lookup(name);
      if (local === undefined && this.importByAlias.has(name)) {
        const importPath = this.importByAlias.get(name)!;
        this.occ(field, role, { t: "import", importPath, name: field.text });
        return;
      }
      this.visit(operand, scope);
      const typeRef = local !== undefined ? this.decls[local].typeRef : undefined;
      if (typeRef) this.occ(field, role, { t: "member", typeRef, name: field.text });
      else if (local === undefined && !BUILTIN_CONSTS.has(name)) {
        // Package-level variable from another file: its type is resolved later.
        this.occ(field, role, { t: "member", typeRef: `@pkgvar:${name}`, name: field.text });
      } else this.occ(field, role, { t: "member?", name: field.text });
      return;
    }

    this.visit(operand, scope);
    const chain = this.typeOfExpr(operand, scope);
    if (chain) this.occ(field, role, { t: "member", typeRef: chain, name: field.text });
    else this.occ(field, role, { t: "member?", name: field.text });
  }

  /** Type reference for `a.b.c` chains, encoded as `@<typeRef>><field>`. */
  private typeOfExpr(n: Node, scope: Scope): string | undefined {
    switch (n.type) {
      case "identifier":
        return this.typeOfIdentifier(n.text, scope);
      case "selector_expression":
        return this.typeOfSelector(n, scope);
      case "parenthesized_expression":
        return this.typeOfExpr(n.namedChildren[0], scope);
      case "composite_literal":
      case "unary_expression":
        return inferExprType(n);
      case "call_expression":
        return this.typeOfCall(n, scope);
      default:
        return undefined;
    }
  }

  private typeOfIdentifier(name: string, scope: Scope): string | undefined {
    const local = scope.lookup(name);
    if (local !== undefined) return this.decls[local].typeRef;
    return this.importByAlias.has(name) ? undefined : `@pkgvar:${name}`;
  }

  private typeOfSelector(n: Node, scope: Scope): string | undefined {
    const op = n.childForFieldName("operand");
    const f = n.childForFieldName("field");
    if (!op || !f) return undefined;
    if (op.type === "identifier" && scope.lookup(op.text) === undefined && this.importByAlias.has(op.text)) {
      return `@pkgvar:${op.text}.${f.text}`;
    }
    const base = this.typeOfExpr(op, scope);
    return base ? `@${base}>${f.text}` : undefined;
  }

  /** The type of a call is the first result type of the callee. */
  private typeOfCall(n: Node, scope: Scope): string | undefined {
    const fn = n.childForFieldName("function");
    if (fn?.type === "selector_expression") return this.typeOfExpr(fn, scope);
    if (fn?.type !== "identifier") return undefined;
    const local = scope.lookup(fn.text);
    if (local !== undefined) {
      const d = this.decls[local];
      return d.kind === "type" ? d.name : d.typeRef;
    }
    return BUILTIN_FUNCS.has(fn.text) || BUILTIN_TYPES.has(fn.text) ? undefined : `@pkgvar:${fn.text}`;
  }

  get importsMap(): Map<string, string> {
    return this.importByAlias;
  }
}

/** First result type of a function, e.g. `T` for `(T, error)`. */
function resultTypeRef(result: Node | null): string | undefined {
  if (!result) return undefined;
  if (result.type === "parameter_list") {
    const first = result.namedChildren.find((c) => c.type === "parameter_declaration");
    return typeRefOf(first?.childForFieldName("type") ?? null);
  }
  return typeRefOf(result);
}

function specsOf(decl: Node): Node[] {
  const out: Node[] = [];
  for (const c of decl.namedChildren) {
    if (c.type === "var_spec" || c.type === "const_spec") out.push(c);
    else if (c.type === "var_spec_list" || c.type === "const_spec_list") out.push(...c.namedChildren.filter((s) => s.type === "var_spec" || s.type === "const_spec"));
  }
  return out;
}

function isCallee(n: Node): boolean {
  const p = n.parent;
  if (!p) return false;
  if (p.type === "call_expression") {
    const f = p.childForFieldName("function");
    return !!f && f.startIndex === n.startIndex && f.endIndex === n.endIndex;
  }
  return false;
}

export function extractGo(tree: Tree, source: string, path: string): FileIndex {
  const ex = new GoExtractor(source);
  ex.run(tree.rootNode);
  ex.blocks.sort((a, b) => a.startLine - b.startLine);
  return {
    path,
    language: "go",
    adapterVersion: adapterVersion("go"),
    packageName: ex.packageName,
    imports: ex.imports,
    uses: [],
    decls: ex.decls,
    occurrences: ex.occurrences,
    blocks: ex.blocks,
    hasErrors: tree.rootNode.hasError,
  };
}
