import { memo, useState } from "react";
import { ChevronDown, ClipboardCopy, RotateCw, ScrollText, X } from "lucide-react";
import { PromptDialog } from "./PromptDialog";
import { boxCodeWords, codeSegments, codeWordsOf } from "@/lib/explain/validate";
import { audience } from "@/lib/explain/prompt";
import { SparkIcon } from "../icons";
import type { Annotation, AnnotationAction } from "./types";
import { cn } from "@/lib/utils";

function Rich({ text, words }: Readonly<{ text: string; words?: Set<string> }>) {
  // Segments are never empty, so their offsets are unique and stable keys.
  let at = 0;
  const parts = codeSegments(words ? boxCodeWords(text, words) : text).map((s) => {
    const key = at;
    at += s.text.length;
    return s.code ? <code key={key}>{s.text}</code> : <span key={key}>{s.text}</span>;
  });
  return <>{parts}</>;
}

/** The row already shows the selected text in front of the term; drop the model's own repeat of it. */
function withoutFragment(term: string, fragment: string): string {
  const lead = `\`${fragment}\``;
  if (!term.startsWith(lead)) return term;
  return term.slice(lead.length).trimStart() || term;
}

function plainText(a: Annotation): string {
  if (!a.result) return "";
  const { term, summary } = a.result.explanation;
  const text = term ? [`${a.ctx.fragment ?? ""}: ${a.ctx.fragment ? withoutFragment(term, a.ctx.fragment) : term}`, `Here: ${summary}`] : [summary];
  return text.join("\n").replaceAll("`", "");
}

