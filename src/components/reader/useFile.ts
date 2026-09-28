import { useEffect, useState } from "react";
import type { RepoSession } from "@/lib/session";
import type { BlobResult } from "@/lib/github/source";
import { isAbort, toAppError, type AppError } from "@/lib/errors";

export type FileState =
  | { status: "idle" }
  | { status: "loading"; path: string }
  | { status: "error"; path: string; error: AppError }
  | { status: "ready"; path: string; blob: BlobResult };

/** `version` changes when a local file was saved again, so it is read anew. */
export function useFile(session: RepoSession, path: string, enabled: boolean, version = 0): [FileState, () => void] {
  const [state, setState] = useState<FileState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !path) {
      setState({ status: "idle" });
      return;
    }
    const ctl = new AbortController();
    setState((s) => (s.status === "ready" && s.path === path ? s : { status: "loading", path }));
    session
      .loadFile(path, ctl.signal)
      .then((blob) => setState({ status: "ready", path, blob }))
      .catch((e) => {
        if (isAbort(e)) return;
        setState({ status: "error", path, error: toAppError(e) });
      });
    return () => ctl.abort();
  }, [session, path, enabled, attempt, version]);
  return [state, () => setAttempt((a) => a + 1)];
}
