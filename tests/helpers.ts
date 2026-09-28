import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ParserHost } from "../src/lib/lang/parserHost";
import { SemanticIndex, parseGoMod } from "../src/lib/lang/semanticIndex";
import { semanticLanguageFor } from "../src/lib/util/files";

const root = join(import.meta.dirname, "..");
export const host = new ParserHost((file) => join(root, file === "web-tree-sitter.wasm" ? "node_modules/web-tree-sitter" : "public/grammars", file));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export async function indexFixture(name: string) {
  const dir = join(root, "tests/fixtures", name);
  const index = new SemanticIndex();
  const texts = new Map<string, string>();
  const files = walk(dir).map((abs) => relative(dir, abs).split("\\").join("/"));
  const gomod = files.find((f) => f === "go.mod");
  if (gomod) index.setGoModules([{ dir: "", path: parseGoMod(readFileSync(join(dir, gomod), "utf8"))! }]);
  for (const path of files) {
    const text = readFileSync(join(dir, path), "utf8");
    texts.set(path, text);
    const lang = semanticLanguageFor(path);
    if (lang) index.add(await host.index(path, lang, text));
  }
  return { index, texts };
}

/** Finds the column of the nth occurrence of `needle` on a 1-based line. */
export function col(texts: Map<string, string>, path: string, line: number, needle: string, nth = 0): number {
  const text = texts.get(path)!.split("\n")[line - 1];
  let i = -1;
  for (let k = 0; k <= nth; k++) i = text.indexOf(needle, i + 1);
  if (i < 0) throw new Error(`"${needle}" not on ${path}:${line}: ${text}`);
  return i;
}

export function lineOf(texts: Map<string, string>, path: string, needle: string, nth = 0): number {
  const lines = texts.get(path)!.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      if (seen === nth) return i + 1;
      seen++;
    }
  }
  throw new Error(`"${needle}" not found in ${path}`);
}
