/**
 * Repository suggestions for the "open a repository" field, from GitHub's
 * public search API (10 unauthenticated requests per minute, so callers
 * debounce and results are cached for the tab).
 */
export interface RepoSuggestion {
  fullName: string;
  description?: string;
  stars: number;
  language?: string;
}

interface SearchResponse {
  items: { full_name: string; description: string | null; stargazers_count: number; language: string | null }[];
}

const cache = new Map<string, Promise<RepoSuggestion[]>>();

/** GitHub search query for what the visitor typed: `sylius`, `sylius/`, `sylius/shop`. */
export function searchQueryFor(input: string): string | null {
  const v = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^(www\.)?github\.com\//i, "");
  if (v.length < 2 || /\s/.test(v)) return null;
  const [owner, repo, ...rest] = v.split("/");
  if (rest.length > 0) return null; // a path into a repository: nothing to suggest
  // A single word matches names, descriptions and topics, so "nextjs" also finds vercel/next.js.
  if (repo === undefined) return owner;
  return repo ? `${repo} in:name user:${owner}` : `user:${owner}`;
}

export function searchRepositories(input: string, signal?: AbortSignal): Promise<RepoSuggestion[]> {
  const q = searchQueryFor(input);
  if (!q) return Promise.resolve([]);
  let p = cache.get(q);
  if (!p) {
    // Most starred first, so the official project leads.
    p = fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<SearchResponse>) : { items: [] }))
      .then((j) =>
        j.items.map((it) => ({
          fullName: it.full_name,
          description: it.description ?? undefined,
          stars: it.stargazers_count,
          language: it.language ?? undefined,
        })),
      )
      .then((list) => rankByName(list, input).slice(0, 7));
    cache.set(q, p);
    p.catch(() => cache.delete(q));
  }
  return p;
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Repositories named like the query first (ignoring punctuation, so nextjs
 * matches next.js), then names containing it, then the rest; most starred
 * first within each group. Keeps big projects that only mention the word
 * in their description below the ones named after it.
 */
function rankByName(list: RepoSuggestion[], input: string): RepoSuggestion[] {
  const words = input.trim().split("/");
  const q = norm(words.at(-1) || words[0]);
  if (!q) return list;
  const group = (s: RepoSuggestion) => {
    const n = norm(s.fullName.split("/")[1]);
    if (n === q) return 0;
    return n.includes(q) ? 1 : 2;
  };
  return [...list].sort((a, b) => group(a) - group(b) || b.stars - a.stars);
}

/**
 * A single word such as `sylius` means a repository: the most starred match
 * named like the word (or simply the most starred match), otherwise
 * `sylius/sylius`.
 */
export async function expandShorthand(input: string): Promise<string> {
  const v = input.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(v)) return v;
  try {
    const hits = await Promise.race([searchRepositories(v), new Promise<RepoSuggestion[]>((r) => setTimeout(() => r([]), 2500))]);
    // Names compare without punctuation (nextjs matches next.js); among those the most starred wins.
    const named = hits.filter((h) => norm(h.fullName.split("/")[1]) === norm(v)).sort((a, b) => b.stars - a.stars)[0];
    const top = [...hits].sort((a, b) => b.stars - a.stars)[0];
    if (named && (!top || named.stars >= top.stars * 0.25)) return named.fullName;
    if (top) return top.fullName;
  } catch {
    /* offline or rate limited */
  }
  return `${v}/${v}`;
}

export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
}
