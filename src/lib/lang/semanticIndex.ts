import { dirname } from "../util/files";
import { nameSpaceOf, SEMANTIC_LANGUAGES } from "./registry";
import type { Decl, DeclKind, FileIndex, Occurrence, OccurrenceRole, Target } from "./types";

export interface GoModule {
  /** Directory of go.mod ("" for the repository root). */
  dir: string;
  /** Module path from the `module` directive. */
  path: string;
}

export interface SymbolLocation {
  path: string;
  line: number;
  col: number;
  endCol: number;
  name: string;
  kind?: DeclKind;
  role?: OccurrenceRole;
  /** Enclosing function/method of a reference ("called from"). */
  enclosing?: string;
  /** e.g. `(*Server).Serve` or `InvoiceTotals::net`. */
  label?: string;
  key?: string;
}

export type Resolution =
  | {
      status: "resolved";
      key: string;
      name: string;
      defs: SymbolLocation[];
      kind?: DeclKind;
      scope: "local" | "file" | "package" | "repository";
      /** "name": matched by name across files (generic adapter), not by scopes and types. */
      precision?: "exact" | "name";
    }
  | { status: "candidates"; name: string; candidates: SymbolLocation[]; reason: string }
  /** Outside the indexed code. `key` (when known) still finds every usage of it in the repository. */
  | { status: "external"; name: string; reason: string; key?: string }
  | { status: "dynamic"; name: string; reason: string }
  | { status: "unresolved"; name: string; reason: string };

export interface ReferenceResult {
  defs: SymbolLocation[];
  /** References that resolve exactly to the symbol. */
  refs: SymbolLocation[];
  /** Occurrences that might refer to it (receiver type unknown). */
  possible: SymbolLocation[];
}

interface DeclRef {
  path: string;
  id: number;
}

const MAX_TYPE_DEPTH = 8;

export class SemanticIndex {
  private readonly files = new Map<string, FileIndex>();
  private goModules: GoModule[] = [];
  private goDirs = new Set<string>();
  private readonly goTop = new Map<string, Map<string, DeclRef[]>>();
  private readonly goMembers = new Map<string, Map<string, DeclRef[]>>();
  private readonly phpClasses = new Map<string, DeclRef[]>();
  private readonly phpMembers = new Map<string, DeclRef[]>();
  private readonly phpFunctions = new Map<string, DeclRef[]>();
  private readonly nameIndex = new Map<string, { path: string; i: number }[]>();
  /** Generic languages: top-level and member declarations by language, then by name. */
  private readonly genericByName = new Map<string, Map<string, DeclRef[]>>();
  private readonly memberNames = new Map<string, DeclRef[]>();
  /** Changes on every add or remove, so derived caches know when to rebuild. */
  generation = 0;

  setGoModules(mods: GoModule[]) {
    this.goModules = [...mods].sort((a, b) => b.path.length - a.path.length);
  }

  /** Directories that contain Go files, used to map import paths when there is no go.mod. */
  setGoDirs(dirs: Iterable<string>) {
    this.goDirs = new Set(dirs);
  }

