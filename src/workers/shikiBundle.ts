import { bundledLanguages, bundledThemes, createHighlighter, type Highlighter } from "shiki";

/** Full Shiki bundle: every grammar and theme, loaded on demand. */
export function createCodeHighlighter(): Promise<Highlighter> {
  return createHighlighter({ themes: [], langs: [] });
}

/** Loads the theme; returns the id to highlight with. */
export async function ensureTheme(hl: Highlighter, id: string): Promise<string> {
  const theme = id in bundledThemes ? id : "github-dark-default";
  if (!hl.getLoadedThemes().includes(theme)) await hl.loadTheme(theme as keyof typeof bundledThemes);
  return theme;
}

export function hasLanguage(id: string): boolean {
  return id in bundledLanguages;
}

export async function ensureLanguage(hl: Highlighter, id: string): Promise<void> {
  if (!hl.getLoadedLanguages().includes(id)) await hl.loadLanguage(id as keyof typeof bundledLanguages);
}
