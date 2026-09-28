import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FolderOpen, KeyRound, Loader2 } from "lucide-react";
import { navigate, readerUrl } from "@/lib/router";
import { reloadRepository } from "@/lib/sessions";
import { addFiles, filesFromInput, LOCAL_OWNER, getListing, pickDirectory, requestAccess, setListing, subscribeListing, supportsDirectoryPicker, type ListingProgress, type LocalProject } from "@/lib/local/projects";
import type { AppError } from "@/lib/errors";
import { Button } from "./ui/button";

/** Brave announces itself on navigator.brave. */
export function isBrave(): boolean {
  return typeof navigator !== "undefined" && "brave" in navigator;
}

export function openProject(p: LocalProject) {
  navigate(readerUrl(LOCAL_OWNER, p.slug, p.id, "", "tree"));
}

/**
 * Picks a folder: the system folder picker where the browser has one (the
 * folder can be reopened later), a folder input otherwise.
 */
export function useFolderPicker(onPicked: (p: LocalProject) => void, reuseId?: string) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<LocalProject | null>) => {
    setBusy(true);
    setError(null);
    try {
      const p = await fn();
      if (p) onPicked(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const [confirming, setConfirming] = useState(false);
  const open = () => {
    if (supportsDirectoryPicker()) run(pickDirectory);
    // Brave's folder input asks to "upload" the files: explain first that nothing leaves the computer.
    else if (isBrave()) setConfirming(true);
    else clickInput();
  };

  // The browser lists the whole folder before handing it over, which can take a
  // while for large projects: show that we are waiting once its dialog closes.
  const clickInput = () => {
    const el = input.current;
    if (!el) return;
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      window.setTimeout(() => {
        if (!el.dataset.done) setListing({ phase: "waiting", entries: 0 });
      }, 300);
    };
    delete el.dataset.done;
    window.addEventListener("focus", onFocus);
    el.addEventListener(
      "cancel",
      () => {
        el.dataset.done = "1";
        setListing({ phase: "idle", entries: 0 });
      },
      { once: true },
    );
    el.click();
  };

  const element = (
    <>
    {confirming ? (
      <div role="alertdialog" aria-label="Before you choose a folder" className="flex w-full flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left text-[13px] shadow-pop">
        <p className="text-foreground">
          <strong className="font-semibold">Brave will ask to “upload” the files.</strong> Nothing is uploaded: Coderimpact reads them in this tab only, and only code you ask to explain goes to the AI.
        </p>
        <p className="text-[12px] text-subtle-foreground">Dragging the folder onto this page skips the question.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              setConfirming(false);
              clickInput();
            }}
          >
            Continue
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    ) : null}
    <input
      ref={input}
      type="file"
      className="hidden"
      // @ts-expect-error: non-standard, supported by all current browsers
      webkitdirectory=""
      multiple
      onChange={(e) => {
        const list = e.target.files;
        e.target.dataset.done = "1";
        setListing({ phase: "idle", entries: 0 });
        if (!list || list.length === 0) return;
        const { name, files } = filesFromInput(list);
        e.target.value = "";
        run(() => addFiles(name, files, reuseId));
      }}
    />
    </>
  );
  return { open, run, busy, error, element };
}

export function OpenLocalFolderButton({ onError, className }: Readonly<{ onError?: (msg: string | null) => void; className?: string }>) {
  const picker = useFolderPicker(openProject);
  useEffect(() => onError?.(picker.error), [picker.error, onError]);
  return (
    <>
      <Button type="button" variant="outline" size="lg" className={className} onClick={picker.open} disabled={picker.busy}>
        <FolderOpen /> {picker.busy ? "Reading folder…" : "Open a local folder"}
      </Button>
      {picker.element}
    </>
  );
}

/** Buttons for the "local-access" error: allow access again, or pick the folder again. */
export function LocalAccessActions({ error, owner, repo }: Readonly<{ error: AppError; owner: string; repo: string }>) {
  const [denied, setDenied] = useState(false);
  const picker = useFolderPicker(() => reloadRepository(owner, repo), error.details.localId);
  if (error.kind !== "local-access" && error.kind !== "not-found") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {error.details.canRequest ? (
        <Button
          size="sm"
          onClick={async () => {
            const ok = await requestAccess(error.details.localId!).catch(() => false);
            if (ok) reloadRepository(owner, repo);
            else setDenied(true);
          }}
        >
          <KeyRound /> Allow access
        </Button>
      ) : null}
      {!error.details.canRequest && error.kind === "local-access" ? (
        <Button size="sm" onClick={picker.open} disabled={picker.busy}>
          <FolderOpen /> {picker.busy ? "Reading folder…" : "Choose the folder again"}
        </Button>
      ) : null}
      {!error.details.canRequest && error.kind !== "local-access" ? (
        <Button size="sm" variant="outline" onClick={() => navigate("/")}>
          <FolderOpen /> Open a local folder
        </Button>
      ) : null}
      {picker.element}
      {denied ? <p className="w-full text-[12.5px] text-subtle-foreground">Access was not granted. Click Allow access to try again.</p> : null}
      {picker.error ? <p className="w-full text-[12.5px] text-danger">{picker.error}</p> : null}
    </div>
  );
}

export function useListing(): ListingProgress {
  return useSyncExternalStore(subscribeListing, getListing, getListing);
}

/** Blocks the whole app while a local folder is being read: nothing can be done until it arrives. */
export function ListingIndicator() {
  const p = useListing();
  if (p.phase === "idle") return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="polite"
      aria-label="Reading the folder"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm"
    >
      <div className="flex max-w-md items-start gap-3 rounded-xl border border-border bg-surface px-5 py-4 text-[13px] shadow-pop">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">
            {p.phase === "waiting" ? "Your browser is reading the folder…" : `Reading folder… ${p.entries.toLocaleString()} files and folders`}
          </span>
          <span className="text-[12px] text-subtle-foreground">
            {p.phase === "waiting"
              ? "Large projects take a moment: the browser lists every file, including dependencies, before handing them over. Dragging the folder in is faster."
              : "Dependency and build folders are skipped until you open them."}
          </span>
        </div>
      </div>
    </div>
  );
}