  get fileCount(): number {
    return this.files.size;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  get(path: string): FileIndex | undefined {
    return this.files.get(path);
  }

  paths(): string[] {
    return [...this.files.keys()];
  }

  add(fi: FileIndex) {
    if (this.files.has(fi.path)) this.remove(fi.path);
    this.generation++;
    this.files.set(fi.path, fi);
    fi.decls.forEach((d) => {
      const ref = { path: fi.path, id: d.id };
      if (fi.language === "go") this.addGoDecl(fi, d, ref);
      else if (fi.language === "php") this.addPhpDecl(d, ref);
      else if (d.scope !== "local") {
        push(getOrCreate(this.genericByName, nameSpaceOf(fi.language), () => new Map()), d.name, ref);
      }
    });
    fi.occurrences.forEach((o, i) => {
      getOrCreate(this.nameIndex, this.nameKey(fi.language, o.name), () => []).push({ path: fi.path, i });
    });
  }

  remove(path: string) {
    const fi = this.files.get(path);
    if (!fi) return;
    this.files.delete(path);
    this.generation++;
    const strip = (m: Map<string, DeclRef[]>) => {
      for (const [k, list] of m) {
        const kept = list.filter((r) => r.path !== path);
        if (kept.length) m.set(k, kept);
        else m.delete(k);
      }
    };
    for (const m of this.goTop.values()) strip(m);
    for (const m of this.goMembers.values()) strip(m);
    strip(this.phpClasses);
    strip(this.phpMembers);
    strip(this.phpFunctions);
    strip(this.memberNames);
    for (const m of this.genericByName.values()) strip(m);
    for (const [k, list] of this.nameIndex) {
      const kept = list.filter((r) => r.path !== path);
      if (kept.length) this.nameIndex.set(k, kept);
      else this.nameIndex.delete(k);
    }
  }

  private nameKey(lang: string, name: string): string {
    return lang === "php" ? name.replace(/^\$/, "").toLowerCase() : name;
  }

  private pkgId(fi: FileIndex): string {
    const dir = dirname(fi.path);
    return fi.packageName?.endsWith("_test") ? `${dir}#test` : dir;
  }

  private addGoDecl(fi: FileIndex, d: Decl, ref: DeclRef) {
    const pkg = this.pkgId(fi);
    if (d.scope === "top") {
      push(getOrCreate(this.goTop, pkg, () => new Map()), d.name, ref);
    } else if (d.scope === "member" && d.container) {
      push(getOrCreate(this.goMembers, pkg, () => new Map()), `${d.container}.${d.name}`, ref);
      push(this.memberNames, `go:${d.name}`, ref);
    }
  }

  private addPhpDecl(d: Decl, ref: DeclRef) {
    if (d.scope === "top" && d.fqn) {
      if (d.kind === "function") push(this.phpFunctions, d.fqn.toLowerCase(), ref);
      else push(this.phpClasses, d.fqn.toLowerCase(), ref);
    } else if (d.scope === "member" && d.fqn) {
      push(this.phpMembers, `${d.fqn.toLowerCase()}::${phpMemberKey(d)}`, ref);
      push(this.memberNames, `php:${phpMemberKey(d)}`, ref);
    }
  }

  // ---------- Keys ----------

  keyOfDecl(path: string, d: Decl): string {
    const fi = this.files.get(path)!;
    if (d.scope === "local") return `L|${path}|${d.id}`;
    if (fi.language !== "go" && fi.language !== "php") return `N|${nameSpaceOf(fi.language)}|${qualifiedName(d.container, d.name)}`;
    if (fi.language === "go") {
      const pkg = this.pkgId(fi);
      if (d.scope === "member") return `G|${pkg}|${d.container ?? "?"}.${d.name}`;
      if (d.name === "init" && d.kind === "function") return `L|${path}|${d.id}`;
      return `G|${pkg}|${d.name}`;
    }
    if (d.scope === "member") return `P|m|${(d.fqn ?? "").toLowerCase()}::${phpMemberKey(d)}`;
    if (d.kind === "function") return `P|f|${(d.fqn ?? d.name).toLowerCase()}`;
    return `P|c|${(d.fqn ?? d.name).toLowerCase()}`;
  }

  private declsForKey(key: string): DeclRef[] {
    const [kind, a, b] = key.split("|");
    if (kind === "L") {
      const fi = this.files.get(a);
      return fi?.decls[Number(b)] ? [{ path: a, id: Number(b) }] : [];
    }
    if (kind === "G") {
      const dot = b.indexOf(".");
      if (dot >= 0) return this.goMembers.get(a)?.get(b) ?? [];
      return this.goTop.get(a)?.get(b) ?? [];
    }
    if (kind === "N") {
      const qname = key.split("|").slice(2).join("|");
      const name = qname.slice(qname.lastIndexOf(".") + 1);
      return (this.genericByName.get(a)?.get(name) ?? []).filter((r) => this.keyOfDecl(r.path, this.files.get(r.path)!.decls[r.id]) === key);
    }
    if (kind === "P") {
      const rest = key.slice(4);
      if (a === "c") return this.phpClasses.get(rest) ?? [];
      if (a === "f") return this.phpFunctions.get(rest) ?? [];
      if (a === "m") return this.phpMembers.get(rest) ?? [];
    }
    return [];
  }

  location(ref: DeclRef): SymbolLocation {
    const fi = this.files.get(ref.path)!;
    const d = fi.decls[ref.id];
    const block = fi.blocks.find((b) => b.decl === d.id);
    return {
      path: ref.path,
      line: d.span.line,
      col: d.span.col,
      endCol: d.span.endCol,
      name: d.name,
      kind: d.kind,
      label: block?.label ?? qualifiedName(d.container, d.name),
      key: this.keyOfDecl(ref.path, d),
    };
  }

  // ---------- Lookup ----------

  occurrenceAt(path: string, line: number, col: number): { occ: Occurrence; index: number } | undefined {
    const fi = this.files.get(path);
    if (!fi) return undefined;
    for (let i = 0; i < fi.occurrences.length; i++) {
      const o = fi.occurrences[i];
      if (o.span.line === line && col >= o.span.col && col < o.span.endCol) return { occ: o, index: i };
    }
    return undefined;
  }

  resolveOccurrence(path: string, index: number): Resolution {
    const fi = this.files.get(path);
    const occ = fi?.occurrences[index];
    if (!fi || !occ) return { status: "unresolved", name: "", reason: "Unknown position." };
    return this.resolveTarget(fi, occ.target, occ.name);
  }

  private resolved(refs: DeclRef[], name: string, scope: "local" | "file" | "package" | "repository"): Resolution {
    const defs = refs.map((r) => this.location(r));
    return { status: "resolved", key: defs[0].key!, name, defs, kind: defs[0].kind, scope };
  }

  resolveTarget(fi: FileIndex, target: Target, name: string): Resolution {
    switch (target.t) {
      case "decl":
        return this.resolveDecl(fi, target.decl, name);
      case "pkg":
        return this.resolvePkg(fi, target.name, name);
      case "import":
        return this.resolveImport(target.importPath, target.name, name);
      case "member":
        if (fi.language === "go") return this.resolveGoMember(fi, target.typeRef, target.name, name);
        return this.resolvePhpMember(fi, target.typeRef, target.name, name);
      case "member?":
        return this.memberCandidates(fi.language, target.name, name, "The receiver's type is not known from the code, so these are all members with this name.");
      case "class":
        return this.resolvePhpClass(target.fqn, name);
      case "function":
        return this.resolvePhpFunction(target.fqn, target.fallback, name);
      case "dynamic":
        return { status: "dynamic", name, reason: target.reason };
      case "name":
        return this.resolveByName(fi, target.name, !!target.member, name, target.inClass, target.receiver);
    }
  }

  private resolveDecl(fi: FileIndex, id: number, name: string): Resolution {
    const d = fi.decls[id];
    if (!d) return { status: "unresolved", name, reason: "Declaration missing." };
    const own = [{ path: fi.path, id: d.id }];
    const refs = d.scope === "local" ? own : this.declsForKey(this.keyOfDecl(fi.path, d));
    return this.resolved(refs.length ? refs : own, name, resolutionScope(d.scope));
  }

  private resolvePkg(fi: FileIndex, targetName: string, name: string): Resolution {
    const refs = this.goTop.get(this.pkgId(fi))?.get(targetName);
    if (refs?.length) return this.resolved(refs, name, "package");
    // External test packages see the package under test through an import.
    for (const imp of fi.imports) {
      if (imp.alias !== ".") continue;
      const dir = this.importDir(imp.path);
      const r = dir === null ? undefined : this.goTop.get(dir)?.get(targetName);
      if (r?.length) return this.resolved(r, name, "repository");
    }
    return { status: "unresolved", name, reason: `No declaration of ${name} was found in the indexed files of this package.` };
  }

  private resolveImport(importPath: string, targetName: string, name: string): Resolution {
    const dir = this.importDir(importPath);
    if (dir === null) {
      return { status: "external", name, reason: `${importPath} is a dependency outside this repository. Dependencies are not indexed.`, key: `G|ext:${importPath}|${targetName}` };
    }
    const refs = this.goTop.get(dir)?.get(targetName);
    if (refs?.length) return this.resolved(refs, name, "repository");
    return { status: "unresolved", name, reason: `${targetName} was not found in ${dir || "the root package"} (indexed files only).` };
  }

  private resolvePhpClass(fqn: string, name: string): Resolution {
    const refs = this.phpClasses.get(fqn.toLowerCase());
    if (refs?.length) return this.resolved(refs, name, "repository");
    return { status: "external", name, reason: `${fqn} is not defined in the indexed files. It may come from a Composer dependency or PHP itself.`, key: `P|c|${fqn.toLowerCase()}` };
  }

  private resolvePhpFunction(fqn: string, fallback: string | undefined, name: string): Resolution {
    const refs = this.phpFunctions.get(fqn.toLowerCase()) ?? (fallback ? this.phpFunctions.get(fallback.toLowerCase()) : undefined);
    if (refs?.length) return this.resolved(refs, name, "repository");
    return { status: "external", name, reason: `${fallback ?? fqn}() is not defined in the indexed files. It is likely a PHP built-in or dependency function.`, key: `P|f|${(fallback ?? fqn).toLowerCase()}` };
  }

  /**
   * Generic languages: a reference matches declarations with the same name in
   * the same language. One match (or one in the same file) resolves; several
   * are candidates. Labeled precision "name".
   */
  private resolveByName(fi: FileIndex, targetName: string, member: boolean, name: string, inClass?: string, receiver?: string): Resolution {
    const all = this.genericByName.get(nameSpaceOf(fi.language))?.get(targetName) ?? [];
    if (all.length === 0)
      return { status: "external", name, reason: `${targetName} is not declared in the indexed ${SEMANTIC_LANGUAGES[fi.language].label} files. It may come from a library or the standard library.`, key: `N|${nameSpaceOf(fi.language)}|${member ? "?." : ""}${targetName}` };
    const refs = this.preferredByName(fi, all, member, inClass, receiver);
    const pick = this.pickByName(fi, refs);
    if (pick) {
      const r = this.resolved(pick, name, "repository");
      return r.status === "resolved" ? { ...r, precision: "name" } : r;
    }
    return {
      status: "candidates",
      name,
      candidates: refs.map((r) => this.location(r)),
      reason: `${refs.length} declarations are named ${targetName}. This language is matched by name, so these are all of them.`,
    };
  }

  private declOf(r: DeclRef): Decl {
    return this.files.get(r.path)!.decls[r.id];
  }

  /**
   * Narrows same-named declarations to the likely ones. A bare name inside a
   * class prefers that class's own member (an implicit this/self call), then
   * top-level declarations; obj.name prefers members. Type.name / Mod.fun:
   * members of that type or module come first.
   */
  private preferredByName(fi: FileIndex, all: DeclRef[], member: boolean, inClass?: string, receiver?: string): DeclRef[] {
    let refs = all;
    if (member && receiver) {
      const onReceiver = refs.filter((r) => {
        const c = this.declOf(r).container;
        return !!c && (c === receiver || c.endsWith(`.${receiver}`) || c.endsWith(`::${receiver}`));
      });
      if (onReceiver.length) refs = onReceiver;
    }
    const own = !member && inClass ? refs.filter((r) => this.declOf(r).scope === "member" && this.declOf(r).container === inClass) : [];
    const ownHere = own.filter((r) => r.path === fi.path);
    let preferred: DeclRef[];
    if (ownHere.length) preferred = ownHere;
    else if (own.length) preferred = own;
    else preferred = refs.filter((r) => (member ? this.declOf(r).scope === "member" : this.declOf(r).scope === "top"));
    return preferred.length ? preferred : refs;
  }

  /** The declarations that make one symbol, or null when the name stays ambiguous. */
  private pickByName(fi: FileIndex, refs: DeclRef[]): DeclRef[] | null {
    if (refs.length === 1) return refs;
    // Declarations that share one symbol key (a Scala class and its companion
    // object, C# partial classes) are one symbol with several definitions.
    const TYPE_KINDS = new Set(["class", "interface", "trait", "enum", "type"]);
    const oneKey = new Set(refs.map((r) => this.keyOfDecl(r.path, this.declOf(r)))).size === 1;
    // Also one symbol: several clauses of one function in one file (Elixir, overloads).
    const oneType = oneKey && (refs.every((r) => TYPE_KINDS.has(this.declOf(r).kind)) || refs.every((r) => r.path === refs[0].path));
    if (oneType) return refs;
    const sameFile = refs.filter((r) => r.path === fi.path);
    return sameFile.length === 1 ? sameFile : null;
  }

  private memberCandidates(lang: string, memberName: string, name: string, reason: string): Resolution {
    const key = lang === "php" ? `php:${phpNameKeyForLookup(memberName)}` : `go:${memberName}`;
    let refs = this.memberNames.get(key) ?? [];
    if (lang === "php" && refs.length === 0 && !memberName.startsWith("$")) refs = this.memberNames.get(`php:k:${memberName}`) ?? [];
    if (refs.length === 0) return { status: "unresolved", name, reason: "No member with this name was found in the indexed files." };
    return { status: "candidates", name, candidates: refs.map((r) => this.location(r)), reason };
  }

  // ---------- Go ----------

  importDir(importPath: string): string | null {
    for (const m of this.goModules) {
      if (importPath === m.path) return m.dir;
      if (importPath.startsWith(m.path + "/")) {
        const rest = importPath.slice(m.path.length + 1);
        return m.dir ? `${m.dir}/${rest}` : rest;
      }
    }
    return this.goModules.length === 0 ? this.goPathDir(importPath) : null;
  }

  /** No go.mod (GOPATH layout): match the longest directory suffix. */
  private goPathDir(importPath: string): string | null {
    let best: string | null = null;
    for (const d of this.goDirs) {
      if (d && (importPath === d || importPath.endsWith("/" + d)) && (!best || d.length > best.length)) best = d;
    }
    return best;
  }

  /** Resolves a Go type reference in the context of a file to (package, type name). */
  private resolveGoType(fi: FileIndex, typeRef: string, depth = 0): { pkg: string; type: string } | null {
    if (depth > MAX_TYPE_DEPTH) return null;
    if (typeRef.startsWith("@pkgvar:")) return this.resolveGoPkgVarType(fi, typeRef.slice(8), depth);
    if (typeRef.startsWith("@")) return this.resolveGoFieldType(fi, typeRef, depth);
    const dot = typeRef.indexOf(".");
    if (dot >= 0) {
      const dir = this.importDirOfAlias(fi, typeRef.slice(0, dot));
      return dir === null ? null : { pkg: dir, type: typeRef.slice(dot + 1) };
    }
    return { pkg: this.pkgId(fi), type: typeRef };
  }

  /** Directory of the package a file imports under `alias`, when it is in the repository. */
  private importDirOfAlias(fi: FileIndex, alias: string): string | null {
    const imp = fi.imports.find((i) => i.alias === alias);
    return imp ? this.importDir(imp.path) : null;
  }

  /** `@pkgvar:name` / `@pkgvar:alias.name`: the type of a package-level variable. */
  private resolveGoPkgVarType(fi: FileIndex, rest: string, depth: number): { pkg: string; type: string } | null {
    const dot = rest.indexOf(".");
    let refs: DeclRef[] | undefined;
    if (dot >= 0) {
      const dir = this.importDirOfAlias(fi, rest.slice(0, dot));
      refs = dir === null ? undefined : this.goTop.get(dir)?.get(rest.slice(dot + 1));
    } else refs = this.goTop.get(this.pkgId(fi))?.get(rest);
    const ref = refs?.[0];
    if (!ref) return null;
    const dfi = this.files.get(ref.path)!;
    const d = dfi.decls[ref.id];
    if (d.kind === "type" || d.kind === "interface") return { pkg: this.pkgId(dfi), type: d.name };
    return d.typeRef ? this.resolveGoType(dfi, d.typeRef, depth + 1) : null;
  }

  /** `@<type>>field`: the type of a field or method result on another type. */
  private resolveGoFieldType(fi: FileIndex, typeRef: string, depth: number): { pkg: string; type: string } | null {
    const sep = typeRef.lastIndexOf(">");
    if (sep < 0) return null;
    const base = this.resolveGoType(fi, typeRef.slice(1, sep), depth + 1);
    if (!base) return null;
    const field = this.findGoMember(base.pkg, base.type, typeRef.slice(sep + 1), depth + 1);
    if (!field) return null;
    const dfi = this.files.get(field.path)!;
    const d = dfi.decls[field.id];
    return d.typeRef ? this.resolveGoType(dfi, d.typeRef, depth + 1) : null;
  }

  /** Finds a method or field on a type, following embedded fields. */
  private findGoMember(pkg: string, type: string, member: string, depth = 0): DeclRef | null {
    if (depth > MAX_TYPE_DEPTH) return null;
    const members = this.goMembers.get(pkg);
    const direct = members?.get(`${type}.${member}`)?.[0];
    if (direct) return direct;
    if (!members) return null;
    // Embedded fields: a field whose name equals its type's name.
    for (const [k, refs] of members) {
      if (!k.startsWith(type + ".")) continue;
      for (const r of refs) {
        const found = this.findViaEmbedded(r, member, depth);
        if (found) return found;
      }
    }
    return null;
  }

  private findViaEmbedded(r: DeclRef, member: string, depth: number): DeclRef | null {
    const fi = this.files.get(r.path)!;
    const d = fi.decls[r.id];
    const typeRef = embeddedTypeRef(d);
    if (!typeRef) return null;
    const t = this.resolveGoType(fi, typeRef, depth + 1);
    return t ? this.findGoMember(t.pkg, t.type, member, depth + 1) : null;
  }

  private resolveGoMember(fi: FileIndex, typeRef: string, member: string, name: string): Resolution {
    const t = this.resolveGoType(fi, typeRef);
    if (t) {
      const ref = this.findGoMember(t.pkg, t.type, member);
      if (ref) {
        const all = this.goMembers.get(this.pkgId(this.files.get(ref.path)!))?.get(`${this.files.get(ref.path)!.decls[ref.id].container}.${member}`) ?? [ref];
        return this.resolved(all, name, "repository");
      }
      return this.memberCandidates("go", member, name, `${member} is not declared on ${t.type} in the indexed files. It may come from an interface or an embedded type in a dependency.`);
    }
    if (typeRef.includes(".") && !typeRef.startsWith("@")) {
      const alias = typeRef.split(".")[0];
      const imp = fi.imports.find((i) => i.alias === alias);
      if (imp && this.importDir(imp.path) === null) {
        return { status: "external", name, reason: `${member} belongs to ${typeRef} from ${imp.path}, a dependency that is not indexed.` };
      }
    }
    return this.memberCandidates("go", member, name, "The receiver's type could not be determined, so these are all members with this name.");
  }

  // ---------- PHP ----------

  private resolvePhpType(fi: FileIndex, typeRef: string, depth = 0): string | null {
    if (depth > MAX_TYPE_DEPTH) return null;
    if (!typeRef.startsWith("@")) return typeRef;
    // `@<class>::$prop` (property type) or `@<class>::m:<method>` (method return type).
    const sep = typeRef.lastIndexOf("::");
    if (sep < 0) return null;
    const cls = this.resolvePhpType(fi, typeRef.slice(1, sep), depth + 1);
    if (!cls) return null;
    const tail = typeRef.slice(sep + 2);
    const member = this.findPhpMember(cls, tail.startsWith("m:") ? tail.slice(2) : tail);
    if (!member) return null;
    const mfi = this.files.get(member.path)!;
    const t = mfi.decls[member.id].typeRef;
    return t ? this.resolvePhpType(mfi, t, depth + 1) : null;
  }

  private findPhpMember(classFqn: string, memberName: string): DeclRef | null {
    let cls: string | undefined = classFqn;
    for (let i = 0; cls && i < MAX_TYPE_DEPTH; i++) {
      const lc: string = cls.toLowerCase();
      for (const key of phpLookupKeys(memberName)) {
        const hit = this.phpMembers.get(`${lc}::${key}`)?.[0];
        if (hit) return hit;
      }
      const classRef: DeclRef | undefined = this.phpClasses.get(lc)?.[0];
      if (!classRef) return null;
      cls = this.files.get(classRef.path)!.decls[classRef.id].extendsFqn;
    }
    return null;
  }

  private resolvePhpMember(fi: FileIndex, typeRef: string, member: string, name: string): Resolution {
    const cls = this.resolvePhpType(fi, typeRef);
    if (cls) {
      const ref = this.findPhpMember(cls, member);
      if (ref) return this.resolved([ref], name, "repository");
      if (!this.phpClasses.has(cls.toLowerCase())) {
        return { status: "external", name, reason: `${cls} is not defined in the indexed files, so ${member.replace(/^\$/, "")} cannot be resolved. It may come from a dependency.` };
      }
      return this.memberCandidates("php", member, name, `${member.replace(/^\$/, "")} is not declared on ${cls} or its parents in the indexed files. It may come from a trait, an interface or a magic method.`);
    }
    return this.memberCandidates("php", member, name, "The object's class is not known from the code, so these are all members with this name.");
  }

  // ---------- References ----------

  references(key: string): ReferenceResult {
    const defs = this.declsForKey(key).map((r) => this.location(r));
    const refs: SymbolLocation[] = [];
    const possible: SymbolLocation[] = [];
    if (key.startsWith("L|")) {
      const [, path, id] = key.split("|");
      const fi = this.files.get(path);
      fi?.occurrences.forEach((o) => {
        if (o.target.t === "decl" && o.target.decl === Number(id) && o.role !== "def") refs.push(occLoc(path, o));
      });
      return { defs, refs, possible };
    }
    const name = nameFromKey(key);
    if (!name) return { defs, refs, possible };
    const lang = languageOfKey(key);
    const candidates = this.nameIndex.get(this.nameKey(lang, name)) ?? [];
    for (const { path, i } of candidates) {
      const fi = this.files.get(path);
      if (!fi || nameSpaceOf(fi.language) !== nameSpaceOf(lang)) continue;
      const o = fi.occurrences[i];
      if (o.role === "def") continue;
      const r = this.resolveTarget(fi, o.target, o.name);
      if ((r.status === "resolved" || r.status === "external") && r.key === key) refs.push(occLoc(path, o));
      else if (r.status === "candidates" && r.candidates.some((c) => c.key === key)) possible.push(occLoc(path, o));
    }
    const sort = (a: SymbolLocation, b: SymbolLocation) => a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col;
    return { defs, refs: refs.toSorted(sort), possible: possible.toSorted(sort) };
  }

  callers(key: string): ReferenceResult {
    const r = this.references(key);
    return { defs: r.defs, refs: r.refs.filter((x) => x.role === "call"), possible: r.possible.filter((x) => x.role === "call") };
  }

  /**
   * Declarations across the repository whose name matches `query`: exact
   * names first, then prefixes, then substrings; types before members.
   */
  searchSymbols(query: string, limit = 20): SymbolLocation[] {
    const q = query.trim().replace(/^\$/, "").toLowerCase();
    if (q.length < 2) return [];
    const hits: { ref: DeclRef; s: number }[] = [];
    for (const [path, fi] of this.files) {
      for (const d of fi.decls) {
        const s = searchScore(d, q);
        if (s !== undefined) hits.push({ ref: { path, id: d.id }, s });
      }
    }
    hits.sort((a, b) => a.s - b.s);
    return hits.slice(0, limit).map((h) => this.location(h.ref));
  }

  /** Outline of a file: top-level and member declarations. */
  outline(path: string): Decl[] {
    const fi = this.files.get(path);
    if (!fi) return [];
    return fi.decls.filter((d) => d.scope !== "local").sort((a, b) => a.span.line - b.span.line);
  }
}

function getOrCreate<K, V>(m: Map<K, V>, k: K, make: () => V): V {
  let v = m.get(k);
  if (v === undefined) {
    v = make();
    m.set(k, v);
  }
  return v;
}

/** The type of an embedded field (a field named after its type), if `d` is one. */
function embeddedTypeRef(d: Decl): string | undefined {
  if (d.kind !== "field" || !d.typeRef) return undefined;
  return d.typeRef.split(".").pop() === d.name ? d.typeRef : undefined;
}

function qualifiedName(container: string | undefined, name: string): string {
  return container ? `${container}.${name}` : name;
}

function resolutionScope(scope: Decl["scope"]): "local" | "package" | "repository" {
  if (scope === "local") return "local";
  return scope === "top" ? "package" : "repository";
}

/** The language (or name space) whose occurrences can refer to a symbol key. */
function languageOfKey(key: string): string {
  if (key.startsWith("P|")) return "php";
  if (key.startsWith("N|")) return key.split("|")[1];
  return "go";
}

const TYPE_DECL_KINDS = new Set<DeclKind>(["class", "interface", "trait", "enum", "type"]);

/**
 * Sort score of a declaration for a symbol search, lower first: exact names,
 * then prefixes, then substrings; types before functions before the rest.
 * Undefined when it does not match or is not searchable.
 */
function searchScore(d: Decl, q: string): number | undefined {
  if (d.scope === "local" || d.kind === "local" || d.kind === "param") return undefined;
  const n = d.name.replace(/^\$/, "").toLowerCase();
  const at = n.indexOf(q);
  if (at < 0) return undefined;
  let rank = 2;
  if (n === q) rank = 0;
  else if (at === 0) rank = 1;
  let kindRank = 2;
  if (TYPE_DECL_KINDS.has(d.kind)) kindRank = 0;
  else if (d.kind === "function") kindRank = 1;
  return rank * 100_000 + kindRank * 10_000 + Math.min(n.length, 9_999);
}

function push<K>(m: Map<K, DeclRef[]>, k: K, v: DeclRef) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

function phpMemberKey(d: Decl): string {
  if (d.kind === "method") return `m:${d.name.toLowerCase()}`;
  if (d.kind === "property") return `$${d.name}`;
  return `k:${d.name}`;
}

/** Keys to try for a member name as written in a member access. */
function phpLookupKeys(member: string): string[] {
  if (member.startsWith("$")) return [member];
  return [`m:${member.toLowerCase()}`, `k:${member}`];
}

function phpNameKeyForLookup(member: string): string {
  return member.startsWith("$") ? member : `m:${member.toLowerCase()}`;
}

function nameFromKey(key: string): string | undefined {
  if (key.startsWith("N|")) {
    const qname = key.split("|").slice(2).join("|");
    return qname.slice(qname.lastIndexOf(".") + 1);
  }
  if (key.startsWith("G|")) {
    const tail = key.split("|")[2];
    return tail.includes(".") ? tail.slice(tail.lastIndexOf(".") + 1) : tail;
  }
  if (key.startsWith("P|")) {
    const rest = key.slice(4);
    const i = rest.lastIndexOf("::");
    if (i >= 0) return rest.slice(i + 2).replace(/^(m:|k:|\$)/, "");
    return rest.split("\\").pop();
  }
  return undefined;
}

function occLoc(path: string, o: Occurrence): SymbolLocation {
  return { path, line: o.span.line, col: o.span.col, endCol: o.span.endCol, name: o.name, role: o.role, enclosing: o.enclosing };
}

// `module` at the start of a line (after indentation), then the path, quoted
// or not, and nothing else on the line. Matched in steps: one regex for the
// whole directive backtracks badly.
const GO_MOD_MODULE = /^[ \t]*module(?=\s)/gm;
const GO_MOD_PATH = /\s+("?)([^\s"]+)/y;
const GO_MOD_LINE_END = /[ \t]*(?:[\n\r\u2028\u2029]|$)/y;

/** Parses the `module` directive of a go.mod file. */
export function parseGoMod(text: string): string | null {
  GO_MOD_MODULE.lastIndex = 0;
  for (let m = GO_MOD_MODULE.exec(text); m; m = GO_MOD_MODULE.exec(text)) {
    GO_MOD_PATH.lastIndex = GO_MOD_MODULE.lastIndex;
    const p = GO_MOD_PATH.exec(text);
    if (!p) continue;
    let end = GO_MOD_PATH.lastIndex;
    if (p[1]) {
      if (text[end] !== '"') continue;
      end++;
    }
    GO_MOD_LINE_END.lastIndex = end;
    if (GO_MOD_LINE_END.test(text)) return p[2];
  }
  return null;
}
