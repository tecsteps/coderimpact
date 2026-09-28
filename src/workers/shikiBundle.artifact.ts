import { createHighlighterCore, type HighlighterCore, type LanguageInput } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

/**
 * Small Shiki bundle for the Artifact build: the four code themes and the
 * grammars that the bundled snapshot repositories use. Keeps the published
 * file count within the Artifact limits.
 */
const LANGS: Record<string, () => Promise<{ default: LanguageInput }>> = {
  go: () => import("@shikijs/langs/go"),
  php: () => import("@shikijs/langs/php"),
  markdown: () => import("@shikijs/langs/markdown"),
  yaml: () => import("@shikijs/langs/yaml"),
  json: () => import("@shikijs/langs/json"),
  javascript: () => import("@shikijs/langs/javascript"),
  typescript: () => import("@shikijs/langs/typescript"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  xml: () => import("@shikijs/langs/xml"),
  toml: () => import("@shikijs/langs/toml"),
  make: () => import("@shikijs/langs/make"),
  docker: () => import("@shikijs/langs/docker"),
  ini: () => import("@shikijs/langs/ini"),
  twig: () => import("@shikijs/langs/twig"),
};

export function createCodeHighlighter(): Promise<HighlighterCore> {
  return createHighlighterCore({
    themes: [
      import("@shikijs/themes/catppuccin-macchiato"),
      import("@shikijs/themes/catppuccin-latte"),
      import("@shikijs/themes/github-dark-default"),
      import("@shikijs/themes/github-light-default"),
    ],
    langs: [],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
}

export function hasLanguage(id: string): boolean {
  return id in LANGS;
}

export async function ensureLanguage(hl: HighlighterCore, id: string): Promise<void> {
  if (hl.getLoadedLanguages().includes(id)) return;
  const mod = await LANGS[id]();
  await hl.loadLanguage(mod.default);
}

/** Only the four bundled themes exist here. */
export async function ensureTheme(hl: HighlighterCore, id: string): Promise<string> {
  return hl.getLoadedThemes().includes(id) ? id : "github-dark-default";
}
