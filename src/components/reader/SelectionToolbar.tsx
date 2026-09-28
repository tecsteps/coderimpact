import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { ClipboardCopy, Link2 } from "lucide-react";
import type { LineRange } from "@/lib/github/parseGithubUrl";
import { SparkIcon } from "../icons";
import type { ExplainRequest } from "./types";
import type { SelBar } from "./useSelectionBar";
import { cn } from "@/lib/utils";

function selectionLabel(selBar: SelBar, isMobile: boolean): string {
  if (selBar.start === selBar.end) return `Line ${selBar.start}`;
  return isMobile ? `${selBar.start}–${selBar.end}` : `Lines ${selBar.start} to ${selBar.end}`;
}

/** The selected text when it is only part of one line (for example just `protected`). */
function fragmentOf(selBar: SelBar): string | undefined {
  const text = selBar.text.trim();
  if (selBar.start !== selBar.end || !text || text.length > 120) return undefined;
  const line = document.querySelector(`[data-line="${selBar.start}"] .cc`)?.textContent?.trim() ?? "";
  return text === line ? undefined : text;
}

function copySelection(text: string) {
  navigator.clipboard?.writeText(text).catch(() => undefined);
}

interface ToolbarProps {
  selBar: SelBar;
  isMobile: boolean;
  onExplain: (req: ExplainRequest) => void;
  onCopyLink: (range: LineRange) => void;
  /** An action ran: the toolbar closes. */
  onDone: () => void;
}

function SelectionActions({ selBar, isMobile, onExplain, onCopyLink, onDone }: Readonly<ToolbarProps>) {
  // Desktop: floats in the code, in the code theme's colors. Phones: docked, in the app's colors for contrast.
  const btn = isMobile
    ? "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-foreground active:bg-surface-2 cursor-pointer [&_svg]:size-4"
    : "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[var(--code-fg)] hover:bg-[var(--code-line-focus)] cursor-pointer";
  return (
    <>
      <button
        type="button"
        className={cn(btn, "font-medium", isMobile ? "bg-accent text-accent-foreground active:bg-accent/85" : "text-[var(--anno-label)]")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onExplain({ task: "selection", start: selBar.start, end: selBar.end, fragment: fragmentOf(selBar) });
          window.getSelection()?.removeAllRanges();
          onDone();
        }}
      >
        <SparkIcon className="size-3.5" /> {isMobile ? "Explain" : "Explain selection"}
      </button>
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          copySelection(selBar.text);
          onDone();
        }}
      >
        <ClipboardCopy className="size-3.5" strokeWidth={1.75} /> Copy
      </button>
      <button
        type="button"
        className={btn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onCopyLink({ start: selBar.start, end: selBar.end });
          onDone();
        }}
      >
        <Link2 className="size-3.5" strokeWidth={1.75} /> {isMobile ? "Link" : "Copy link"}
      </button>
    </>
  );
}

/** Desktop: floats under the selection, inside the code. Its pointer events are ignored by the code view. */
export function FloatingSelectionToolbar({ barRef, ...props }: Readonly<ToolbarProps & { barRef: RefObject<HTMLDivElement | null> }>) {
  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Selection actions"
      className="absolute z-10 flex items-center gap-0.5 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] p-1 font-sans text-[12.5px] shadow-pop"
      style={{ top: props.selBar.top, left: props.selBar.left }}
    >
      <SelectionActions {...props} />
      <span className="px-1.5 text-[11.5px] text-[var(--code-gutter)] tabular-nums">{selectionLabel(props.selBar, props.isMobile)}</span>
    </div>
  );
}

/**
 * Phones: docked above the path bar, so it never covers the selection,
 * never fights the system text menu and stays put while handles move.
 */
export function DockedSelectionToolbar(props: Readonly<ToolbarProps>) {
  return createPortal(
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="sel-dock fixed inset-x-2 bottom-[calc(var(--vv-bottom,0px)+5.25rem+env(safe-area-inset-bottom)+6px)] z-40 flex items-center gap-1 rounded-2xl border border-border-strong bg-surface p-1.5 font-sans text-[14px] text-foreground shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
    >
      <SelectionActions {...props} />
      <span className="ml-auto shrink-0 px-2 text-[12px] text-muted-foreground tabular-nums">{selectionLabel(props.selBar, props.isMobile)}</span>
    </div>,
    document.body,
  );
}
