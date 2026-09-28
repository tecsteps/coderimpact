import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CloudOff, GitBranch, Loader2, Timer, X } from "lucide-react";
import type { RateLimitState } from "@/lib/github/client";
import type { BlobResult } from "@/lib/github/source";
import type { RepoSession } from "@/lib/session";
import type { Dependency } from "@/lib/deps";
import type { FileIndex } from "@/lib/lang/types";
import { languageLabel, shikiLanguageFor } from "@/lib/util/files";
import { ErrorState } from "../ErrorState";
import { CodeView, type CodeViewProps } from "./CodeView";
import { FolderView } from "./FolderView";
import { ImageView } from "./ImageView";
import { RepoHome } from "./RepoHome";
import { MarkdownView } from "./MarkdownView";
import { FileToolbar } from "./FileToolbar";
import { EditFile, editBlockedReason, hasDraft, useCanEdit, useEditShortcut } from "./EditFile";
import type { FileState } from "./useFile";
import type { BackEntry } from "./readerHooks";
import type { Annotation } from "./types";
import type { SymbolMenuAnchor } from "./SymbolMenu";

/** Offline, newer commits on the opened branch, and the GitHub rate limit. */
export function ReaderBanners({
  online,
  branch,
  newerSha,
  rate,
  onUpdate,
  onDismiss,
}: Readonly<{
  online: boolean;
  branch: string | null;
  newerSha: string | null;
  rate: RateLimitState | null;
  onUpdate: (sha: string, branch: string) => void;
  onDismiss: () => void;
}>) {
  return (
    <>
      {online ? null : (
        <output className="flex items-center gap-2 border-b border-border bg-warn-soft px-4 py-1.5 text-[12.5px] text-foreground">
          <CloudOff className="size-3.5 text-warn" /> You are offline. Files you already opened still work.
        </output>
      )}
      {newerSha && branch ? (
        <output className="flex items-center gap-2 border-b border-border bg-accent-soft px-4 py-1.5 text-[12.5px] text-foreground">
          <GitBranch className="size-3.5 text-accent" /> <span className="font-mono">{branch}</span> has new commits.{" "}
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline cursor-pointer" onClick={() => onUpdate(newerSha, branch)}>
            Update to {newerSha.slice(0, 7)}
          </button>
          <button type="button" aria-label="Dismiss" className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" onClick={onDismiss}>
            <X className="size-3.5" />
          </button>
        </output>
      ) : null}
      {rate?.remaining === 0 && rate.resetAt > Date.now() ? (
        <output className="flex items-center gap-2 border-b border-border bg-warn-soft px-4 py-1.5 text-[12.5px] text-foreground">
          <Timer className="size-3.5 text-warn" /> GitHub rate limit reached. Cached files still open. New folders and metadata load again at{" "}
          {new Date(rate.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
        </output>
      ) : null}
    </>
  );
}

/** "Back to file:line" after jumping to a definition or usage. */
export function BackLink({ backStack, onBack }: Readonly<{ backStack: BackEntry[]; onBack: () => void }>) {
  const last = backStack.at(-1);
  if (!last) return null;
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-[var(--code-border,var(--border))] bg-surface px-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer"
      >
        <ArrowLeft className="size-3.5" /> Back to {last.path.split("/").pop()}
        {last.line ? `:${last.line}` : ""}
      </button>
    </div>
  );
}

export type FileContentProps = Readonly<
  Pick<
    CodeViewProps,
    "focus" | "revealKey" | "symbolHighlights" | "searchQuery" | "onFocus" | "onExplain" | "onSymbol" | "onAnnotationAction" | "onCopyLink" | "onEscape" | "onKeyCommand"
  > & {
    session: RepoSession;
    path: string;
    isMobile: boolean;
    local: boolean;
    semantic: boolean;
    markdown: boolean;
    showRendered: boolean;
    fileIndex: FileIndex | null;
    annotations: Annotation[];
    dependencies?: Dependency[];
    onDependency: (dep: Dependency, anchor: SymbolMenuAnchor) => void;
    onMarkdownView: (v: "rendered" | "source") => void;
    showToast: (msg: string) => void;
  }
>;

/** The rendered Markdown, or the code with its annotations. */
function FileBody({ blob, ...p }: FileContentProps & { blob: BlobResult }) {
  const { session, path } = p;
  if (p.showRendered) {
    return <MarkdownView text={blob.text} path={path} repo={session.repo} imageUrls={p.local ? session.imageUrlsFn : undefined} />;
  }
  return (
    <CodeView
      path={path}
      text={blob.text}
      blobSha={blob.sha}
      lang={shikiLanguageFor(path)}
      fileIndex={p.fileIndex}
      focus={p.focus}
      revealKey={p.revealKey}
      annotations={p.annotations}
      symbolHighlights={p.symbolHighlights}
      searchQuery={p.searchQuery}
      onFocus={p.onFocus}
      onExplain={p.onExplain}
      onSymbol={p.onSymbol}
      onAnnotationAction={p.onAnnotationAction}
      onCopyLink={p.onCopyLink}
      onEscape={p.onEscape}
      onKeyCommand={p.onKeyCommand}
      dependencies={p.dependencies}
      onDependency={p.onDependency}
      bottomInset={p.isMobile ? 24 : 0}
    />
  );
}

const badgeLabel = (path: string) => {
  const language = languageLabel(path);
  return language === "plain text" ? "Text" : language;
};

/** An open text file: the toolbar (not on phones), then the file; local files can switch to the editor. */
function FileContent(props: FileContentProps & { blob: BlobResult }) {
  const { session, path, blob } = props;
  const canEdit = useCanEdit(session, props.local && !props.isMobile);
  // Unsaved edits reopen in the editor when the file is opened again.
  const [editing, setEditing] = useState(() => hasDraft(session, path));
  useEffect(() => {
    setEditing(hasDraft(session, path));
  }, [session, path]);
  const blocked = props.local ? editBlockedReason(canEdit) : undefined;
  const startEditing = useCallback(() => (blocked ? props.showToast(blocked) : setEditing(true)), [blocked, props.showToast]);
  useEditShortcut(props.local && !props.isMobile && !editing ? startEditing : null);
  if (editing && canEdit) {
    return <EditFile key={path} session={session} path={path} text={blob.text} language={badgeLabel(path)} lang={shikiLanguageFor(path)} onDone={() => setEditing(false)} />;
  }
  const reloadFile = async () => {
    const changed = await session.refreshFile(path);
    props.showToast(changed ? "File reloaded" : "No changes on disk");
  };
  return (
    <>
      {props.isMobile ? null : (
        <FileToolbar
          onEdit={props.local ? startEditing : undefined}
          editBlocked={blocked}
          onReloadFile={props.local ? reloadFile : undefined}
          language={badgeLabel(path)}
          semantic={props.semantic}
          markdown={props.markdown}
          showRendered={props.showRendered}
          onMarkdownView={props.onMarkdownView}
        />
      )}
      <FileBody {...props} />
    </>
  );
}

/** The main area: the repository start screen, a folder, an image, or an open file. */
export function ReaderMain({
  session,
  path,
  isDir,
  image,
  fileState,
  retryFile,
  githubUrl,
  refLabel,
  isMobile,
  onBrowse,
  onOpenPath,
  file,
}: Readonly<{
  session: RepoSession;
  path: string;
  isDir: boolean;
  image: boolean;
  fileState: FileState;
  retryFile: () => void;
  githubUrl: string;
  refLabel: string;
  isMobile: boolean;
  onBrowse: () => void;
  onOpenPath: (path: string, kind: "blob" | "tree") => void;
  file: FileContentProps;
}>) {
  if (isDir && !path) return <RepoHome session={session} refLabel={refLabel} isMobile={isMobile} onBrowse={onBrowse} />;
  if (isDir) return <FolderView session={session} path={path} onOpen={onOpenPath} />;
  if (image) return <ImageView session={session} path={path} />;
  if (fileState.status === "error") return <ErrorState error={fileState.error} onRetry={retryFile} githubUrl={githubUrl} />;
  if (fileState.status !== "ready") {
    return (
      <output className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading {path.split("/").pop()}…
      </output>
    );
  }
  return <FileContent {...file} blob={fileState.blob} />;
}

/** The toast area; announced politely to screen readers. */
export function Toast({ message }: Readonly<{ message: string | null }>) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center md:bottom-6">
      {message ? <div className="max-w-[90vw] truncate rounded-md bg-foreground px-3 py-1.5 text-[12.5px] text-background shadow-pop">{message}</div> : null}
    </div>
  );
}
