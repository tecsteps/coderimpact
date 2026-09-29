import { useEffect, useState } from "react";
import { File, FileCode2, Folder, GitCommitHorizontal, Loader2 } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import type { TreeEntry } from "@/lib/github/tree";
import { formatBytes, semanticLanguageFor } from "@/lib/util/files";
import { useSessionVersion } from "@/hooks/useSession";
import { toAppError, type AppError } from "@/lib/errors";
import { ErrorState } from "../ErrorState";

export function FolderView({
  session,
  path,
  onOpen,
}: Readonly<{
  session: RepoSession;
  path: string;
  onOpen: (path: string, kind: "blob" | "tree") => void;
}>) {
  useSessionVersion(session);
  const [error, setError] = useState<AppError | null>(null);
  const loaded = session.tree.isLoaded(path);

  useEffect(() => {
    setError(null);
    if (!session.tree.isLoaded(path)) session.loadDirectory(path).catch((e) => setError(toAppError(e)));
  }, [session, path]);

  if (error) return <ErrorState error={error} onRetry={() => session.loadDirectory(path).catch((e) => setError(toAppError(e)))} />;
  if (!loaded) {
    return (
      <div className="flex items-center gap-2 p-6 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading folder…
      </div>
    );
  }
  const entries = session.tree.list(path) ?? [];
  const semantic = entries.filter((e) => e.type === "blob" && semanticLanguageFor(e.path)).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-foreground">{path ? path.split("/").pop() : `${session.repo.owner}/${session.repo.repo}`}</h1>
          {!path && session.repo.description ? <p className="text-[13.5px] text-muted-foreground">{session.repo.description}</p> : null}
          <p className="text-[12.5px] text-subtle-foreground">
            {entries.length} items{semantic ? ` · ${semantic} ${semantic === 1 ? "file" : "files"} with semantic navigation` : ""}
            {session.tree.truncated ? " · large repository, folders load on demand" : ""}
          </p>
        </div>
        <ul className="overflow-hidden rounded-lg border border-border bg-surface">
          {path ? (
            <li className="border-b border-border">
              <button
                type="button"
                onClick={() => onOpen(path.split("/").slice(0, -1).join("/"), "tree")}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] text-muted-foreground hover:bg-surface-2 cursor-pointer"
              >
                <Folder className="size-4" strokeWidth={1.75} /> ..
              </button>
            </li>
          ) : null}
          {entries.map((e) => {
            const Icon = entryIcon(e);
            return (
              <li key={e.path} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => onOpen(e.path, e.type === "tree" ? "tree" : "blob")}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-surface-2 cursor-pointer"
                >
                  <Icon className={e.type === "tree" ? "size-4 text-accent" : "size-4 text-subtle-foreground"} strokeWidth={1.75} />
                  <span className="truncate text-foreground">{e.name}</span>
                  <span className="ml-auto shrink-0 text-[12px] tabular-nums text-subtle-foreground">
                    {entryMeta(e)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function entryIcon(e: TreeEntry) {
  if (e.type === "tree") return Folder;
  if (e.type === "commit") return GitCommitHorizontal;
  return semanticLanguageFor(e.path) ? FileCode2 : File;
}

function entryMeta(e: TreeEntry): string {
  if (e.type === "commit") return "submodule";
  return e.type === "blob" && e.size !== undefined ? formatBytes(e.size) : "";
}
