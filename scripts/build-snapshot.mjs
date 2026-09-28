#!/usr/bin/env node
// Builds a repository snapshot for the claude.ai Artifact demo, which cannot
// reach GitHub at runtime.
//
//   node scripts/build-snapshot.mjs owner/repo [ref] [--out artifact/public/snapshots]
//
// Uses 3 unauthenticated GitHub API calls (repo, ref, recursive tree) and
// fetches text files from raw.githubusercontent.com at the pinned commit.
// Binary files, files over 300 KB and vendor/node_modules are left out; the
// reader explains that when such a file is opened.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : "artifact/public/snapshots";
const [slug, refArg] = args.filter((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
if (!slug?.includes("/")) {
  console.error("Usage: node scripts/build-snapshot.mjs owner/repo [ref]");
  process.exit(1);
}
const [owner, repo] = slug.split("/");
const API = "https://api.github.com";
const MAX_BYTES = 300_000;
const BINARY_EXTENSIONS = new Set(
  ["png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "pdf", "zip", "gz", "tgz", "jar", "exe", "dll", "so", "dylib", "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "mov", "wasm", "phar", "bin", "lock"],
);
/** Binary files and lock files, by extension (case-insensitive). */
function isBinary(path) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}
const SKIP = /(^|\/)(vendor|node_modules|dist|build)\//;

async function api(path) {
  const res = await fetch(API + path, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const info = await api(`/repos/${owner}/${repo}`);
const refName = refArg ?? info.default_branch;
const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/${refName}`);
const commitSha = ref.object.sha;
const tree = await api(`/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
if (tree.truncated) console.warn("Warning: GitHub truncated the tree; the snapshot is partial.");

const wanted = tree.tree.filter((t) => t.type === "blob" && !isBinary(t.path) && !SKIP.test(t.path) && (t.size ?? 0) <= MAX_BYTES && !t.mode.startsWith("12"));
const files = {};
let i = 0;
async function worker() {
  while (i < wanted.length) {
    const t = wanted[i++];
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/${t.path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.subarray(0, 8000).includes(0)) continue;
    files[t.path] = new TextDecoder().decode(buf);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

const snapshot = {
  owner: info.owner.login,
  repo: info.name,
  defaultBranch: info.default_branch,
  refName,
  commitSha,
  description: info.description ?? undefined,
  htmlUrl: info.html_url,
  createdAt: new Date().toISOString(),
  tree: tree.tree,
  files,
};
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${info.owner.login}__${info.name}.json`);
writeFileSync(file, JSON.stringify(snapshot));
const bytes = Object.values(files).reduce((n, s) => n + s.length, 0);
console.log(`${file}: ${refName} @ ${commitSha.slice(0, 7)}, ${Object.keys(files).length} of ${tree.tree.filter((t) => t.type === "blob").length} files, ${(bytes / 1e6).toFixed(2)} MB of text`);
