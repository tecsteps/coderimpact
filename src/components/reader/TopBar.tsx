import { useEffect, useState } from "react";
import { CircleCheck, ExternalLink, HardDrive, PanelLeft, Pause, Play, RefreshCw } from "lucide-react";
import { ProjectGitHubLink } from "../ProjectGitHubLink";
import { isLocalOwner } from "@/lib/local/projects";
import { reloadRepository } from "@/lib/sessions";
import type { IndexProgress, RepoSession } from "@/lib/session";
import { hrefFor, navigate } from "@/lib/router";
import { useSessionVersion } from "@/hooks/useSession";
import { LogoMark } from "../icons";
import { Breadcrumbs } from "./Breadcrumbs";
import { RefSwitcher } from "./RefSwitcher";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { SettingsMenu } from "../SettingsMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { cn } from "@/lib/utils";

export function GitHubMark(props: Readonly<React.SVGProps<SVGSVGElement>>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
      />
    </svg>
  );
}

const fmt = (n: number) => n.toLocaleString();

/** The pill's text on phones: warming, per-module or repository progress, paused, limited or done. */
function compactIndexLabel(p: IndexProgress, target: number, repoDone: boolean, moduleDone: boolean): string {
  const m = p.module;
  if (p.warming) return `Loading ${fmt(p.indexed)}`;
  if (p.phase === "running" && !moduleDone && m) return `${m.name} ${m.indexed}/${m.total}`;
  if (p.phase === "running") return `${fmt(p.indexed)}/${fmt(target)}`;
  if (p.phase === "paused") return "Paused";
  if (p.phase === "limited") return "Limited";
  return repoDone ? `${fmt(p.indexed)} indexed` : `Indexed ${fmt(p.indexed)} of ${fmt(target)}`;
}

/** The same states, spelled out. */
function fullIndexLabel(p: IndexProgress, target: number, repoDone: boolean, moduleDone: boolean): string {
  const m = p.module;
  if (p.warming) return `Loading cached index: ${fmt(p.indexed)} of ${fmt(target)}`;
  if (p.phase === "running" && !moduleDone && m) return `Indexing ${m.name}: ${m.indexed} of ${m.total}`;
  if (p.phase === "running") return `Indexing ${fmt(p.indexed)} of ${fmt(target)}`;
  if (p.phase === "paused") return `Indexed ${fmt(p.indexed)}, paused`;
  if (p.phase === "limited") return `Indexed ${fmt(p.indexed)}, limited`;
  return repoDone ? `${fmt(p.indexed)} files indexed` : `Indexed ${fmt(p.indexed)} of ${fmt(target)}`;
}

/** Background meta information: muted, pulsing while indexing; paused or limited in the warning color. */
function pillTone(stalled: boolean): string {
  if (stalled) return "text-warn hover:bg-surface-2";
  return "index-pulse text-subtle-foreground hover:bg-surface-2";
}

/** Floating (phones): shown over the code while indexing, fades out shortly after. */
function useHiddenWhenIdle(floating: boolean | undefined, busy: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!floating) return;
    if (busy) {
      setHidden(false);
      return;
    }
    const t = window.setTimeout(() => setHidden(true), 2500);
    return () => window.clearTimeout(t);
  }, [floating, busy]);
  return hidden;
}

