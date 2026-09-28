import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { LineRange } from "@/lib/github/parseGithubUrl";
import { highlightClient, type TokenTuple } from "@/lib/highlight/client";
import { codeTheme, codeThemeStyle } from "@/lib/highlight/themes";
import type { Block, FileIndex } from "@/lib/lang/types";
import { updateSettings, useSettings } from "@/lib/cache/settings";
import { AnnotationRow } from "./AnnotationRow";
import { renderTokens, type HlRange } from "./renderTokens";
import type { Annotation, AnnotationAction, ExplainRequest, SymbolHighlight } from "./types";
import type { SymbolMenuAnchor } from "./SymbolMenu";
import type { Dependency } from "@/lib/deps";
import { caretAt, selectedCode, textOffset } from "./codeViewDom";
import { useFindInFile, type FindMatch } from "./useFindInFile";
import { FindBar } from "./FindBar";
import { useSelectionBar, type SelBar } from "./useSelectionBar";
import { DockedSelectionToolbar, FloatingSelectionToolbar } from "./SelectionToolbar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMediaQuery";

const CHUNK = 200;

export interface CodeViewProps {
  path: string;
  text: string;
  blobSha: string;
  lang: string;
  fileIndex?: FileIndex | null;
  focus?: LineRange;
  /** Changes whenever the view should scroll the focus into view (navigation, load). */
  revealKey: string;
  annotations: Annotation[];
  symbolHighlights?: SymbolHighlight[];
  searchQuery?: string;
  onFocus: (range: LineRange | undefined) => void;
  onExplain: (req: ExplainRequest) => void;
  /** `anchor` is set for a pointer click: where the symbol menu opens. */
  onSymbol: (line: number, col: number, opts: { goto: boolean; open: boolean; anchor?: SymbolMenuAnchor }) => boolean;
  onAnnotationAction: (id: string, action: AnnotationAction) => void;
  onCopyLink: (range: LineRange) => void;
  onEscape: () => void;
  onKeyCommand?: (cmd: "definition" | "references" | "rename") => void;
  bottomInset?: number;
  /** Package manifests: dependency names that open their repository. */
  dependencies?: Dependency[];
  onDependency?: (dep: Dependency) => void;
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function innermost(blocks: Block[], line: number, kinds: Block["kind"][]): Block | undefined {
  let best: Block | undefined;
  for (const b of blocks) {
    if (!kinds.includes(b.kind)) continue;
    if (b.startLine <= line && line <= b.endLine && (!best || b.endLine - b.startLine < best.endLine - best.startLine)) best = b;
  }
  return best;
}

interface RowProps {
  n: number;
  plain: string;
  tokens?: TokenTuple[];
  ranges?: HlRange[];
  focused: boolean;
  inRange: boolean;
  /** Inside the current text selection: the whole line is shaded. */
  selected?: boolean;
}

const Row = memo(function Row({ n, plain, tokens, ranges, focused, inRange, selected }: Readonly<RowProps>) {
  return (
    <div className={cn("cl", focused && "is-focused", inRange && !focused && "in-range", selected && "in-sel")} data-n={n} data-line={n} data-kind="source" id={`L${n}`}>
      {/* Explaining a function or class is in the symbol menu; this column is just the gap. */}
      <span className="gi" aria-hidden />
      <span className="cc">{renderTokens(tokens, plain, ranges)}</span>
    </div>
  );
});

function pushRange(m: Map<number, HlRange[]>, line: number, r: HlRange) {
  const list = m.get(line);
  if (list) list.push(r);
  else m.set(line, [r]);
}

/** Identifiers the index knows (and dependency names): these open a menu, so they get a light underline. */
function buildSymbolRanges(dependencies: Dependency[] | undefined, fileIndex: FileIndex | null | undefined): Map<number, HlRange[]> {
  const m = new Map<number, HlRange[]>();
  for (const d of dependencies ?? []) pushRange(m, d.line, [d.col, d.endCol, "dep-link"]);
  for (const o of fileIndex?.occurrences ?? []) {
    if (o.span.endLine !== o.span.line || o.span.endCol <= o.span.col) continue;
    pushRange(m, o.span.line, [o.span.col, o.span.endCol, "sym-link"]);
  }
  return m;
}

/** Symbol ranges plus highlights, find matches (while the find bar has a query) or search matches. */
function buildRangesByLine(
  symbolRanges: Map<number, HlRange[]>,
  highlights: SymbolHighlight[] | undefined,
  find: { matches: FindMatch[]; current: number } | null,
  searchQuery: string | undefined,
  lines: string[],
): Map<number, HlRange[]> {
  // Lines without highlights keep the same array, so their rows do not re-render.
  const m = new Map<number, HlRange[]>(symbolRanges);
  const copied = new Set<number>();
  const add = (line: number, r: HlRange) => {
    if (!copied.has(line)) {
      m.set(line, [...(m.get(line) ?? [])]);
      copied.add(line);
    }
    m.get(line)!.push(r);
  };
  for (const h of highlights ?? []) add(h.line, [h.col, h.endCol, h.def ? "sym-hl-def" : "sym-hl"]);
  if (find) {
    find.matches.forEach((f, i) => add(f.line, [f.col, f.col + f.len, i === find.current ? "find-hl-current" : "search-hl"]));
    return m;
  }
  if (!searchQuery || searchQuery.length < 2) return m;
  const needle = searchQuery.toLowerCase();
  lines.forEach((l, i) => {
    const hay = l.toLowerCase();
    let idx = hay.indexOf(needle);
    let guard = 0;
    while (idx >= 0 && guard++ < 50) {
      add(i + 1, [idx, idx + needle.length, "search-hl"]);
      idx = hay.indexOf(needle, idx + needle.length);
    }
  });
  return m;
}

interface ChunkParams {
  lines: string[];
  tokens: TokenTuple[][] | null;
  rangesByLine: Map<number, HlRange[]>;
  annotationsByAnchor: Map<number, Annotation[]>;
  focus?: LineRange;
  selBar: SelBar | null;
  onAnnotationAction: (id: string, action: AnnotationAction) => void;
}

/** Source rows (and the explanations under them) from `c` up to `end`. */
function chunkRows(p: ChunkParams, c: number, end: number): ReactNode[] {
  const { focus, selBar } = p;
  const rows: ReactNode[] = [];
  for (let i = c; i < end; i++) {
    const n = i + 1;
    const focused = focus?.start === n;
    rows.push(
      <Row
        key={n}
        n={n}
        plain={p.lines[i]}
        tokens={p.tokens?.[i]}
        ranges={p.rangesByLine.get(n)}
        focused={focused}
        inRange={!!focus && n >= focus.start && n <= focus.end}
        selected={!!selBar && n >= selBar.start && n <= selBar.end}
      />,
    );
    for (const a of p.annotationsByAnchor.get(n) ?? []) rows.push(<AnnotationRow key={`a-${a.id}`} a={a} onAction={p.onAnnotationAction} />);
  }
  return rows;
}

/**
 * Rows in chunks of CHUNK lines, each skipped by the browser while off screen
 * (content-visibility) unless it holds an explanation or the focused line.
 */
function buildChunks(p: ChunkParams): ReactNode[] {
  const chunks: ReactNode[] = [];
  const anchors = [...p.annotationsByAnchor.keys()];
  for (let c = 0; c < p.lines.length; c += CHUNK) {
    const end = Math.min(p.lines.length, c + CHUNK);
    const hasAnno = anchors.some((k) => k > c && k <= end);
    const hasFocus = !!p.focus && p.focus.start > c && p.focus.start <= end;
    chunks.push(
      <div
        key={c}
        className="code-chunk"
        style={{ containIntrinsicSize: `auto calc(${end - c} * 1em * var(--code-line-height))`, contentVisibility: hasAnno || hasFocus ? "visible" : undefined }}
      >
        {chunkRows(p, c, end)}
      </div>,
    );
  }
  return chunks;
}

interface PointerContext {
  focus?: LineRange;
  anchorLine: { current: number | null };
  toolbarRef: RefObject<HTMLElement | null>;
  updateSelection: () => void;
  onFocus: (range: LineRange | undefined) => void;
  onSymbol: CodeViewProps["onSymbol"];
  dependencies?: Dependency[];
  onDependency?: (dep: Dependency) => void;
}

/** Where the symbol menu opens: the visual line under the pointer (a wrapped row spans several). */
function menuAnchor(row: HTMLElement, cc: HTMLElement, e: PointerEvent): SymbolMenuAnchor {
  const r = row.getBoundingClientRect();
  const lh = Number.parseFloat(getComputedStyle(cc).lineHeight) || 20;
  const top = Math.max(r.top, r.top + Math.floor((e.clientY - r.top) / lh) * lh);
  return { x: e.clientX, top, bottom: top + lh };
}

/** A click on the code text: opens the dependency or symbol under it. True when the click is fully handled. */
function clickCode(e: PointerEvent, n: number, row: HTMLElement, cc: HTMLElement, ctx: PointerContext): boolean {
  const caret = caretAt(e.clientX, e.clientY);
  const col = caret ? textOffset(cc, caret.node, caret.offset) : null;
  if (col === null) return false;
  const dep = ctx.dependencies?.find((d) => d.line === n && col >= d.col && col < d.endCol);
  if (dep && ctx.onDependency) {
    ctx.onDependency(dep);
    ctx.onFocus({ start: n, end: n });
    return true;
  }
  const goto = e.metaKey || e.ctrlKey;
  const anchor = menuAnchor(row, cc, e);
  const hit = ctx.onSymbol(n, col, { goto, open: true, anchor }) || (col > 0 && ctx.onSymbol(n, col - 1, { goto, open: true, anchor }));
  return hit && goto;
}

function handlePointerUp(e: PointerEvent, ctx: PointerContext) {
  const target = e.target as HTMLElement;
  // The selection toolbar floats inside the lines, but its taps are its own.
  if (ctx.toolbarRef.current?.contains(target)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    ctx.updateSelection();
    return;
  }
  if (target.closest("button, a, .anno")) return;
  const row = target.closest<HTMLElement>(".cl");
  if (!row) return;
  const n = Number(row.dataset.line);
  const cc = row.querySelector<HTMLElement>(".cc")!;
  if (e.shiftKey && ctx.focus) {
    const anchor = ctx.anchorLine.current ?? ctx.focus.start;
    ctx.onFocus({ start: Math.min(anchor, n), end: Math.max(anchor, n) });
    return;
  }
  ctx.anchorLine.current = n;
  const inCode = e.clientX >= cc.getBoundingClientRect().left;
  if (inCode && clickCode(e, n, row, cc, ctx)) return;
  ctx.onFocus({ start: n, end: n });
}

interface KeyContext {
  focus?: LineRange;
  fileIndex?: FileIndex | null;
  lineCount: number;
  softWrap: boolean;
  linesRef: RefObject<HTMLElement | null>;
  anchorLine: { current: number | null };
  /** Index of the identifier picked with Left/Right on the focused line. */
  occCursor: { current: { line: number; i: number } };
  onFocus: (range: LineRange | undefined) => void;
  onExplain: (req: ExplainRequest) => void;
  onSymbol: CodeViewProps["onSymbol"];
  onKeyCommand?: (cmd: "definition" | "references" | "rename") => void;
  onEscape: () => void;
  clearSelBar: () => void;
}

function moveFocus(ctx: KeyContext, to: number, extend: boolean) {
  const n = Math.max(1, Math.min(ctx.lineCount, to));
  if (extend && ctx.focus) {
    const anchor = ctx.anchorLine.current ?? ctx.focus.start;
    ctx.onFocus({ start: Math.min(anchor, n), end: Math.max(anchor, n) });
  } else {
    ctx.anchorLine.current = n;
    ctx.onFocus({ start: n, end: n });
  }
  ctx.linesRef.current?.querySelector(`[data-line="${n}"]`)?.scrollIntoView({ block: "nearest" });
}

/** Left/Right: the previous or next identifier on the focused line. */
function stepOccurrence(e: KeyboardEvent, ctx: KeyContext) {
  const { focus, fileIndex } = ctx;
  if (!focus || !fileIndex) return;
  const occ = fileIndex.occurrences.filter((o) => o.span.line === focus.start).sort((a, b) => a.span.col - b.span.col);
  if (occ.length === 0) return;
  e.preventDefault();
  const current = ctx.occCursor.current.line === focus.start ? ctx.occCursor.current.i : -1;
  const next = e.key === "ArrowRight" ? (current + 1) % occ.length : (current - 1 + occ.length) % occ.length;
  ctx.occCursor.current = { line: focus.start, i: next };
  ctx.onSymbol(focus.start, occ[next].span.col, { goto: false, open: false });
}

function explainFocus(e: KeyboardEvent, ctx: KeyContext) {
  const { focus } = ctx;
  if (!focus) return;
  e.preventDefault();
  if (focus.end > focus.start) ctx.onExplain({ task: "selection", start: focus.start, end: focus.end });
  else ctx.onExplain({ task: "line", line: focus.start });
}

/** F and T: explain the function or class around the focused line. */
function explainEnclosing(e: KeyboardEvent, ctx: KeyContext, kinds: Block["kind"][]) {
  if (!ctx.focus || !ctx.fileIndex) return;
  const b = innermost(ctx.fileIndex.blocks, ctx.focus.start, kinds);
  if (b) {
    e.preventDefault();
    ctx.onExplain({ task: "declaration", block: b });
  }
}

function handleCodeKey(e: KeyboardEvent, ctx: KeyContext) {
  if (e.altKey && e.code === "KeyZ") {
    e.preventDefault();
    updateSettings({ softWrap: !ctx.softWrap });
    return;
  }
  if ((e.target as HTMLElement).closest("button, input, textarea, .anno, [role=dialog]")) return;
  const cur = ctx.focus?.end ?? ctx.focus?.start ?? 0;
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      moveFocus(ctx, cur ? cur + 1 : 1, e.shiftKey);
      return;
    case "ArrowUp":
      e.preventDefault();
      moveFocus(ctx, cur ? cur - 1 : 1, e.shiftKey);
      return;
    case "ArrowLeft":
    case "ArrowRight":
      stepOccurrence(e, ctx);
      return;
    case "Enter":
    case "e":
      explainFocus(e, ctx);
      return;
    case "f":
      explainEnclosing(e, ctx, ["function", "method"]);
      return;
    case "t":
      explainEnclosing(e, ctx, ["class", "type"]);
      return;
    case "F12":
    case "d":
      e.preventDefault();
      ctx.onKeyCommand?.("definition");
      return;
    case "r":
      e.preventDefault();
      ctx.onKeyCommand?.("references");
      return;
    case "F2":
      e.preventDefault();
      ctx.onKeyCommand?.("rename");
      return;
    case "Escape":
      ctx.clearSelBar();
      ctx.onEscape();
      return;
  }
}

