import { AppError } from "../errors";

export interface LineRange {
  start: number;
  end: number;
}

export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  /** "repo" when no tree/blob part was given. */
  kind: "repo" | "tree" | "blob";
  /**
   * Path segments after /tree/ or /blob/. The split between ref and path is
   * resolved later against GitHub metadata, never guessed here.
   */
  refAndPath: string[];
  lines?: LineRange;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const RESERVED_OWNERS = new Set([
  "settings", "orgs", "marketplace", "explore", "topics", "trending", "collections",
  "notifications", "login", "join", "sponsors", "features", "about", "pricing", "search",
]);

/** Parses `#L16`, `#L16-L27` or `#L16-27`. */
export function parseLineHash(hash: string | undefined | null): LineRange | undefined {
  if (!hash) return undefined;
  const m = /^#?L(\d+)(?:-L?(\d+))?$/.exec(hash.trim());
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (!a || !b) return undefined;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function formatLineHash(range: LineRange | undefined): string {
  if (!range) return "";
  return range.start === range.end ? `#L${range.start}` : `#L${range.start}-L${range.end}`;
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parses a path of the form `owner/repo[/tree|blob/<ref and path>]`.
 * Used for both GitHub URLs and Coderimpact's own URLs, which mirror them.
 */
export function parseRepoPath(pathname: string, hash?: string): ParsedRepoUrl {
  const segments = pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments.length < 2) {
    throw new AppError("invalid-url", "Enter a repository as owner/repo or a github.com URL.");
  }
  const [owner, rawRepo, kindSeg, ...rest] = segments;
  const repo = rawRepo.replace(/\.git$/i, "");
  // "~" is the owner of local folders: /~/<folder>/tree/<id>.
  if (owner !== "~" && (!OWNER_RE.test(owner) || RESERVED_OWNERS.has(owner.toLowerCase()))) {
    throw new AppError("invalid-url", `"${owner}" is not a valid GitHub owner name.`);
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new AppError("invalid-url", `"${rawRepo}" is not a valid repository name.`);
  }
  const lines = parseLineHash(hash);
  if (!kindSeg) return { owner, repo, kind: "repo", refAndPath: [], lines };
  if (kindSeg !== "tree" && kindSeg !== "blob") {
    // Pages such as /issues or /pulls: open the repository itself.
    return { owner, repo, kind: "repo", refAndPath: [], lines: undefined };
  }
  if (rest.length === 0) {
    throw new AppError("invalid-url", "The link is missing a branch, tag or commit after /" + kindSeg + "/.");
  }
  return { owner, repo, kind: kindSeg, refAndPath: rest, lines };
}

/**
 * Accepts `owner/repo`, `github.com/owner/repo`, full https URLs with
 * optional /tree/<ref>/<path> or /blob/<ref>/<path> and a #L anchor.
 */
export function parseGithubInput(input: string): ParsedRepoUrl {
  const raw = input.trim();
  if (!raw) throw new AppError("invalid-url", "Enter a repository URL.");

  // git@github.com:owner/repo.git
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(raw);
  if (ssh) return parseRepoPath(`${ssh[1]}/${ssh[2]}`);

  let urlText = raw;
  if (/^(www\.)?github\.com\//i.test(urlText)) urlText = "https://" + urlText;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlText)) return parseAbsoluteUrl(urlText);

  // Another host written without a scheme, e.g. gitlab.com/owner/repo.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(raw)) {
    throw new AppError("invalid-url", "Only public repositories on github.com are supported.");
  }
  return parseShorthand(raw);
}

/** A full URL with a scheme, which must point at github.com over http(s). */
function parseAbsoluteUrl(urlText: string): ParsedRepoUrl {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new AppError("invalid-url", "That does not look like a valid URL.");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new AppError("invalid-url", "Only public repositories on github.com are supported.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AppError("invalid-url", "Use an https://github.com link.");
  }
  return parseRepoPath(url.pathname, url.hash);
}

/** Shorthand owner/repo, possibly with extra path and a hash. */
function parseShorthand(raw: string): ParsedRepoUrl {
  const hashIdx = raw.indexOf("#");
  const path = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const hash = hashIdx >= 0 ? raw.slice(hashIdx) : undefined;
  if (/\s/.test(path)) throw new AppError("invalid-url", "Repository names cannot contain spaces.");
  const qIdx = path.indexOf("?");
  return parseRepoPath(qIdx >= 0 ? path.slice(0, qIdx) : path, hash);
}

export const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
export const SHORT_SHA_RE = /^[0-9a-f]{7,40}$/i;
