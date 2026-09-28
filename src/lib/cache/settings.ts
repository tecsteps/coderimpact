import { useSyncExternalStore } from "react";

export type Appearance = "system" | "light" | "dark";

export interface Settings {
  appearance: Appearance;
  codeTheme: string;
  codeSize: number;
  sidebarWidth: number;
  sidebarOpen: boolean;
  /** Soft-wrap long code lines instead of scrolling sideways. */
  softWrap: boolean;
  /** Languages the reader already knows well; explanations relate to them. Optional. */
  familiarLanguages: string[];
  /** Markdown files: rendered preview or source. */
  markdownView: "rendered" | "source";
  /** Customized explanation prompts per kind of explanation; missing kinds use the default prompt. */
  promptTemplates: Partial<Record<"line" | "selection" | "declaration", { system: string; user: string }>>;
  /** The reader agreed that code is sent to the AI chain (backend, OpenRouter, OpenAI). Only "yes" is remembered. */
  aiConsent: boolean;
}

/** Languages a reader can pick as a reference for explanations. */
export const FAMILIAR_LANGUAGE_OPTIONS = [
  "PHP", "Java", "JavaScript", "TypeScript", "Python", "C#", "Go", "Ruby", "Kotlin", "Swift", "C++", "C", "Rust", "Scala", "Dart", "Elixir",
];

export const CODE_SIZE_MIN = 12;
export const CODE_SIZE_MAX = 24;

export const DEFAULT_SETTINGS: Settings = {
  appearance: "system",
  codeTheme: "catppuccin-macchiato",
  codeSize: 14,
  sidebarWidth: 272,
  sidebarOpen: true,
  softWrap: false,
  familiarLanguages: [],
  markdownView: "rendered",
  promptTemplates: {},
  aiConsent: false,
};

const KEY = "ci.settings";
type Listener = () => void;
const listeners = new Set<Listener>();
let current: Settings = load();

function load(): Settings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return sanitize({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function sanitize(s: Settings): Settings {
  const appearance: Appearance = ["system", "light", "dark"].includes(s.appearance) ? s.appearance : "system";
  const size = Math.round(Number(s.codeSize));
  return {
    appearance,
    codeTheme: typeof s.codeTheme === "string" ? s.codeTheme : DEFAULT_SETTINGS.codeTheme,
    codeSize: Number.isFinite(size) ? Math.min(CODE_SIZE_MAX, Math.max(CODE_SIZE_MIN, size)) : 14,
    sidebarWidth: Math.min(520, Math.max(200, Number(s.sidebarWidth) || DEFAULT_SETTINGS.sidebarWidth)),
    sidebarOpen: s.sidebarOpen !== false,
    softWrap: s.softWrap === true,
    familiarLanguages: Array.isArray(s.familiarLanguages)
      ? s.familiarLanguages.filter((l) => FAMILIAR_LANGUAGE_OPTIONS.includes(l)).slice(0, 4)
      : [],
    markdownView: s.markdownView === "source" ? "source" : "rendered",
    promptTemplates: sanitizeTemplates(s.promptTemplates),
    aiConsent: s.aiConsent === true,
  };
}

function sanitizeTemplates(t: unknown): Settings["promptTemplates"] {
  const out: Settings["promptTemplates"] = {};
  if (!t || typeof t !== "object") return out;
  for (const task of ["line", "selection", "declaration"] as const) {
    const v = (t as Record<string, unknown>)[task] as { system?: unknown; user?: unknown } | undefined;
    if (v && typeof v.system === "string" && typeof v.user === "string") out[task] = { system: v.system.slice(0, 12_000), user: v.user.slice(0, 4_000) };
  }
  return out;
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage blocked: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: Listener) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = load();
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
