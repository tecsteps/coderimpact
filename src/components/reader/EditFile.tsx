import { lazy, Suspense, useEffect, useState } from "react";
import { Check, Loader2, Save, TriangleAlert } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { browserCanWriteFiles } from "@/lib/local/projects";
import { modKey } from "@/lib/util/keys";
import { codeTheme, codeThemeStyle } from "@/lib/highlight/themes";
import { useSettings } from "@/lib/cache/settings";
import { Button } from "../ui/button";
import { LanguageBadge } from "./LanguageBadge";

const CodeEditor = lazy(() => import("./CodeEditor"));

/** Unsaved edits per file, kept while navigating around the repository in this tab. */
const drafts = new Map<string, string>();
const draftKey = (session: RepoSession, path: string) => `${session.key}|${path}`;

export function hasDraft(session: RepoSession, path: string): boolean {
  return drafts.has(draftKey(session, path));
}

/** Leaving the page with unsaved edits asks first. */
function useWarnBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/** Whether this session's files can be saved (local folders in Chrome and Edge). */
export function useCanEdit(session: RepoSession, enabled: boolean): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    session.canEdit().then((v) => alive && setCan(v));
    return () => {
      alive = false;
    };
  }, [session, enabled]);
  return enabled && can;
}

/** Local folders that cannot be saved here: why, for the disabled pencil's tooltip. */
export function editBlockedReason(canEdit: boolean): string | undefined {
  if (canEdit) return undefined;
  if (!browserCanWriteFiles()) return "Editing works in Chrome and Edge on a computer. This browser can only read the folder.";
  return "This folder was opened without write access. Open it again with Open a local folder to edit.";
}

/** Cmd/Ctrl+E: `run` when not typing in a field. */
export function useEditShortcut(run: (() => void) | null) {
  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      // Handled already: the editor's own Cmd/Ctrl+E closes it, and must not reopen it on the way up.
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "e") return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "conflict" } | { kind: "error"; message: string };

function SaveStatus({ state, dirty }: Readonly<{ state: SaveState; dirty: boolean }>) {
  if (state.kind === "saving") return <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> Saving…</span>;
  if (state.kind === "error") return <span className="text-danger">{state.message}</span>;
  if (dirty) return <span>Unsaved changes</span>;
  if (state.kind === "saved") return <span className="inline-flex items-center gap-1 text-accent"><Check className="size-3" /> Saved to disk</span>;
  return <span>Editing. {modKey("S")} saves to disk, {modKey("E")} goes back to reading</span>;
}

/**
 * A file in edit mode: a slim bar (language, status, Save, Done) above the
 * editor. Saving checks the file on disk first, so edits made elsewhere are
 * never overwritten without asking.
 */
export function EditFile({
  session,
  path,
  text,
  language,
  lang,
  onDone,
}: Readonly<{
  session: RepoSession;
  path: string;
  /** The file as last read from disk. */
  text: string;
  language: string;
  lang: string;
  onDone: () => void;
}>) {
  const settings = useSettings();
  const theme = codeTheme(settings.codeTheme);
  const key = draftKey(session, path);
  const [initial] = useState(() => drafts.get(key) ?? text);
  const [current, setCurrent] = useState(initial);
  const [saved, setSaved] = useState(text);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const dirty = current !== saved;
  useWarnBeforeUnload(dirty);

  const change = (next: string) => {
    setCurrent(next);
    if (next === saved) drafts.delete(key);
    else drafts.set(key, next);
    if (state.kind !== "saving") setState({ kind: "idle" });
  };

  const save = async (value: string, force = false) => {
    setState({ kind: "saving" });
    try {
      await session.saveFile(path, value, { force });
      drafts.delete(key);
      setSaved(value);
      setState({ kind: "saved" });
    } catch (e) {
      if (e instanceof AppError && e.kind === "conflict") setState({ kind: "conflict" });
      else setState({ kind: "error", message: e instanceof Error ? e.message : "Could not save the file." });
    }
  };

  const done = () => {
    if (dirty && !window.confirm("Discard your unsaved changes to this file?")) return;
    drafts.delete(key);
    onDone();
  };

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-surface pl-3 pr-1.5">
        <LanguageBadge label={language} semantic={false} />
        <p className="min-w-0 flex-1 truncate text-[12px] text-subtle-foreground">
          <SaveStatus state={state} dirty={dirty} />
        </p>
        <Button size="sm" variant="ghost" onClick={done}>
          Done
        </Button>
        <Button size="sm" disabled={!dirty || state.kind === "saving"} onClick={() => save(current)}>
          <Save /> Save
        </Button>
      </div>
      {state.kind === "conflict" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border bg-warn-soft px-3 py-1.5 text-[12.5px] text-foreground">
          <TriangleAlert className="size-3.5 text-warn" />
          <span className="flex-1">This file was changed on disk since you opened it.</span>
          <Button size="sm" variant="outline" onClick={() => save(current, true)}>
            Overwrite with my version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              drafts.delete(key);
              session.refreshFile(path).finally(onDone);
            }}
          >
            Discard mine, load theirs
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col" style={{ ...codeThemeStyle(theme), "--code-size": `${settings.codeSize}px` } as React.CSSProperties}>
        <Suspense
          fallback={
            <p className="flex items-center gap-2 p-4 text-[12.5px] text-subtle-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Opening the editor…
            </p>
          }
        >
          <CodeEditor session={session} path={path} text={current} lang={lang} theme={theme.shiki} wrap={settings.softWrap} onChange={change} onSave={(v) => save(v)} onExit={done} />
        </Suspense>
      </div>
    </>
  );
}
