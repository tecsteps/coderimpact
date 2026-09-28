import type { SemanticLanguage } from "../util/files";

/** 1-based lines, 0-based UTF-16 columns (matching JavaScript string indices). */
export interface Span {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

export type DeclKind =
  | "function"
  | "method"
  | "type"
  | "interface"
  | "class"
  | "trait"
  | "enum"
  | "var"
  | "const"
  | "field"
  | "property"
  | "param"
  | "local";

export interface Decl {
  /** Index into FileIndex.decls. */
  id: number;
  name: string;
  kind: DeclKind;
  /** Span of the declared name. */
  span: Span;
  /** Package or namespace level ("top"), class member ("member") or lexical ("local"). */
  scope: "top" | "member" | "local";
  /** Receiver type (Go methods) or declaring class short name (PHP members). */
  container?: string;
  /** Fully qualified class name for PHP classes and members. */
  fqn?: string;
  /** PHP: parent class FQN. */
  extendsFqn?: string;
  /** Static type we could infer for a variable/param: Go `pkg.Type` / `Type`, PHP class FQN. */
  typeRef?: string;
  /** One-line signature, for outlines and AI context. */
  signature?: string;
  /** Whole declaration lines. */
  startLine: number;
  endLine: number;
}

/**
 * What an occurrence refers to, as far as a single file can tell. The
 * SemanticIndex turns targets into repository-wide symbol keys.
 */
export type Target =
  | { t: "decl"; decl: number }
  /** Go: package-level name declared in another file of the same package. */
  | { t: "pkg"; name: string }
  /** Go: `alias.Name` through an import. */
  | { t: "import"; importPath: string; name: string }
  /** Go: `x.Name` where x has a known type; PHP: `$x->name()` with a known class. */
  | { t: "member"; typeRef: string; name: string }
  /** A member access whose receiver type is unknown: candidates by name only. */
  | { t: "member?"; name: string }
  /** PHP class reference by fully qualified name. */
  | { t: "class"; fqn: string }
  /** PHP function call: namespaced name first, global fallback for unqualified calls. */
  | { t: "function"; fqn: string; fallback?: string }
  /** Cannot be resolved statically (dynamic call, variable function, reflection). */
  | { t: "dynamic"; reason: string }
  /**
   * Generic adapter: a reference matched to declarations by name. `member` for
   * obj.name / obj->name; `inClass` is the class the reference sits in, so a
   * bare call to a sibling method finds that class's member first.
   */
  | { t: "name"; name: string; member?: boolean; inClass?: string; receiver?: string };

export type OccurrenceRole = "def" | "ref" | "call";

export interface Occurrence {
  name: string;
  span: Span;
  role: OccurrenceRole;
  target: Target;
  /** Name of the enclosing function/method, for "called from" labels. */
  enclosing?: string;
}

export interface Block {
  kind: "function" | "method" | "type" | "class";
  name: string;
  /** Qualified label, e.g. `(*Server).Serve` or `InvoiceTotals::net`. */
  label: string;
  startLine: number;
  endLine: number;
  /** Line with the declaration name, where the gutter control goes. */
  declLine: number;
  signature: string;
  /** The declaration this block belongs to. */
  decl: number;
}

export interface GoImport {
  alias: string;
  path: string;
  line: number;
}

export interface PhpUse {
  alias: string;
  fqn: string;
  kind: "class" | "function" | "const";
}

export interface FileIndex {
  path: string;
  language: SemanticLanguage;
  adapterVersion: string;
  /** Go package clause name. */
  packageName?: string;
  /** PHP namespace ("" for global). */
  namespace?: string;
  imports: GoImport[];
  uses: PhpUse[];
  decls: Decl[];
  occurrences: Occurrence[];
  blocks: Block[];
  /** Parse errors were present: results may be partial. */
  hasErrors: boolean;
}
