import { useMemo } from "react";
import type { LineRange } from "@/lib/github/parseGithubUrl";
import type { FileIndex } from "@/lib/lang/types";
import { buildContext, innermostBlock as innermost, type ExplainContext } from "@/lib/explain/context";
import { audience } from "@/lib/explain/prompt";
import { languageLabel } from "@/lib/util/files";
import { useProviderState } from "@/hooks/useProvider";
import { ClassIcon, FunctionIcon, LineSparkIcon, SparkIcon } from "../icons";
import type { ExplainRequest } from "./types";
import { cn } from "@/lib/utils";

function audienceLabel(ctx: ExplainContext): string {
  return audience(ctx).reader;
}

/** A multi-line focus can be explained as a selection; a single line is not a range. */
function explainRange(focus: LineRange | undefined): LineRange | null {
  return focus && focus.end > focus.start ? focus : null;
}

function lineHint(lines: string[], line: number | undefined): string {
  if (!line) return "Tap a line first";
  return lines[line - 1]?.trim().slice(0, 60) || "(empty line)";
}

function Option({
  icon,
  title,
  hint,
  disabled,
  onClick,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
  disabled?: boolean;
  onClick?: () => void;
}>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-2 cursor-pointer disabled:cursor-default disabled:opacity-55 disabled:hover:bg-surface",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[14px] font-medium text-foreground">{title}</span>
        {hint ? <span className="truncate text-[12px] text-subtle-foreground">{hint}</span> : null}
      </span>
    </button>
  );
}

function PreviewDetails({ preview }: Readonly<{ preview: ExplainContext }>) {
  const scope = preview.focusEnd > preview.focusStart ? `lines ${preview.focusStart} to ${preview.focusEnd}` : "a line";
  const redacted = preview.redactions === 0 ? "nothing removed by secrets filter" : `${preview.redactions} secrets removed`;
  return (
    <details className="rounded-lg border border-border px-3 py-2 text-[12.5px]">
      <summary className="cursor-pointer text-muted-foreground">
        Code sent for {scope}: {preview.endLine - preview.startLine + 1} lines · {preview.language} ·{" "}
        {redacted}
      </summary>
      <pre className="mt-2 overflow-x-auto font-mono text-[11.5px] text-foreground">{preview.code}</pre>
    </details>
  );
}

/** Explain choices for the focused line, used by the mobile Explain sheet. */
export function ExplainOptions({
  path,
  lines,
  focus,
  fileIndex,
  familiar,
  onExplain,
}: Readonly<{
  path: string;
  lines: string[];
  focus?: LineRange;
  fileIndex?: FileIndex | null;
  familiar: string[];
  onExplain: (req: ExplainRequest) => void;
}>) {
  const ai = useProviderState();
  const line = focus?.start;
  const fn = line && fileIndex ? innermost(fileIndex.blocks, line, ["function", "method"]) : undefined;
  const cls = line && fileIndex ? innermost(fileIndex.blocks, line, ["class", "type"]) : undefined;
  const range = explainRange(focus);

  const preview = useMemo(() => {
    if (!line) return null;
    return buildContext({ task: "line", path, language: languageLabel(path), lines, start: line, end: line, blocks: fileIndex?.blocks ?? [], familiar });
  }, [line, path, lines, fileIndex, familiar]);

  return (
    <div className="flex flex-col gap-2 overflow-y-auto px-4 pt-1 pb-4">
      {ai.state === "unavailable" ? (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-[12.5px] text-foreground">{ai.reason}</p>
      ) : null}
      <Option
        icon={<LineSparkIcon className="size-4" />}
        title={line ? `Explain line ${line}` : "Explain a line"}
        hint={lineHint(lines, line)}
        disabled={!line}
        onClick={() => line && onExplain({ task: "line", line })}
      />
      {fn ? (
        <Option
          icon={<FunctionIcon className="size-4" />}
          title={`Explain ${fn.kind} ${fn.name}`}
          hint={`Lines ${fn.startLine} to ${fn.endLine}`}
          onClick={() => onExplain({ task: "declaration", block: fn })}
        />
      ) : null}
      {cls ? (
        <Option
          icon={<ClassIcon className="size-4" />}
          title={`Explain ${cls.kind === "class" ? "class" : "type"} ${cls.name}`}
          hint={`Lines ${cls.startLine} to ${cls.endLine}`}
          onClick={() => onExplain({ task: "declaration", block: cls })}
        />
      ) : null}
      <Option
        icon={<SparkIcon className="size-4" />}
        title="Explain selection"
        hint={range ? `Lines ${range.start} to ${range.end}` : "Select lines first"}
        disabled={!range}
        onClick={() => range && onExplain({ task: "selection", start: range.start, end: range.end })}
      />
      {preview ? <PreviewDetails preview={preview} /> : null}
      <p className="text-[12px] text-subtle-foreground">
        {preview ? `Explained for ${audienceLabel(preview)}. ` : ""}Change the languages you know under Aa. Results can be wrong. Nothing is sent until you choose an option.
      </p>
    </div>
  );
}