interface CodeHandlers {
  keyDown: (e: KeyboardEvent) => void;
  pointerUp: (e: PointerEvent) => void;
  copy: (e: ClipboardEvent) => void;
  keyUp: () => void;
}

/**
 * Keyboard, pointer and copy handling for the code, listened to on the DOM
 * elements themselves: events from dialogs that explanation rows portal out
 * (the prompt editor) never reach the code view this way, only real clicks,
 * keys and copies inside it do. `handlers` always holds the latest render's.
 */
function useCodeEvents(scrollerRef: RefObject<HTMLElement | null>, linesRef: RefObject<HTMLDivElement | null>, handlers: CodeHandlers) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const scroller = scrollerRef.current;
    const linesEl = linesRef.current;
    if (!scroller || !linesEl) return;
    const keyDown = (e: KeyboardEvent) => latest.current.keyDown(e);
    const pointerUp = (e: PointerEvent) => latest.current.pointerUp(e);
    const copy = (e: ClipboardEvent) => latest.current.copy(e);
    const keyUp = () => latest.current.keyUp();
    scroller.addEventListener("keydown", keyDown);
    linesEl.addEventListener("pointerup", pointerUp);
    linesEl.addEventListener("copy", copy);
    linesEl.addEventListener("keyup", keyUp);
    return () => {
      scroller.removeEventListener("keydown", keyDown);
      linesEl.removeEventListener("pointerup", pointerUp);
      linesEl.removeEventListener("copy", copy);
      linesEl.removeEventListener("keyup", keyUp);
    };
  }, [scrollerRef, linesRef]);
}