/** The explanation itself: a skeleton while loading, the error with a retry, or the result. */
function AnnotationBody({ a, onAction }: Readonly<{ a: Annotation; onAction: (id: string, action: AnnotationAction) => void }>) {
  if (a.status === "loading") {
    return (
      <div className="flex flex-col gap-1.5 py-0.5">
        <div className="skeleton h-3 w-[85%]" />
        <div className="skeleton h-3 w-[60%]" />
        <span className="anno-muted text-[12px]">Explaining {a.title.charAt(0).toLowerCase() + a.title.slice(1)}…</span>
      </div>
    );
  }
  if (a.status === "error") {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <p className="text-pretty">{a.error?.message}</p>
        {a.error?.retryable ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium anno-label hover:underline cursor-pointer"
            onClick={() => onAction(a.id, "retry")}
          >
            <RotateCw className="size-3.5" /> Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (!a.result) return null;
  const words = codeWordsOf(a.ctx.code, a.ctx.fragment);
  const { term, summary } = a.result.explanation;
  if (term && a.ctx.fragment) {
    // A selected fragment: what exactly it means, then its role here.
    return (
      <div className="flex flex-col gap-2">
        <p className="text-pretty">
          <code className="mr-1.5">{a.ctx.fragment}</code>
          <Rich text={withoutFragment(term, a.ctx.fragment)} words={words} />
        </p>
        <p className="text-pretty">
          <span className="anno-label mr-1.5 text-[12px] font-semibold">Here</span>
          <Rich text={summary} words={words} />
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-pretty">
        <Rich text={summary} words={words} />
      </p>
    </div>
  );
}

function CopyButton({ a, onCopied }: Readonly<{ a: Annotation; onCopied: () => void }>) {
  return (
    <button
      type="button"
      className="anno-muted rounded p-1 hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
      aria-label="Copy explanation"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(plainText(a));
          onCopied();
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      <ClipboardCopy className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/** Model, prompt and cache details shown once a result is in. */
function ResultMeta({ result, onShowPrompt }: Readonly<{ result: NonNullable<Annotation["result"]>; onShowPrompt: () => void }>) {
  return (
    <>
      <span aria-hidden>·</span>
      <span>{result.model}</span>
      <button
        type="button"
        onClick={onShowPrompt}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-black/10 hover:underline dark:hover:bg-white/10 cursor-pointer"
        aria-label="Show and edit the prompt"
        title="Show and edit the prompt"
      >
        <ScrollText className="size-3.5" strokeWidth={1.75} />
        <span>Prompt</span>
      </button>
      {result.cached ? (
        <>
          <span aria-hidden>·</span>
          <span>cached</span>
        </>
      ) : null}
    </>
  );
}

/** Exactly what was sent: language, size, what the secrets filter removed, and the code. */
function SentDetails({ ctx }: Readonly<{ ctx: Annotation["ctx"] }>) {
  const filter = ctx.redactions === 0 ? "Secrets filter: nothing removed" : `Secrets filter removed ${ctx.redactions} (${ctx.redactionKinds.join(", ")})`;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] p-2">
      <p className="text-[11.5px] anno-muted">
        {ctx.language} · {ctx.bytes.toLocaleString()} bytes ·{" "}
        {filter}
        {ctx.truncated ? " · truncated" : ""}
      </p>
      {ctx.enclosingSignature ? (
        <p className="text-[11.5px] anno-muted">
          Enclosing declaration: <code>{ctx.enclosingSignature}</code>
        </p>
      ) : null}
      <pre className="text-[var(--code-fg)]">{ctx.code}</pre>
    </div>
  );
}

/**
 * An AI explanation, rendered as its own row between source rows. It has no
 * line number, is not part of the source text, and is announced with its label.
 */
export const AnnotationRow = memo(function AnnotationRow({
  a,
  onAction,
}: Readonly<{
  a: Annotation;
  onAction: (id: string, action: AnnotationAction) => void;
}>) {
  const [copied, setCopied] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const ctx = a.ctx;
  const labelId = `anno-${a.id.replaceAll(/[^a-z0-9]/gi, "-")}`;
  const sentLabel = `Code sent: lines ${ctx.startLine} to ${ctx.endLine}`;

  return (
    <div className="anno" data-kind="annotation" role="note" aria-labelledby={labelId}>
      <div className="anno-inner">
        <div className="anno-card">
          <div className="flex items-center gap-2">
            <SparkIcon className="size-3.5 anno-label" />
            <span id={labelId} className="anno-label whitespace-nowrap text-[12.5px] font-semibold">
              AI explanation<span className="sr-only"> for {a.title}</span>
            </span>
            <span className="anno-muted hidden truncate text-[12px] sm:inline" aria-hidden>
              {a.title}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {a.status === "done" ? (
                <CopyButton
                  a={a}
                  onCopied={() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                />
              ) : null}
              {a.status === "loading" ? (
                <button type="button" className="anno-muted rounded px-1.5 py-0.5 text-[12px] hover:underline cursor-pointer" onClick={() => onAction(a.id, "cancel")}>
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close explanation"
                title="Close"
                className="anno-muted rounded p-1 hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
                onClick={() => onAction(a.id, "hide")}
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
          <span className="sr-only" aria-live="polite">
            {copied ? "Explanation copied" : ""}
          </span>

          <div className="mt-1.5" aria-live="polite" aria-busy={a.status === "loading"}>
            <AnnotationBody a={a} onAction={onAction} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] anno-muted">
            <button
              type="button"
              aria-expanded={a.sentOpen}
              onClick={() => onAction(a.id, "toggle-sent")}
              className="inline-flex items-center gap-1 hover:underline cursor-pointer"
            >
              <ChevronDown className={cn("size-3 transition-transform", !a.sentOpen && "-rotate-90")} />
              {sentLabel}
            </button>
            {ctx.familiar.length ? (
              <>
                <span aria-hidden>·</span>
                <span>for {audience(ctx).reader.replace(/^an? /, "")}</span>
              </>
            ) : null}
            {a.result ? <ResultMeta result={a.result} onShowPrompt={() => setPromptOpen(true)} /> : null}
          </div>
          {a.sentOpen ? <SentDetails ctx={ctx} /> : null}
          {promptOpen ? (
            <PromptDialog
              ctx={ctx}
              open={promptOpen}
              onOpenChange={setPromptOpen}
              onRerun={() => {
                setPromptOpen(false);
                onAction(a.id, "rerun");
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});
