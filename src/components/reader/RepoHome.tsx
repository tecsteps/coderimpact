import { FolderTree, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { isLocalOwner } from "@/lib/local/projects";
import { reloadRepository } from "@/lib/sessions";
import type { RepoSession } from "@/lib/session";
import { baseUrl } from "@/lib/config";
import { semanticLanguageFor } from "@/lib/util/files";
import { SEMANTIC_LANGUAGES, type SemanticLanguage } from "@/lib/lang/registry";
import { useSessionVersion } from "@/hooks/useSession";
import { Button } from "../ui/button";
import { useFile } from "./useFile";
import { isMarkdownPath, MarkdownView } from "./MarkdownView";
import { FileToolbar } from "./FileToolbar";
import { updateSettings } from "@/lib/cache/settings";
import { navigate, readerUrl } from "@/lib/router";

/**
 * The start screen of a repository: its README, rendered. Repositories
 * without one get the illustration and a short summary instead.
 */
export function RepoHome(props: Readonly<{ session: RepoSession; refLabel: string; isMobile: boolean; onBrowse: () => void }>) {
  useSessionVersion(props.session);
  const readme = findReadme(props.session);
  return readme ? <ReadmeHome {...props} path={readme} /> : <Placeholder {...props} />;
}

function findReadme(session: RepoSession): string | null {
  const root = (session.tree.list("") ?? []).filter((e) => e.type === "blob" && /^readme(\.(md|markdown|mdown|txt|rst))?$/i.test(e.name));
  // Markdown first, then plain text.
  root.sort((a, b) => Number(!isMarkdownPath(a.name)) - Number(!isMarkdownPath(b.name)));
  return root[0]?.path ?? null;
}

function ReadmeHome(props: Readonly<{ session: RepoSession; refLabel: string; isMobile: boolean; onBrowse: () => void; path: string }>) {
  const { session, path } = props;
  const [state, retry] = useFile(session, path, true);
  if (state.status === "error") return <Placeholder {...props} note={state.error.message} onRetry={retry} />;
  if (state.status !== "ready") {
    return (
      <output className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the README…
      </output>
    );
  }
  return isMarkdownPath(path) ? (
    <>
      {props.isMobile ? null : (
      <FileToolbar
        language="Markdown"
        semantic={false}
        note={path}
        markdown
        showRendered
        onMarkdownView={(v) => {
          if (v !== "source") return;
          // The source opens as the file itself, with the full code view.
          updateSettings({ markdownView: "source" });
          const { owner, repo, commitSha } = session.repo;
          navigate(readerUrl(owner, repo, commitSha, path, "blob"));
        }}
      />
      )}
      <MarkdownView text={state.blob.text} path={path} repo={session.repo} imageUrls={session.repo.owner === "~" ? session.imageUrlsFn : undefined} />
    </>
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <pre className="mx-auto max-w-3xl whitespace-pre-wrap px-5 py-6 font-mono text-[13px] text-foreground">{state.blob.text}</pre>
    </div>
  );
}

function Placeholder({
  session,
  refLabel,
  isMobile,
  onBrowse,
  note,
  onRetry,
}: Readonly<{
  session: RepoSession;
  refLabel: string;
  isMobile: boolean;
  onBrowse: () => void;
  note?: string;
  onRetry?: () => void;
}>) {
  const { owner, repo, description } = session.repo;
  const files = session.tree.files();
  const counts = new Map<string, number>();
  for (const f of files) {
    const lang = semanticLanguageFor(f.path);
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const langs = top.map(([lang, n]) => `${n.toLocaleString()} ${SEMANTIC_LANGUAGES[lang as SemanticLanguage].label}`).join(", ");

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <picture className="w-full max-w-md">
          <img src={baseUrl("illustrations/repo-empty-light.webp")} alt="" aria-hidden className="w-full dark:hidden" width={960} height={640} />
          <img src={baseUrl("illustrations/repo-empty-dark.webp")} alt="" aria-hidden className="hidden w-full dark:block" width={960} height={640} />
        </picture>
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-balance text-[22px] font-semibold tracking-[-0.01em] text-foreground">
            <span className="text-muted-foreground">{owner} / </span>
            {repo}
          </h1>
          {description ? <p className="max-w-[52ch] text-pretty text-[14px] text-muted-foreground">{description}</p> : null}
          <p className="text-[12.5px] text-subtle-foreground">
            <span className="font-mono">{refLabel}</span> · {files.length.toLocaleString()} files
            {langs ? ` · ${langs} files with definitions, references and callers` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {isMobile ? (
            <Button onClick={onBrowse}>
              <FolderTree /> Browse files
            </Button>
          ) : null}
          {isLocalOwner(owner) && isMobile ? (
            <Button variant="outline" onClick={() => reloadRepository(owner, repo)}>
              <RefreshCw /> Reload folder
            </Button>
          ) : null}
          {onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              <RotateCw /> Load the README again
            </Button>
          ) : null}
        </div>
        {note ? <p className="max-w-[52ch] text-pretty text-[12.5px] text-warn">{note}</p> : null}
        {!isMobile ? <p className="text-[13px] text-subtle-foreground">Pick a file in the sidebar, or search with Go to file.</p> : null}
        {isLocalOwner(owner) ? (
          <p className="max-w-[52ch] text-pretty text-[12.5px] text-subtle-foreground">
            This folder is read from your disk in this browser and never uploaded. Only the code you ask to explain is sent to the AI. After editing files, use Reload folder.
          </p>
        ) : null}
      </div>
    </div>
  );
}
