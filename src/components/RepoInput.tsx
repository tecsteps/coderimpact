import { useEffect, useId, useMemo, useState } from "react";
import { ArrowRight, Clock, Loader2, Star } from "lucide-react";
import { getRecents } from "@/lib/cache/recents";
import { expandShorthand, formatStars, searchQueryFor, searchRepositories, type RepoSuggestion } from "@/lib/github/repoSearch";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface Option {
  fullName: string;
  recent?: boolean;
  suggestion?: RepoSuggestion;
}

/**
 * The "open a repository" field: accepts owner/repo, GitHub URLs and a single
 * name (`sylius` opens sylius/sylius or the best match), and suggests recent
 * repositories and GitHub search results while typing.
 *
 * `inline`: suggestions are part of the layout (inside a sheet) instead of a
 * floating list (start page).
 */
export function RepoInput({
  onOpen,
  onError,
  autoFocus,
  inline,
  size = "md",
  placeholder = "owner/repo or GitHub URL",
  label,
  emphasis,
}: Readonly<{
  /** The start screen's main action: a stronger field. */
  emphasis?: boolean;
  /** Visible label above the field. */
  label?: string;
  onOpen: (value: string) => void;
  onError?: (msg: string | null) => void;
  autoFocus?: boolean;
  inline?: boolean;
  size?: "md" | "lg";
  placeholder?: string;
}>) {
  const id = useId();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<RepoSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // GitHub search, debounced (the unauthenticated limit is 10 searches per minute).
  useEffect(() => {
    setRemote([]);
    if (!searchQueryFor(value)) return;
    const ctl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      searchRepositories(value, ctl.signal)
        .then((r) => !ctl.signal.aborted && setRemote(r))
        .catch(() => undefined)
        .finally(() => !ctl.signal.aborted && setLoading(false));
    }, 350);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
      setLoading(false);
    };
  }, [value]);

  const options = useMemo<Option[]>(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const recents = getRecents()
      .filter((r) => r.owner !== "~" && `${r.owner}/${r.repo}`.toLowerCase().includes(q))
      .slice(0, 3)
      .map((r) => ({ fullName: `${r.owner}/${r.repo}`, recent: true }));
    const seen = new Set(recents.map((r) => r.fullName.toLowerCase()));
    const found = remote.filter((s) => !seen.has(s.fullName.toLowerCase())).map((s) => ({ fullName: s.fullName, suggestion: s }));
    return [...recents, ...found].slice(0, 8);
  }, [value, remote]);

  useEffect(() => {
    setActive(-1);
  }, [value]);

  const submit = async (raw: string) => {
    if (!raw.trim()) return;
    setBusy(true);
    onError?.(null);
    try {
      onOpen(await expandShorthand(raw));
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showList = open && value.trim().length > 0 && (options.length > 0 || loading);
  const list = showList ? (
    <SuggestionList
      id={id}
      options={options}
      active={active}
      loading={loading}
      inline={inline}
      onPick={(name) => {
        setValue(name);
        submit(name);
      }}
      onHover={setActive}
    />
  ) : null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative">
      {label ? (
        <label htmlFor={`${id}-input`} className="mb-1.5 block text-left text-[13px] font-medium text-foreground">
          {label}
        </label>
      ) : null}
      <form
        className={cn("flex gap-2", size === "lg" && !emphasis && "flex-col sm:flex-row")}
        onSubmit={(e) => {
          e.preventDefault();
          submit(active >= 0 && options[active] ? options[active].fullName : value);
        }}
      >
        <input
          id={`${id}-input`}
          aria-label={label ? undefined : "Repository"}
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          // The focus ring is drawn inside the field, so a scrolling sheet cannot clip it.
          className={cn(
            "w-full min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-foreground placeholder:font-sans placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
            size === "lg" ? "h-11 px-3.5 text-[14px]" : "h-10 text-[14px]",
            emphasis && "h-12 flex-1 border-border-strong text-[15px] shadow-[0_6px_24px_-10px_color-mix(in_srgb,var(--accent)_40%,transparent)]",
          )}
        />
        <Button type="submit" size={size === "lg" ? "lg" : "default"} className={cn(size === "lg" ? "h-11 px-5" : "h-10", emphasis && "h-12 px-6 text-[15px] max-sm:px-4")} aria-label="Open repository" disabled={busy}>
          <SubmitLabel busy={busy} large={size === "lg"} />
        </Button>
      </form>
      {list}
    </div>
  );
}

function SubmitLabel({ busy, large }: Readonly<{ busy: boolean; large: boolean }>) {
  if (busy) return <Loader2 className="animate-spin" />;
  if (large) return <>Open <ArrowRight /></>;
  return <ArrowRight />;
}


/** The suggestions under the field: recent repositories first, then GitHub search results. */
function SuggestionList({
  id,
  options,
  active,
  loading,
  inline,
  onPick,
  onHover,
}: Readonly<{
  id: string;
  options: Option[];
  active: number;
  loading: boolean;
  inline?: boolean;
  onPick: (fullName: string) => void;
  onHover: (index: number) => void;
}>) {
  return (
    <ul
      id={`${id}-list`}
      role="listbox"
      aria-label="Repositories"
      className={cn(
        "flex flex-col overflow-y-auto rounded-lg border border-border bg-surface p-1",
        inline ? "mt-2" : "absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 shadow-pop",
      )}
    >
      {options.map((o, i) => (
        <li key={o.fullName} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            // Keep focus in the field so the list does not close before the click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(o.fullName)}
            onPointerMove={() => onHover(i)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 text-left cursor-pointer",
              inline ? "py-2.5" : "py-2",
              i === active && "bg-surface-2",
            )}
          >
            {o.recent ? <Clock className="size-3.5 shrink-0 text-subtle-foreground" strokeWidth={1.75} /> : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-[13.5px] text-foreground">{o.fullName}</span>
              {o.suggestion?.description ? <span className="truncate text-[12px] text-subtle-foreground">{o.suggestion.description}</span> : null}
            </span>
            {o.suggestion ? (
              <span className="flex shrink-0 items-center gap-2 text-[11.5px] tabular-nums text-subtle-foreground">
                {o.suggestion.language ? <span className="hidden sm:inline">{o.suggestion.language}</span> : null}
                <span className="inline-flex items-center gap-0.5">
                  <Star className="size-3" strokeWidth={1.75} />
                  {formatStars(o.suggestion.stars)}
                </span>
              </span>
            ) : null}
          </button>
        </li>
      ))}
      {loading && options.length === 0 ? (
        <li className="flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-subtle-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Searching GitHub…
        </li>
      ) : null}
    </ul>
  );
}
