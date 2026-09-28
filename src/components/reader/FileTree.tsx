import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, File, FileCode2, Folder, FolderOpen, GitCommitHorizontal, Loader2, Search } from "lucide-react";
import { Tooltip } from "../ui/tooltip";
import type { RepoSession } from "@/lib/session";
import type { RepoTree, TreeEntry } from "@/lib/github/tree";
import { semanticLanguageFor } from "@/lib/util/files";
import { useSessionVersion } from "@/hooks/useSession";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";

interface Item {
  entry: TreeEntry;
  depth: number;
}

function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function FileTree({
  session,
  currentPath,
  onOpen,
}: Readonly<{
  session: RepoSession;
  currentPath: string;
  onOpen: (path: string, kind: "blob" | "tree") => void;
}>) {
  useSessionVersion(session);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestors(currentPath)));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tree = session.tree;

  // Reveal the open file: open (and load) its folders, then scroll it into view.
  const revealed = useRef("");
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const a of ancestors(currentPath)) {
        if (!tree.isLoaded(a)) await session.loadDirectory(a).catch(() => undefined);
      }
      if (!alive) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const a of ancestors(currentPath)) next.add(a);
        return next;
      });
      revealed.current = "";
    })();
    return () => {
      alive = false;
    };
  }, [currentPath, session, tree]);

  /** Expands loaded folders level by level until about this many rows are shown. */
  const MAX_EXPANDED_ROWS = 4000;
  const expandAll = () => {
    const next = new Set<string>();
    let rows = (tree.list("") ?? []).length;
    let level = (tree.list("") ?? []).filter((e) => e.type === "tree");
    while (level.length && rows < MAX_EXPANDED_ROWS) {
      const deeper: TreeEntry[] = [];
      for (const d of level) {
        const kids = tree.list(d.path);
        if (!kids || rows + kids.length > MAX_EXPANDED_ROWS) continue;
        next.add(d.path);
        rows += kids.length;
        for (const k of kids) if (k.type === "tree") deeper.push(k);
      }
      level = deeper;
    }
    for (const a of ancestors(currentPath)) next.add(a);
    setExpanded(next);
  };

  const toggle = async (dir: string) => {
    if (expanded.has(dir)) {
      setExpanded((s) => {
        const n = new Set(s);
        n.delete(dir);
        return n;
      });
      return;
    }
    if (!tree.isLoaded(dir)) {
      setLoading((s) => new Set(s).add(dir));
      try {
        await session.loadDirectory(dir);
      } catch {
        /* shown as empty */
      } finally {
        setLoading((s) => {
          const n = new Set(s);
          n.delete(dir);
          return n;
        });
      }
    }
    setExpanded((s) => new Set(s).add(dir));
  };

  const items = useMemo(() => {
    const out: Item[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of tree.list(dir) ?? []) {
        out.push({ entry: e, depth });
        if (e.type === "tree" && expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, expanded, session.version]);

  const results = useMemo(() => (filter.trim() ? session.findFiles(filter) : null), [filter, session, session.version]);

  useEffect(() => {
    const i = items.findIndex((it) => it.entry.path === currentPath);
    if (i < 0) return;
    setFocusIdx(i);
    // Scroll once per opened file, not on every tree update.
    if (revealed.current !== currentPath) {
      revealed.current = currentPath;
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" }));
    }
  }, [currentPath, items]);

  const focusItem = (i: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    setFocusIdx(clamped);
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${clamped}"]`)?.focus();
  };

  const activate = (e: TreeEntry) => {
    if (e.type === "tree") toggle(e.path);
    else onOpen(e.path, "blob");
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number, it: Item) => {
    const e0 = it.entry;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(i - 1);
        break;
      case "ArrowRight":
        if (e0.type === "tree") {
          e.preventDefault();
          if (!expanded.has(e0.path)) toggle(e0.path);
          else focusItem(i + 1);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (e0.type === "tree" && expanded.has(e0.path)) toggle(e0.path);
        else {
          const parent = e0.path.split("/").slice(0, -1).join("/");
          const pi = items.findIndex((x) => x.entry.path === parent);
          if (pi >= 0) focusItem(pi);
        }
        break;
      case "Home":
        e.preventDefault();
        focusItem(0);
        break;
      case "End":
        e.preventDefault();
        focusItem(items.length - 1);
        break;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            aria-label="Filter files by name"
            placeholder="Go to file"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-7"
          />
        </div>
        <Tooltip content="Expand all">
          <button type="button" aria-label="Expand all folders" onClick={expandAll} className="rounded-md p-1.5 text-subtle-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer">
            <ChevronsUpDown className="size-4" strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Tooltip content="Collapse all">
          <button type="button" aria-label="Collapse all folders" onClick={() => setExpanded(new Set())} className="rounded-md p-1.5 text-subtle-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer">
            <ChevronsDownUp className="size-4" strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>
      {results ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!tree.complete && tree.pendingDirs().length > 0 ? (
            <p className="px-2 pb-2 text-[12px] text-subtle-foreground">
              Searching {tree.files().length.toLocaleString()} files. This repository is too large for GitHub to list at once, so{" "}
              {tree.pendingDirs().length.toLocaleString()} folders match by name only until you open them.
            </p>
          ) : null}
          {results.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-subtle-foreground">No file names match “{filter}”.</p>
          ) : (
            <ul aria-label="Matching files">
              {results.map((e) => (
                <li key={e.path}>
                  <button
                    type="button"
                    aria-current={e.path === currentPath ? "page" : undefined}
                    onClick={() => onOpen(e.path, e.type === "tree" ? "tree" : "blob")}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 cursor-pointer"
                  >
                    {e.type === "tree" ? (
                      <Folder className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} />
                    ) : (
                      <File className="mt-0.5 size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13px] text-foreground">{e.name}</span>
                      <span className="w-full truncate font-mono text-[11.5px] text-subtle-foreground">{e.path}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div ref={listRef} role="tree" aria-label="Repository files" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {items.map((it, i) => {
            const e = it.entry;
            const isDir = e.type === "tree";
            const open = expanded.has(e.path);
            const active = e.path === currentPath;
            const Icon = treeIcon(e, open);
            return (
              <div
                key={e.path}
                role="treeitem"
                aria-level={it.depth + 1}
                aria-expanded={isDir ? open : undefined}
                aria-selected={active}
                aria-current={active ? "page" : undefined}
                data-idx={i}
                tabIndex={i === focusIdx ? 0 : -1}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    activate(e);
                    return;
                  }
                  onKeyDown(ev, i, it);
                }}
                onClick={() => {
                  setFocusIdx(i);
                  activate(e);
                }}
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-2 text-[13px] text-muted-foreground max-md:h-10 max-md:gap-2 max-md:text-[15px] hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2",
                  active && "bg-accent-soft text-foreground hover:bg-accent-soft",
                )}
                style={{ paddingLeft: 6 + it.depth * 14 }}
                title={e.type === "commit" ? `${e.name} (Git submodule)` : e.path}
              >
                <DisclosureMark isDir={isDir} loading={loading.has(e.path)} open={open} />
                <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-subtle-foreground")} strokeWidth={1.75} />
                <span className="truncate">{e.name}</span>
                {isDir ? <FolderCount tree={tree} dir={e.path} /> : null}
                {e.type === "commit" ? <span className="ml-auto text-[11px] text-subtle-foreground">submodule</span> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Everything below a folder that is loaded: files, folders and the most common file types. */
function folderStats(tree: RepoTree, dir: string) {
  let files = 0;
  let folders = 0;
  let partial = false;
  const types = new Map<string, number>();
  const walk = (d: string) => {
    const kids = tree.list(d);
    if (!kids) {
      partial = true;
      return;
    }
    for (const k of kids) {
      if (k.type === "tree") {
        folders++;
        walk(k.path);
      } else {
        files++;
        const ext = /\.([\w-]+)$/.exec(k.name)?.[1]?.toLowerCase() ?? "no extension";
        types.set(ext, (types.get(ext) ?? 0) + 1);
      }
    }
  };
  walk(dir);
  const top = [...types].toSorted((a, b) => b[1] - a[1]).slice(0, 4);
  return { files, folders, partial, top };
}

function FolderTooltip({ tree, dir, direct }: Readonly<{ tree: RepoTree; dir: string; direct: TreeEntry[] }>) {
  const subfolders = direct.filter((k) => k.type === "tree").length;
  const all = folderStats(tree, dir);
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        {[subfolders ? plural(subfolders, "folder", "folders") : "", direct.length > subfolders ? plural(direct.length - subfolders, "file", "files") : ""].filter(Boolean).join(", ") || "Empty"}
      </span>
      {all.folders > subfolders ? (
        <span className="opacity-75">
          In total {plural(all.files, "file", "files")} in {plural(all.folders, "folder", "folders")}
          {all.partial ? " so far" : ""}
        </span>
      ) : null}
      {all.top.length ? <span className="opacity-75">{all.top.map(([ext, n]) => (ext.startsWith("no ") ? `${n} without extension` : `${n} .${ext}`)).join(", ")}</span> : null}
    </span>
  );
}

/** Light meta information after a folder name: how many items (files and folders) it holds. */
function FolderCount({ tree, dir }: Readonly<{ tree: RepoTree; dir: string }>) {
  const direct = tree.list(dir);
  if (!direct) return null;
  return (
    <Tooltip content={<FolderTooltip tree={tree} dir={dir} direct={direct} />} side="right">
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-subtle-foreground/70">{direct.length.toLocaleString()}</span>
    </Tooltip>
  );
}

function treeIcon(e: TreeEntry, open: boolean) {
  if (e.type === "tree") return open ? FolderOpen : Folder;
  if (e.type === "commit") return GitCommitHorizontal;
  return semanticLanguageFor(e.path) ? FileCode2 : File;
}

/** The chevron in front of a folder (a spinner while it loads), or its blank width for files. */
function DisclosureMark({ isDir, loading, open }: Readonly<{ isDir: boolean; loading: boolean; open: boolean }>) {
  if (!isDir) return <span className="w-3.5 shrink-0" />;
  if (loading) return <Loader2 className="size-3.5 shrink-0 animate-spin" />;
  return <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />;
}
