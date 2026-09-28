import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Info, Loader2, Search, TriangleAlert } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import type { ReferenceResult, Resolution, SymbolLocation } from "@/lib/lang/semanticIndex";
import { languageLabel, semanticLanguageFor } from "@/lib/util/files";
import { useSessionVersion } from "@/hooks/useSession";
import { Segmented } from "../ui/segmented";
import { Button } from "../ui/button";
import { ScanControl } from "./SearchPanel";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMediaQuery";

export interface SymbolSelection {
  path: string;
  index: number;
  name: string;
  line: number;
  col: number;
}

type Tab = "definition" | "references" | "callers";

function Preview({ session, loc, highlight, before = 36 }: Readonly<{ session: RepoSession; loc: SymbolLocation; highlight?: string; before?: number }>) {
  const line = session.lines(loc.path)?.[loc.line - 1];
  if (line === undefined) return <span className="font-mono text-[12px] text-subtle-foreground">…</span>;
  const trimmed = line.replace(/^\s+/, "");
  const shift = line.length - trimmed.length;
  const s = loc.col - shift;
  const e = loc.endCol - shift;
  const name = highlight ?? loc.name;
  if (s >= 0 && e <= trimmed.length && trimmed.slice(s, e).replace(/^\$/, "") === name.replace(/^\$/, "")) {
    let from = Math.max(0, s - before);
    if (from > 0) {
      const space = trimmed.lastIndexOf(" ", s - 1);
      from = space >= from ? space + 1 : from;
    }
    return (
      <span className="truncate font-mono text-[12px] text-foreground">
        {from > 0 ? "…" : ""}
        {trimmed.slice(from, s)}
        <mark className="rounded-sm bg-accent-soft px-0.5 text-foreground">{trimmed.slice(s, e)}</mark>
        {trimmed.slice(e, e + 80)}
      </span>
    );
  }
  return <span className="truncate font-mono text-[12px] text-foreground">{trimmed.slice(0, 120)}</span>;
}

/** Under a location: its label when it adds to the name. */
function LocationNote({ loc }: Readonly<{ loc: SymbolLocation }>) {
  const cls = "pl-10 text-[11.5px] text-subtle-foreground max-md:text-[12.5px]";
  if (loc.label && loc.label !== loc.name) return <span className={cls}>{loc.label}</span>;
  return null;
}

