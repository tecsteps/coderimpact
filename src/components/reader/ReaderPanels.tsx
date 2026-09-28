import { useRef } from "react";
import { RefSwitcher } from "./RefSwitcher";
import { isLocalOwner } from "@/lib/local/projects";
import { ChevronDown, ListTree, X } from "lucide-react";
import type { LineRange } from "@/lib/github/parseGithubUrl";
import type { RepoSession } from "@/lib/session";
import type { FileIndex } from "@/lib/lang/types";
import { updateSettings } from "@/lib/cache/settings";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { SettingsMenu } from "../SettingsMenu";
import { RepoSwitcher } from "../RepoSwitcher";
import { ProjectGitHubLink } from "../ProjectGitHubLink";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { SheetContent } from "../ui/sheet";
import { Button } from "../ui/button";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { SymbolsPanel } from "./SymbolsPanel";
import { RefsPanel, type SymbolSelection } from "./RefsPanel";
import { ExplainOptions } from "./ExplainOptions";
import { CodeSizeControl, MarkdownToggle, ThemeBadge, WrapToggle } from "./FileToolbar";
import type { MobilePanel } from "./MobileBar";
import type { ExplainRequest } from "./types";

export type SheetPanel = MobilePanel | "refs";
export type SidebarTab = "files" | "search" | "symbols";
export type RefsTab = { tab: "definition" | "references" | "callers"; n: number };
type OpenLocation = (path: string, line: number, opts?: { query?: string; pushBack?: boolean }) => void;

/** The phone header: the Files button, the open file name, and view controls. */
export function MobileHeader({
  owner,
  repo,
  path,
  isDir,
  image,
  markdown,
  showRendered,
  filesOpen,
  onOpenFiles,
  onMarkdownView,
}: Readonly<{
  owner: string;
  repo: string;
  path: string;
  isDir: boolean;
  image: boolean;
  markdown: boolean;
  showRendered: boolean;
  filesOpen: boolean;
  onOpenFiles: () => void;
  onMarkdownView: (v: "rendered" | "source") => void;
}>) {
  const fileName = path ? path.split("/").pop() : "Files";
  const isFile = !isDir;
  return (
    <header className="pt-safe flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-1.5">
      <Button variant="ghost" size="icon" aria-label="Files" aria-expanded={filesOpen} onClick={onOpenFiles}>
        <ListTree strokeWidth={1.75} />
      </Button>
      <button
        type="button"
        onClick={onOpenFiles}
        className="flex min-w-0 flex-1 items-center gap-1 text-left text-[14px] cursor-pointer"
        aria-label={`${owner}/${repo}, ${path || "root"}. Open files`}
      >
        <span className="truncate text-muted-foreground">{repo} /</span>
        <span className="truncate font-medium text-foreground">{fileName}</span>
        <ChevronDown className="size-3.5 shrink-0 text-subtle-foreground" />
      </button>
      {markdown && isFile ? <MarkdownToggle showRendered={showRendered} onMarkdownView={onMarkdownView} /> : null}
      {isFile && !image ? <WrapToggle disabled={showRendered} /> : null}
      <ThemeSwitcher />
      <SettingsMenu
        codeOptions={
          <>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Code</h3>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-muted-foreground">Theme</span>
              <ThemeBadge showLabel />
            </div>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-muted-foreground">Text size</span>
              <CodeSizeControl />
            </div>
          </>
        }
      />
      <ProjectGitHubLink />
    </header>
  );
}

const SHEET_TITLES: Partial<Record<SheetPanel, string>> = { repos: "Switch repository", search: "Search", explain: "Explain" };

function sheetTitle(panel: SheetPanel, owner: string, repo: string, selection: SymbolSelection | null): string {
  if (panel === "files") return `${owner}/${repo}`;
  const fixed = SHEET_TITLES[panel];
  if (fixed) return fixed;
  if (panel === "refs" && selection) return selection.name.replace(/^\$/, "").split(/\\|::/).pop() || "Symbol";
  return "Outline";
}

interface SheetProps {
  panel: SheetPanel;
  owner: string;
  repo: string;
  session: RepoSession;
  path: string;
  isDir: boolean;
  refLabel: string;
  selection: SymbolSelection | null;
  refsTab: RefsTab;
  searchRequest: { query: string; n: number } | null;
  lines: string[];
  focus?: LineRange;
  fileIndex: FileIndex | null;
  familiar: string[];
  onExplain: (req: ExplainRequest) => void;
  onOpenPath: (path: string, kind: "blob" | "tree") => void;
  onOpenLocation: OpenLocation;
  onPanel: (panel: SheetPanel | null) => void;
}

/** The phone sheet for one bottom bar action (or the files, or a symbol's usages). */
export function MobileSheet(props: Readonly<SheetProps>) {
  const { panel, owner, repo, selection } = props;
  const compact = panel === "explain" || panel === "repos";
  return (
    <SheetContent title={sheetTitle(panel, owner, repo, selection)} className={compact ? undefined : "h-[calc(var(--app-h,100dvh)*0.9)]"}>
      <MobileSheetBody {...props} />
    </SheetContent>
  );
}

