// Generates src/lib/highlight/themes.generated.ts: the reader's editor chrome
// (gutter, focused line, selection, explanation rows) for every bundled Shiki
// theme, derived from the theme's own VS Code workbench colors.
// Run: node scripts/gen-themes.mjs
import { writeFileSync } from "node:fs";
import { bundledThemesInfo } from "shiki";

function parse(c) {
  if (typeof c !== "string" || !c.startsWith("#")) return null;
  let h = c.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i) => Number.parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}
const hex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const rgba = ({ r, g, b }, a) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(2)})`;
/** Color `c` over opaque `base`. */
const over = (c, base) => ({ r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a), a: 1 });
const mix = (a, b, t) => ({ r: a.r * t + b.r * (1 - t), g: a.g * t + b.g * (1 - t), b: a.b * t + b.b * (1 - t), a: 1 });
const lum = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const dist = (a, b) => Math.abs(lum(a) - lum(b));

/** A token color rule's scopes as a list. */
function ruleScopes(rule) {
  if (Array.isArray(rule.scope)) return rule.scope;
  if (typeof rule.scope === "string") return rule.scope.split(",").map((x) => x.trim());
  return [];
}

/** The foreground of the first rule that names `scope` and has a parsable color. */
function scopeColor(theme, scope) {
  for (const rule of theme.tokenColors ?? []) {
    if (!rule.settings?.foreground || !ruleScopes(rule).includes(scope)) continue;
    const c = parse(rule.settings.foreground);
    if (c) return c;
  }
  return null;
}

function tokenColor(theme, scopes) {
  for (const want of scopes) {
    const c = scopeColor(theme, want);
    if (c) return c;
  }
  return null;
}

/** The selection color: the theme's own (at least 25% opaque), or the foreground at 22%. */
function selectionColor(selRaw, fg) {
  if (!selRaw) return rgba(fg, 0.22);
  return selRaw.a < 1 ? rgba(selRaw, Math.max(selRaw.a, 0.25)) : rgba(selRaw, 0.45);
}

// The four hand-tuned themes keep their ids and colors (themes.ts).
const HAND_TUNED = new Set(["catppuccin-macchiato", "catppuccin-latte", "github-dark-default", "github-light-default"]);
// Shiki ids that would collide with the hand-tuned ids.
const RENAME = { "github-dark": ["github-dark-classic", "GitHub Dark Classic"], "github-light": ["github-light-classic", "GitHub Light Classic"] };

const out = [];
for (const info of bundledThemesInfo) {
  if (HAND_TUNED.has(info.id)) continue;
  const theme = (await info.import()).default;
  const c = theme.colors ?? {};
  const dark = info.type === "dark";
  const bg = over(parse(c["editor.background"]) ?? parse(theme.bg) ?? parse(dark ? "#1e1e1e" : "#ffffff"), parse(dark ? "#000000" : "#ffffff"));
  const fg = over(parse(c["editor.foreground"]) ?? parse(theme.fg) ?? parse(c.foreground) ?? parse(dark ? "#d4d4d4" : "#333333"), bg);
  let gutter = parse(c["editorLineNumber.foreground"]);
  gutter = gutter ? over(gutter, bg) : mix(fg, bg, 0.45);
  if (dist(gutter, bg) < 0.12) gutter = mix(fg, bg, 0.45);
  let active = parse(c["editorLineNumber.activeForeground"]);
  active = active ? over(active, bg) : fg;
  let focus = parse(c["editor.lineHighlightBackground"]);
  focus = focus && focus.a > 0.05 ? over(focus, bg) : mix(fg, bg, 0.07);
  if (dist(focus, bg) < 0.015) focus = mix(fg, bg, 0.08);
  const selRaw = parse(c["editor.selectionBackground"]);
  const selection = selectionColor(selRaw, fg);
  let border = parse(c["editorGroup.border"]) ?? parse(c["panel.border"]) ?? parse(c["editorWidget.border"]);
  border = border && border.a > 0.1 ? over(border, bg) : mix(fg, bg, 0.14);
  if (dist(border, bg) < 0.03) border = mix(fg, bg, 0.14);
  // Explanation accent: the keyword color, which is the theme's signature hue in most themes.
  let accent = tokenColor(theme, ["keyword", "storage.type", "keyword.control", "storage", "entity.name.function"]) ?? parse(c.focusBorder) ?? parse(c["textLink.foreground"]);
  accent = accent ? over(accent, bg) : mix(fg, bg, 0.8);
  if (dist(accent, bg) < 0.2) accent = mix(fg, bg, 0.85);
  const word = parse(c["editor.wordHighlightBackground"]);
  const find = parse(c["editor.findMatchHighlightBackground"]);
  const [id, label] = RENAME[info.id] ?? [info.id, info.displayName];
  out.push({
    id,
    label,
    shiki: info.id,
    type: info.type,
    vars: {
      bg: hex(bg),
      fg: hex(fg),
      gutter: hex(gutter),
      gutterActive: hex(active),
      lineFocus: hex(focus),
      selection,
      border: hex(border),
      annoBg: hex(mix(accent, bg, dark ? 0.08 : 0.07)),
      annoRail: hex(accent),
      annoLabel: hex(accent),
      annoText: hex(fg),
      annoMuted: hex(mix(fg, bg, 0.72)),
      symbolHighlight: word && word.a > 0.05 ? rgba(word, Math.min(Math.max(word.a, 0.18), 0.4)) : rgba(accent, 0.2),
      searchMatch: find && find.a > 0.05 ? rgba(find, Math.min(Math.max(find.a, 0.25), 0.45)) : rgba(parse("#e5b53c"), 0.32),
      icon: hex(mix(gutter, fg, 0.85)),
    },
  });
}
out.sort((a, b) => a.label.localeCompare(b.label));
const body = `// Generated by scripts/gen-themes.mjs. Do not edit.
import type { CodeTheme } from "./themes";

export const GENERATED_THEMES: CodeTheme[] = ${JSON.stringify(out, null, 1)};
`;
writeFileSync(new URL("../src/lib/highlight/themes.generated.ts", import.meta.url), body);
console.log(`${out.length} themes`);