function LocationList({
  session,
  items,
  onOpen,
  empty,
  showEnclosing,
}: Readonly<{
  session: RepoSession;
  items: SymbolLocation[];
  onOpen: (loc: SymbolLocation) => void;
  empty: string;
  showEnclosing?: boolean;
}>) {
  const isMobile = useIsMobile();
  // Load previews for files known only from the persistent index cache.
  useEffect(() => {
    const missing = [...new Set(items.map((i) => i.path))].filter((p) => !session.texts.has(p)).slice(0, 30);
    missing.forEach((p) => session.loadFile(p).catch(() => undefined));
  }, [items, session]);

  if (items.length === 0) return empty ? <p className="px-3 py-3 text-[13px] text-subtle-foreground">{empty}</p> : null;
  const groups = new Map<string, SymbolLocation[]>();
  for (const it of items) {
    const g = groups.get(it.path);
    if (g) g.push(it);
    else groups.set(it.path, [it]);
  }
  return (
    <div className="flex flex-col">
      {[...groups.entries()].map(([path, locs]) => {
        const i = path.lastIndexOf("/");
        const file = path.slice(i + 1);
        const dir = i >= 0 ? path.slice(0, i) : "";
        return (
          <section key={path} className="border-b border-border/60 pb-1.5 last:border-b-0">
            {/* File name first; the folder is shortened from the left so its end stays readable. */}
            <div className="sticky top-0 z-[1] flex min-w-0 items-baseline gap-2 bg-surface px-3 pt-2 pb-1" title={path}>
              <span className="shrink-0 text-[12.5px] font-medium text-foreground max-md:text-[14px]">{file}</span>
              {dir ? (
                <span className="min-w-0 truncate font-mono text-[11px] text-subtle-foreground [direction:rtl] max-md:text-[11.5px]">
                  <bdi>{dir}</bdi>
                </span>
              ) : null}
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-subtle-foreground">{locs.length}</span>
            </div>
            {locs.map((loc, n) => {
              // The enclosing declaration once per run of lines inside it, not under every line.
              const scope = showEnclosing && loc.enclosing && loc.enclosing !== locs[n - 1]?.enclosing ? loc.enclosing : null;
              return (
                <div key={`${loc.line}:${loc.col}`}>
                  {scope ? <p className="truncate pt-1 pl-[3.25rem] pr-3 font-mono text-[11px] text-subtle-foreground">{scope}</p> : null}
                  <button
                    type="button"
                    onClick={() => onOpen(loc)}
                    className="flex w-full flex-col gap-0.5 px-3 py-1 text-left hover:bg-surface-2 active:bg-surface-2 cursor-pointer max-md:py-2.5"
                  >
                    <span className="flex w-full items-baseline gap-2 max-md:[&_.font-mono]:text-[13.5px]">
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-subtle-foreground">{loc.line}</span>
                      <Preview session={session} loc={loc} before={isMobile ? 14 : 36} />
                    </span>
                    {showEnclosing ? null : <LocationNote loc={loc} />}
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function TextFallback({ session, name, onOpen }: Readonly<{ session: RepoSession; name: string; onOpen: (loc: SymbolLocation) => void }>) {
  useSessionVersion(session);
  const bare = name.replace(/^\$/, "");
  const { textsVersion } = session;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => session.searchText(bare, { caseSensitive: true, wholeWord: true, limit: 200 }), [session, bare, textsVersion]);
  const locs: SymbolLocation[] = result.matches.map((m) => ({ path: m.path, line: m.line, col: m.col, endCol: m.col + m.length, name: bare }));
  return (
    <div className="flex flex-col gap-2">
      <div className="mx-3 flex flex-col gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted-foreground">
        <span>
          <strong className="font-semibold text-foreground">Text search</strong>, not semantic: {result.matches.length}
          {result.truncated ? "+" : ""} matches for <code className="font-mono">{bare}</code> in {result.filesSearched} fetched files. Some may be unrelated.
        </span>
        <ScanControl session={session} />
      </div>
      <LocationList session={session} items={locs} onOpen={onOpen} empty="No text matches in the fetched files." />
    </div>
  );
}

type Unresolved = Exclude<Resolution, { status: "resolved" }>;

const UNRESOLVED_TONE: Record<Unresolved["status"], string> = {
  candidates: "Partial result",
  dynamic: "Cannot be resolved",
  external: "Outside the indexed code",
  unresolved: "Not found",
};

const SECTION_HEADING = "px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground";

/** True while the files that can answer this (class file, Go package) are fetched and indexed. */
function useResolving(session: RepoSession, selection: SymbolSelection): boolean {
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    setResolving(true);
    session
      .resolveDeep(selection.path, selection.index, ctl.signal)
      .catch(() => undefined)
      .finally(() => !ctl.signal.aborted && setResolving(false));
    return () => ctl.abort();
  }, [session, selection.path, selection.index]);
  return resolving;
}

function Coverage({ session, path, resolution }: Readonly<{ session: RepoSession; path: string; resolution: Resolution }>) {
  const lang = semanticLanguageFor(path);
  const resolved = resolution.status === "resolved" ? resolution : null;
  return (
    <p className="flex items-start gap-1.5 px-3 text-[11.5px] text-subtle-foreground">
      <Info className="mt-0.5 size-3 shrink-0" />
      <span>
        {lang ? `${languageLabel(path)} adapter` : "Semantic index"} · {session.progress.indexed.toLocaleString()} of {session.progress.total.toLocaleString()} files indexed
        {session.progress.phase === "running" ? " · indexing continues, results may grow" : ""}
        {resolved?.scope === "local" ? " · local to this file" : ""}
        {resolved?.precision === "name" && resolved.scope !== "local" ? " · matched by name, like GitHub's search-based navigation" : ""}
      </span>
    </p>
  );
}


/** Not resolved to a declaration: why, the usages or candidates that are known, and a text search to fall back on. */
function UnresolvedResult({
  session,
  selection,
  resolution,
  externalRefs,
  onOpen,
}: Readonly<{
  session: RepoSession;
  selection: SymbolSelection;
  resolution: Unresolved;
  externalRefs: SymbolLocation[] | null;
  onOpen: (loc: SymbolLocation) => void;
}>) {
  const [textSearch, setTextSearch] = useState(false);
  useEffect(() => {
    setTextSearch(false);
  }, [selection.path, selection.index]);
  // Built-ins and dependencies: the usages are the answer; why there is no definition is a side note.
  const usages = resolution.status === "external" ? externalRefs : null;
  return (
    <>
      {usages ? (
        <>
          <h3 className={SECTION_HEADING}>Usages in this repository ({usages.length})</h3>
          <LocationList session={session} items={usages} onOpen={onOpen} empty="No usages in the indexed files." showEnclosing />
          <p className="flex items-start gap-1.5 px-3 text-[11.5px] text-subtle-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            <span>No definition to open: {resolution.reason}</span>
          </p>
        </>
      ) : (
        <div className="mx-3 flex gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <div className="flex flex-col gap-1">
            <strong className="font-semibold">{UNRESOLVED_TONE[resolution.status]}</strong>
            <span className="text-muted-foreground">{resolution.reason}</span>
          </div>
        </div>
      )}
      {resolution.status === "candidates" ? (
        <>
          <h3 className={SECTION_HEADING}>
            {resolution.candidates.length} candidate{resolution.candidates.length === 1 ? "" : "s"}
          </h3>
          <LocationList session={session} items={resolution.candidates} onOpen={onOpen} empty="" />
        </>
      ) : null}
      {textSearch ? (
        <TextFallback session={session} name={selection.name} onOpen={onOpen} />
      ) : (
        <div className="px-3">
          <Button size="sm" variant="outline" onClick={() => setTextSearch(true)}>
            <Search /> Search text for {selection.name.replace(/^\$/, "")}
          </Button>
        </div>
      )}
    </>
  );
}

/** Exact results, then the possible ones (receiver type unknown) under their own heading. */
function RefList({
  session,
  result,
  onOpen,
  empty,
  possibleHeading,
}: Readonly<{
  session: RepoSession;
  result: Pick<ReferenceResult, "refs" | "possible">;
  onOpen: (loc: SymbolLocation) => void;
  empty: string;
  possibleHeading: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-3">
      <LocationList session={session} items={result.refs} onOpen={onOpen} empty={result.possible.length ? "" : empty} showEnclosing />
      {result.possible.length > 0 ? (
        <>
          <h3 className={SECTION_HEADING}>{possibleHeading}</h3>
          <LocationList session={session} items={result.possible} onOpen={onOpen} empty="" showEnclosing />
        </>
      ) : null}
    </div>
  );
}

function Definitions({ session, defs, onOpen }: Readonly<{ session: RepoSession; defs: SymbolLocation[]; onOpen: (loc: SymbolLocation) => void }>) {
  return (
    <div className="flex flex-col gap-2">
      <LocationList session={session} items={defs} onOpen={onOpen} empty="No definition found." />
      {defs[0] ? (
        <div className="px-3">
          <Button size="sm" variant="outline" onClick={() => onOpen(defs[0])}>
            <ArrowUpRight /> Go to definition
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TabContent({
  session,
  tab,
  defs,
  refs,
  calls,
  onOpen,
}: Readonly<{
  session: RepoSession;
  tab: Tab;
  defs: SymbolLocation[];
  refs: ReferenceResult | null;
  calls: Pick<ReferenceResult, "refs" | "possible"> | null;
  onOpen: (loc: SymbolLocation) => void;
}>) {
  if (tab === "definition") return <Definitions session={session} defs={defs} onOpen={onOpen} />;
  if (tab === "references" && refs) {
    return (
      <RefList
        session={session}
        result={refs}
        onOpen={onOpen}
        empty="No references in the indexed files."
        possibleHeading={
          <>
            Possible references ({refs.possible.length}) <span className="font-normal normal-case tracking-normal">· receiver type unknown</span>
          </>
        }
      />
    );
  }
  if (!calls) return null;
  return <RefList session={session} result={calls} onOpen={onOpen} empty="No call sites in the indexed files." possibleHeading={`Possible callers (${calls.possible.length})`} />;
}

export function RefsPanel({
  session,
  selection,
  requestedTab,
  onOpenLocation,
}: Readonly<{
  session: RepoSession;
  selection: SymbolSelection;
  /** The tab an action asked for; a new `n` applies it again. */
  requestedTab?: { tab: Tab; n: number };
  onOpenLocation: (path: string, line: number) => void;
}>) {
  const version = useSessionVersion(session);
  const [tab, setTab] = useState<Tab>(requestedTab?.tab ?? "references");
  useEffect(() => {
    if (requestedTab) setTab(requestedTab.tab);
  }, [requestedTab]);

  // Fetch and index exactly the files that can answer this (class file, Go package)
  // instead of waiting for the whole repository.
  const resolving = useResolving(session, selection);

  const resolution: Resolution = useMemo(
    () => session.index.resolveOccurrence(selection.path, selection.index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, selection.path, selection.index, version],
  );
  const isCallable = resolution.status === "resolved" && (resolution.kind === "function" || resolution.kind === "method");
  const refs = useMemo(
    () => (resolution.status === "resolved" ? session.index.references(resolution.key) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolution, version],
  );
  // Defined outside the indexed code, but its usages inside the repository are still known.
  const externalRefs = useMemo(
    () => (resolution.status === "external" && resolution.key ? session.index.references(resolution.key).refs : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolution, version],
  );
  const calls = useMemo(() => (refs ? { refs: refs.refs.filter((r) => r.role === "call"), possible: refs.possible.filter((r) => r.role === "call") } : null), [refs]);

  useEffect(() => {
    if (!isCallable && tab === "callers") setTab("references");
  }, [isCallable, tab]);

  const open = (loc: SymbolLocation) => onOpenLocation(loc.path, loc.line);
  const indexing = session.progress.phase === "running";
  const coverage = <Coverage session={session} path={selection.path} resolution={resolution} />;

  if (resolution.status !== "resolved" && resolving) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3">
        <p className="flex items-center gap-2 px-3 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Looking up the declaration…
        </p>
      </div>
    );
  }

  if (resolution.status !== "resolved") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3">
        <UnresolvedResult session={session} selection={selection} resolution={resolution} externalRefs={externalRefs} onOpen={open} />
        {coverage}
      </div>
    );
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: "definition", label: "Definition" },
    { value: "references", label: `References ${refs ? refs.refs.length : ""}` },
  ];
  if (isCallable) tabs.push({ value: "callers", label: `Callers ${calls ? calls.refs.length : ""}` });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3">
      <div className="px-3">
        <Segmented<Tab> label="Result type" value={tab} onChange={setTab} options={tabs} />
      </div>
      <TabContent session={session} tab={tab} defs={resolution.defs} refs={refs} calls={calls} onOpen={open} />
      {coverage}
      {indexing ? (
        <p className={cn("flex items-center gap-1.5 px-3 text-[11.5px] text-subtle-foreground")}>
          <Loader2 className="size-3 animate-spin" /> Indexing {session.progress.current ?? ""}
        </p>
      ) : null}
    </div>
  );
}
