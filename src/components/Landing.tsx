import { modKey } from "@/lib/util/keys";
import { useCallback, useEffect, useState } from "react";
import { BookMarked, Check, Clock, FolderOpen, HardDrive, PanelLeft, Scale, UserRoundCheck, X } from "lucide-react";
import { GitHubMark } from "./reader/TopBar";
import { PROJECT_REPO_URL } from "./ProjectGitHubLink";
import { encodePath, HASH_ROUTER, navigate, readerUrl } from "@/lib/router";
import { listProjects, LOCAL_OWNER, projectFromDrop, removeProject, supportsDirectoryPicker, type LocalProject } from "@/lib/local/projects";
import { parseGithubInput, type LineRange } from "@/lib/github/parseGithubUrl";
import { getRecents, removeRecent, timeAgo, type RecentRepo } from "@/lib/cache/recents";
import { ProjectSwitcher } from "./reader/ProjectSwitcher";
import { isAppError } from "@/lib/errors";
import { baseUrl, loadConfig, type RuntimeConfig } from "@/lib/config";
import { updateSettings, useSettings } from "@/lib/cache/settings";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { LogoMark } from "./icons";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { SettingsMenu } from "./SettingsMenu";
import { RepoInput } from "./RepoInput";
import { ProjectGitHubLink } from "./ProjectGitHubLink";
import { LegalLinks } from "./LegalLinks";
import { openProject, useFolderPicker } from "./LocalFolder";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";
import { cn } from "@/lib/utils";

const EXAMPLES: { repo: string; note: string }[] = [
  { repo: "spf13/cobra", note: "Go" },
  { repo: "slimphp/Slim", note: "PHP" },
  { repo: "sindresorhus/ky", note: "TypeScript" },
  { repo: "psf/requests", note: "Python" },
];


function lineSuffix(lines: LineRange | undefined): string {
  if (!lines) return "";
  if (lines.start === lines.end) return `#L${lines.start}`;
  return `#L${lines.start}-L${lines.end}`;
}

export function openInput(value: string): void {
  const parsed = parseGithubInput(value);
  const lines = lineSuffix(parsed.lines);
  const rest = parsed.kind === "repo" ? "" : `/${parsed.kind}/${encodePath(parsed.refAndPath.join("/"))}`;
  navigate(`/${parsed.owner}/${parsed.repo}${rest}${lines}`);
}

const ITEM_CLASS = "group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[14px] text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer";

type FolderPicker = ReturnType<typeof useFolderPicker>;
type RecentItem = { at: number; local?: LocalProject; repo?: RecentRepo };

/**
 * The repository field is where the start screen begins: focus it once the page is drawn,
 * when the tab comes back, and when someone starts typing anywhere on the page.
 */
function useStartFieldFocus(isMobile: boolean) {
  useEffect(() => {
    if (isMobile) return;
    const field = () => document.querySelector<HTMLInputElement>('main input[role="combobox"]');
    const focusField = () => {
      const a = document.activeElement;
      if (a && a !== document.body && a.tagName !== "MAIN") return;
      field()?.focus();
    };
    const raf = requestAnimationFrame(focusField);
    const onType = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      if (isEditingElement(document.activeElement as HTMLElement | null)) return;
      field()?.focus();
    };
    window.addEventListener("focus", focusField);
    window.addEventListener("keydown", onType, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("focus", focusField);
      window.removeEventListener("keydown", onType, true);
    };
  }, [isMobile]);
}

function isEditingElement(a: HTMLElement | null): boolean {
  if (!a) return false;
  return a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable || Boolean(a.closest("[role=dialog]"));
}

