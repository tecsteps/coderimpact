import type { Block } from "../lang/types";
import { redactSecrets } from "./secrets.ts";

export type ExplainTask = "line" | "selection" | "declaration";

/** Most bytes of code sent for one explanation. */
export const MAX_CONTEXT_BYTES = 12_000;
/** Lines around the selection when there is no small enclosing declaration to send. */
export const WINDOW_LINES = 15;
/** An enclosing block (function, class, or any bracketed block) is sent whole up to this many lines. */
export const MAX_ENCLOSING_LINES = 50;
/** Doc comments and attributes above a declaration are included up to this many lines. */
const MAX_DOC_LINES = 30;

export interface ExplainContext {
  task: ExplainTask;
  path: string;
  language: string;
  /** First and last line of the code sent. */
  startLine: number;
  endLine: number;
  /** Lines the explanation is about. */
  focusStart: number;
  focusEnd: number;
  /** What kind of declaration, for declaration tasks. */
  declKind?: Block["kind"];
  declName?: string;
  /** Code exactly as sent, one `N | text` row per line. */
  code: string;
  /** The selected lines as sent (redacted), without line numbers. */
  selectionText: string;
  enclosingSignature?: string;
  /** Languages the reader knows well, used to relate explanations. */
  familiar: string[];
  truncated: boolean;
  redactions: number;
  redactionKinds: string[];
  bytes: number;
  /** The exact text selected, when it is part of a single line: explained precisely, then in context. */
  fragment?: string;
  /** A prompt template the reader customized; the default prompt when absent. */
  template?: { system: string; user: string };
}

function numbered(lines: string[], start: number): string {
  const width = String(start + lines.length - 1).length;
  return lines.map((l, i) => `${String(start + i).padStart(width)} | ${l}`).join("\n");
}

function byteSize(lines: string[], lastLine: number): number {
  const prefix = String(lastLine).length + 3;
  let bytes = 0;
  for (const l of lines) bytes += new TextEncoder().encode(l).length + 1 + prefix;
  return bytes;
}

/** Keeps whole lines until the numbered excerpt (`N | text`) would exceed maxBytes. */
function capLines(lines: string[], maxBytes: number, lastLine: number): { lines: string[]; truncated: boolean } {
  const prefix = String(lastLine).length + 3;
  let bytes = 0;
  const out: string[] = [];
  for (const l of lines) {
    bytes += new TextEncoder().encode(l).length + 1 + prefix;
    if (bytes > maxBytes && out.length > 0) return { lines: out, truncated: true };
    out.push(l.length > 2000 ? l.slice(0, 2000) + " …" : l);
  }
  return { lines: out, truncated: false };
}

/** The smallest block of the given kinds (any kind when omitted) that contains `line`. */
export function innermostBlock(blocks: Block[], line: number, kinds?: Block["kind"][]): Block | undefined {
  let best: Block | undefined;
  for (const b of blocks) {
    if (kinds && !kinds.includes(b.kind)) continue;
    if (b.startLine <= line && line <= b.endLine && (!best || b.endLine - b.startLine < best.endLine - best.startLine)) best = b;
  }
  return best;
}

/** First line of the doc comment and attributes directly above a declaration. */
export function docStart(lines: string[], declStart: number): number {
  let start = declStart;
  for (let i = declStart - 1; i >= 1 && declStart - i <= MAX_DOC_LINES; i--) {
    const t = lines[i - 1]?.trim() ?? "";
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("#[") || t.startsWith("@") || t.endsWith("*/")) start = i;
    else break;
  }
  return start;
}

/** Most lines a single statement may be widened to. */
const MAX_STATEMENT_LINES = 80;

const LINE_TERMINATORS = new Set(["\n", "\r", "\u2028", "\u2029"]);

/**
 * Cuts a trailing `//` or `#` comment (but not a `#[` attribute) off a line: the same
 * as `.replace(/\/\/.*$|#(?!\[).*$/, "")`, in linear time. A comment only counts
 * when no line break follows it.
 */
