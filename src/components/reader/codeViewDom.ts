/** DOM helpers for the code view: columns under the pointer and the selected source text. */

/** Column of (node, offset) within `root`'s text, or null when the node is outside it. */
export function textOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let col = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node) return col + offset;
    col += t.textContent?.length ?? 0;
  }
  // node is an element: offset counts child nodes
  if (node.nodeType === Node.ELEMENT_NODE) {
    let c = 0;
    const children = Array.from(node.childNodes).slice(0, offset);
    for (const ch of children) c += ch.textContent?.length ?? 0;
    const before = document.createRange();
    before.setStart(root, 0);
    before.setEnd(node, 0);
    return (before.toString().length ?? 0) + c;
  }
  return null;
}

/** WebKit's older hit test, for browsers without caretPositionFromPoint. */
interface LegacyCaretDocument {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const legacy = document as unknown as LegacyCaretDocument;
  if (legacy.caretRangeFromPoint) {
    const r = legacy.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

export function lineOf(node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const row = el?.closest<HTMLElement>("[data-line]");
  return row ? Number(row.dataset.line) : null;
}

/** The selected source text, line by line, without gutters or explanation rows. */
export function selectedCode(container: HTMLElement | null): string | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !container || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.cl[data-kind="source"]')).filter((r) => range.intersectsNode(r));
  if (rows.length === 0) return null;
  const parts = rows.map((row, i) => {
    const cc = row.querySelector<HTMLElement>(".cc")!;
    const full = cc.textContent ?? "";
    let s = 0;
    let en = full.length;
    if (i === 0) s = textOffset(cc, range.startContainer, range.startOffset) ?? 0;
    if (i === rows.length - 1) en = textOffset(cc, range.endContainer, range.endOffset) ?? full.length;
    return full.slice(s, en);
  });
  return parts.join("\n");
}

/** First and last source line a selection range touches, as written (not sorted). */
export function selectionLines(container: HTMLElement, range: Range): { a: number; b: number } | null {
  let a = lineOf(range.startContainer);
  let b = lineOf(range.endContainer);
  if (a === null || b === null) {
    // Selection starts or ends in an annotation row: use the nearest source rows.
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".cl")).filter((r) => range.intersectsNode(r));
    if (rows.length === 0) return null;
    a = Number(rows[0].dataset.line);
    b = Number(rows.at(-1)!.dataset.line);
  }
  // A selection ending at column 0 of the next line belongs to the previous line.
  if (b > a && range.endOffset === 0 && lineOf(range.endContainer) === b) {
    const endRow = container.querySelector(`[data-line="${b}"] .cc`);
    if (endRow && textOffset(endRow as HTMLElement, range.endContainer, 0) === 0) b -= 1;
  }
  return { a, b };
}
