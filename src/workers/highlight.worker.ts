/// <reference lib="webworker" />
import { createCodeHighlighter, ensureLanguage, ensureTheme, hasLanguage } from "./shikiBundle";

/**
 * Syntax highlighting with Shiki, off the UI thread. Grammars load on demand;
 * the result is compact per-line token lists that the UI renders as text.
 */
declare const self: DedicatedWorkerGlobalScope;

export type TokenTuple = [content: string, color?: string, fontStyle?: number];

let highlighter: ReturnType<typeof createCodeHighlighter> | null = null;

const MAX_HIGHLIGHT_CHARS = 600_000;

self.onmessage = async (e: MessageEvent<{ id: number; code: string; lang: string; theme: string }>) => {
  const { id, code, lang, theme } = e.data;
  try {
    highlighter ??= createCodeHighlighter();
    const hl = await highlighter;
    let langId: string | null = hasLanguage(lang) ? lang : null;
    if (code.length > MAX_HIGHLIGHT_CHARS) langId = null;
    if (langId) await ensureLanguage(hl as never, langId);
    const themeId = await ensureTheme(hl as never, theme);
    const result = hl.codeToTokens(code, { lang: (langId ?? "text") as never, theme: themeId });
    const lines: TokenTuple[][] = result.tokens.map((line) =>
      line.map((t) => {
        const tuple: TokenTuple = [t.content];
        if (t.color) tuple[1] = t.color.toLowerCase();
        if (t.fontStyle) tuple[2] = t.fontStyle;
        return tuple;
      }),
    );
    self.postMessage({ id, lines });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