function IndexDetails({ session, repoDone, moduleDone }: Readonly<{ session: RepoSession; repoDone: boolean; moduleDone: boolean }>) {
  const p = session.progress;
  const m = p.module;
  let action: React.ReactNode = null;
  if (p.phase === "paused" || p.phase === "limited") {
    action = (
      <Button size="sm" variant="outline" onClick={() => session.resumeIndexing()}>
        <Play /> Resume
      </Button>
    );
  } else if (!repoDone) {
    action = (
      <Button size="sm" variant="outline" onClick={() => session.pauseIndexing()}>
        <Pause /> Pause background indexing
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <h3 className="font-semibold">Semantic index</h3>
      {m ? (
        <p className="text-foreground">
          <span className="font-medium">This module</span> ({m.root || "repository root"}): {fmt(m.indexed)} of {fmt(m.total)} files
          {moduleDone ? ", complete. Definitions, references and callers within it are exact." : "."}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        Repository: {fmt(p.indexed)} of {fmt(p.total)} source files parsed
        {p.total > p.cap ? ` (this device indexes up to ${fmt(p.cap)} in the background)` : ""}
        {p.rate ? `, about ${Math.round(p.rate)} files per second` : ""}. The open file comes first, then the files it uses, its module, then the rest. Definitions of
        classes and packages are fetched directly, without waiting for the rest.
      </p>
      {p.current ? <p className="truncate font-mono text-[11.5px] text-subtle-foreground">Now: {p.current}</p> : null}
      {p.failed ? <p className="text-[12px] text-subtle-foreground">{p.failed} files could not be indexed.</p> : null}
      {p.note ? <p className="text-[12px] text-warn">{p.note}</p> : null}
      <p className="text-[12px] text-subtle-foreground">Everything is parsed and stored in this browser. Unchanged files are never parsed twice, even on other commits.</p>
      <div className="flex gap-2">{action}</div>
    </div>
  );
}

export function IndexPill({ session, compact, floating }: Readonly<{ session: RepoSession; compact?: boolean; floating?: boolean }>) {
  useSessionVersion(session);
  const p = session.progress;
  const busy = p.phase === "running" || !!p.warming;
  const hidden = useHiddenWhenIdle(floating, busy);
  if (p.total === 0) return null;
  const target = Math.min(p.total, p.cap);
  const m = p.module;
  const moduleDone = !m || m.indexed >= m.total;
  const repoDone = p.indexed >= target;
  const label = compact ? compactIndexLabel(p, target, repoDone, moduleDone) : fullIndexLabel(p, target, repoDone, moduleDone);
  const done = !busy && repoDone && moduleDone && p.phase !== "paused" && p.phase !== "limited";
  const stalled = !busy && !done;
  const gone = !!floating && hidden;
  const details = (
    <PopoverContent className="w-80">
      <IndexDetails session={session} repoDone={repoDone} moduleDone={moduleDone} />
    </PopoverContent>
  );
  // Fully indexed: a quiet icon; the tooltip says what it means, a click shows the details.
  if (done && !floating) {
    return (
      <Popover>
        <Tooltip content={`All ${fmt(p.indexed)} files indexed: definitions, usages and callers work across the repository`}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Semantic index: ${label}`}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer"
            >
              <CircleCheck className="size-4" strokeWidth={1.75} />
            </button>
          </PopoverTrigger>
        </Tooltip>
        {details}
      </Popover>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 max-w-[46vw] items-center rounded-md px-2 font-mono text-[11.5px] cursor-pointer tabular-nums transition-colors",
            pillTone(stalled),
            compact && "h-6 px-1.5 text-[11px]",
            floating && "absolute top-2 right-2 z-20 shadow-pop backdrop-blur transition-opacity duration-500",
            floating && "bg-surface/90",
            gone && "pointer-events-none opacity-0",
          )}
          aria-hidden={gone ? true : undefined}
          tabIndex={gone ? -1 : undefined}
          aria-label={`Semantic index: ${label}`}
        >
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      {details}
    </Popover>
  );
}

export function TopBar({
  session,
  path,
  refLabel,
  githubUrl,
  sidebarOpen,
  onToggleSidebar,
  isDir,
  search,
}: Readonly<{
  /** The header search (double Shift). */
  search?: React.ReactNode;
  session: RepoSession;
  path: string;
  isDir: boolean;
  refLabel: string;
  githubUrl: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}>) {
  const { owner, repo, commitSha } = session.repo;
  const local = isLocalOwner(owner);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
      <Tooltip content={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        <Button variant="ghost" size="icon" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={sidebarOpen} onClick={onToggleSidebar}>
          <PanelLeft strokeWidth={1.75} />
        </Button>
      </Tooltip>
      <a
        href={hrefFor("/")}
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
        className="flex items-center rounded-md p-1 hover:bg-surface-2"
        aria-label="Coderimpact home"
      >
        <LogoMark className="size-5 text-foreground" />
      </a>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ProjectSwitcher owner={owner} repo={repo} />
        <span className="shrink-0 text-[13px] text-subtle-foreground">/</span>
        <Breadcrumbs owner={owner} repo={repo} commit={commitSha} path={path} isDir={isDir} className="min-w-0 shrink" />
        {local ? (
          <Tooltip content="Reload the folder (new, changed and deleted files). Read from your disk in this browser; nothing is uploaded.">
            <button
              type="button"
              onClick={() => reloadRepository(owner, repo)}
              aria-label="Local folder: reload"
              className="group inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer"
            >
              <HardDrive className="size-3" strokeWidth={1.75} />
              {refLabel}
              <RefreshCw className="size-3 text-subtle-foreground group-hover:text-foreground" strokeWidth={1.75} />
            </button>
          </Tooltip>
        ) : (
          <RefSwitcher session={session} path={path} isDir={isDir} refLabel={refLabel} />
        )}
      </div>
      {/* Left of the search: its changing width is absorbed by the path, never by the search. */}
      <IndexPill session={session} />
      {search ? <div className="hidden w-[clamp(220px,28vw,380px)] shrink-0 md:block">{search}</div> : null}
      <div className="flex shrink-0 items-center gap-1">
        {!local && githubUrl ? (
          <Tooltip content="Open this on github.com">
            <Button variant="ghost" size="icon" asChild>
              <a href={githubUrl} target="_blank" rel="noreferrer" aria-label="Open this on github.com">
                <ExternalLink strokeWidth={1.75} />
              </a>
            </Button>
          </Tooltip>
        ) : null}
        <ThemeSwitcher />
        <SettingsMenu />
        <ProjectGitHubLink />
      </div>
    </header>
  );
}
