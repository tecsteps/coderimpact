/**
 * Code themes. Each maps a Shiki theme to the reader's editor chrome, so the
 * gutter, focused line, selection and annotation rows keep their contrast in
 * whichever code theme is chosen, independent of the app appearance.
 */
export interface CodeTheme {
  id: string;
  label: string;
  shiki: string;
  type: "light" | "dark";
  vars: {
    bg: string;
    fg: string;
    gutter: string;
    gutterActive: string;
    lineFocus: string;
    selection: string;
    border: string;
    annoBg: string;
    annoRail: string;
    annoLabel: string;
    annoText: string;
    annoMuted: string;
    symbolHighlight: string;
    searchMatch: string;
    icon: string;
  };
}

import { GENERATED_THEMES } from "./themes.generated";

const HAND_TUNED: CodeTheme[] = [
  {
    id: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    shiki: "catppuccin-macchiato",
    type: "dark",
    vars: {
      bg: "#24273a", fg: "#cad3f5", gutter: "#6e738d", gutterActive: "#cad3f5", lineFocus: "#363a4f",
      selection: "rgba(147, 154, 183, 0.32)", border: "#363a4f", annoBg: "#2b2f45", annoRail: "#c6a0f6",
      annoLabel: "#c6a0f6", annoText: "#cad3f5", annoMuted: "#a5adcb", symbolHighlight: "rgba(138, 173, 244, 0.22)",
      searchMatch: "rgba(238, 212, 159, 0.30)", icon: "#8087a2",
    },
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    shiki: "catppuccin-latte",
    type: "light",
    vars: {
      bg: "#eff1f5", fg: "#4c4f69", gutter: "#8c8fa1", gutterActive: "#4c4f69", lineFocus: "#e2e5ee",
      selection: "rgba(124, 127, 147, 0.25)", border: "#dce0e8", annoBg: "#e8e3f5", annoRail: "#8839ef",
      annoLabel: "#7132d1", annoText: "#3b3e55", annoMuted: "#5c5f77", symbolHighlight: "rgba(30, 102, 245, 0.14)",
      searchMatch: "rgba(223, 142, 29, 0.25)", icon: "#7c7f93",
    },
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    shiki: "github-dark-default",
    type: "dark",
    vars: {
      bg: "#0d1117", fg: "#e6edf3", gutter: "#6e7681", gutterActive: "#e6edf3", lineFocus: "#161b22",
      selection: "rgba(56, 139, 253, 0.28)", border: "#21262d", annoBg: "#151b24", annoRail: "#d2a8ff",
      annoLabel: "#d2a8ff", annoText: "#e6edf3", annoMuted: "#9198a1", symbolHighlight: "rgba(56, 139, 253, 0.22)",
      searchMatch: "rgba(187, 128, 9, 0.35)", icon: "#7d8590",
    },
  },
  {
    id: "github-light",
    label: "GitHub Light",
    shiki: "github-light-default",
    type: "light",
    vars: {
      bg: "#ffffff", fg: "#1f2328", gutter: "#6e7781", gutterActive: "#1f2328", lineFocus: "#f3f6fa",
      selection: "rgba(84, 174, 255, 0.30)", border: "#d1d9e0", annoBg: "#f5f0ff", annoRail: "#8250df",
      annoLabel: "#6639ba", annoText: "#1f2328", annoMuted: "#59636e", symbolHighlight: "rgba(9, 105, 218, 0.12)",
      searchMatch: "rgba(212, 167, 44, 0.35)", icon: "#6e7781",
    },
  },
];

/**
 * Every Shiki theme. The four hand-tuned ones come first; the others get
 * their chrome from the theme's own editor colors (scripts/gen-themes.mjs).
 * The Artifact build bundles only the hand-tuned themes.
 */
export const CODE_THEMES: CodeTheme[] = import.meta.env.VITE_ROUTER === "hash" ? HAND_TUNED : [...HAND_TUNED, ...GENERATED_THEMES];

export const DEFAULT_CODE_THEME = "catppuccin-macchiato";

export function codeTheme(id: string): CodeTheme {
  return CODE_THEMES.find((t) => t.id === id) ?? CODE_THEMES[0];
}

/** CSS custom properties applied to the code canvas. */
export function codeThemeStyle(theme: CodeTheme): Record<string, string> {
  const v = theme.vars;
  return {
    "--code-bg": v.bg,
    "--code-fg": v.fg,
    "--code-gutter": v.gutter,
    "--code-gutter-active": v.gutterActive,
    "--code-line-focus": v.lineFocus,
    "--code-selection": v.selection,
    "--code-border": v.border,
    "--anno-bg": v.annoBg,
    "--anno-rail": v.annoRail,
    "--anno-label": v.annoLabel,
    "--anno-text": v.annoText,
    "--anno-muted": v.annoMuted,
    "--code-symbol": v.symbolHighlight,
    "--code-match": v.searchMatch,
    "--code-icon": v.icon,
    colorScheme: theme.type,
  };
}
