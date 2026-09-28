import type { Dispatch, RefObject, SetStateAction } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";
import { MAX_FIND_MATCHES, type FindState } from "./useFindInFile";
import { cn } from "@/lib/utils";

function findStatus(query: string, count: number, current: number): string {
  if (!query) return "";
  if (!count) return "No results";
  const total = count >= MAX_FIND_MATCHES ? "10,000+" : count.toLocaleString();
  return `${current + 1} of ${total}`;
}

/** The find bar over the code view. Escape closes it and hands focus back through `onEscape`. */
export function FindBar({
  find,
  setFind,
  inputRef,
  count,
  current,
  step,
  onEscape,
}: Readonly<{
  find: FindState;
  setFind: Dispatch<SetStateAction<FindState>>;
  inputRef: RefObject<HTMLInputElement | null>;
  count: number;
  current: number;
  step: (dir: 1 | -1) => void;
  onEscape: () => void;
}>) {
  return (
    <div
      role="search"
      aria-label="Find in file"
      className="absolute top-2 right-4 z-30 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 font-sans text-[12.5px] text-foreground shadow-pop"
    >
      <input
        ref={inputRef}
        aria-label="Find in this file"
        value={find.query}
        placeholder="Find in file"
        spellCheck={false}
        onChange={(e) => setFind((f) => ({ ...f, query: e.target.value, index: 0 }))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setFind((f) => ({ ...f, open: false }));
            onEscape();
          }
        }}
        className="h-7 w-52 rounded-md bg-surface-2 px-2 font-mono text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      />
      <span className="min-w-[4.5rem] px-1 text-center tabular-nums text-subtle-foreground" aria-live="polite">
        {findStatus(find.query, count, current)}
      </span>
      <button type="button" aria-pressed={find.caseSensitive} title="Match case" aria-label="Match case" onClick={() => setFind((f) => ({ ...f, caseSensitive: !f.caseSensitive, index: 0 }))} className={cn("rounded p-1 text-muted-foreground hover:bg-surface-2 cursor-pointer", find.caseSensitive && "bg-accent-soft text-accent")}>
        <CaseSensitive className="size-4" />
      </button>
      <button type="button" title="Previous (Shift+Enter)" aria-label="Previous match" disabled={!count} onClick={() => step(-1)} className="rounded p-1 text-muted-foreground hover:bg-surface-2 disabled:opacity-40 cursor-pointer">
        <ChevronUp className="size-4" />
      </button>
      <button type="button" title="Next (Enter)" aria-label="Next match" disabled={!count} onClick={() => step(1)} className="rounded p-1 text-muted-foreground hover:bg-surface-2 disabled:opacity-40 cursor-pointer">
        <ChevronDown className="size-4" />
      </button>
      <button type="button" title="Close (Escape)" aria-label="Close find" onClick={() => setFind((f) => ({ ...f, open: false }))} className="rounded p-1 text-muted-foreground hover:bg-surface-2 cursor-pointer">
        <X className="size-4" />
      </button>
    </div>
  );
}
