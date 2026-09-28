import { Code2 } from "lucide-react";
import {
  siC, siClojure, siCplusplus, siCss, siDart, siDocker, siDotnet, siElixir, siErlang, siGnubash, siGo, siGraphql, siHaskell,
  siHtml5, siJavascript, siJson, siKotlin, siLua, siMake, siMarkdown, siMdx, siOpenjdk, siPerl, siPhp, siPython, siR, siReact,
  siRuby, siRust, siSass, siScala, siSqlite, siSvelte, siSwift, siToml, siTypescript, siVuedotjs, siXml, siYaml, siZig,
  type SimpleIcon,
} from "simple-icons";
import { cn } from "@/lib/utils";

/** Official language marks (Simple Icons, CC0), by the reader's language label. */
const ICONS: Record<string, SimpleIcon> = {
  TypeScript: siTypescript,
  TSX: siReact,
  JavaScript: siJavascript,
  JSX: siReact,
  Go: siGo,
  PHP: siPhp,
  Python: siPython,
  Java: siOpenjdk,
  "C#": siDotnet,
  Kotlin: siKotlin,
  Scala: siScala,
  Ruby: siRuby,
  Elixir: siElixir,
  Erlang: siErlang,
  Rust: siRust,
  C: siC,
  "C++": siCplusplus,
  Swift: siSwift,
  Dart: siDart,
  Haskell: siHaskell,
  Clojure: siClojure,
  Lua: siLua,
  Perl: siPerl,
  R: siR,
  Zig: siZig,
  Markdown: siMarkdown,
  MDX: siMdx,
  JSON: siJson,
  YAML: siYaml,
  TOML: siToml,
  XML: siXml,
  HTML: siHtml5,
  CSS: siCss,
  SCSS: siSass,
  Vue: siVuedotjs,
  Svelte: siSvelte,
  Shell: siGnubash,
  Dockerfile: siDocker,
  Makefile: siMake,
  SQL: siSqlite,
  GraphQL: siGraphql,
};

/** Brand colors that nearly vanish on the dark background use the text color there. */
function tooDarkForDarkMode(hex: string): boolean {
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.22;
}

/** The open file's language: its official mark in brand color, and its name. */
export function LanguageBadge({ label, semantic }: Readonly<{ label: string; semantic: boolean }>) {
  const icon = ICONS[label];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-foreground"
      title={semantic ? `${label}: definitions, usages and callers available` : label}
    >
      {icon ? (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={cn("size-3.5 shrink-0 fill-[var(--lang)]", tooDarkForDarkMode(icon.hex) && "dark:fill-foreground")}
          style={{ "--lang": `#${icon.hex}` } as React.CSSProperties}
        >
          <path d={icon.path} />
        </svg>
      ) : (
        <Code2 className="size-3.5 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
      )}
      {label}
    </span>
  );
}
