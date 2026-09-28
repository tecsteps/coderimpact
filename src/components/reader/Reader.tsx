import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LineRange, ParsedRepoUrl } from "@/lib/github/parseGithubUrl";
import { absoluteUrl, currentHref, HASH_ROUTER, navigate, readerUrl, replaceLines, useBackToClose } from "@/lib/router";
import { manifestEcosystem, parseDependencies } from "@/lib/deps";
import { refNameFor, rememberRefName, useRepository } from "@/lib/sessions";
import type { RepoSession } from "@/lib/session";
import type { ResolvedRepo } from "@/lib/github/source";
import { githubUrl as githubLink } from "@/lib/github/source";
import { getSettings, updateSettings, useSettings } from "@/lib/cache/settings";
import { semanticLanguageFor } from "@/lib/util/files";
import { useSessionVersion } from "@/hooks/useSession";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useOnline } from "@/hooks/useOnline";
import { useRateLimit } from "@/hooks/useRateLimit";
import { LogoMark } from "../icons";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { ErrorState } from "../ErrorState";
import { Sheet } from "../ui/sheet";
import type { SymbolSelection } from "./RefsPanel";
import { IndexPill, TopBar } from "./TopBar";
import { MobileBar, type MobilePanel } from "./MobileBar";
import { isMarkdownPath } from "./MarkdownView";
import { AiConsentDialog } from "../AiConsentDialog";
import { ProjectGitHubLink } from "../ProjectGitHubLink";
import { useFocusMode } from "@/lib/focusMode";
import { OpeningRepository } from "./OpeningRepository";
import { GlobalSearch, useDoubleShift, type GlobalSearchHandle } from "./GlobalSearch";
import { Breadcrumbs } from "./Breadcrumbs";
import { isLocalOwner } from "@/lib/local/projects";
import { LocalAccessActions } from "../LocalFolder";
import type { Resolution } from "@/lib/lang/semanticIndex";
import { SymbolMenu, type SymbolAction, type SymbolMenuAnchor } from "./SymbolMenu";
import { RenameDialog } from "./RenameDialog";
import { useDependencyMenu } from "./DependencyMenu";
import { useCanEdit } from "./EditFile";
import type { Annotation, ExplainRequest } from "./types";
import { BackLink, ReaderBanners, ReaderMain, Toast } from "./ReaderMain";
import { MobileHeader, MobileSheet, ReaderSidebar, RefsDrawer, type RefsTab, type SheetPanel, type SidebarTab } from "./ReaderPanels";
import { useExplanations } from "./useExplanations";
import {
  useBackStack,
  useCloseOnScroll,
  useLocalLiveUpdates,
  useNewerCommit,
  usePinnedUrl,
  useReaderFile,
  useRecentAndTitle,
  useRevealCounter,
  useSymbolHighlights,
  useToast,
  useRefDisplay,
  type RefDisplay,
} from "./readerHooks";

type Resolved = Extract<Resolution, { status: "resolved" }>;

/** What F2 renames: the clicked name, when the index knows where it is declared. */
function renameTarget(session: RepoSession, selection: SymbolSelection): Resolved | null {
  const r = session.index.resolveOccurrence(selection.path, selection.index);
  return r.status === "resolved" && r.defs.length ? r : null;
}

/** Local folders: the rename dialog, opened from the symbol menu or with F2. */
function useRename(session: RepoSession, canEdit: boolean, showToast: (msg: string) => void) {
  const [renaming, setRenaming] = useState<Resolved | null>(null);
  const start = useCallback(
    (selection: SymbolSelection) => {
      if (!canEdit) return;
      const target = renameTarget(session, selection);
      if (target) setRenaming(target);
      else showToast("Only names declared in this folder can be renamed.");
    },
    [session, canEdit, showToast],
  );
  const dialog = renaming ? (
    <RenameDialog
      session={session}
      resolution={renaming}
      onClose={() => setRenaming(null)}
      onDone={(msg) => {
        setRenaming(null);
        showToast(msg);
      }}
    />
  ) : null;
  return useMemo(() => ({ start, open: setRenaming, dialog }), [start, dialog]);
}

/** The branch badge: just the branch at its latest commit, the short hash for any older commit. */
function refLabelOf({ name, latest }: RefDisplay, sha: string, local: boolean): string {
  if (local) return "local folder";
  if (!name) return sha.slice(0, 7);
  return latest === false ? `${name} @ ${sha.slice(0, 7)}` : name;
}

