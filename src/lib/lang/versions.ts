import type { SemanticLanguage } from "./registry";

/** Adapter versions are part of the persistent index cache key. Bump when extraction changes. */
const HAND_WRITTEN: Partial<Record<SemanticLanguage, string>> = { go: "go-1", php: "php-1" };
/** The generic (Tree-sitter tags) adapter; bump when its extraction or any query changes. */
const GENERIC_ADAPTER_VERSION = "gen-3";

export function adapterVersion(lang: SemanticLanguage): string {
  return HAND_WRITTEN[lang] ?? `${lang}-${GENERIC_ADAPTER_VERSION}`;
}
