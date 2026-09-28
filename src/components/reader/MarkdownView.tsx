import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { hrefFor, navigate, readerUrl } from "@/lib/router";
import { dirname } from "@/lib/util/files";
import { highlightClient, type TokenTuple } from "@/lib/highlight/client";
import { codeTheme, codeThemeStyle } from "@/lib/highlight/themes";
import { useSettings } from "@/lib/cache/settings";
import type { ResolvedRepo } from "@/lib/github/source";

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

/** Resolves a relative link against the Markdown file's folder. Returns null for external or anchor links. */
function resolveRepoPath(fromPath: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) return null;
  const [pathPart] = href.split(/[?#]/);
  const parts = (pathPart.startsWith("/") ? pathPart.slice(1) : `${dirname(fromPath)}/${pathPart}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(decodeSegment(p));
  }
  return out.join("/");
}

/** A path segment with its %-escapes decoded; malformed escapes stay as written. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Highlighted lines as text-only spans (no HTML injection), newline-separated. */
function tokensToFragment(lines: TokenTuple[][]): DocumentFragment {
  const frag = document.createDocumentFragment();
  lines.forEach((line, n) => {
    for (const [content, color, fontStyle] of line) {
      const span = document.createElement("span");
      span.textContent = content;
      if (color) span.style.color = color;
      if (fontStyle && fontStyle & 1) span.style.fontStyle = "italic";
      frag.appendChild(span);
    }
    if (n < lines.length - 1) frag.appendChild(document.createTextNode("\n"));
  });
  return frag;
}

function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-");
}

/**
 * Rendered Markdown. The HTML is sanitized (no scripts, styles, event handlers
 * or frames); relative images load from the repository at the same commit,
 * relative links open in the reader, external links in a new tab.
 */
/** Local folders: points repository images at files read from disk. */
function loadRepoImages(root: HTMLElement, imageUrls: (path: string) => Promise<string[]>, isAlive: () => boolean, created: string[]) {
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-repo-src]")) {
    imageUrls(img.dataset.repoSrc!)
      .then((u) => showImage(img, u, isAlive(), created))
      .catch(() => undefined);
  }
}

function showImage(img: HTMLImageElement, urls: string[], alive: boolean, created: string[]) {
  created.push(...urls.filter((x) => x.startsWith("blob:")));
  if (alive && urls[0]) img.src = urls[0];
}

export function MarkdownView({
  text,
  path,
  repo,
  imageUrls,
}: Readonly<{
  text: string;
  path: string;
  repo: ResolvedRepo;
  /** Local folders: repository images are read from disk instead of GitHub. */
  imageUrls?: (path: string) => Promise<string[]>;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  const theme = codeTheme(settings.codeTheme);

  const html = useMemo(() => {
    const raw = marked.parse(text, { gfm: true, async: false }) as string;
    const rawBase = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.commitSha}/`;
    DOMPurify.removeAllHooks();
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      const el = node as HTMLElement;
      if (el.tagName === "IMG") {
        const src = el.getAttribute("src") ?? "";
        const local = resolveRepoPath(path, src);
        if (local !== null && imageUrls) {
          el.removeAttribute("src");
          el.dataset.repoSrc = local;
        } else if (local !== null) el.setAttribute("src", rawBase + local.split("/").map(encodeURIComponent).join("/"));
        el.setAttribute("loading", "lazy");
        el.setAttribute("referrerpolicy", "no-referrer");
      }
      if (el.tagName === "A") {
        const href = el.getAttribute("href") ?? "";
        const local = resolveRepoPath(path, href);
        if (local !== null) {
          el.setAttribute("href", hrefFor(readerUrl(repo.owner, repo.repo, repo.commitSha, local, "blob")));
          el.dataset.repoPath = local;
        } else if (!href.startsWith("#")) {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
      }
    });
    const clean = DOMPurify.sanitize(raw, {
      FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed", "script"],
      FORBID_ATTR: ["style"],
    });
    DOMPurify.removeAllHooks();
    return clean;
  }, [text, path, repo.owner, repo.repo, repo.commitSha]);

  // Heading anchors, and syntax highlighting for fenced code blocks (text only, no HTML injection).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
      if (!h.id) h.id = slug(h.textContent ?? "");
    });
    let alive = true;
    root.querySelectorAll<HTMLElement>("pre > code").forEach((code, i) => {
      const lang = /language-([\w-]+)/.exec(code.className)?.[1] ?? "text";
      const source = code.textContent ?? "";
      highlightClient
        .highlight(`md:${path}:${i}:${source.length}`, source, lang === "sh" || lang === "bash" ? "shellscript" : lang, theme.shiki)
        .then(({ lines }) => {
          if (alive) code.replaceChildren(tokensToFragment(lines));
        })
        .catch(() => undefined);
    });
    const created: string[] = [];
    if (imageUrls) loadRepoImages(root, imageUrls, () => alive, created);
    return () => {
      alive = false;
      created.forEach((x) => URL.revokeObjectURL(x));
    };
  }, [html, path, theme.shiki, imageUrls]);

  // Relative links open in the reader. Delegated on the article because its
  // content is injected HTML; Enter on a focused link fires the same click.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      const repoPath = a?.dataset.repoPath;
      if (repoPath !== undefined && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        navigate(readerUrl(repo.owner, repo.repo, repo.commitSha, repoPath, "blob"));
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [repo.owner, repo.repo, repo.commitSha]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" style={{ ...codeThemeStyle(theme), colorScheme: undefined } as React.CSSProperties}>
      <article
        ref={ref}
        className="md-body mx-auto w-full max-w-[860px] px-4 py-6 sm:px-10 sm:py-10"
        // Sanitized above with DOMPurify.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
