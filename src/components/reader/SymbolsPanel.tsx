import { Box, Braces, CircleDot, Hash, Loader2, Variable } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import type { Decl } from "@/lib/lang/types";
import { languageLabel, semanticLanguageFor } from "@/lib/util/files";
import { useSessionVersion } from "@/hooks/useSession";
import { ClassIcon, FunctionIcon } from "../icons";
import { cn } from "@/lib/utils";

function KindIcon({ kind }: Readonly<{ kind: Decl["kind"] }>) {
  const cls = "size-3.5 shrink-0";
  switch (kind) {
    case "function":
    case "method":
      return <FunctionIcon className={cn(cls, "text-[#3b82c4] dark:text-[#8aadf4]")} />;
    case "class":
    case "type":
    case "interface":
    case "trait":
    case "enum":
      return <ClassIcon className={cn(cls, "text-[#b7791f] dark:text-[#eed49f]")} />;
    case "field":
    case "property":
      return <CircleDot className={cn(cls, "text-subtle-foreground")} strokeWidth={1.75} />;
    case "const":
      return <Hash className={cn(cls, "text-subtle-foreground")} strokeWidth={1.75} />;
    case "var":
      return <Variable className={cn(cls, "text-subtle-foreground")} strokeWidth={1.75} />;
    default:
      return <Box className={cn(cls, "text-subtle-foreground")} strokeWidth={1.75} />;
  }
}

export function SymbolsPanel({
  session,
  path,
  currentLine,
  onJump,
}: Readonly<{
  session: RepoSession;
  path: string;
  currentLine?: number;
  onJump: (line: number) => void;
}>) {
  useSessionVersion(session);
  const lang = semanticLanguageFor(path);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SymbolsBody session={session} path={path} hasLang={!!lang} currentLine={currentLine} onJump={onJump} />
      {lang ? (
        <p className="mt-auto flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11.5px] text-subtle-foreground">
          <Braces className="size-3" /> {languageLabel(path)} adapter · Tree-sitter syntax, local name resolution
        </p>
      ) : null}
    </div>
  );
}

function SymbolsBody({
  session,
  path,
  hasLang,
  currentLine,
  onJump,
}: Readonly<{
  session: RepoSession;
  path: string;
  hasLang: boolean;
  currentLine?: number;
  onJump: (line: number) => void;
}>) {
  if (!path) return <p className="px-4 py-4 text-[13px] text-subtle-foreground">Open a file to see its symbols.</p>;
  if (!hasLang) {
    return (
      <div className="flex flex-col gap-1 px-4 py-4">
        <p className="text-[13px] font-medium text-foreground">Semantic navigation is not available for {languageLabel(path)} files</p>
        <p className="text-[12.5px] text-muted-foreground">
          Go to definition and find usages cover 15 languages, including Go, PHP, TypeScript, Python and Java. For this file you still get syntax highlighting, text search and line explanations.
        </p>
      </div>
    );
  }
  if (!session.index.has(path)) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Indexing this file…
      </div>
    );
  }
  const outline = session.index.outline(path);
  if (outline.length === 0) return <p className="px-4 py-4 text-[13px] text-subtle-foreground">No declarations in this file.</p>;
  return (
    <ul className="px-2 py-2" aria-label="Symbols in this file">
      {outline.map((d) => {
        const active = currentLine !== undefined && d.startLine <= currentLine && currentLine <= d.endLine && d.kind !== "field" && d.kind !== "property";
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onJump(d.span.line)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-[13px] text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer",
                d.scope === "member" ? "pl-6" : "pl-2",
                active && "text-foreground",
              )}
            >
              <KindIcon kind={d.kind} />
              <span className="truncate font-mono text-[12.5px]">{d.name}</span>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-subtle-foreground">{d.span.line}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