/** Cmd/Ctrl+O opens a local folder, like opening a file in an editor. */
function useOpenFolderShortcut(localEnabled: boolean, picker: FolderPicker) {
  useEffect(() => {
    if (!localEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        picker.open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [localEnabled, picker]);
}

/** One recent list: local folders and repositories, newest first, six at most. */
function mergeRecents(locals: LocalProject[], recents: RecentRepo[]): RecentItem[] {
  const items: RecentItem[] = [
    ...locals.map((p) => ({ at: p.addedAt, local: p })),
    ...recents.filter((r) => r.owner !== "~").map((r) => ({ at: r.openedAt, repo: r })),
  ];
  return items.toSorted((a, b) => b.at - a.at).slice(0, 6);
}

function recentRepoHref(r: RecentRepo): string {
  if (r.path) return `/${r.owner}/${r.repo}/blob/${r.sha}/${encodePath(r.path)}`;
  return `/${r.owner}/${r.repo}/tree/${r.sha}`;
}

function snapshotDemo(snapshots: { owner: string; repo: string }[] | null): string | null {
  if (!snapshots) return null;
  const names = snapshots.map((s) => s.owner + "/" + s.repo).join(" and ");
  return `Demo with snapshots of ${names}.`;
}

function dropCardLabel(busy: boolean, dragging: boolean): string {
  if (busy) return "Reading folder…";
  return dragging ? "Drop it" : "Drag a project folder here";
}

function dropHandlers(localEnabled: boolean, setDragging: (v: boolean) => void, setError: (v: string | null) => void) {
  if (!localEnabled) return {};
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      projectFromDrop(e.dataTransfer.items)
        .then((r) => {
          if (!r) return;
          if (r.open) navigate(readerUrl(LOCAL_OWNER, r.project.slug, r.project.id, r.open, "blob"));
          else openProject(r.project);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
  };
}

/** The ways to open a local folder: a drop card where there is no folder picker, a button otherwise. */
function LocalFolderEntry({ dropFirst, dragging, isMobile, picker }: Readonly<{ dropFirst: boolean; dragging: boolean; isMobile: boolean; picker: FolderPicker }>) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3 text-[12px] text-subtle-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      {dropFirst ? (
        // Without the folder picker (Brave, Firefox, Safari) the browser's folder input asks to
        // "upload" everything; dragging a folder in asks nothing, so it is the main way in.
        <div
          className={cn(
            "drop-card group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border-2 border-dashed px-3.5 py-3 text-left transition-all duration-200",
            dragging
              ? "scale-[1.01] border-solid border-accent shadow-[0_10px_30px_-12px_color-mix(in_srgb,var(--accent)_45%,transparent)]"
              : "border-accent/30 hover:border-accent/55",
          )}
        >
          {/* Folder with two file cards fanned out behind it. */}
          <div aria-hidden className="relative h-11 w-14 shrink-0">
            <span className="absolute top-0 left-1 h-8 w-6 -rotate-[14deg] rounded border border-border-strong bg-surface shadow-sm transition-transform duration-300 group-hover:-rotate-[20deg]" />
            <span className="absolute top-0 right-1 h-8 w-6 rotate-[14deg] rounded border border-border-strong bg-surface shadow-sm transition-transform duration-300 group-hover:rotate-[20deg]" />
            <span className="absolute inset-x-2 bottom-0 flex h-7 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow">
              <FolderOpen className="size-4" strokeWidth={2} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-foreground">{dropCardLabel(picker.busy, dragging)}</p>
            <p className="text-[12px] text-subtle-foreground">Read in this browser. Nothing is uploaded.</p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 bg-surface/80" onClick={picker.open} disabled={picker.busy}>
            Choose folder
          </Button>
        </div>
      ) : (
        <Button variant="outline" className="h-10 w-full justify-center gap-2 text-[13.5px]" onClick={picker.open} disabled={picker.busy}>
          <FolderOpen strokeWidth={1.75} />
          {picker.busy ? "Reading folder…" : "Open a local folder"}
          {isMobile ? null : <kbd className="ml-1 rounded border border-border px-1.5 font-sans text-[11px] font-normal text-subtle-foreground">{modKey("O")}</kbd>}
        </Button>
      )}
      {picker.element}
    </div>
  );
}

function RecentList({
  items,
  examples,
  onLocalsChange,
  onRecentsChange,
}: Readonly<{
  items: RecentItem[];
  examples: { repo: string; note: string }[];
  onLocalsChange: (locals: LocalProject[]) => void;
  onRecentsChange: (recents: RecentRepo[]) => void;
}>) {
  const shownLocals = items.flatMap((i) => (i.local ? [i.local] : []));
  const recentRepos = items.flatMap((i) => (i.repo ? [i.repo] : []));
  return (
    <nav aria-label="Recent" className="flex w-full flex-col">

      {shownLocals.map((p) => (
        <div key={p.id} className="group relative">
          <button type="button" className={ITEM_CLASS} onClick={() => openProject(p)}>
            <HardDrive className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[12px] text-subtle-foreground group-hover:opacity-0">{timeAgo(p.addedAt)}</span>
          </button>
          <ForgetButton
            label={`Forget ${p.name}`}
            onClick={async () => {
              await removeProject(p.id);
              removeRecent("~", p.slug);
              onLocalsChange(await listProjects());
            }}
          />
        </div>
      ))}

      {recentRepos.map((r) => (
        <div key={`${r.owner}/${r.repo}`} className="group relative">
          <button type="button" className={ITEM_CLASS} onClick={() => navigate(recentRepoHref(r))}>
            <Clock className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate font-mono text-[13.5px]">
              {r.owner}/{r.repo}
            </span>
            <span className="shrink-0 text-[12px] text-subtle-foreground group-hover:opacity-0">{timeAgo(r.openedAt)}</span>
          </button>
          <ForgetButton
            label={`Remove ${r.owner}/${r.repo} from recent`}
            onClick={() => {
              removeRecent(r.owner, r.repo);
              onRecentsChange(getRecents());
            }}
          />
        </div>
      ))}

      {items.length === 0
        ? examples.map((ex) => (
            <button key={ex.repo} type="button" className={ITEM_CLASS} onClick={() => navigate(`/${ex.repo}`)}>
              <BookMarked className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate font-mono text-[13.5px]">{ex.repo}</span>
              <span className="shrink-0 text-[12px] text-subtle-foreground">{ex.note}</span>
            </button>
          ))
        : null}
    </nav>
  );
}

function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-background/85 backdrop-blur-sm">
      <p className="flex items-center gap-2 text-[15px] font-medium text-foreground">
        <FolderOpen className="size-5 text-accent" /> Drop a folder or files to read them
      </p>
    </div>
  );
}

