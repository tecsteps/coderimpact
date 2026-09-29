import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Clock,
  FolderOpen,
  HardDrive,
  Home,
  Search,
} from "lucide-react";
import { encodePath, HASH_ROUTER, navigate } from "@/lib/router";
import { getRecents, timeAgo } from "@/lib/cache/recents";
import {
  isLocalOwner,
  listProjects,
  type LocalProject,
} from "@/lib/local/projects";
import { openProject, useFolderPicker } from "../LocalFolder";
import { openInput } from "../Landing";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import { cn } from "@/lib/utils";

interface Entry {
  id: string;
  label: string;
  icon: typeof Clock;
  hint?: string;
  current: boolean;
  open: () => void;
}

function openTyped(value: string) {
  try {
    openInput(value);
  } catch {
    navigate("/");
  }
}

/** Recent repositories and local folders, the current one first. */
function useEntries(owner: string, repo: string, open: boolean): Entry[] {
  const [locals, setLocals] = useState<LocalProject[]>([]);
  useEffect(() => {
    if (open && !HASH_ROUTER) listProjects().then(setLocals);
  }, [open]);
  return useMemo(() => {
    if (!open) return [];
    const same = (o: string, r: string) =>
      o.toLowerCase() === owner.toLowerCase() &&
      r.toLowerCase() === repo.toLowerCase();
    const folders: Entry[] = locals.map((p) => ({
      id: `~/${p.id}`,
      label: p.name,
      icon: HardDrive,
      hint: "local folder",
      current: same("~", p.slug),
      open: () => openProject(p),
    }));
    const repos: Entry[] = getRecents()
      .filter((r) => !isLocalOwner(r.owner))
      .map((r) => ({
        id: `${r.owner}/${r.repo}`,
        label: `${r.owner}/${r.repo}`,
        icon: Clock,
        hint: timeAgo(r.openedAt),
        current: same(r.owner, r.repo),
        open: () =>
          navigate(
            r.path
              ? `/${r.owner}/${r.repo}/blob/${r.sha}/${encodePath(r.path)}`
              : `/${r.owner}/${r.repo}/tree/${r.sha}`,
          ),
      }));
    return [...folders, ...repos].sort(
      (a, b) => Number(b.current) - Number(a.current),
    );
  }, [open, locals, owner, repo]);
}

/**
 * The owner in the header opens a quick switcher: search the recent
 * repositories and local folders, open a folder, or go to the start page.
 */
export function ProjectSwitcher({
  owner = "",
  repo = "",
  label,
  compact,
}: Readonly<{
  owner?: string;
  repo?: string;
  /** The trigger's text when no project is open (start page). */
  label?: string;
  /** Phones: the repository name is the trigger, in the header's larger text. */
  compact?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const picker = useFolderPicker(openProject);
  const entries = useEntries(owner, repo, open);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const matches = entries.filter(
      (e) => !q || e.label.toLowerCase().includes(q),
    );
    const extra: Entry[] = [
      {
        id: "open-folder",
        label: "Open a local folder…",
        icon: FolderOpen,
        current: false,
        open: picker.open,
      },
      {
        id: "start",
        label: "Add a repository…",
        icon: Home,
        current: false,
        open: () => navigate("/"),
      },
    ];
    // Typed owner/repo or a GitHub link: open it directly.
    if (q.includes("/") && !matches.length)
      extra.unshift({
        id: "input",
        label: `Open ${query.trim()}`,
        icon: Search,
        current: false,
        open: () => openTyped(query.trim()),
      });
    return [...matches, ...(HASH_ROUTER ? extra.slice(1) : extra)];
  }, [entries, q, query, picker.open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);
  // A block body: newer browsers return a Promise from scrollIntoView, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    list.current
      ?.querySelector(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (e: Entry) => {
    setOpen(false);
    setQuery("");
    if (!e.current) e.open();
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % shown.length);
    } else if (ev.key === "Enter" && shown[active]) {
      ev.preventDefault();
      choose(shown[active]);
    }
  };

  return (
    <>
      {picker.element}
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip content={owner ? "Switch project" : "Recent projects"}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={owner ? `Switch project (now ${owner}/${repo})` : "Open a recent project"}
              className={
                compact
                  ? "inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[15px] font-medium text-foreground active:bg-surface-2 cursor-pointer"
                  : "inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-subtle-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer"
              }
            >
              <span className="truncate">{compact ? repo : owner || label}</span>
              <ChevronsUpDown className={compact ? "size-4 shrink-0 text-subtle-foreground" : "size-3"} strokeWidth={1.75} />
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-1rem))] p-0"
          // Phones: Radix would focus the search field anyway, and the keyboard would cover the list.
          onOpenAutoFocus={compact ? (e) => e.preventDefault() : undefined}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-3.5 shrink-0 text-subtle-foreground" />
            <input
              // Phones: no keyboard popping up over the list right away.
              autoFocus={!compact}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Find a project"
              aria-label="Find a project"
              aria-controls="project-switcher-list"
              className="bare-field h-10 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-subtle-foreground"
            />
          </div>
          <ul
            ref={list}
            id="project-switcher-list"
            aria-label="Projects"
            className="max-h-[360px] overflow-y-auto p-1"
          >
            {shown.map((e, i) => (
              <li key={e.id}>
                <button
                  type="button"
                  data-i={i}
                  onClick={() => choose(e)}
                  onMouseMove={() => setActive(i)}
                  aria-current={e.current ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] cursor-pointer",
                    i === active && "bg-surface-2",
                  )}
                >
                  <e.icon
                    className="size-3.5 shrink-0 text-subtle-foreground"
                    strokeWidth={1.75}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      e.id.includes("/") && "font-mono text-[12.5px]",
                    )}
                  >
                    {e.label}
                  </span>
                  {e.current ? (
                    <Check className="size-3.5 shrink-0 text-accent" />
                  ) : (
                    <span className="shrink-0 text-[11.5px] text-subtle-foreground">
                      {e.hint}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </>
  );
}
