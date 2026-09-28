/** File classification helpers: language detection, binary and generated file checks, limits. */

export const LIMITS = {
  /** Largest file we fetch and display. */
  maxDisplayBytes: 1_000_000,
  /** Largest file we parse for semantic navigation. */
  maxIndexBytes: 300_000,
  /** Most tree entries we accept before refusing the repository. */
  maxTreeEntries: 200_000,
  /** Most files a bounded content scan will fetch. */
  maxScanFiles: 800,
  /** Parallel raw content fetches (raw.githubusercontent.com is not rate limited like the API). */
  contentConcurrency: 16,
  /** Parallel GitHub REST API requests. */
  apiConcurrency: 3,
};

import { languageForExtension, type SemanticLanguage } from "../lang/registry";
export type { SemanticLanguage };

const EXT_TO_SHIKI: Record<string, string> = {
  go: "go", php: "php", phtml: "php", js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", py: "python",
  rb: "ruby", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift", c: "c",
  h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", cs: "csharp", m: "objective-c",
  scala: "scala", sh: "shellscript", bash: "shellscript", zsh: "shellscript", fish: "fish",
  ps1: "powershell", md: "markdown", mdx: "mdx", json: "json", jsonc: "jsonc", json5: "json5",
  yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", xml: "xml", html: "html", htm: "html",
  css: "css", scss: "scss", sass: "sass", less: "less", vue: "vue", svelte: "svelte", sql: "sql",
  graphql: "graphql", gql: "graphql", proto: "proto", lua: "lua", pl: "perl", pm: "perl", r: "r",
  dart: "dart", ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", clj: "clojure",
  zig: "zig", nim: "nim", tf: "hcl", hcl: "hcl", twig: "twig", blade: "blade", mod: "go",
  sum: "txt", txt: "txt", dockerfile: "docker", makefile: "make", mk: "make", cmake: "cmake",
  gradle: "groovy", groovy: "groovy", diff: "diff", patch: "diff", csv: "csv", svg: "xml",
};

const FILENAME_TO_SHIKI: Record<string, string> = {
  dockerfile: "docker", makefile: "make", "go.mod": "go", "go.sum": "txt", "go.work": "go",
  "composer.json": "json", "composer.lock": "json", ".gitignore": "txt", license: "txt",
  "cmakelists.txt": "cmake", gemfile: "ruby", rakefile: "ruby", jenkinsfile: "groovy",
};

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1) : "";
}

/** The Shiki grammar id for a path, or "txt" when unknown. */
export function shikiLanguageFor(path: string): string {
  const name = basename(path).toLowerCase();
  if (FILENAME_TO_SHIKI[name]) return name === "go.mod" ? "txt" : FILENAME_TO_SHIKI[name];
  if (name.endsWith(".blade.php")) return "blade";
  return EXT_TO_SHIKI[extension(path)] ?? "txt";
}

/** Human readable language name for labels such as "Semantic navigation is not available for Rust". */
export function languageLabel(path: string): string {
  const id = shikiLanguageFor(path);
  const labels: Record<string, string> = {
    go: "Go", php: "PHP", javascript: "JavaScript", typescript: "TypeScript", tsx: "TSX", jsx: "JSX",
    python: "Python", ruby: "Ruby", rust: "Rust", java: "Java", kotlin: "Kotlin", swift: "Swift",
    c: "C", cpp: "C++", csharp: "C#", markdown: "Markdown", mdx: "MDX", xml: "XML", ini: "INI", docker: "Dockerfile", make: "Makefile", scss: "SCSS", vue: "Vue", svelte: "Svelte", json: "JSON", yaml: "YAML", toml: "TOML",
    html: "HTML", css: "CSS", shellscript: "Shell", sql: "SQL", txt: "plain text",
  };
  return labels[id] ?? id;
}

export function semanticLanguageFor(path: string): SemanticLanguage | null {
  if (basename(path).toLowerCase().endsWith(".blade.php")) return null;
  if (/\.d\.ts$/i.test(path)) return "typescript";
  return languageForExtension(extension(path));
}

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "tif", "tiff", "psd", "pdf", "zip",
  "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war", "class", "exe", "dll", "so", "dylib", "a",
  "o", "obj", "bin", "wasm", "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "mov", "avi",
  "webm", "ogg", "wav", "flac", "sqlite", "db", "pyc", "pdb", "dat", "phar", "ds_store",
]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "apng"]);

/** Raster images the reader previews instead of rejecting as binary. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXT.has(extension(path));
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.has(extension(path));
}

/** Detects binary content by looking for NUL bytes in the first 8 KB. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function isLfsPointer(text: string): boolean {
  return text.startsWith("version https://git-lfs.github.com/spec/v1");
}

const SKIP_DIRS = new Set([
  "vendor", "node_modules", "third_party", "third-party", "bower_components", "dist", "build",
  ".git", ".idea", ".vscode", "testdata", "__snapshots__", "coverage", ".next", ".nuxt", "target",
]);

/** Directories and files the indexer and repository scans skip (still browsable). */
export function isSkippedForIndex(path: string): boolean {
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i++) if (SKIP_DIRS.has(parts[i].toLowerCase())) return true;
  const name = parts.at(-1)!.toLowerCase();
  return (
    name.endsWith(".pb.go") ||
    name.endsWith("_gen.go") ||
    name.endsWith(".gen.go") ||
    name.endsWith(".min.js") ||
    name.endsWith(".min.css") ||
    name.endsWith(".lock")
  );
}

/** Go's convention for generated files. */
export function isGeneratedSource(text: string): boolean {
  const head = text.slice(0, 2000);
  return /^\/\/ Code generated .* DO NOT EDIT\.$/m.test(head) || /@generated\b/.test(head.slice(0, 600));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
