import { Fragment, forwardRef, useDeferredValue, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Braces, FileText, Folder, Search, TextSearch } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import { useSessionVersion } from "@/hooks/useSession";
import { cn } from "@/lib/utils";

type Item =
  | { kind: "file"; path: string; dir: boolean }
  | { kind: "symbol"; path: string; line: number; name: string; label: string; symbolKind?: string }
  | { kind: "text"; path: string; line: number; col: number; length: number; text: string }
  | { kind: "all-text" };

export interface GlobalSearchHandle {
  focus: () => void;
}

const HEADINGS: Partial<Record<Item["kind"], string>> = { file: "Files", symbol: "Symbols", text: "Code" };

function split(p: string) {
  const i = p.lastIndexOf("/");
  return { name: p.slice(i + 1), dir: i >= 0 ? p.slice(0, i) : "" };
}

/** Stable per result: two symbols can share a line, two text matches cannot share a column. */
function itemKey(it: Item): string {
  switch (it.kind) {
    case "file":
      return `file:${it.path}`;
    case "symbol":
      return `symbol:${it.path}:${it.line}:${it.name}`;
    case "text":
      return `text:${it.path}:${it.line}:${it.col}`;
    default:
      return "all-text";
  }
}

function ItemContent({ it, q }: Readonly<{ it: Item; q: string }>) {
  switch (it.kind) {
    case "file": {
      const { name, dir } = split(it.path);
      return (
        <>
          {it.dir ? <Folder className="size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} /> : <FileText className="size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} />}
          <span className="shrink-0 font-medium text-foreground">{name}</span>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-subtle-foreground [direction:rtl]">
            <bdi>{dir}</bdi>
          </span>
        </>
      );
    }
    case "symbol":
      return (
        <>
          <Braces className="size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
          <span className="shrink-0 font-mono text-[12.5px] text-foreground">{it.label}</span>
          {it.symbolKind ? <span className="shrink-0 text-[11.5px] text-subtle-foreground">{it.symbolKind}</span> : null}
          <span className="ml-auto min-w-0 truncate font-mono text-[11.5px] text-subtle-foreground">
            {split(it.path).name}:{it.line}
          </span>
        </>
      );
    case "text": {
      const from = Math.max(0, it.col - 24);
      return (
        <>
          <TextSearch className="size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
            {from > 0 ? "…" : ""}
            {it.text.slice(from, it.col).trimStart()}
            <mark className="rounded-sm bg-accent-soft px-0.5 text-foreground">{it.text.slice(it.col, it.col + it.length)}</mark>
            {it.text.slice(it.col + it.length, it.col + it.length + 60)}
          </span>
          <span className="shrink-0 font-mono text-[11.5px] text-subtle-foreground">
            {split(it.path).name}:{it.line}
          </span>
        </>
      );
    }
    default:
      return <span className="text-[12.5px] text-accent">All code matches for “{q}” in the Search panel</span>;
  }
}

function ResultOption({
  optionId,
  selected,
  onChoose,
  onHover,
  children,
}: Readonly<{ optionId: string; selected: boolean; onChoose: () => void; onHover: () => void; children: React.ReactNode }>) {
  return (
    <li id={optionId} role="option" aria-selected={selected}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onChoose}
        onPointerMove={onHover}
        className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] cursor-pointer", selected && "bg-surface-2")}
      >
        {children}
      </button>
    </li>
  );
}

/**
 * The search in the header (double Shift): file names, symbols across the
 * repository and code text in one list, grouped. Enter opens the highlighted
 * result; "All text matches" continues in the Search panel.
 */
export const GlobalSearch = forwardRef<
  GlobalSearchHandle,
  Readonly<{
    session: RepoSession;
    onOpenFile: (path: string, dir: boolean) => void;
    onOpenLocation: (path: string, line: number, query?: string) => void;
    onAllText: (query: string) => void;
    /** Phones: results in the page flow (the nav tree sheet) instead of a dropdown. */
    inline?: boolean;
    /** Inline: whether results are showing, so the tree can step aside. */
    onSearchingChange?: (searching: boolean) => void;
  }>
