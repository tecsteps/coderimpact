import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParsedRepoUrl } from "@/lib/github/parseGithubUrl";
import type { ResolvedRepo } from "@/lib/github/source";
import type { RepoSession } from "@/lib/session";
import { currentHref, hrefFor, isSheetPop, navigate, readerUrl } from "@/lib/router";
import { pinnedPath, refNameFor, rememberRefName } from "@/lib/sessions";
import { addRecent } from "@/lib/cache/recents";
import { registryUrl, repositoryOf, type Dependency } from "@/lib/deps";
import { dirname, isImagePath } from "@/lib/util/files";
import type { SymbolSelection } from "./RefsPanel";
import { splitLines } from "./CodeView";
import { useFile } from "./useFile";
import type { SymbolHighlight } from "./types";

export interface BackEntry {
  path: string;
  line?: number;
  href: string;
}

/** The path the reader shows, whether it is a folder or an image, and the loaded text and index of a file. */
export function useReaderFile(session: RepoSession, parsed: ParsedRepoUrl, resolved: ResolvedRepo) {
  const pinned = pinnedPath(parsed);
  const path = pinned ?? resolved.path;
  const entry = path ? session.tree.get(path) : undefined;
  const isDir = !path || parsed.kind === "tree" || parsed.kind === "repo" || entry?.type === "tree";
  const image = !isDir && isImagePath(path);
  const [fileState, retryFile] = useFile(session, path, !isDir && !image, session.fileVersion(path));
  const text = fileState.status === "ready" ? fileState.blob.text : "";
  const lines = useMemo(() => splitLines(text), [text]);
  const fileIndex = session.index.get(path) ?? null;
  return { pinned, path, isDir, image, fileState, retryFile, text, lines, fileIndex };
}

/** Pins the URL to the resolved commit so it is shareable and immutable. Runs once. */
export function usePinnedUrl(session: RepoSession, resolved: ResolvedRepo, parsed: ParsedRepoUrl, pinned: string | null, path: string, isDir: boolean) {
  useEffect(() => {
    const { owner, repo, commitSha } = session.repo;
    if (resolved.refType !== "commit") rememberRefName(commitSha, resolved.refName);
    if (pinned === null) navigate(readerUrl(owner, repo, commitSha, path, isDir ? "tree" : "blob", parsed.lines), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Records the open file in the recents list and names the browser tab after it. */
export function useRecentAndTitle(owner: string, repo: string, commitSha: string, path: string, isDir: boolean) {
  useEffect(() => {
    addRecent({ owner, repo, sha: commitSha, refName: refNameFor(commitSha) ?? undefined, path: isDir ? undefined : path });
    document.title = path ? `${path.split("/").pop()} · ${owner}/${repo} · Coderimpact` : `${owner}/${repo} · Coderimpact`;
  }, [owner, repo, commitSha, path, isDir]);
}

/** A counter that changes on a new file or a history navigation, so the focused line scrolls into view. */
export function useRevealCounter(path: string, status: string) {
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    setReveal((r) => r + 1);
  }, [path, status]);
  useEffect(() => {
    const onPop = () => {
      if (!isSheetPop()) setReveal((r) => r + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return [reveal, setReveal] as const;
}

/**
 * Live updates, local folders: check the open file about once a second while the tab is
 * visible, and its folder when the tab regains focus (files saved in an editor show up).
 */
export function useLocalLiveUpdates(local: boolean, session: RepoSession, path: string, isDir: boolean) {
  useEffect(() => {
    if (!local) return;
    let busy = false;
    const tick = async (withDir: boolean) => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        if (path && !isDir) await session.refreshFile(path);
        if (withDir) await session.refreshDirectory(isDir ? path : dirname(path));
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => tick(false), 1200);
    const onFocus = () => tick(true);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [local, session, path, isDir]);
}

/** Live updates, GitHub: when a branch was opened, offer its newer commits. */
export function useNewerCommit(branch: string | null, session: RepoSession) {
  const [newerSha, setNewerSha] = useState<string | null>(null);
  useEffect(() => {
    if (!branch) return;
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 20_000) return;
      last = Date.now();
      const sha = await session.newerCommit(branch);
      if (sha) setNewerSha(sha);
    };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [branch, session]);
  return [newerSha, setNewerSha] as const;
}

/** Where "Back to" returns; the entry drops when the visitor returned with the browser Back button. */
export function useBackStack(path: string, line: number | undefined) {
  const [backStack, setBackStack] = useState<BackEntry[]>([]);
  useEffect(() => {
    const here = currentHref();
    setBackStack((st) => (st.at(-1)?.href === here ? st.slice(0, -1) : st));
  }, [path, line]);
  return [backStack, setBackStack] as const;
}

/** A short message at the bottom of the screen that clears itself. */
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }, []);
  return [toast, showToast] as const;
}

/** The desktop menu is anchored to a point in the code: close it when the code scrolls. */
export function useCloseOnScroll(enabled: boolean, close: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onScroll = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.("[role=menu]")) return;
      close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [enabled, close]);
}

