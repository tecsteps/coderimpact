// Copies the Tree-sitter runtime and grammar WASM files into a public folder
// so the parser workers can load them by URL at runtime.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, "public", "grammars");
mkdirSync(out, { recursive: true });

const files = [
  ["web-tree-sitter/web-tree-sitter.wasm", "web-tree-sitter.wasm"],
  ["tree-sitter-go/tree-sitter-go.wasm", "tree-sitter-go.wasm"],
  ["tree-sitter-php/tree-sitter-php.wasm", "tree-sitter-php.wasm"],
  ["tree-sitter-javascript/tree-sitter-javascript.wasm", "tree-sitter-javascript.wasm"],
  ["tree-sitter-typescript/tree-sitter-typescript.wasm", "tree-sitter-typescript.wasm"],
  ["tree-sitter-typescript/tree-sitter-tsx.wasm", "tree-sitter-tsx.wasm"],
  ["tree-sitter-python/tree-sitter-python.wasm", "tree-sitter-python.wasm"],
  ["tree-sitter-java/tree-sitter-java.wasm", "tree-sitter-java.wasm"],
  ["tree-sitter-c-sharp/tree-sitter-c_sharp.wasm", "tree-sitter-c_sharp.wasm"],
  ["tree-sitter-ruby/tree-sitter-ruby.wasm", "tree-sitter-ruby.wasm"],
  ["tree-sitter-rust/tree-sitter-rust.wasm", "tree-sitter-rust.wasm"],
  ["tree-sitter-c/tree-sitter-c.wasm", "tree-sitter-c.wasm"],
  ["tree-sitter-cpp/tree-sitter-cpp.wasm", "tree-sitter-cpp.wasm"],
  ["tree-sitter-scala/tree-sitter-scala.wasm", "tree-sitter-scala.wasm"],
  ["tree-sitter-elixir/tree-sitter-elixir.wasm", "tree-sitter-elixir.wasm"],
  ["@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm", "tree-sitter-kotlin.wasm"],
];
let copied = 0;
for (const [src, dest] of files) {
  const from = join(root, "node_modules", src);
  if (!existsSync(from)) {
    console.warn(`copy-grammars: missing ${src}`);
    continue;
  }
  copyFileSync(from, join(out, dest));
  copied++;
}
console.log(`copy-grammars: copied ${copied} files to ${out}`);