>(function GlobalSearch({ session, onOpenFile, onOpenLocation, onAllText, inline, onSearchingChange }, ref) {
  useSessionVersion(session);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDeferredValue(query.trim());

  useImperativeHandle(ref, () => ({
    focus: () => {
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    },
  }));

  // Searches only while the list is open, and again only when what it searches changed:
  // the tree (total), the index (generation) or the fetched texts (textsVersion).
  const { textsVersion, progress } = session;
  const generation = session.index.generation;
  const items: Item[] = useMemo(() => {
    if (!open || q.length < 2) return [];
    const files = session.findFiles(q, 6).map<Item>((e) => ({ kind: "file", path: e.path, dir: e.type === "tree" }));
    const symbols = session.index
      .searchSymbols(q, 6)
      .map<Item>((s) => ({ kind: "symbol", path: s.path, line: s.line, name: s.name, label: s.label ?? s.name, symbolKind: s.kind }));
    const text = session.searchText(q, { limit: 6 }).matches.map<Item>((m) => ({ kind: "text", path: m.path, line: m.line, col: m.col, length: m.length, text: m.text }));
    return [...files, ...symbols, ...text, ...(text.length ? [{ kind: "all-text" } as Item] : [])];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, session, textsVersion, generation, progress.total]);

  useEffect(() => {
    setActive(0);
  }, [q]);
  useEffect(() => {
    document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  const choose = (it: Item) => {
    setOpen(false);
    input.current?.blur();
    if (it.kind === "file") onOpenFile(it.path, it.dir);
    else if (it.kind === "symbol") onOpenLocation(it.path, it.line);
    else if (it.kind === "text") onOpenLocation(it.path, it.line, q);
    else onAllText(q);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  const show = open && q.length >= 2;
  useEffect(() => {
    onSearchingChange?.(show);
  }, [show, onSearchingChange]);

  const list = show ? (
    <div
      className={cn(
        "flex flex-col overflow-y-auto bg-surface p-1",
        inline ? "mt-2 min-h-0 flex-1" : "absolute top-full right-0 left-0 z-40 mt-1.5 max-h-[min(70dvh,560px)] min-w-[420px] rounded-lg border border-border shadow-pop",
      )}
    >
      <ul id={`${id}-list`} role="listbox" aria-label="Search results" className="flex flex-col">
        {items.length === 0 ? <li className="px-2.5 py-3 text-[13px] text-subtle-foreground">No files, symbols or text in the fetched files match.</li> : null}
        {items.map((it, i) => {
          // A group's heading goes before its first result; screen readers get the kind from each result.
          const heading = HEADINGS[it.kind];
          const first = i === 0 || items[i - 1].kind !== it.kind;
          return (
            <Fragment key={itemKey(it)}>
              {heading && first ? (
                <li aria-hidden className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">
                  {heading}
                </li>
              ) : null}
              <ResultOption optionId={`${id}-opt-${i}`} selected={i === active} onChoose={() => choose(it)} onHover={() => setActive(i)}>
                <ItemContent it={it} q={q} />
              </ResultOption>
            </Fragment>
          );
        })}
      </ul>
      <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-subtle-foreground">
        Code search covers the {session.texts.size.toLocaleString()} files fetched so far; symbols cover the indexed files.
      </p>
    </div>
  ) : null;

  return (
    <div className={cn("relative w-full", inline && show && "flex min-h-0 flex-1 flex-col")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search files, symbols and code"
          aria-expanded={show}
          aria-controls={`${id}-list`}
          aria-activedescendant={show ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          placeholder="Search files, symbols, code"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Inline, the results stay while the phone keyboard closes.
          onBlur={() => !inline && setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-md border border-border bg-surface-2/60 pl-8 text-foreground placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
            inline ? "h-10 pr-3 text-[15px]" : "h-8 pr-12 text-[13px]",
          )}
        />
        {inline ? null : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border px-1 font-sans text-[10.5px] text-subtle-foreground" title="Press Shift twice">
            ⇧⇧
          </kbd>
        )}
      </div>
      {list}
    </div>
  );
});

/** Calls `onDouble` when Shift is pressed twice quickly (without other keys), like IDEs do. */
export function useDoubleShift(onDouble: () => void) {
  const cb = useRef(onDouble);
  cb.current = onDouble;
  useEffect(() => {
    let last = 0;
    // True while the current Shift press has not been combined with another key.
    let clean = false;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") clean = !e.repeat;
      else {
        clean = false;
        last = 0;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || !clean) return;
      clean = false;
      const now = Date.now();
      if (now - last < 400) {
        last = 0;
        cb.current();
      } else last = now;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
