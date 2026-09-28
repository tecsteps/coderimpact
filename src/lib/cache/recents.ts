export interface RecentRepo {
  owner: string;
  repo: string;
  /** Branch or tag name the visitor opened, if any. */
  refName?: string;
  sha: string;
  path?: string;
  openedAt: number;
}

const KEY = "ci.recents";
const MAX = 8;

export function getRecents(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentRepo[]) : [];
    return Array.isArray(list) ? list.filter((r) => r?.owner && r.repo) : [];
  } catch {
    return [];
  }
}

export function addRecent(entry: Omit<RecentRepo, "openedAt">) {
  const list = getRecents().filter(
    (r) => !(r.owner.toLowerCase() === entry.owner.toLowerCase() && r.repo.toLowerCase() === entry.repo.toLowerCase()),
  );
  list.unshift({ ...entry, openedAt: Date.now() });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* ignore */
  }
}

export function removeRecent(owner: string, repo: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecents().filter((r) => !(r.owner === owner && r.repo === repo))));
  } catch {
    /* ignore */
  }
}

export function clearRecents() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(ts).toLocaleDateString();
}
