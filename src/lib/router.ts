import { useEffect, useRef, useSyncExternalStore } from "react";
import { formatLineHash, parseRepoPath, type LineRange, type ParsedRepoUrl } from "./github/parseGithubUrl";
import { AppError } from "./errors";

export type Route =
  | { kind: "landing" }
  | { kind: "repo"; parsed: ParsedRepoUrl; href: string }
  | { kind: "invalid"; error: AppError; href: string };

const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "").replace(/^\.$/, "");

/**
 * Path mode (default): /owner/repo/blob/<sha>/path#L16-L20, mirroring GitHub.
 * Hash mode (claude.ai Artifact build, where the path cannot change):
 * #/owner/repo/blob/<sha>/path@L16-L20.
 */
export const HASH_ROUTER = import.meta.env?.VITE_ROUTER === "hash";

/** Current app location as "/owner/repo/...#L1-L2" in either mode. */
export function currentHref(): string {
  if (HASH_ROUTER) {
    const h = window.location.hash;
    if (!h.startsWith("#/")) return "/";
    const at = h.indexOf("@L");
    return at >= 0 ? `${h.slice(1, at)}#${h.slice(at + 1)}` : h.slice(1);
  }
  const p = window.location.pathname;
  const path = BASE && p.startsWith(BASE) ? p.slice(BASE.length) || "/" : p;
  return path + window.location.hash;
}

/** Browser URL for an app location. */
export function hrefFor(appUrl: string): string {
  if (HASH_ROUTER) {
    const i = appUrl.indexOf("#");
    const path = i >= 0 ? appUrl.slice(0, i) : appUrl;
    const lines = i >= 0 ? appUrl.slice(i + 1) : "";
    if (path === "/") return "#";
    return lines ? `#${path}@${lines}` : `#${path}`;
  }
  return appUrl.startsWith("/") ? BASE + appUrl : appUrl;
}

let cachedHref = "";
let cachedRoute: Route = { kind: "landing" };

function computeRoute(): Route {
  const href = currentHref();
  if (href === cachedHref) return cachedRoute;
  cachedHref = href;
  const i = href.indexOf("#");
  const path = i >= 0 ? href.slice(0, i) : href;
  const hash = i >= 0 ? href.slice(i) : "";
  if (path === "/" || path === "") cachedRoute = { kind: "landing" };
  else {
    try {
      cachedRoute = { kind: "repo", parsed: parseRepoPath(path, hash), href };
    } catch (e) {
      cachedRoute = { kind: "invalid", error: e instanceof AppError ? e : new AppError("invalid-url", String(e)), href };
    }
  }
  return cachedRoute;
}

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  const on = () => l();
  window.addEventListener("popstate", on);
  window.addEventListener("hashchange", on);
  return () => {
    listeners.delete(l);
    window.removeEventListener("popstate", on);
    window.removeEventListener("hashchange", on);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, computeRoute, computeRoute);
}

function writeUrl(appUrl: string, replace: boolean) {
  if (appUrl === currentHref()) return;
  const url = hrefFor(appUrl);
  const full = HASH_ROUTER ? hashRouterUrl(url) : url;
  // Leaving from an open sheet: the new page takes the sheet's history entry.
  if (replace || isSheetEntry(window.history.state)) window.history.replaceState(null, "", full);
  else window.history.pushState(null, "", full);
  listeners.forEach((l) => l());
}

/** Full browser URL in hash mode; the bare "#" (landing) keeps the address clean. */
function hashRouterUrl(url: string): string {
  const base = window.location.pathname + window.location.search;
  return url === "#" ? base : base + url;
}

const SHEET_KEY = "ciSheet";
let sheetBackAt = 0;
let pendingRelease: number | null = null;

function isSheetEntry(state: unknown): boolean {
  return !!state && typeof state === "object" && SHEET_KEY in state;
}

/** True right after a sheet removed its own history entry (not a real Back). */
export function isSheetPop(): boolean {
  return Date.now() - sheetBackAt < 400;
}

/**
 * While `open`, an overlay owns one history entry, so the browser's Back
 * button (and the Android back gesture) closes it instead of leaving the page.
 */
export function useBackToClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    // Only identifies this sheet's history entry; no security relevance.
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    const state = { ...window.history.state, [SHEET_KEY]: id };
    if (pendingRelease !== null && isSheetEntry(window.history.state)) {
      // Another sheet just closed: take over its entry instead of adding one.
      window.clearTimeout(pendingRelease);
      pendingRelease = null;
      window.history.replaceState(state, "", window.location.href);
    } else window.history.pushState(state, "", window.location.href);
    let popped = false;
    const onPop = () => {
      if (popped) return;
      popped = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed from the UI: drop the entry, unless a sheet opening right now claims it.
      if (!popped && (window.history.state as Record<string, unknown> | null)?.[SHEET_KEY] === id) {
        pendingRelease = window.setTimeout(() => {
          pendingRelease = null;
          sheetBackAt = Date.now();
          window.history.back();
        }, 0);
      }
    };
  }, [open]);
}

export function navigate(url: string, opts: { replace?: boolean } = {}) {
  writeUrl(url, !!opts.replace);
}

export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Coderimpact URL for a file or folder at an immutable commit. */
export function readerUrl(owner: string, repo: string, ref: string, path: string, kind: "blob" | "tree", lines?: LineRange): string {
  if (!path && kind === "tree") return `/${owner}/${repo}/tree/${encodePath(ref)}`;
  return `/${owner}/${repo}/${kind}/${encodePath(ref)}/${encodePath(path)}${formatLineHash(lines)}`;
}

/** Updates only the line anchor without adding a history entry. */
export function replaceLines(lines: LineRange | undefined) {
  const href = currentHref();
  const i = href.indexOf("#");
  const path = i >= 0 ? href.slice(0, i) : href;
  writeUrl(path + formatLineHash(lines), true);
}

/** Absolute, shareable URL for an app location (path mode only). */
export function absoluteUrl(path: string): string {
  return window.location.origin + BASE + path;
}