/** Where the selected symbol occurs in the open file (its definitions marked), or just the selection when unresolved. */
export function useSymbolHighlights(session: RepoSession, selection: SymbolSelection | null, path: string): SymbolHighlight[] {
  return useMemo(() => {
    if (!selection) return [];
    const r = session.index.resolveOccurrence(selection.path, selection.index);
    if (r.status !== "resolved") {
      if (selection.path !== path) return [];
      const length = selection.name.replace(/^\$/, "").length + (selection.name.startsWith("$") ? 1 : 0);
      return [{ line: selection.line, col: selection.col, endCol: selection.col + length }];
    }
    const refs = session.index.references(r.key);
    const out: SymbolHighlight[] = [];
    for (const d of refs.defs) if (d.path === path) out.push({ line: d.line, col: d.col, endCol: d.endCol, def: true });
    for (const x of refs.refs) if (x.path === path) out.push({ line: x.line, col: x.col, endCol: x.endCol });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, path, session, session.version]);
}

/** Package manifests: dependency names open their repository in a new tab. */
export function useDependencyOpener(showToast: (msg: string) => void) {
  return useCallback(
    async (dep: Dependency) => {
      // Open the tab right away (popup blockers allow it only during the click), then point it at the repository.
      const tab = window.open("about:blank", "_blank");
      // The registry page must not reach back into this tab (reverse tabnabbing).
      if (tab) tab.opener = null;
      showToast(`Looking up ${dep.name}…`);
      const repo = await repositoryOf(dep);
      if (repo) {
        const url = hrefFor(`/${repo}`);
        if (tab) tab.location.href = new URL(url, window.location.href).href;
        else window.open(url, "_blank");
        showToast(`Opened ${repo} in a new tab`);
      } else {
        if (tab) tab.location.href = registryUrl(dep);
        showToast(`${dep.name} has no GitHub repository on record; opened its registry page`);
      }
    },
    [showToast],
  );
}

export interface RefDisplay {
  /** Branch or tag name, when known. */
  name: string | null;
  /** True when the commit is the latest commit of that branch; null while unknown. */
  latest: boolean | null;
}

/**
 * Names the commit being read. A link pins a commit, so a fresh tab only
 * knows the hash: ask which branches point at it, preferring the default
 * branch, then the one this tab remembers.
 */
export function useRefDisplay(session: RepoSession, local: boolean): RefDisplay {
  const { commitSha, defaultBranch } = session.repo;
  const [state, setState] = useState<RefDisplay>(() => ({ name: refNameFor(commitSha), latest: null }));
  useEffect(() => {
    if (local) return;
    const ctl = new AbortController();
    const remembered = refNameFor(commitSha);
    setState({ name: remembered, latest: null });
    session
      .branchesAtCommit(ctl.signal)
      .then((names) => {
        const pick = [defaultBranch, remembered].find((n) => n && names.includes(n)) ?? names[0];
        if (pick) {
          rememberRefName(commitSha, pick);
          setState({ name: pick, latest: true });
        } else setState({ name: remembered, latest: false });
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [session, local, commitSha, defaultBranch]);
  return state;
}