/** Phone layout: a compact top bar (with recent projects, if any) and the welcome. */
function MobileLanding({ welcome, dropProps, overlay }: Readonly<{ welcome: React.ReactNode; dropProps: React.HTMLAttributes<HTMLDivElement>; overlay: React.ReactNode }>) {
  return (
    <div className="flex h-full flex-col" {...dropProps}>
      <header className="pt-safe flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
        <span className="flex shrink-0 items-center gap-2 px-1 text-[15px] font-medium text-foreground">
          <LogoMark className="size-6" /> CoderImpact
        </span>
        <div className="flex min-w-0 flex-1">{getRecents().length ? <ProjectSwitcher label="Recent" /> : null}</div>
        <ThemeSwitcher />
        <SettingsMenu />
        <ProjectGitHubLink />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{welcome}</main>
      {overlay}
    </div>
  );
}

/** Desktop layout: the editor's top bar and sidebar around the welcome. */
function DesktopLanding({ welcome, dropProps, overlay }: Readonly<{ welcome: React.ReactNode; dropProps: React.HTMLAttributes<HTMLDivElement>; overlay: React.ReactNode }>) {
  const settings = useSettings();
  const sidebarLabel = settings.sidebarOpen ? "Hide sidebar" : "Show sidebar";
  return (
    <div className="flex h-full flex-col" {...dropProps}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
        <Tooltip content={sidebarLabel}>
          <Button variant="ghost" size="icon" aria-label={sidebarLabel} aria-pressed={settings.sidebarOpen} onClick={() => updateSettings({ sidebarOpen: !settings.sidebarOpen })}>
            <PanelLeft strokeWidth={1.75} />
          </Button>
        </Tooltip>
        <span className="flex items-center gap-2 px-1 text-[13px] font-medium text-foreground">
          <LogoMark className="size-5" /> CoderImpact
        </span>
        {getRecents().length ? <ProjectSwitcher label="Recent projects" /> : <span className="text-[13px] text-subtle-foreground">No repository open</span>}
        <div className="ml-auto flex items-center gap-1">
          <ThemeSwitcher />
          <SettingsMenu />
          <ProjectGitHubLink />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {settings.sidebarOpen ? (
          <aside className="flex shrink-0 flex-col border-r border-border bg-surface" style={{ width: settings.sidebarWidth }} aria-label="Repository">
            <div className="flex h-10 items-end gap-4 border-b border-border px-3 text-[13px]">
              {["Files", "Search", "Symbols"].map((t, i) => (
                <span key={t} className={cn("pb-2", i === 0 ? "border-b-2 border-accent font-medium text-foreground" : "text-subtle-foreground")}>
                  {t}
                </span>
              ))}
            </div>
            {/* A quiet placeholder where the tree will be. */}
            <div className="flex flex-col items-center px-6 pt-[12vh]">
              <img src={baseUrl("illustrations/tree-empty-light.webp")} alt="" aria-hidden className="w-[min(130px,55%)] dark:hidden" width={628} height={806} />
              <img src={baseUrl("illustrations/tree-empty-dark.webp")} alt="" aria-hidden className="hidden w-[min(130px,55%)] dark:block" width={626} height={808} />
            </div>
          </aside>
        ) : null}
        {/* Balance the sidebar on wide screens, so the welcome sits in the middle of the window. */}
        <main
          className="flex min-w-0 flex-1 overflow-y-auto xl:pr-[var(--balance)]"
          style={{ "--balance": settings.sidebarOpen ? `${settings.sidebarWidth}px` : "0px" } as React.CSSProperties}
          aria-label="Start"
        >
          <div className="m-auto w-full">{welcome}</div>
        </main>
      </div>
      {overlay}
    </div>
  );
}

