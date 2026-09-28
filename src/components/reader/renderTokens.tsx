import type { ReactNode } from "react";
import type { TokenTuple } from "@/lib/highlight/client";

/** [start, end, className] in UTF-16 columns. */
export type HlRange = [number, number, string];

function styleFor(t: TokenTuple): React.CSSProperties | undefined {
  if (!t[1] && !t[2]) return undefined;
  const s: React.CSSProperties = {};
  if (t[1]) s.color = t[1];
  if (t[2]) {
    if (t[2] & 1) s.fontStyle = "italic";
    if (t[2] & 2) s.fontWeight = 600;
    if (t[2] & 4) s.textDecoration = "underline";
  }
  return s;
}

/**
 * Every range covering `pos` contributes its class (a clickable symbol can
 * also be highlighted or match the search); the segment ends where the next
 * range starts or a covering range ends.
 */
function segmentAt(sorted: HlRange[], pos: number, end: number): { segEnd: number; classes: string[] } {
  let segEnd = end;
  const classes: string[] = [];
  for (const x of sorted) {
    if (x[0] <= pos && x[1] > pos) {
      classes.push(x[2]);
      segEnd = Math.min(segEnd, x[1]);
    } else if (x[0] > pos && x[0] < segEnd) segEnd = x[0];
  }
  return { segEnd, classes };
}

/** Renders one line's tokens as text spans, splitting them where highlight ranges start and end. */
export function renderTokens(tokens: TokenTuple[] | undefined, plain: string, ranges: HlRange[] | undefined): ReactNode {
  const toks: TokenTuple[] = tokens?.length ? tokens : [[plain]];
  const out: ReactNode[] = [];
  let key = 0;
  if (!ranges?.length) {
    for (const t of toks) {
      out.push(
        <span key={key++} style={styleFor(t)}>
          {t[0]}
        </span>,
      );
    }
    return out;
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let offset = 0;
  for (const t of toks) {
    const text = t[0];
    const start = offset;
    const end = offset + text.length;
    const style = styleFor(t);
    let pos = start;
    while (pos < end) {
      const { segEnd, classes } = segmentAt(sorted, pos, end);
      out.push(
        <span key={key++} style={style} className={classes.length ? classes.join(" ") : undefined}>
          {text.slice(pos - start, segEnd - start)}
        </span>,
      );
      pos = segEnd;
    }
    offset = end;
  }
  return out;
}