function stripLineComment(code: string): string {
  let from = 0;
  for (let i = code.length - 1; i >= 0; i--) {
    if (LINE_TERMINATORS.has(code[i])) {
      from = i + 1;
      break;
    }
  }
  for (let i = from; i < code.length; i++) {
    if (code[i] === "/" && code[i + 1] === "/") return code.slice(0, i);
    if (code[i] === "#" && code[i + 1] !== "[") return code.slice(0, i);
  }
  return code;
}

/** Net ( and [ on a line, ignoring strings and trailing comments. Braces are left out on purpose. */
function bracketDelta(line: string): number {
  const code = stripLineComment(line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""'));
  let d = 0;
  for (const ch of code) {
    if (ch === "(" || ch === "[") d++;
    else if (ch === ")" || ch === "]") d--;
  }
  return d;
}

/**
 * Widens a single line to its whole statement when the line opens a bracket
 * that closes later (Go `import (`, `var (`, a multi-line call, a PHP array),
 * or closes one opened earlier (a lone `)`).
 */
export function statementRange(lines: string[], line: number): [number, number] {
  const d = bracketDelta(lines[line - 1] ?? "");
  if (d > 0) {
    let bal = d;
    for (let i = line + 1; i <= lines.length && i - line <= MAX_STATEMENT_LINES; i++) {
      bal += bracketDelta(lines[i - 1]);
      if (bal <= 0) return [line, i];
    }
  } else if (d < 0) {
    let bal = d;
    for (let i = line - 1; i >= 1 && line - i <= MAX_STATEMENT_LINES; i--) {
      bal += bracketDelta(lines[i - 1]);
      if (bal >= 0) return [i, line];
    }
  }
  return [line, line];
}

export interface BuildContextInput {
  task: ExplainTask;
  path: string;
  language: string;
  /** All lines of the file. */
  lines: string[];
  /** 1-based inclusive range to explain. For declarations, the block range. */
  start: number;
  end: number;
  blocks: Block[];
  block?: Block;
  familiar?: string[];
}

/** A declaration with its doc comment. */
function declarationRange(input: BuildContextInput): [number, number] {
  return [docStart(input.lines, Math.max(1, input.start)), Math.min(input.lines.length, input.end)];
}

/** Multi-line bracket pairs ({…}, […], (…)) as [open line, close line], 1-based. Strings and // comments are skipped. */
export function bracketPairs(lines: string[]): [number, number][] {
  const pairs: [number, number][] = [];
  const stack: number[] = [];
  lines.forEach((line, i) => scanBrackets(line, i + 1, stack, pairs));
  return pairs;
}

/** Index of the quote that closes the string opened at `start`, or the line's end. */
function stringEnd(line: string, start: number): number {
  let escaped = false;
  for (let j = start + 1; j < line.length; j++) {
    if (escaped) escaped = false;
    else if (line[j] === "\\") escaped = true;
    else if (line[j] === line[start]) return j;
  }
  return line.length;
}

/** One line of bracketPairs: pushes openers, pairs closers with the line they opened on. */
function scanBrackets(line: string, n: number, stack: number[], pairs: [number, number][]) {
  let j = 0;
  while (j < line.length) {
    const ch = line[j];
    if (ch === "/" && line[j + 1] === "/") return;
    if (ch === '"' || ch === "'" || ch === "`") j = stringEnd(line, j);
    else if ("{[(".includes(ch)) stack.push(n);
    else if ("}])".includes(ch)) closeBracket(n, stack, pairs);
    j++;
  }
}

function closeBracket(n: number, stack: number[], pairs: [number, number][]) {
  const open = stack.pop();
  if (open !== undefined && open < n) pairs.push([open, n]);
}

/**
 * The code around a selection by its brackets: the largest enclosing block
 * that fits MAX_ENCLOSING_LINES, or, when even the innermost one is longer,
 * that many lines around the selection inside it.
 */
export function bracketRange(lines: string[], focusStart: number, focusEnd: number): [number, number] | null {
  const around = bracketPairs(lines)
    .filter(([s, e]) => s <= focusStart && e >= focusEnd)
    .sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
  if (!around.length) return null;
  const fitting = around.filter(([s, e]) => e - s < MAX_ENCLOSING_LINES);
  if (fitting.length) return fitting.at(-1)!;
  const [s, e] = around[0];
  const room = Math.max(0, MAX_ENCLOSING_LINES - (focusEnd - focusStart + 1));
  const start = Math.max(s, focusStart - Math.floor(room / 2));
  const end = Math.min(e, start + MAX_ENCLOSING_LINES - 1);
  return [Math.max(s, end - MAX_ENCLOSING_LINES + 1), end];
}

/**
 * For a line or selection: the enclosing function or class with its doc comment when
 * it is small enough, otherwise lines around the selection.
 */
function surroundingRange(input: BuildContextInput, focusStart: number, focusEnd: number): [number, number] {
  const { lines } = input;
  const total = lines.length;
  const fits = ([s, e]: [number, number]) => e - s < MAX_ENCLOSING_LINES && byteSize(lines.slice(s - 1, e), e) <= MAX_CONTEXT_BYTES;
  const enclosing = innermostBlock(input.blocks, focusStart);
  if (enclosing && enclosing.endLine >= focusEnd) {
    const r: [number, number] = [docStart(lines, enclosing.startLine), Math.min(total, enclosing.endLine)];
    if (fits(r)) return r;
  }
  const bracketed = bracketRange(lines, focusStart, focusEnd);
  if (bracketed && byteSize(lines.slice(bracketed[0] - 1, bracketed[1]), bracketed[1]) <= MAX_CONTEXT_BYTES) return bracketed;
  const range: [number, number] = [Math.max(1, focusStart - WINDOW_LINES), Math.min(total, focusEnd + WINDOW_LINES)];
  if (byteSize(lines.slice(range[0] - 1, range[1]), range[1]) > MAX_CONTEXT_BYTES) {
    return [Math.max(1, focusStart - 3), Math.min(total, focusEnd + 3)];
  }
  return range;
}

/**
 * Builds exactly what is sent. Never the whole file (unless it is tiny) and
 * never other files:
 *  - declaration: the declaration with its doc comment, capped
 *  - line or selection: the enclosing function or class with its doc comment
 *    when it is at most 50 lines and fits the cap, else the largest enclosing
 *    bracketed block up to 50 lines, otherwise 15 lines around the selection
 *    plus the enclosing signature
 */
export function buildContext(input: BuildContextInput): ExplainContext {
  const { lines } = input;
  let task = input.task;
  let focusStart = input.start;
  let focusEnd = task === "line" ? input.start : input.end;
  if (task === "line") {
    // Explain the whole statement when the line opens or closes a multi-line bracket.
    [focusStart, focusEnd] = statementRange(lines, input.start);
    if (focusEnd > focusStart) task = "selection";
  }
  const range = task === "declaration" ? declarationRange(input) : surroundingRange(input, focusStart, focusEnd);
  const startLine = range[0];
  const capped = capLines(lines.slice(startLine - 1, range[1]), MAX_CONTEXT_BYTES, range[1]);
  const slice = capped.lines;
  const truncated = capped.truncated;
  const endLine = truncated ? startLine + slice.length - 1 : range[1];

  let enclosingSignature: string | undefined;
  const enclosing = task === "declaration" ? undefined : innermostBlock(input.blocks, focusStart);
  if (enclosing && enclosing.declLine < startLine) enclosingSignature = enclosing.signature.slice(0, 400);

  const redacted = redactSecrets(slice.join("\n"));
  const sentLines = redacted.text.split("\n");
  let code = numbered(sentLines, startLine);
  if (truncated) code += `\n… truncated after line ${endLine} to stay within ${MAX_CONTEXT_BYTES / 1000} KB`;
  const sig = enclosingSignature ? redactSecrets(enclosingSignature).text : undefined;
  const selectionText = sentLines.slice(Math.max(0, focusStart - startLine), Math.max(0, Math.min(focusEnd, endLine) - startLine + 1)).join("\n");

  return {
    task,
    path: input.path,
    language: input.language,
    startLine,
    endLine,
    focusStart,
    focusEnd,
    declKind: input.block?.kind,
    declName: input.block?.label,
    code,
    selectionText,
    enclosingSignature: sig,
    familiar: input.familiar ?? [],
    truncated,
    redactions: redacted.count,
    redactionKinds: redacted.kinds,
    bytes: new TextEncoder().encode(code + (sig ?? "")).length,
  };
}
