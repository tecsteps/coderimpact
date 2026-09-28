/**
 * Languages with semantic navigation. Go and PHP have hand-written adapters
 * that resolve names through scopes, imports and types ("exact"). All other
 * languages use the generic adapter, driven by the grammar's standard
 * Tree-sitter tags and locals queries: definitions and references are found
 * precisely, and cross-file links are matched by name ("name"), like GitHub's
 * search-based code navigation.
 *
 * This module is small on purpose: the main bundle imports it. Queries live
 * in ./queries and are only loaded by the parser worker.
 */
export const SEMANTIC_LANGUAGES = {
  go: { label: "Go", grammar: "tree-sitter-go.wasm", extensions: ["go"], precision: "exact" },
  php: { label: "PHP", grammar: "tree-sitter-php.wasm", extensions: ["php", "phtml"], precision: "exact" },
  javascript: { label: "JavaScript", grammar: "tree-sitter-javascript.wasm", extensions: ["js", "mjs", "cjs", "jsx"], precision: "name" },
  typescript: { label: "TypeScript", grammar: "tree-sitter-typescript.wasm", extensions: ["ts", "mts", "cts"], precision: "name" },
  tsx: { label: "TSX", grammar: "tree-sitter-tsx.wasm", extensions: ["tsx"], precision: "name" },
  python: { label: "Python", grammar: "tree-sitter-python.wasm", extensions: ["py", "pyi"], precision: "name" },
  java: { label: "Java", grammar: "tree-sitter-java.wasm", extensions: ["java"], precision: "name" },
  csharp: { label: "C#", grammar: "tree-sitter-c_sharp.wasm", extensions: ["cs"], precision: "name" },
  ruby: { label: "Ruby", grammar: "tree-sitter-ruby.wasm", extensions: ["rb", "rake"], precision: "name" },
  rust: { label: "Rust", grammar: "tree-sitter-rust.wasm", extensions: ["rs"], precision: "name" },
  c: { label: "C", grammar: "tree-sitter-c.wasm", extensions: ["c", "h"], precision: "name" },
  cpp: { label: "C++", grammar: "tree-sitter-cpp.wasm", extensions: ["cc", "cpp", "cxx", "hpp", "hh", "hxx"], precision: "name" },
  scala: { label: "Scala", grammar: "tree-sitter-scala.wasm", extensions: ["scala", "sc"], precision: "name" },
  elixir: { label: "Elixir", grammar: "tree-sitter-elixir.wasm", extensions: ["ex", "exs"], precision: "name" },
  kotlin: { label: "Kotlin", grammar: "tree-sitter-kotlin.wasm", extensions: ["kt", "kts"], precision: "name" },
} as const;

export type SemanticLanguage = keyof typeof SEMANTIC_LANGUAGES;

const BY_EXTENSION = new Map<string, SemanticLanguage>();
for (const [id, spec] of Object.entries(SEMANTIC_LANGUAGES)) for (const ext of spec.extensions) BY_EXTENSION.set(ext, id as SemanticLanguage);

export function languageForExtension(ext: string): SemanticLanguage | null {
  return BY_EXTENSION.get(ext.toLowerCase()) ?? null;
}

/**
 * Languages whose files refer to each other's declarations share one name
 * space: a .tsx component imports from .ts and .js modules, and C++ sources
 * include C headers (.h files are parsed as C).
 */
const NAME_SPACES: Partial<Record<SemanticLanguage, string>> = {
  javascript: "ecmascript",
  typescript: "ecmascript",
  tsx: "ecmascript",
  c: "c-family",
  cpp: "c-family",
};

export function nameSpaceOf(lang: string): string {
  return NAME_SPACES[lang as SemanticLanguage] ?? lang;
}