/** One shared empty list, so the memoized code view is not re-rendered for a new []. */
const NO_ANNOTATIONS: Annotation[] = [];
const annotationsOf = (all: Record<string, Annotation[]>, path: string) => all[path] ?? NO_ANNOTATIONS;

export function Reader({ parsed }: Readonly<{ parsed: ParsedRepoUrl }>) {
  const state = useRepository(parsed);
  if (state.status === "loading") {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 items-center gap-3 border-b border-border bg-surface px-3">
          <LogoMark className="size-5 text-foreground" />
          <span className="text-[13px] font-medium text-foreground">
            {parsed.owner}/{parsed.repo}
          </span>
          <ProjectGitHubLink className="ml-auto" />
        </header>
        <OpeningRepository owner={parsed.owner} repo={parsed.repo} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 items-center gap-3 border-b border-border bg-surface px-3">
          <button type="button" onClick={() => navigate("/")} aria-label="CoderImpact home" className="rounded p-1 hover:bg-surface-2 cursor-pointer">
            <LogoMark className="size-5 text-foreground" />
          </button>
          <span className="text-[13px] font-medium text-foreground">
            {parsed.owner}/{parsed.repo}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeSwitcher />
            <ProjectGitHubLink />
          </div>
        </header>
        <ErrorState
          error={state.error}
          onRetry={state.retry}
          githubUrl={state.error.kind === "not-found" || isLocalOwner(parsed.owner) ? undefined : `https://github.com/${parsed.owner}/${parsed.repo}`}
          onPickCandidate={(ref) => {
            const rest = parsed.refAndPath.join("/").slice(ref.length).replace(/^\//, "");
            navigate(`/${parsed.owner}/${parsed.repo}/${parsed.kind === "repo" ? "tree" : parsed.kind}/${ref}${rest ? "/" + rest : ""}`);
          }}
        >
          {isLocalOwner(parsed.owner) ? <LocalAccessActions error={state.error} owner={parsed.owner} repo={parsed.repo} /> : null}
        </ErrorState>
      </div>
    );
  }
  return <ReaderReady key={`${state.session.key}#${state.session.instance}`} session={state.session} resolved={state.resolved} parsed={parsed} />;
}

/** The references sheet shows under the Symbols action of the bottom bar. */
function barPanel(panel: SheetPanel | null): MobilePanel | null {
  return panel === "refs" ? "symbols" : panel;
}