function MobileSheetBody(p: Readonly<SheetProps>) {
  const { panel, session, path, selection } = p;
  switch (panel) {
    case "repos":
      return <RepoSwitcher current={{ owner: p.owner, repo: p.repo }} onDone={() => p.onPanel(null)} />;
    case "files":
      return (
        <>
          <div className="px-3 pb-1">
            {isLocalOwner(p.owner) ? (
              <p className="px-1 font-mono text-[11.5px] text-subtle-foreground">{p.refLabel}</p>
            ) : (
              <RefSwitcher session={session} path={path} isDir={p.isDir} refLabel={p.refLabel} />
            )}
          </div>
          <FileTree session={session} currentPath={path} onOpen={p.onOpenPath} />
        </>
      );
    case "search":
      return (
        <SearchPanel
          key={p.searchRequest?.n ?? 0}
          session={session}
          initialQuery={p.searchRequest?.query}
          onOpen={(file, l, q) => p.onOpenLocation(file, l, { query: q, pushBack: false })}
        />
      );
    case "explain":
      return <ExplainOptions path={path} lines={p.lines} focus={p.focus} fileIndex={p.fileIndex} familiar={p.familiar} onExplain={p.onExplain} />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {panel === "refs" && selection ? (
        <>
          <RefsPanel session={session} selection={selection} requestedTab={p.refsTab} onOpenLocation={(file, l) => p.onOpenLocation(file, l)} />
          {p.isDir ? null : (
            <button
              type="button"
              onClick={() => p.onPanel("symbols")}
              className="mx-3 mb-3 flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-[14px] text-foreground active:bg-surface-2 cursor-pointer"
            >
              <ListTree className="size-4 text-muted-foreground" strokeWidth={1.75} /> Outline of this file
            </button>
          )}
        </>
      ) : (
        <SymbolsPanel session={session} path={p.isDir ? "" : path} currentLine={p.focus?.start} onJump={(l) => p.onOpenLocation(path, l, { pushBack: false })} />
      )}
    </div>
  );
}

/** The desktop sidebar: Files, Search and Symbols tabs, resizable. */
export function ReaderSidebar({
  session,
  path,
  isDir,
  focus,
  tab,
  onTab,
  searchRequest,
  width,
  onOpenPath,
  onOpenLocation,
}: Readonly<{
  session: RepoSession;
  path: string;
  isDir: boolean;
  focus?: LineRange;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  searchRequest: { query: string; n: number } | null;
  width: number;
  onOpenPath: (path: string, kind: "blob" | "tree") => void;
  onOpenLocation: OpenLocation;
}>) {
  return (
    <aside className="relative flex shrink-0 flex-col border-r border-border bg-surface" style={{ width }} aria-label="Repository">
      <Tabs value={tab} onValueChange={(v) => onTab(v as SidebarTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="symbols">Symbols</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="flex flex-col data-[state=inactive]:hidden">
          <FileTree session={session} currentPath={path} onOpen={onOpenPath} />
        </TabsContent>
        <TabsContent value="search" className="flex flex-col data-[state=inactive]:hidden">
          <SearchPanel
            key={searchRequest?.n ?? 0}
            session={session}
            initialQuery={searchRequest?.query}
            onOpen={(p, l, q) => onOpenLocation(p, l, { query: q, pushBack: false })}
          />
        </TabsContent>
        <TabsContent value="symbols" className="flex flex-col data-[state=inactive]:hidden">
          <SymbolsPanel session={session} path={isDir ? "" : path} currentLine={focus?.start} onJump={(l) => onOpenLocation(path, l, { pushBack: false })} />
        </TabsContent>
      </Tabs>
      <SidebarResizer width={width} />
    </aside>
  );
}

/** The desktop references drawer on the right. */
export function RefsDrawer({
  session,
  selection,
  refsTab,
  onClose,
  onOpenLocation,
}: Readonly<{ session: RepoSession; selection: SymbolSelection; refsTab: RefsTab; onClose: () => void; onOpenLocation: OpenLocation }>) {
  return (
    <aside aria-label="References" className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface">
      {/* Same height as the file toolbar and the back row, so the lines meet. */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1.5">
        <code className="min-w-0 truncate font-mono text-[13px] font-semibold text-foreground">{selection.name}</code>
        <Button variant="ghost" size="icon-sm" aria-label="Close references" onClick={onClose}>
          <X />
        </Button>
      </div>
      <RefsPanel session={session} selection={selection} requestedTab={refsTab} onOpenLocation={(p, l) => onOpenLocation(p, l)} />
    </aside>
  );
}

/** The drag handle on the sidebar edge; Left and Right arrow keys resize it too. */
function SidebarResizer({ width }: Readonly<{ width: number }>) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <button
      type="button"
      aria-label="Resize sidebar"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") updateSettings({ sidebarWidth: width - 16 });
        if (e.key === "ArrowRight") updateSettings({ sidebarWidth: width + 16 });
      }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        updateSettings({ sidebarWidth: start.current.w + e.clientX - start.current.x });
      }}
      onPointerUp={() => (start.current = null)}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none"
    />
  );
}
