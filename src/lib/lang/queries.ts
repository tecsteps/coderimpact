import type { SemanticLanguage } from "./registry";

/**
 * Tree-sitter tags and locals queries for the generic adapter, bundled as
 * text. Only the parser worker (and tests) import this module.
 */
const files = import.meta.glob("./queries/*/*.scm", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export function querySource(lang: SemanticLanguage, kind: "tags" | "locals"): string | undefined {
  const text = files[`./queries/${lang}/${kind}.scm`];
  return text?.replace(/;[^\n]*/g, "").trim() ? text : undefined;
}
