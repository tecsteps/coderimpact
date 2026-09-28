import { useEffect, useState } from "react";
import { loadConfig } from "./config";
import { toAppError, type AppError } from "./errors";
import { FULL_SHA_RE, type ParsedRepoUrl } from "./github/parseGithubUrl";
import { getSource, type RepositorySource, type ResolvedRepo } from "./github/source";
import { SnapshotSource } from "./github/snapshotSource";
import { GitSource } from "./github/gitSource";
import { RepoSession } from "./session";
import type { RepoTree } from "./github/tree";
import { LocalSource } from "./local/localSource";
import { isLocalOwner } from "./local/projects";

const sessions = new Map<string, Promise<RepoSession>>();
/** Repositories kept in memory: the open one and the two before it. Older ones stop indexing and are dropped. */
const KEEP_SESSIONS = 3;

/** Marks a session as just used, and disposes the least recently used beyond KEEP_SESSIONS (a revisit starts it again). */
function touch(key: string, sp: Promise<RepoSession>) {
  sessions.delete(key);
  sessions.set(key, sp);
  while (sessions.size > KEEP_SESSIONS) {
    const [oldest, old] = sessions.entries().next().value!;
    sessions.delete(oldest);
    old.then((x) => x.dispose()).catch(() => undefined);
  }
}
const resolutions = new Map<string, Promise<ResolvedRepo>>();

function resolutionKey(p: ParsedRepoUrl): string {
  return `${p.owner}/${p.repo}|${p.refAndPath.join("/")}`.toLowerCase();
}

/** Same key for every file of a commit-pinned URL, so moving between files never re-resolves. */
export function repoKey(p: ParsedRepoUrl): string {
  const first = p.refAndPath[0];
  if (first && FULL_SHA_RE.test(first)) return `${p.owner}/${p.repo}@${first}`.toLowerCase();
  return resolutionKey(p);
}

/** Path inside the repository for a commit-pinned URL. */
export function pinnedPath(p: ParsedRepoUrl): string | null {
  const first = p.refAndPath[0];
  return first && FULL_SHA_RE.test(first) ? p.refAndPath.slice(1).join("/") : null;
}

let snapshotSource: SnapshotSource | null = null;
let gitSource: GitSource | null = null;
function getGitSource(): GitSource {
  gitSource ??= new GitSource();
  return gitSource;
}

/** The configured RepositorySource: live GitHub, or bundled snapshots. */
export async function source(): Promise<RepositorySource> {
  const cfg = await loadConfig();
  if (cfg.source.kind === "snapshot") {
    snapshotSource ??= new SnapshotSource(cfg.source.snapshots);
    return snapshotSource;
  }
  const s = cfg.github.transport === "api" ? getSource() : getGitSource();
  s.contentMode = cfg.github.contentMode;
  return s;
}

let localSource: LocalSource | null = null;
function getLocalSource(): LocalSource {
  localSource ??= new LocalSource();
  return localSource;
}

/** Resolves the URL to an immutable commit and returns the (shared) session for it. */
export async function openRepository(parsed: ParsedRepoUrl): Promise<{ session: RepoSession; resolved: ResolvedRepo }> {
  const src = isLocalOwner(parsed.owner) ? getLocalSource() : await source();
  const pinned = pinnedPath(parsed);
  if (pinned !== null) {
    const existing = sessions.get(repoKey(parsed));
    if (existing) {
      touch(repoKey(parsed), existing);
      const session = await existing.catch(() => null);
      if (session) return { session, resolved: { ...session.repo, path: pinned } };
    }
  }
  const rk = resolutionKey(parsed);
  let rp = resolutions.get(rk);
  if (!rp) {
    rp = src.resolve(parsed);
    resolutions.set(rk, rp);
    rp.catch(() => resolutions.delete(rk));
  }
  const resolved = await rp;
  const sk = `${resolved.owner}/${resolved.repo}@${resolved.commitSha}`.toLowerCase();
  let sp = sessions.get(sk);
  if (!sp) {
    sp = src.loadTree(resolved).then((tree) => startSession(resolved, tree, src));
    sp.catch(() => sessions.delete(sk));
  }
  touch(sk, sp);
  return { session: await sp, resolved };
}

function startSession(resolved: ResolvedRepo, tree: RepoTree, src: RepositorySource): RepoSession {
  const session = new RepoSession(resolved, tree, src);
  session.start();
  return session;
}

/** Remembers branch names for commits resolved in this browser session, for display. */
export function rememberRefName(sha: string, name: string) {
  try {
    sessionStorage.setItem(`ci.ref.${sha}`, name);
  } catch {
    /* ignore */
  }
}

export function refNameFor(sha: string): string | null {
  try {
    return sessionStorage.getItem(`ci.ref.${sha}`);
  } catch {
    return null;
  }
}

const RELOAD_EVENT = "ci:reload-repository";

/** Lists a local folder again (new and changed files), keeping the open file. */
export function reloadRepository(owner: string, repo: string) {
  const prefix = `${owner}/${repo}`.toLowerCase();
  // Deleting the current entry while iterating a Map is safe.
  for (const [k, sp] of sessions)
    if (k.startsWith(prefix + "@") || k.startsWith(prefix + "|")) {
      sessions.delete(k);
      sp.then((s) => s.dispose()).catch(() => undefined);
    }
  for (const k of resolutions.keys()) if (k.startsWith(prefix + "|")) resolutions.delete(k);
  window.dispatchEvent(new CustomEvent(RELOAD_EVENT));
}

export type RepoState =
  | { status: "loading" }
  | { status: "error"; error: AppError; retry: () => void }
  | { status: "ready"; session: RepoSession; resolved: ResolvedRepo };

const nextAttempt = (a: number) => a + 1;

export function useRepository(parsed: ParsedRepoUrl): RepoState {
  const key = repoKey(parsed);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RepoState & { key?: string }>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    // Keep showing the same repository while a pinned URL for it resolves (no flash).
    const same = (s: RepoState) =>
      s.status === "ready" && `${s.session.repo.owner}/${s.session.repo.repo}`.toLowerCase() === `${parsed.owner}/${parsed.repo}`.toLowerCase();
    setState((s) => (same(s) ? s : { status: "loading" }));
    openRepository(parsed)
      .then(({ session, resolved }) => {
        if (alive) setState({ status: "ready", session, resolved, key });
      })
      .catch((e) => {
        if (!alive) return;
        const error = toAppError(e);
        setState({
          status: "error",
          error,
          retry: () => {
            resolutions.clear();
            setAttempt(nextAttempt);
          },
        });
      });
    return () => {
      alive = false;
    };
    // parsed is represented by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  // A reload (local folders) or access granted again: resolve anew.
  useEffect(() => {
    const on = () => setAttempt(nextAttempt);
    window.addEventListener(RELOAD_EVENT, on);
    return () => window.removeEventListener(RELOAD_EVENT, on);
  }, []);

  return state;
}