/**
 * The start page is the editor itself, empty: the usual top bar and sidebar,
 * and in the code area a quiet welcome (in the spirit of Excalidraw's) to
 * open a repository, a local folder or something recent.
 */
export function Landing() {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [recents, setRecents] = useState<RecentRepo[]>(() => getRecents());
  const [locals, setLocals] = useState<LocalProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const localEnabled = !HASH_ROUTER;
  const picker = useFolderPicker(openProject);
  const dropFirst = localEnabled && !isMobile && !supportsDirectoryPicker();

  useEffect(() => {
    loadConfig().then(setConfig);
    if (localEnabled) listProjects().then(setLocals);
  }, [localEnabled]);
  useEffect(() => {
    setError(picker.error);
  }, [picker.error]);
  useStartFieldFocus(isMobile);
  useOpenFolderShortcut(localEnabled, picker);

  const snapshots = config?.source.kind === "snapshot" ? config.source.snapshots : null;
  const examples = snapshots ? snapshots.map((s) => ({ repo: `${s.owner}/${s.repo}`, note: s.language })) : EXAMPLES;
  const recentItems = mergeRecents(locals, recents);

  const submit = useCallback((v: string) => {
    try {
      setError(null);
      openInput(v);
    } catch (e) {
      setError(isAppError(e) ? e.message : "That does not look like a GitHub repository.");
    }
  }, []);

  const welcome = (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-5 py-10">
      <Hero demo={snapshotDemo(snapshots)} />

      <div className="w-full">
        <RepoInput autoFocus={!isMobile} size="lg" emphasis onOpen={submit} onError={setError} label="Explore any open source codebase" placeholder="owner/repo, GitHub URL or a name" />
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {localEnabled ? <LocalFolderEntry dropFirst={dropFirst} dragging={dragging} isMobile={isMobile} picker={picker} /> : null}

      <RecentList items={recentItems} examples={examples} onLocalsChange={setLocals} onRecentsChange={setRecents} />

      {localEnabled && !isMobile && !dropFirst ? (
        <p className="text-center text-[12px] text-subtle-foreground">Or drop a folder or files anywhere. They are read in this browser and never uploaded.</p>
      ) : null}

      <LegalLinks className="pt-4" />
    </div>
  );

  const dropProps = dropHandlers(localEnabled, setDragging, setError);
  const dropOverlay = dragging ? <DropOverlay /> : null;

  if (isMobile) return <MobileLanding welcome={welcome} dropProps={dropProps} overlay={dropOverlay} />;
  return <DesktopLanding welcome={welcome} dropProps={dropProps} overlay={dropOverlay} />;
}

function ForgetButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-subtle-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 cursor-pointer"
    >
      <X className="size-3.5" />
    </button>
  );
}

const HERO_POINTS = [
  "IntelliSense for 15 languages, like Go, TypeScript and Python",
  "Any line explained by AI, only when you ask",
  "Privacy first: your code stays in your browser",
];

/** The start screen headline: what it is, who it is for, what it does. */
function Hero({ demo }: Readonly<{ demo: string | null }>) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
        <LogoMark className="size-6" /> CoderImpact
      </span>
      <h1 className="flex flex-col items-center gap-1">
        <span className="text-balance text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[36px]">Lightweight IDE in your browser</span>
        <span className="bg-gradient-to-r from-accent to-[#8839ef] bg-clip-text text-[19px] font-medium tracking-[-0.01em] text-transparent sm:text-[22px] dark:to-[#c6a0f6]">
          For humans who want to understand code
        </span>
      </h1>
      <ul className="flex flex-col items-start gap-1.5 text-left text-[14px] text-muted-foreground">
        {(demo ? [demo] : HERO_POINTS).map((p) => (
          <li key={p} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={2.25} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {demo ? null : (
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12.5px] text-subtle-foreground" aria-label="About CoderImpact">
          <li className="inline-flex items-center">
            <a href={PROJECT_REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <GitHubMark className="size-3.5" /> Open source on GitHub
            </a>
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Scale className="size-3.5" strokeWidth={1.75} /> MIT license
          </li>
          <li className="inline-flex items-center gap-1.5">
            <UserRoundCheck className="size-3.5" strokeWidth={1.75} /> No sign-up, free to use
          </li>
        </ul>
      )}
    </div>
  );
}
