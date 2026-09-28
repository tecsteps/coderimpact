import { useSyncExternalStore } from "react";

/**
 * Focus mode: only the code (and its toolbar) on screen, in browser full
 * screen where available. Leaving browser full screen (Escape) leaves it too.
 */
let on = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setFocusMode(next: boolean) {
  if (next === on) return;
  on = next;
  emit();
  const doc = document;
  if (next && !doc.fullscreenElement) doc.documentElement.requestFullscreen?.().catch(() => undefined);
  if (!next && doc.fullscreenElement) doc.exitFullscreen?.().catch(() => undefined);
}

if (typeof document !== "undefined") {
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && on) {
      on = false;
      emit();
    }
  });
  // Browsers without the Fullscreen API: Escape still leaves focus mode.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && on && !document.fullscreenElement) setFocusMode(false);
  });
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => false,
  );
}
