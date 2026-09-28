import { useMemo, useRef, useState } from "react";
import { ClipboardCopy, RotateCcw, Sparkles } from "lucide-react";
import type { ExplainContext, ExplainTask } from "@/lib/explain/context";
import { buildMessages, DEFAULT_TEMPLATE, TEMPLATE_VARIABLES, type PromptTemplate } from "@/lib/explain/prompt";
import { updateSettings, useSettings } from "@/lib/cache/settings";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Sheet, SheetContent } from "../ui/sheet";
import { Segmented } from "../ui/segmented";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

const TASKS: { value: ExplainTask; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "selection", label: "Selection" },
  { value: "declaration", label: "Function or class" },
];

/** Relay limit per message; longer prompts are refused. */
const MAX_CHARS = 20_000;

function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

/**
 * The prompt behind an explanation: exactly what was sent, and the editable
 * templates for each kind of explanation (line, selection, declaration).
 */
export function PromptDialog({ ctx, open, onOpenChange, onRerun }: Readonly<{ ctx: ExplainContext; open: boolean; onOpenChange: (o: boolean) => void; onRerun: () => void }>) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<"sent" | "template">("sent");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? (
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          title="Prompt"
          description="The prompt sent for this explanation, and the templates it is built from."
          className={cn(isMobile ? "h-[calc(var(--app-h,100dvh)*0.92)]" : "w-[min(760px,96vw)]")}
          // The sheet is portaled, but React events still bubble to the code view
          // this dialog is opened from: keep typing, clicks and copies here.
          onKeyDown={stop}
          onKeyUp={stop}
          onPointerUp={stop}
          onCopy={stop}
        >
          <div className="px-4 pb-2">
            <Segmented<"sent" | "template">
              label="Prompt view"
              value={tab}
              onChange={setTab}
              options={[
                { value: "sent", label: "Sent for this explanation" },
                { value: "template", label: "Edit template" },
              ]}
            />
          </div>
          {tab === "sent" ? <SentPrompt ctx={ctx} /> : <TemplateEditor ctx={ctx} onRerun={onRerun} />}
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function SentPrompt({ ctx }: Readonly<{ ctx: ExplainContext }>) {
  const [system, user] = useMemo(() => buildMessages(ctx), [ctx]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      <p className="text-[12.5px] text-subtle-foreground">
        {ctx.template ? "Built from your customized template." : "Built from the default template."} Code and names below are exactly what the model received.
      </p>
      {[
        { label: "System", text: system.content },
        { label: "User", text: user.content },
      ].map((m) => (
        <section key={m.label} className="flex flex-col gap-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">
            {m.label} <span className="font-normal normal-case tracking-normal">· {m.text.length.toLocaleString()} characters</span>
          </h3>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-foreground">{m.text}</pre>
        </section>
      ))}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(`# System\n${system.content}\n\n# User\n${user.content}`).catch(() => undefined);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          <ClipboardCopy /> {copied ? "Copied" : "Copy prompt"}
        </Button>
      </div>
    </div>
  );
}

function TemplateEditor({ ctx, onRerun }: Readonly<{ ctx: ExplainContext; onRerun: () => void }>) {
  const settings = useSettings();
  const [task, setTask] = useState<ExplainTask>(ctx.task);
  const saved = settings.promptTemplates[task];
  const [draft, setDraft] = useState<Record<ExplainTask, PromptTemplate>>(() => ({
    line: settings.promptTemplates.line ?? DEFAULT_TEMPLATE,
    selection: settings.promptTemplates.selection ?? DEFAULT_TEMPLATE,
    declaration: settings.promptTemplates.declaration ?? DEFAULT_TEMPLATE,
  }));
  const current = draft[task];
  const lastField = useRef<{ el: HTMLTextAreaElement; key: keyof PromptTemplate } | null>(null);
  const dirty = current.system !== (saved ?? DEFAULT_TEMPLATE).system || current.user !== (saved ?? DEFAULT_TEMPLATE).user;
  const isDefault = current.system === DEFAULT_TEMPLATE.system && current.user === DEFAULT_TEMPLATE.user;

  const set = (key: keyof PromptTemplate, value: string) => setDraft((d) => ({ ...d, [task]: { ...d[task], [key]: value } }));

  const save = () => {
    const next = { ...settings.promptTemplates };
    if (isDefault) delete next[task];
    else next[task] = current;
    updateSettings({ promptTemplates: next });
  };

  const insert = (name: string) => {
    const f = lastField.current;
    const token = `{{${name}}}`;
    if (!f) {
      set("system", `${current.system}${token}`);
      return;
    }
    const { el, key } = f;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    set(key, el.value.slice(0, start) + token + el.value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const field = (key: keyof PromptTemplate, label: string, rows: number) => (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">
        {label}
        <span className={cn("font-normal normal-case tracking-normal tabular-nums", current[key].length > MAX_CHARS / 2 && "text-warn")}>{current[key].length.toLocaleString()} characters</span>
      </span>
      <textarea
        value={current[key]}
        rows={rows}
        spellCheck={false}
        onChange={(e) => set(key, e.target.value)}
        onFocus={(e) => (lastField.current = { el: e.currentTarget, key })}
        onSelect={(e) => (lastField.current = { el: e.currentTarget, key })}
        className="w-full resize-y rounded-md border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-foreground focus-visible:border-ring focus-visible:outline-none"
      />
    </label>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      <div className="flex flex-col gap-1.5">
        <Segmented<ExplainTask> label="Kind of explanation" value={task} onChange={setTask} options={TASKS} />
        <p className="text-[12px] text-subtle-foreground">
          {saved ? "Customized. " : "Default template. "}
          Each kind of explanation has its own template, stored in this browser. {"{{placeholders}}"} are filled for every explanation; lines whose placeholders are empty are left out.
        </p>
      </div>
      {field("system", "System", isDefaultSize(current.system) ? 16 : 12)}
      {field("user", "User", 9)}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Placeholders · click to insert</h3>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.name}
              type="button"
              title={v.description}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(v.name)}
              className="rounded-full border border-border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer"
            >
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>
      </section>
      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 pt-3 pb-1">
        <Button size="sm" disabled={!dirty} onClick={save}>
          Save
        </Button>
        {task === ctx.task ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              save();
              onRerun();
            }}
          >
            <Sparkles /> Save and explain again
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={isDefault} onClick={() => setDraft((d) => ({ ...d, [task]: DEFAULT_TEMPLATE }))} className="ml-auto">
          <RotateCcw /> Default
        </Button>
      </div>
    </div>
  );
}

function isDefaultSize(text: string) {
  return text.split("\n").length > 12;
}
