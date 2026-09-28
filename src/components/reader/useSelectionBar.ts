import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { selectedCode, selectionLines } from "./codeViewDom";

/** The selection toolbar: the selected lines, where it floats, and the text it copies. */
export interface SelBar {
  start: number;
  end: number;
  top: number;
  left: number;
  text: string;
}

/**
 * Tracks the text selection inside the code lines and places the selection
 * toolbar under it. `update` re-reads the selection now (pointer and key up).
 */
export function useSelectionBar(linesRef: RefObject<HTMLDivElement | null>, scrollerRef: RefObject<HTMLElement | null>) {
  const barRef = useRef<HTMLDivElement>(null);
  const [selBar, setSelBar] = useState<SelBar | null>(null);

  const update = useCallback(() => {
    const sel = window.getSelection();
    const container = linesRef.current;
    if (!sel || sel.isCollapsed || !container || sel.rangeCount === 0) {
      setSelBar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const span = container.contains(range.commonAncestorContainer) ? selectionLines(container, range) : null;
    if (!span) {
      setSelBar(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const scroller = scrollerRef.current!;
    const top = rect.bottom - cRect.top + 6;
    const left = Math.max(8, Math.min(rect.left - cRect.left, scroller.scrollLeft + scroller.clientWidth - 300));
    setSelBar({ start: Math.min(span.a, span.b), end: Math.max(span.a, span.b), top, left, text: selectedCode(container) ?? "" });
  }, [linesRef, scrollerRef]);

  // Keep the floating toolbar inside the visible code area, using its real width.
  useLayoutEffect(() => {
    const el = barRef.current;
    const scroller = scrollerRef.current;
    if (!el || !scroller || !selBar) return;
    const max = scroller.scrollLeft + scroller.clientWidth - el.offsetWidth - 8;
    el.style.left = `${Math.max(scroller.scrollLeft + 8, Math.min(selBar.left, max))}px`;
  }, [selBar, scrollerRef]);

  // Follow the selection however it was made: mouse, keyboard, or long-press
  // and handle drags on touch screens (which fire no pointerup here).
  useEffect(() => {
    let timer = 0;
    const onSel = () => {
      window.clearTimeout(timer);
      const sel = window.getSelection();
      // Collapsing: wait a moment, so a tap on the toolbar itself still lands.
      if (!sel || sel.isCollapsed) timer = window.setTimeout(() => setSelBar(null), 250);
      else timer = window.setTimeout(update, 120);
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onSel);
    };
  }, [update]);

  return { selBar, setSelBar, update, barRef };
}