/** Syntax highlighting in the worker; plain text is shown until tokens arrive. */
function useTokens(blobSha: string, text: string, lang: string, shikiTheme: string): TokenTuple[][] | null {
  const [tokens, setTokens] = useState<TokenTuple[][] | null>(null);
  useEffect(() => {
    let alive = true;
    setTokens(null);
    highlightClient
      .highlight(blobSha, text, lang, shikiTheme)
      .then((r) => alive && setTokens(r.lines))
      .catch(() => alive && setTokens(null));
    return () => {
      alive = false;
    };
  }, [blobSha, text, lang, shikiTheme]);
  return tokens;
}

/** Holding Cmd/Ctrl turns the hovered name into a link (Cmd/Ctrl+click goes to its definition). */
function useModifierDown(): boolean {
  const [modDown, setModDown] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => setModDown(e.metaKey || e.ctrlKey);
    const off = () => setModDown(false);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return modDown;
}

function useViewportWidth(scrollerRef: RefObject<HTMLElement | null>): number {
  const [viewportW, setViewportW] = useState<number>(0);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, [scrollerRef]);
  return viewportW;
}

/** Memoized: the reader re-renders on every indexing tick, the code only when its props change. */
export const CodeView = memo(function CodeView(props: Readonly<CodeViewProps>) {
  const { path, text, blobSha, lang, fileIndex, focus, annotations, onFocus, onExplain, onSymbol, onAnnotationAction } = props;
  const settings = useSettings();
  const theme = codeTheme(settings.codeTheme);
  const lines = useMemo(() => splitLines(text), [text]);
  const tokens = useTokens(blobSha, text, lang, theme.shiki);
  const scrollerRef = useRef<HTMLElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const anchorLine = useRef<number | null>(null);
  const occCursor = useRef<{ line: number; i: number }>({ line: 0, i: -1 });
  const isMobile = useIsMobile();
  const { selBar, setSelBar, update: updateSelection, barRef: selBarRef } = useSelectionBar(linesRef, scrollerRef);
  const viewportW = useViewportWidth(scrollerRef);
  const modDown = useModifierDown();

  // Scroll the focused line into view on navigation.
  useLayoutEffect(() => {
    if (!focus) {
      scrollerRef.current?.scrollTo({ top: 0 });
      return;
    }
    const row = linesRef.current?.querySelector<HTMLElement>(`[data-line="${focus.start}"]`);
    row?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.revealKey]);

  // Keep the focused line in place when the code text size changes.
  const firstSize = useRef(true);
  useLayoutEffect(() => {
    if (firstSize.current) {
      firstSize.current = false;
      return;
    }
    if (!focus) return;
    linesRef.current?.querySelector<HTMLElement>(`[data-line="${focus.start}"]`)?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.codeSize, settings.softWrap]);

  const findInFile = useFindInFile(lines, linesRef);
  const { find, matches: findMatches, current: findCurrent } = findInFile;

  const symbolRanges = useMemo(() => buildSymbolRanges(props.dependencies, fileIndex), [fileIndex, props.dependencies]);
  const rangesByLine = useMemo(
    () => {
      const findHl = find.open && find.query ? { matches: findMatches, current: findCurrent } : null;
      return buildRangesByLine(symbolRanges, props.symbolHighlights, findHl, props.searchQuery, lines);
    },
    [props.symbolHighlights, props.searchQuery, lines, symbolRanges, find.open, find.query, findMatches, findCurrent],
  );

  const annotationsByAnchor = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annotations) {
      if (!a.open) continue;
      const list = m.get(a.anchor);
      if (list) list.push(a);
      else m.set(a.anchor, [a]);
    }
    return m;
  }, [annotations]);

  useCodeEvents(scrollerRef, linesRef, {
    keyDown: (e) =>
      handleCodeKey(e, {
        focus,
        fileIndex,
        lineCount: lines.length,
        softWrap: settings.softWrap,
        linesRef,
        anchorLine,
        occCursor,
        onFocus,
        onExplain,
        onSymbol,
        onKeyCommand: props.onKeyCommand,
        onEscape: props.onEscape,
        clearSelBar: () => setSelBar(null),
      }),
    pointerUp: (e) =>
      handlePointerUp(e, {
        focus,
        anchorLine,
        toolbarRef: selBarRef,
        updateSelection,
        onFocus,
        onSymbol,
        dependencies: props.dependencies,
        onDependency: props.onDependency,
      }),
    copy: (e) => {
      const code = selectedCode(linesRef.current);
      if (code === null || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", code);
      e.preventDefault();
    },
    keyUp: updateSelection,
  });

  const style = {
    ...codeThemeStyle(theme),
    "--code-size": `${settings.codeSize}px`,
    "--gutter-digits": String(String(lines.length).length),
    "--viewport-w": viewportW ? `${viewportW}px` : "100%",
  } as React.CSSProperties;

  const chunks = buildChunks({ lines, tokens, rangesByLine, annotationsByAnchor, focus, selBar, onAnnotationAction });
  const toolbarProps = selBar ? { selBar, isMobile, onExplain, onCopyLink: props.onCopyLink, onDone: () => setSelBar(null) } : null;

  return (
    <div className={cn("code-canvas relative flex min-h-0 flex-1 flex-col", settings.softWrap && "is-wrapped", modDown && "mod-down")} style={style}>
      {find.open ? (
        <FindBar
          find={find}
          setFind={findInFile.setFind}
          inputRef={findInFile.findInput}
          count={findMatches.length}
          current={findCurrent}
          step={findInFile.step}
          onEscape={() => scrollerRef.current?.focus()}
        />
      ) : null}
      <section
        ref={scrollerRef}
        className="code-scroller relative min-h-0 flex-1 focus-visible:outline-none"
        tabIndex={0}
        aria-label={`Source of ${path}. Use arrow keys to move between lines, Enter to explain a line, F for the enclosing function.`}
        style={{ paddingBottom: props.bottomInset ?? 0 }}
      >
        <div ref={linesRef} className="code-lines relative">
          {chunks}
          {toolbarProps && !isMobile ? <FloatingSelectionToolbar barRef={selBarRef} {...toolbarProps} /> : null}
        </div>
      </section>
      {toolbarProps && isMobile ? <DockedSelectionToolbar {...toolbarProps} /> : null}
    </div>
  );
});
