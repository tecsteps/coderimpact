import { useSyncExternalStore } from "react";
import type { RepoSession } from "@/lib/session";

/** Re-renders when the session's tree, files, index or progress change. */
export function useSessionVersion(session: RepoSession): number {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.version,
    () => session.version,
  );
}
