import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

export interface FindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  index: number;
}

export interface FindMatch {
  line: number;
  col: number;
  len: number;
}

/** More matches are not counted; the bar then shows "10,000+". */
export const MAX_FIND_MATCHES = 10_000;

function findAll(lines: string[], query: string, caseSensitive: boolean): FindMatch[] {
  const out: FindMatch[] = [];
  const needle = caseSensitive ? query : query.toLowerCase();
  for (let i = 0; i < lines.length && out.length < MAX_FIND_MATCHES; i++) {
    const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
    for (let at = hay.indexOf(needle); at >= 0 && out.length < MAX_FIND_MATCHES; at = hay.indexOf(needle, at + needle.length)) out.push({ line: i + 1, col: at, len: needle.length });
  }
  return out;
}

/** Find in file (Cmd/Ctrl+F): the query, its matches, the current one, and stepping between them. */
export function useFindInFile(lines: string[], linesRef: RefObject<HTMLDivElement | null>) {
  const [find, setFind] = useState<FindState>({ open: false, query: "", caseSensitive: false, index: 0 });
  const findInput = useRef<HTMLInputElement>(null);
  const matches = useMemo(
    () => (find.open && find.query ? findAll(lines, find.query, find.caseSensitive) : []),
    [find.open, find.query, find.caseSensitive, lines],
  );
  const current = matches.length ? Math.min(find.index, matches.length - 1) : -1;

  // The browser's own find cannot see rows that are not rendered yet: take over Cmd/Ctrl+F.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "f") return;
      if ((e.target as HTMLElement | null)?.closest?.("[role=dialog]")) return;
      e.preventDefault();
      const sel = window.getSelection()?.toString() ?? "";
      const seed = sel && !sel.includes("\n") && sel.length < 200 ? sel : undefined;
      setFind((f) => ({ ...f, open: true, query: seed ?? f.query, index: 0 }));
      requestAnimationFrame(() => {
        findInput.current?.focus();
        findInput.current?.select();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Bring the current match into view.
  useEffect(() => {
    if (current < 0) return;
    const m = matches[current];
    linesRef.current?.querySelector<HTMLElement>(`[data-line="${m.line}"]`)?.scrollIntoView({ block: "center" });
  }, [current, matches, linesRef]);

  const step = (dir: 1 | -1) =>
    setFind((f) => ({ ...f, index: matches.length ? (Math.min(f.index, matches.length - 1) + dir + matches.length) % matches.length : 0 }));

  return { find, setFind, findInput, matches, current, step };
}
