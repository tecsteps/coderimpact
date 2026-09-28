import type { ExplainTask } from "./context";

export interface Explanation {
  /** For a selected fragment: what exactly that term means (the summary is then its role here). */
  term?: string;
  summary: string;
  /** The reply broke the contract (for example Markdown or a list) and was cleaned up. */
  fallback: boolean;
}

/** Sentence and length limits per task. The contract is plain comment text. */
const LIMITS: Record<ExplainTask, { sentences: number; chars: number }> = {
  line: { sentences: 2, chars: 480 },
  selection: { sentences: 2, chars: 520 },
  declaration: { sentences: 4, chars: 900 },
};

/**
 * List markers at the start of a line. The indent before a marker stays on its own line
 * (no line breaks), so matching stays linear; whitespace is collapsed afterwards anyway.
 */
const LIST_MARKER = /^[ \t]*(?:[-*•]|\d+[.)])\s+/gm;
const HAS_LIST_MARKER = /^[ \t]*(?:[-*•]|\d+[.)])\s/m;

function clean(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(LIST_MARKER, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits into sentences without breaking inside backtick code spans. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    cur += ch;
    if (ch === "`") inCode = !inCode;
    if (!inCode && /[.!?]/.test(ch) && (i + 1 === text.length || /\s/.test(text[i + 1])) && !/\b(e\.g|i\.e|etc|vs)\.$/i.test(cur)) {
      out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function limitChars(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const space = cut.lastIndexOf(" ");
  return (space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:]$/, "") + "…";
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9_$]+/g) ?? []);
}

/** Drops a sentence that mostly repeats an earlier one (models sometimes restate their answer). */
export function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const sentence of list) {
    const w = words(sentence);
    const repeat = out.some((prev) => {
      const p = words(prev);
      let shared = 0;
      for (const x of w) if (p.has(x)) shared++;
      return w.size > 0 && shared / Math.min(w.size, p.size) >= 0.6;
    });
    if (!repeat) out.push(sentence);
  }
  return out;
}

/** Drops a closing ``` at the very end and the whitespace before it. */
function stripClosingFence(text: string): string {
  return text.endsWith("```") ? text.slice(0, -3).trimEnd() : text;
}

/** Replaces every ```lang fenced block with its content (the fence line's language and newline dropped). */
function unfence(text: string): string {
  let out = "";
  let from = 0;
  let open = text.indexOf("```");
  while (open >= 0) {
    let body = open + 3;
    while (body < text.length && /[a-z]/i.test(text[body])) body++;
    if (text[body] === "\n") body++;
    const close = text.indexOf("```", body);
    if (close < 0) break;
    out += text.slice(from, open) + text.slice(body, close);
    from = close + 3;
    open = text.indexOf("```", from);
  }
  return out + text.slice(from);
}

/** Replaces every `<...>` tag with a space. */
function stripTags(text: string): string {
  let out = "";
  let from = 0;
  let open = text.indexOf("<");
  while (open >= 0) {
    const close = text.indexOf(">", open + 1);
    if (close < 0) break;
    out += text.slice(from, open) + " ";
    from = close + 1;
    open = text.indexOf("<", from);
  }
  return out + text.slice(from);
}

/** Whether the text has a non-empty `<...>` tag. */
function hasTag(text: string): boolean {
  const lastClose = text.lastIndexOf(">");
  for (let i = text.indexOf("<"); i >= 0 && i + 1 < lastClose; i = text.indexOf("<", i + 1)) {
    if (text[i + 1] !== ">") return true;
  }
  return false;
}

/** Parses a JSON reply ({summary, points} or a bare string), for models that ignore the text contract. */
function jsonText(raw: string): string | null {
  const text = stripClosingFence(raw.trim().replace(/^```(?:json)?\s*/i, ""));
  if (!text.startsWith("{") && !text.startsWith('"')) return null;
  try {
    const data = JSON.parse(text) as unknown;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const d = data as { summary?: unknown; points?: unknown; comment?: unknown };
      const parts = [d.summary ?? d.comment, ...(Array.isArray(d.points) ? d.points : [])].filter((x): x is string => typeof x === "string");
      return parts.length ? parts.join(" ") : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Where a line starting with "Here:" begins (any case), or -1. Line scan, no regex backtracking. */
function hereAt(raw: string): number {
  let offset = 0;
  for (const line of raw.split("\n")) {
    const lead = line.length - line.trimStart().length;
    if (line.trimStart().toLowerCase().startsWith("here:")) return offset + lead;
    offset += line.length + 1;
  }
  return -1;
}

/**
 * Validates the model's reply against the contract (a short plain-text
 * comment) and enforces the length rules. The UI always renders text,
 * never HTML.
 */
export function parseExplanation(raw: string, task: ExplainTask, opts: { fragment?: string } = {}): Explanation {
  if (opts.fragment) {
    // Two parts: the term itself, then a paragraph that starts with "Here:".
    const at = hereAt(raw);
    if (at > 0) {
      const term = parseExplanation(raw.slice(0, at), "selection");
      const here = parseExplanation(raw.slice(at).trimStart().slice("Here:".length), "selection");
      return { term: limitChars(dedupe(sentences(term.summary)).slice(0, 3).join(" "), 560), summary: here.summary, fallback: term.fallback || here.fallback };
    }
  }
  const limits = LIMITS[task];
  const fromJson = jsonText(raw);
  const source = fromJson ?? raw;
  const stripped = stripTags(unfence(source)).replace(/^\s*(?:Comment|Explanation)\s*:\s*/i, "");
  const text = clean(stripped);
  if (!text) throw new Error("The model returned an empty answer.");
  const broke = fromJson !== null || raw.includes("```") || hasTag(raw) || HAS_LIST_MARKER.test(raw) || raw.includes("**");
  const summary = limitChars(dedupe(sentences(text)).slice(0, limits.sentences).join(" "), limits.chars);
  return { summary, fallback: broke };
}

/**
 * Code-shaped names from the code that was sent (camelCase, snake_case, $vars,
 * Foo::bar, obj.prop, names with digits), plus a selected fragment. Explanations
 * box these even when the model left them unmarked; plain English stays plain.
 */
export function codeWordsOf(code: string, fragment?: string): Set<string> {
  const words = new Set<string>();
  for (const m of code.matchAll(/[$A-Za-z_][\w$]*(?:(?:::|->|\.)[$A-Za-z_][\w$]*)*/g)) {
    const w = m[0];
    if (w.length < 3) continue;
    if (/[_$]|[a-z][A-Z]|::|->|\.|\d/.test(w)) words.add(w);
  }
  if (fragment && /^[$\w:>.-]+$/.test(fragment)) words.add(fragment);
  return words;
}

/** Wraps known code words that stand alone in plain text in backticks. */
export function boxCodeWords(text: string, words: Set<string>): string {
  if (words.size === 0) return text;
  return codeSegments(text)
    .map((s) => {
      if (s.code) return `\`${s.text}\``;
      return s.text.replace(/[$A-Za-z_][\w$]*(?:(?:::|->|\.)[$A-Za-z_][\w$]*)*/g, (w) => (words.has(w) ? `\`${w}\`` : w));
    })
    .join("");
}

/** Splits text into plain and `code` segments for safe rendering. */
export function codeSegments(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ code: false, text: text.slice(last, m.index) });
    out.push({ code: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) });
  return out;
}
