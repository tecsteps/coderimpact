/** macOS and iOS show ⌘ shortcuts; everything else Ctrl. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** A Cmd/Ctrl shortcut as the visitor's keyboard labels it: "⌘E" or "Ctrl+E". */
export function modKey(key: string): string {
  return IS_MAC ? `⌘${key}` : `Ctrl+${key}`;
}
