import { useCallback, useRef, useState } from "react";
import type { LineRange } from "@/lib/github/parseGithubUrl";
import { getSettings } from "@/lib/cache/settings";
import { buildContext, type ExplainContext } from "@/lib/explain/context";
import { explain } from "@/lib/explain/explain";
import { redactFragment } from "@/lib/explain/secrets";
import { ProviderError } from "@/lib/explain/provider";
import { isAbort } from "@/lib/errors";
import { languageLabel } from "@/lib/util/files";
import type { Block, FileIndex } from "@/lib/lang/types";
import type { Annotation, AnnotationAction, ExplainRequest } from "./types";

const BLOCK_KIND_LABELS: Record<string, string> = { class: "Class", type: "Type", method: "Method" };

function innermostBlockKind(kind: string) {
  return BLOCK_KIND_LABELS[kind] ?? "Function";
}

interface ExplainTarget {
  id: string;
  anchor: number;
  title: string;
  ctx: ExplainContext;
  /** Lines to select in the URL, when the explanation grows beyond the requested line. */
  focus?: LineRange;
}

interface TargetInput {
  path: string;
  language: string;
  lines: string[];
  blocks: Block[];
  familiar: string[];
}

/** What a request explains: its annotation id, the line it hangs under, its title and the context sent. */
function explainTarget(req: ExplainRequest, input: TargetInput): ExplainTarget {
  if (req.task === "line") {
    const ctx = buildContext({ task: "line", ...input, start: req.line, end: req.line });
    if (ctx.focusEnd > ctx.focusStart) {
      // The line opens or closes a multi-line statement: explain the whole statement.
      return {
        id: `sel:${ctx.focusStart}-${ctx.focusEnd}`,
        anchor: ctx.focusEnd,
        title: `Lines ${ctx.focusStart} to ${ctx.focusEnd}`,
        ctx,
        focus: { start: ctx.focusStart, end: ctx.focusEnd },
      };
    }
    return { id: `line:${req.line}`, anchor: req.line, title: `Line ${req.line}`, ctx };
  }
  if (req.task === "selection") {
    const ctx = buildContext({ task: "selection", ...input, start: req.start, end: req.end });
    if (req.fragment) {
      ctx.fragment = redactFragment(req.fragment, input.lines[req.start - 1] ?? "");
      return { id: `sel:${req.start}-${req.end}|f:${req.fragment}`, anchor: req.end, title: `${req.fragment} on line ${req.start}`, ctx };
    }
    return { id: `sel:${req.start}-${req.end}`, anchor: req.end, title: `Lines ${req.start} to ${req.end}`, ctx };
  }
  const b = req.block;
  return {
    id: `decl:${b.startLine}-${b.endLine}`,
    anchor: b.declLine,
    title: `${innermostBlockKind(b.kind)} ${b.label}`,
    ctx: buildContext({ task: "declaration", ...input, start: b.startLine, end: b.endLine, block: b }),
  };
}

function explainError(e: unknown): { message: string; retryable: boolean } {
  if (e instanceof ProviderError) return { message: e.message, retryable: e.retryable };
  return { message: e instanceof Error ? e.message : String(e), retryable: true };
}

function patchList(list: Annotation[], id: string, patch: Partial<Annotation> | null): Annotation[] {
  if (patch === null) return list.filter((a) => a.id !== id);
  return list.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

/** An annotation explained again: as it was (retry), or with the prompt template saved now (rerun). */
function restarted(a: Annotation, rerun: boolean): Annotation {
  if (!rerun) return { ...a, status: "loading", error: undefined };
  return { ...a, status: "loading", error: undefined, result: undefined, open: true, ctx: { ...a.ctx, template: getSettings().promptTemplates[a.ctx.task] } };
}

interface Options {
  text: string;
  path: string;
  lines: string[];
  fileIndex: FileIndex | null;
  familiar: string[];
  promptTemplates: ReturnType<typeof getSettings>["promptTemplates"];
  onFocus: (range: LineRange | undefined) => void;
  /** Called when an explanation starts or toggles (the phone sheet closes). */
  onStart: () => void;
}

/** Explanations shown inline in the code: their state per file, and the requests that start, rerun or cancel them. */
export function useExplanations({ text, path, lines, fileIndex, familiar, promptTemplates, onFocus, onStart }: Options) {
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]>>({});
  const controllers = useRef(new Map<string, AbortController>());

  const updateAnno = useCallback((p: string, id: string, patch: Partial<Annotation> | null) => {
    setAnnotations((all) => ({ ...all, [p]: patchList(all[p] ?? [], id, patch) }));
  }, []);

  const run = useCallback(
    (a: Annotation) => {
      controllers.current.get(a.id)?.abort();
      const ctl = new AbortController();
      controllers.current.set(a.id, ctl);
      explain(a.ctx, ctl.signal)
        .then((result) => updateAnno(a.path, a.id, { status: "done", result, error: undefined }))
        .catch((e) => {
          if (isAbort(e) || ctl.signal.aborted) return;
          updateAnno(a.path, a.id, { status: "error", error: explainError(e) });
        })
        .finally(() => controllers.current.delete(a.id));
    },
    [updateAnno],
  );

  const runExplain = useCallback(
    (req: ExplainRequest) => {
      if (!text) return;
      const target = explainTarget(req, { path, language: languageLabel(path), lines, blocks: fileIndex?.blocks ?? [], familiar });
      if (target.focus) onFocus(target.focus);
      const { anchor, title, ctx } = target;
      // A customized prompt template for this kind of explanation, if any.
      ctx.template = promptTemplates[ctx.task];
      // Explanations depend on who they are for.
      const id = `${target.id}|${familiar.join(",")}`;
      const existing = (annotations[path] ?? []).find((x) => x.id === id);
      onStart();
      if (!existing) {
        const a: Annotation = { id, path, anchor, title, ctx, status: "loading", open: true, sentOpen: false };
        setAnnotations((all) => ({ ...all, [path]: [...(all[path] ?? []), a] }));
        run(a);
      } else if (existing.status === "error") {
        const next = { ...existing, status: "loading" as const, open: true, error: undefined, ctx };
        updateAnno(path, id, next);
        run(next);
      } else updateAnno(path, id, { open: !existing.open });
    },
    [text, path, lines, fileIndex, annotations, run, updateAnno, familiar, promptTemplates, onFocus, onStart],
  );

  const onAnnotationAction = useCallback(
    (id: string, action: AnnotationAction) => {
      const a = (annotations[path] ?? []).find((x) => x.id === id);
      if (!a) return;
      switch (action) {
        case "hide":
          updateAnno(path, id, { open: false });
          return;
        case "toggle-sent":
          updateAnno(path, id, { sentOpen: !a.sentOpen });
          return;
        case "cancel":
          controllers.current.get(id)?.abort();
          updateAnno(path, id, null);
          return;
        default: {
          // Retry and rerun send code too: never without the consent the first request asked for.
          if (!getSettings().aiConsent) {
            updateAnno(path, id, { status: "error", error: { message: "AI explanations are switched off. Explain the code again to allow them.", retryable: false } });
            return;
          }
          const next = restarted(a, action === "rerun");
          updateAnno(path, id, next);
          run(next);
        }
      }
    },
    [annotations, path, run, updateAnno],
  );

  return { annotations, runExplain, onAnnotationAction };
}
