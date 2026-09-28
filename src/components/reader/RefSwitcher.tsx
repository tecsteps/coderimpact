import { useEffect, useMemo, useState } from "react";
import { Check, GitBranch, Loader2, Search, Tag } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import type { RepoRefs } from "@/lib/github/source";
import { navigate, readerUrl } from "@/lib/router";
import { refNameFor } from "@/lib/sessions";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";

const LIMIT = 80;

/** The badge shows only the branch at its latest commit; the tooltip names the commit. */
function refTooltip(branch: string | null, label: string, sha: string): string {
  const short = sha.slice(0, 7);
  if (!branch) return `Commit ${short}. Switch branch or tag.`;
  if (label === branch) return `Latest commit of ${branch} (${short}). Switch branch or tag.`;
  return `${short} is an older commit of ${branch}. Switch branch or tag.`;
}

/**
 * The branch badge: shows the branch (or tag) and commit being read, and opens
 * a small searchable list of branches and tags to switch to. The open file
 * stays open when it exists in the other branch.
 */
export function RefSwitcher({ session, path, isDir, refLabel }: Readonly<{ session: RepoSession; path: string; isDir: boolean; refLabel: string }>) {
  const { owner, repo, commitSha } = session.repo;
  const current = refNameFor(commitSha);
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<RepoRefs | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || refs) return;
    const ctl = new AbortController();
    session
      .listRefs(ctl.signal)
      .then(setRefs)
      .catch(() => setFailed(true));
    return () => ctl.abort();
  }, [open, refs, session]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pick = (names: string[]) => names.filter((n) => !q || n.toLowerCase().includes(q)).slice(0, LIMIT);
    return refs ? { branches: pick(refs.branches), tags: pick(refs.tags) } : null;
  }, [refs, query]);

  const go = (name: string) => {
    setOpen(false);
    navigate(readerUrl(owner, repo, name, path, isDir ? "tree" : "blob"));
  };

  const row = (name: string, Icon: typeof GitBranch) => (
    <li key={name}>
      <button
        type="button"
        onClick={() => go(name)}
        aria-current={name === current ? "true" : undefined}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[12.5px] text-foreground hover:bg-surface-2 cursor-pointer"
      >
        <Icon className="size-3.5 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {name === current ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
      </button>
    </li>
  );

  const section = (title: string, names: string[], Icon: typeof GitBranch) =>
    names.length ? (
      <section>
        <h3 className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">{title}</h3>
        <ul>{names.map((n) => row(n, Icon))}</ul>
      </section>
    ) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={refTooltip(current, refLabel, commitSha)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Branch or tag: ${refLabel}. Switch`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer"
          >
            <GitBranch className="size-3" strokeWidth={1.75} />
            {refLabel}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="flex w-72 flex-col overflow-hidden p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="relative border-b border-border p-1.5">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) go(filtered?.branches[0] ?? filtered?.tags[0] ?? query.trim());
            }}
            placeholder="Find a branch or tag"
            aria-label="Find a branch or tag"
            className="h-8 w-full rounded-md bg-transparent pl-7 pr-2 text-[13px] text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </div>
        <div className="max-h-[min(360px,60dvh)] overflow-y-auto p-1.5">
          {!filtered && !failed ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[12.5px] text-subtle-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading branches and tags…
            </p>
          ) : null}
          {failed ? <p className="px-2 py-3 text-[12.5px] text-subtle-foreground">Branches and tags could not be loaded. Type a name and press Enter.</p> : null}
          {filtered ? (
            <>
              {section("Branches", filtered.branches, GitBranch)}
              {section("Tags", filtered.tags, Tag)}
              {filtered.branches.length + filtered.tags.length === 0 ? <p className="px-2 py-3 text-[12.5px] text-subtle-foreground">No branch or tag matches. Press Enter to try it anyway.</p> : null}
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