function ReaderReady({ session, resolved, parsed }: Readonly<{ session: RepoSession; resolved: ResolvedRepo; parsed: ParsedRepoUrl }>) {
  useSessionVersion(session);
  const settings = useSettings();
  const isMobile = useIsMobile();
  const focusMode = useFocusMode();
  const online = useOnline();
  const rate = useRateLimit();
  const { owner, repo, commitSha } = session.repo;
  const { pinned, path, isDir, image, fileState, retryFile, text, lines, fileIndex } = useReaderFile(session, parsed, resolved);
  const focus = parsed.lines;
  const local = isLocalOwner(owner);
  const semantic = !!semanticLanguageFor(path);
  const markdown = isMarkdownPath(path);
  // A line link (#L28) shows the source so the line is visible; otherwise the remembered choice.
  const showRendered = markdown && settings.markdownView === "rendered" && !focus;

  const [reveal, setReveal] = useRevealCounter(path, fileState.status);
  const [selection, setSelection] = useState<SymbolSelection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<SymbolMenuAnchor | null>(null);
  // Only local folders can be saved; the session knows.
  const canEdit = useCanEdit(session, !isMobile);
  /** Which result tab the references panel should show; `n` re-applies the same tab. */
  const [refsTab, setRefsTab] = useState<RefsTab>({ tab: "references", n: 0 });
  const [searchRequest, setSearchRequest] = useState<{ query: string; n: number } | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [mobilePanel, setMobilePanel] = useState<SheetPanel | null>(null);
  const closeSheet = useCallback(() => setMobilePanel(null), []);
  useBackToClose(isMobile && mobilePanel !== null, closeSheet);
  const [searchQuery, setSearchQuery] = useState<string | undefined>();
  const [toast, showToast] = useToast();
  const rename = useRename(session, canEdit, showToast);
  const [backStack, setBackStack] = useBackStack(path, focus?.start);

  usePinnedUrl(session, resolved, parsed, pinned, path, isDir);
  useRecentAndTitle(owner, repo, commitSha, path, isDir);

  useEffect(() => {
    if (fileState.status === "ready" && semantic) session.focusFile(path);
    else session.startIndexing();
  }, [session, path, fileState.status, semantic]);

  useLocalLiveUpdates(local, session, path, isDir);
  const branch = local ? null : refNameFor(commitSha);
  const [newerSha, setNewerSha] = useNewerCommit(branch, session);

  const openPath = useCallback(
    (p: string, kind: "blob" | "tree") => {
      navigate(readerUrl(owner, repo, commitSha, p, kind));
      setMobilePanel(null);
    },
    [owner, repo, commitSha],
  );

  const openLocation = useCallback(
    (p: string, line: number, opts: { query?: string; pushBack?: boolean } = {}) => {
      if (opts.pushBack !== false) {
        // Capture the current location now: the state updater runs after navigation.
        const from = { path, line: focus?.start, href: currentHref() };
        setBackStack((st) => [...st.slice(-20), from]);
      }
      setSearchQuery(opts.query);
      navigate(readerUrl(owner, repo, commitSha, p, "blob", { start: line, end: line }));
      setReveal((r) => r + 1);
      setMobilePanel(null);
    },
    [owner, repo, commitSha, path, focus?.start, setBackStack, setReveal],
  );

  const onFocus = useCallback((range: LineRange | undefined) => replaceLines(range), []);

  const openRefs = useCallback(
    (tab: "definition" | "references" | "callers") => {
      setRefsTab((t) => ({ tab, n: t.n + 1 }));
      if (isMobile) setMobilePanel("refs");
      else setDrawerOpen(true);
    },
    [isMobile],
  );

  const gotoDefinition = useCallback(
    (sel: SymbolSelection) => {
      const r = session.index.resolveOccurrence(sel.path, sel.index);
      if (r.status === "resolved" && r.defs[0]) {
        openLocation(r.defs[0].path, r.defs[0].line);
        return;
      }
      // Not indexed yet: fetch exactly the declaring file, then jump.
      session.resolveDeep(sel.path, sel.index).then((deep) => {
        if (deep.status === "resolved" && deep.defs[0]) openLocation(deep.defs[0].path, deep.defs[0].line);
        else openRefs("definition");
      });
    },
    [session, openLocation, openRefs],
  );

  const onSymbol = useCallback(
    (line: number, col: number, opts: { goto: boolean; open: boolean; anchor?: SymbolMenuAnchor }) => {
      const hit = session.index.occurrenceAt(path, line, col);
      if (!hit) return false;
      const sel = { path, index: hit.index, name: hit.occ.name, line, col: hit.occ.span.col };
      setSelection(sel);
      if (opts.goto) {
        setMenuAnchor(null);
        gotoDefinition(sel);
        return true;
      }
      // A click opens the action menu; panels open only when an action asks for them.
      if (opts.open && opts.anchor) setMenuAnchor(opts.anchor);
      return true;
    },
    [session, path, gotoDefinition],
  );

  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  useCloseOnScroll(!!menuAnchor && !isMobile, closeMenu);

  const symbolHighlights = useSymbolHighlights(session, selection, path);

  // ---------- Explanations ----------

  const { annotations, runExplain, onAnnotationAction } = useExplanations({
    text,
    path,
    lines,
    fileIndex,
    familiar: settings.familiarLanguages,
    promptTemplates: settings.promptTemplates,
    onFocus,
    onStart: closeSheet,
  });

  // Package manifests: dependency names open their repository in a new tab.
  const dependencies = useMemo(() => (text && manifestEcosystem(path) ? parseDependencies(path, text) : undefined), [path, text]);
  const dependencyMenu = useDependencyMenu();

  // Code leaves the browser only for explanations: ask first, remember a yes, ask again after a no.
  const [pendingExplain, setPendingExplain] = useState<ExplainRequest | null>(null);
  const onExplain = useCallback(
    (req: ExplainRequest) => {
      if (getSettings().aiConsent) runExplain(req);
      else setPendingExplain(req);
    },
    [runExplain],
  );
  const consentDialog = (
    <AiConsentDialog
      open={pendingExplain !== null}
      onAllow={() => {
        updateSettings({ aiConsent: true });
        const req = pendingExplain;
        setPendingExplain(null);
        if (req) runExplain(req);
      }}
      onDecline={() => setPendingExplain(null)}
    />
  );

  const onCopyLink = useCallback(
    async (range: LineRange) => {
      // Inside a claude.ai Artifact only bare anchors survive a shared link: share the GitHub line link.
      const url = HASH_ROUTER ? githubLink(session.repo, path, "blob", range) : absoluteUrl(readerUrl(owner, repo, commitSha, path, "blob", range));
      try {
        await navigator.clipboard.writeText(url);
        showToast("Link copied");
      } catch {
        showToast(url);
      }
    },
    [owner, repo, commitSha, path, showToast, session.repo],
  );

  const onEscape = useCallback(() => {
    setDrawerOpen(false);
    setMenuAnchor(null);
    setSelection(null);
    setSearchQuery(undefined);
  }, []);

  const onKeyCommand = useCallback(
    (cmd: "definition" | "references" | "rename") => {
      if (!selection) {
        showToast("Pick an identifier with the Left and Right arrow keys first.");
        return;
      }
      setMenuAnchor(null);
      if (cmd === "definition") gotoDefinition(selection);
      else if (cmd === "references") openRefs("references");
      else rename.start(selection);
    },
    [selection, gotoDefinition, openRefs, showToast, rename],
  );

  /** Opens the text Search panel with a query (sidebar on desktop, sheet on phones). */
  const showTextSearch = useCallback(
    (query: string) => {
      setSearchRequest((r) => ({ query, n: (r?.n ?? 0) + 1 }));
      if (isMobile) setMobilePanel("search");
      else {
        if (!getSettings().sidebarOpen) updateSettings({ sidebarOpen: true });
        setSidebarTab("search");
      }
    },
    [isMobile],
  );

  const globalSearch = useRef<GlobalSearchHandle>(null);
  useDoubleShift(() => {
    if (!isMobile) globalSearch.current?.focus();
  });

  const onMenuAction = useCallback(
    (a: SymbolAction) => {
      setMenuAnchor(null);
      if (!selection) return;
      switch (a.t) {
        case "definition":
          if (a.resolution.status === "candidates") openRefs("definition");
          else gotoDefinition(selection);
          return;
        case "panel":
          openRefs(a.tab);
          return;
        case "search":
          showTextSearch(a.name);
          return;
        case "explain-line":
          onExplain({ task: "line", line: a.line });
          return;
        case "explain-block":
          onExplain({ task: "declaration", block: a.block });
          return;
        case "rename":
          rename.open(a.resolution);
          return;
        case "copy":
          navigator.clipboard.writeText(a.name).then(
            () => showToast(`Copied ${a.name}`),
            () => showToast(a.name),
          );
          return;
      }
    },
    [selection, openRefs, gotoDefinition, onExplain, showToast, showTextSearch],
  );

  const onMarkdownView = useCallback(
    (v: "rendered" | "source") => {
      updateSettings({ markdownView: v });
      if (v === "rendered" && focus) onFocus(undefined);
    },
    [focus, onFocus],
  );

  const refDisplay = useRefDisplay(session, local);
  const refLabel = refLabelOf(refDisplay, commitSha, local);
  const githubUrl = githubLink(session.repo, path, isDir ? "tree" : "blob", focus);

  // ---------- Layout pieces ----------

  const banners = (
    <ReaderBanners
      online={online}
      branch={branch}
      newerSha={newerSha}
      rate={rate}
      onUpdate={(sha, name) => {
        rememberRefName(sha, name);
        setNewerSha(null);
        navigate(readerUrl(owner, repo, sha, path, isDir ? "tree" : "blob", focus));
      }}
      onDismiss={() => setNewerSha(null)}
    />
  );

  const backLink = (
    <BackLink
      backStack={backStack}
      onBack={() => {
        setBackStack((s) => s.slice(0, -1));
        window.history.back();
      }}
    />
  );

  const main = (
    <ReaderMain
      session={session}
      path={path}
      isDir={isDir}
      image={image}
      fileState={fileState}
      retryFile={retryFile}
      githubUrl={githubUrl}
      refLabel={refLabel}
      isMobile={isMobile}
      onBrowse={() => setMobilePanel("files")}
      onOpenPath={openPath}
      file={{
        session,
        path,
        isMobile,
        local,
        semantic,
        markdown,
        showRendered,
        fileIndex,
        focus,
        revealKey: `${path}:${reveal}`,
        annotations: annotationsOf(annotations, path),
        symbolHighlights,
        searchQuery,
        dependencies,
        showToast,
        onMarkdownView,
        onFocus,
        onExplain,
        onSymbol,
        onAnnotationAction,
        onCopyLink,
        onEscape,
        onKeyCommand,
        onDependency: dependencyMenu.onDependency,
      }}
    />
  );

  const symbolMenu = (
    <SymbolMenu
      session={session}
      selection={menuAnchor ? selection : null}
      anchor={menuAnchor}
      isMobile={isMobile}
      canRename={canEdit}
      onOpenChange={(o) => !o && setMenuAnchor(null)}
      onAction={onMenuAction}
    />
  );


  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        <MobileHeader
          owner={owner}
          repo={repo}
          path={path}
          isDir={isDir}
          image={image}
          markdown={markdown}
          showRendered={showRendered}
          filesOpen={mobilePanel === "files"}
          onOpenFiles={() => setMobilePanel("files")}
          onMarkdownView={onMarkdownView}
        />
        {banners}
        {backLink}
        <main className="relative flex min-h-0 flex-1 flex-col">
          {main}
          <IndexPill session={session} compact floating />
        </main>
        <div className="shrink-0 border-t border-border bg-surface px-2 py-1">
          <Breadcrumbs owner={owner} repo={repo} commit={commitSha} path={path} isDir={isDir} compact />
        </div>
        <MobileBar active={barPanel(mobilePanel)} symbolBadge={!!selection} onOpen={(p) => setMobilePanel(p === "symbols" && selection ? "refs" : p)} />
        <Sheet open={mobilePanel !== null} onOpenChange={(o) => !o && setMobilePanel(null)}>
          {mobilePanel ? (
            <MobileSheet
              panel={mobilePanel}
              owner={owner}
              repo={repo}
              session={session}
              path={path}
              isDir={isDir}
              refLabel={refLabel}
              selection={selection}
              refsTab={refsTab}
              searchRequest={searchRequest}
              lines={lines}
              focus={focus}
              fileIndex={fileIndex}
              familiar={settings.familiarLanguages}
              onExplain={onExplain}
              onOpenPath={openPath}
              onOpenLocation={openLocation}
              onPanel={setMobilePanel}
            />
          ) : null}
        </Sheet>
        {symbolMenu}
        {dependencyMenu.menu}
      {dependencyMenu.menu}
        {consentDialog}
        <Toast message={toast} />
      </div>
    );
  }

  // ---------- Desktop ----------
  return (
    <div className="flex h-full flex-col">
      {focusMode ? null : (
      <TopBar
        session={session}
        path={path}
        refLabel={refLabel}
        githubUrl={githubUrl}
        sidebarOpen={settings.sidebarOpen}
        onToggleSidebar={() => updateSettings({ sidebarOpen: !settings.sidebarOpen })}
        isDir={isDir}
        search={
          <GlobalSearch
            ref={globalSearch}
            session={session}
            onOpenFile={(p, dir) => openPath(p, dir ? "tree" : "blob")}
            onOpenLocation={(p, l, q) => openLocation(p, l, { query: q })}
            onAllText={showTextSearch}
          />
        }
      />
      )}
      {focusMode ? null : banners}
      <div className="flex min-h-0 flex-1">
        {settings.sidebarOpen && !focusMode ? (
          <ReaderSidebar
            session={session}
            path={path}
            isDir={isDir}
            focus={focus}
            tab={sidebarTab}
            onTab={setSidebarTab}
            searchRequest={searchRequest}
            width={settings.sidebarWidth}
            onOpenPath={openPath}
            onOpenLocation={openLocation}
          />
        ) : null}
        <main className="flex min-w-0 flex-1 flex-col" aria-label="Code">
          {backLink}
          {main}
        </main>
        {drawerOpen && selection && !focusMode ? (
          <RefsDrawer session={session} selection={selection} refsTab={refsTab} onClose={() => setDrawerOpen(false)} onOpenLocation={openLocation} />
        ) : null}
      </div>
      {symbolMenu}
      {dependencyMenu.menu}
      {rename.dialog}
      {consentDialog}
      <Toast message={toast} />
    </div>
  );
}
