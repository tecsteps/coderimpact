import { useEffect, useMemo, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Loader2, PenLine } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import type { Resolution, SymbolLocation } from "@/lib/lang/semanticIndex";
import { applyRename, validRename } from "@/lib/edit/rename";
import { hasDraft } from "./EditFile";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type Resolved = Extract<Resolution, { status: "resolved" }>;

interface Site {
  loc: SymbolLocation;
  /** Exact matches start checked; name-only matches ("possible") need a look. */
  exact: boolean;
}

const siteId = (l: SymbolLocation) => `${l.path}:${l.line}:${l.col}`;

/** Declarations and usages, exact first, one entry per place. */
function sitesOf(session: RepoSession, resolution: Resolved): Site[] {
  const refs = session.index.references(resolution.key);
  const out = new Map<string, Site>();
  for (const loc of [...resolution.defs, ...refs.defs, ...refs.refs]) out.set(siteId(loc), { loc, exact: true });
  for (const loc of refs.possible) if (!out.has(siteId(loc))) out.set(siteId(loc), { loc, exact: false });
  return [...out.values()];
}

function lineText(session: RepoSession, loc: SymbolLocation): string {
  return session.texts.get(loc.path)?.split("\n")[loc.line - 1]?.trim() ?? "";
}

/**
 * Renames a class, function, constant or variable in every file the index
 * knows it from. Name-only matches start unchecked; files with unsaved edits
 * are left alone. Every file is checked on disk before it is written.
 */
export function RenameDialog({
  session,
  resolution,
  onClose,
  onDone,
}: Readonly<{ session: RepoSession; resolution: Resolved; onClose: () => void; onDone: (message: string) => void }>) {
  const oldName = resolution.name;
  const [name, setName] = useState(oldName);
  const sites = useMemo(() => sitesOf(session, resolution), [session, resolution]);
  const [checked, setChecked] = useState(() => new Set(sites.filter((s) => s.exact).map((s) => siteId(s.loc))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Line previews for files that are indexed but not in memory.
  useEffect(() => {
    [...new Set(sites.map((s) => s.loc.path))].filter((p) => !session.texts.has(p)).slice(0, 40).forEach((p) => session.loadFile(p).catch(() => undefined));
  }, [sites, session]);

  const byFile = useMemo(() => {
    const m = new Map<string, Site[]>();
    for (const s of sites) m.set(s.loc.path, [...(m.get(s.loc.path) ?? []), s]);
    return m;
  }, [sites]);
  const blocked = [...byFile.keys()].filter((p) => hasDraft(session, p));
  const invalid = validRename(oldName, name.trim());
  const count = [...checked].length;

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const apply = async () => {
    setBusy(true);
    setError(null);
    const newName = name.trim();
    let places = 0;
    let files = 0;
    let skipped = 0;
    const failed: string[] = [];
    for (const [path, list] of byFile) {
      const chosen = list.filter((s) => checked.has(siteId(s.loc))).map((s) => s.loc);
      if (!chosen.length || hasDraft(session, path)) continue;
      try {
        const { text } = await session.loadFile(path);
        const r = applyRename(text, chosen, oldName, newName);
        skipped += r.skipped;
        if (r.applied === 0) continue;
        await session.saveFile(path, r.text);
        places += r.applied;
        files++;
      } catch (e) {
        failed.push(`${path.split("/").pop()}: ${e instanceof Error ? e.message : "not saved"}`);
      }
    }
    setBusy(false);
    if (failed.length && !places) {
      setError(failed.join(" "));
      return;
    }
    const extra = [skipped ? `${skipped} changed since indexing, skipped` : "", failed.length ? `${failed.length} files failed` : ""].filter(Boolean).join(", ");
    const suffix = extra ? ` (${extra})` : "";
    onDone(`Renamed ${oldName} to ${newName} in ${places} places across ${files} files${suffix}`);
  };

  return (
    <D.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[70] bg-black/45" />
        <D.Content className="fixed top-1/2 left-1/2 z-[71] flex max-h-[min(640px,calc(100vh-4rem))] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-border bg-surface p-5 text-foreground shadow-pop outline-none">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <PenLine className="size-5" strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <D.Title className="text-[16px] font-semibold">
                Rename <code className="font-mono">{oldName}</code>
              </D.Title>
              <D.Description className="text-[13px] text-muted-foreground">
                Changes are written to the files on disk. Uncheck places that are not this {resolution.kind ?? "symbol"}.
                {resolution.precision === "name" ? " In this language, usages are matched by name, so check the list." : ""}
              </D.Description>
            </div>
          </div>
          <form
            className="flex flex-col gap-3 min-h-0"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid && count && !busy) apply();
            }}
          >
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" className="font-mono" onFocus={(e) => e.currentTarget.select()} />
            {name.trim() !== oldName && invalid ? <p className="text-[12px] text-danger">{invalid}</p> : null}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              {[...byFile.entries()].map(([path, list]) => (
                <section key={path} className="border-b border-border/60 pb-1 last:border-b-0">
                  <p className="sticky top-0 flex items-baseline gap-2 bg-surface px-3 pt-2 pb-1 text-[12.5px] font-medium">
                    {path.split("/").pop()}
                    <span className="min-w-0 truncate font-mono text-[11px] font-normal text-subtle-foreground">{path}</span>
                    {hasDraft(session, path) ? <span className="ml-auto shrink-0 text-[11px] font-normal text-warn">unsaved edits, skipped</span> : null}
                  </p>
                  {list.map(({ loc, exact }) => (
                    <label key={siteId(loc)} className="flex cursor-pointer items-baseline gap-2 px-3 py-1 hover:bg-surface-2">
                      <input type="checkbox" className="translate-y-0.5 accent-[var(--accent)]" checked={checked.has(siteId(loc))} onChange={() => toggle(siteId(loc))} />
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-subtle-foreground">{loc.line}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{lineText(session, loc)}</span>
                      {exact ? null : <span className="shrink-0 text-[11px] text-warn">name match</span>}
                    </label>
                  ))}
                </section>
              ))}
            </div>
            {blocked.length ? <p className="text-[12px] text-subtle-foreground">Files with unsaved edits are skipped. Save or discard them first.</p> : null}
            {error ? <p className="text-[12px] text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={!!invalid || !count || busy}>
                {busy ? <Loader2 className="animate-spin" /> : null} Rename {count} {count === 1 ? "place" : "places"}
              </Button>
            </div>
          </form>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
