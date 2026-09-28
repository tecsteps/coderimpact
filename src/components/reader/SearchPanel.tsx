import { useDeferredValue, useMemo, useState } from "react";
import { CaseSensitive, Loader2, Search, WholeWord } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import { useSessionVersion } from "@/hooks/useSession";
import { LIMITS } from "@/lib/util/files";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

export function ScanControl({ session }: Readonly<{ session: RepoSession }>) {
  useSessionVersion(session);
  const scan = session.scan;
  const { textsVersion, progress } = session;
  const notFetched = useMemo(
    () => session.scannableFiles().filter((f) => !session.texts.has(f.path)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, textsVersion, progress.total],
  );
  if (scan.phase === "running") {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="tabular-nums">
          Fetching {scan.fetched} of {scan.total} files
        </span>
        <Button size="sm" variant="ghost" onClick={() => session.cancelScan()}>
          Cancel
        </Button>
      </div>
    );
  }
  if (notFetched === 0) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" onClick={() => session.scanRepository()}>
        Scan repository
      </Button>
      <span className="text-[11.5px] text-subtle-foreground">
        Fetches up to {Math.min(notFetched, LIMITS.maxScanFiles).toLocaleString()} more text files (vendor and generated folders are skipped). You can cancel at any time.
        {scan.phase === "cancelled" ? " The last scan was cancelled." : ""}
      </span>
    </div>
  );
}

export function SearchPanel({
  session,
  onOpen,
  autoFocus,
  initialQuery,
}: Readonly<{
  session: RepoSession;
  onOpen: (path: string, line: number, query: string) => void;
  autoFocus?: boolean;
  /** Search started from a symbol: prefilled, case-sensitive, whole word. */
  initialQuery?: string;
}>) {
  useSessionVersion(session);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [caseSensitive, setCaseSensitive] = useState(!!initialQuery);
  const [wholeWord, setWholeWord] = useState(!!initialQuery);
  const deferred = useDeferredValue(query);

  const { textsVersion, progress } = session;
  const result = useMemo(
    () => (deferred.trim().length >= 2 ? session.searchText(deferred, { caseSensitive, wholeWord }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferred, caseSensitive, wholeWord, session, textsVersion],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, NonNullable<typeof result>["matches"]>();
    for (const x of result?.matches ?? []) {
      const list = m.get(x.path);
      if (list) list.push(x);
      else m.set(x.path, [x]);
    }
    return [...m.entries()];
  }, [result]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalText = useMemo(() => session.scannableFiles().length, [session, progress.total]);
  const moreMark = result?.truncated ? "+" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            aria-label="Search text in fetched files"
            placeholder="Search text"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-7 pr-16 font-mono"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
            <button
              type="button"
              aria-pressed={caseSensitive}
              aria-label="Match case"
              title="Match case"
              onClick={() => setCaseSensitive((v) => !v)}
              className={cn("rounded p-1 text-subtle-foreground hover:text-foreground cursor-pointer", caseSensitive && "bg-accent-soft text-accent")}
            >
              <CaseSensitive className="size-3.5" />
            </button>
            <button
              type="button"
              aria-pressed={wholeWord}
              aria-label="Whole word"
              title="Whole word"
              onClick={() => setWholeWord((v) => !v)}
              className={cn("rounded p-1 text-subtle-foreground hover:text-foreground cursor-pointer", wholeWord && "bg-accent-soft text-accent")}
            >
              <WholeWord className="size-3.5" />
            </button>
          </div>
        </div>
        <p className="text-[11.5px] text-subtle-foreground" aria-live="polite">
          {result
            ? `${result.matches.length}${moreMark} matches in ${grouped.length} files. Searched ${result.filesSearched} fetched of ${totalText.toLocaleString()} text files.`
            : `Searches the ${session.texts.size} files fetched so far. Scan the repository to search more.`}
        </p>
        <ScanControl session={session} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {grouped.map(([path, matches]) => (
          <div key={path} className="mb-2">
            <div className="truncate px-2 py-1 font-mono text-[11.5px] text-muted-foreground">{path}</div>
            {matches.slice(0, 50).map((m) => (
              <button
                key={`${m.line}:${m.col}`}
                type="button"
                onClick={() => onOpen(m.path, m.line, query)}
                className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-2 cursor-pointer"
              >
                <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-subtle-foreground">{m.line}</span>
                <span className="truncate font-mono text-[12px] text-foreground">
                  {m.text.slice(Math.max(0, m.col - 30), m.col).trimStart()}
                  <mark className="rounded-sm bg-accent-soft px-0.5 text-foreground">{m.text.slice(m.col, m.col + m.length)}</mark>
                  {m.text.slice(m.col + m.length, m.col + m.length + 60)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
