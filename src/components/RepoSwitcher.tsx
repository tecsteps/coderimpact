import { useEffect, useState } from "react";
import { Clock, HardDrive, Home } from "lucide-react";
import { encodePath, HASH_ROUTER, navigate } from "@/lib/router";
import { getRecents, timeAgo } from "@/lib/cache/recents";
import { isAppError } from "@/lib/errors";
import { listProjects, type LocalProject } from "@/lib/local/projects";
import { openInput } from "./Landing";
import { OpenLocalFolderButton, openProject } from "./LocalFolder";
import { RepoInput } from "./RepoInput";

/** Switch to another repository or local folder without going back to the start page. */
export function RepoSwitcher({ current, onDone }: Readonly<{ current: { owner: string; repo: string }; onDone: () => void }>) {
  const [error, setError] = useState<string | null>(null);
  const [locals, setLocals] = useState<LocalProject[]>([]);
  useEffect(() => {
    if (!HASH_ROUTER) listProjects().then(setLocals);
  }, []);
  const isCurrent = (owner: string, repo: string) => owner.toLowerCase() === current.owner.toLowerCase() && repo.toLowerCase() === current.repo.toLowerCase();
  const recents = getRecents().filter((r) => r.owner !== "~" && !isCurrent(r.owner, r.repo));
  const otherLocals = locals.filter((p) => !isCurrent("~", p.slug));
  const go = (fn: () => void) => {
    fn();
    onDone();
  };

  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left active:bg-surface-2 hover:bg-surface-2 cursor-pointer";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-4">
      <RepoInput
        inline
        onError={setError}
        onOpen={(v) => {
          try {
            go(() => openInput(v));
          } catch (err) {
            setError(isAppError(err) ? err.message : "That does not look like a GitHub repository.");
          }
        }}
        placeholder="owner/repo, URL or a name"
      />
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {!HASH_ROUTER ? <OpenLocalFolderButton onError={setError} className="w-full" /> : null}

      {otherLocals.length > 0 ? (
        <section className="flex flex-col">
          <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Local folders</h3>
          {otherLocals.map((p) => (
            <button key={p.id} type="button" className={row} onClick={() => go(() => openProject(p))}>
              <HardDrive className="size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate font-mono text-[14px] text-foreground">{p.name}</span>
            </button>
          ))}
        </section>
      ) : null}

      {recents.length > 0 ? (
        <section className="flex flex-col">
          <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Recent</h3>
          {recents.map((r) => (
            <button
              key={`${r.owner}/${r.repo}`}
              type="button"
              className={row}
              onClick={() => go(() => navigate(r.path ? `/${r.owner}/${r.repo}/blob/${r.sha}/${encodePath(r.path)}` : `/${r.owner}/${r.repo}/tree/${r.sha}`))}
            >
              <Clock className="size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate font-mono text-[14px] text-foreground">
                {r.owner}/{r.repo}
              </span>
              <span className="shrink-0 text-[12px] text-subtle-foreground">{timeAgo(r.openedAt)}</span>
            </button>
          ))}
        </section>
      ) : null}

      <button type="button" className={row} onClick={() => go(() => navigate("/"))}>
        <Home className="size-4 shrink-0 text-subtle-foreground" strokeWidth={1.75} />
        <span className="text-[14px] text-foreground">Start page</span>
      </button>
    </div>
  );
}
