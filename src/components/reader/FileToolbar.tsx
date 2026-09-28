import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, Eye, Maximize2, Minimize2, Minus, Pencil, Plus, RefreshCw, Search, WrapText } from "lucide-react";
import { setFocusMode, useFocusMode } from "@/lib/focusMode";
import { LanguageBadge } from "./LanguageBadge";
import { CODE_SIZE_MAX, CODE_SIZE_MIN, updateSettings, useSettings } from "@/lib/cache/settings";
import { CODE_THEMES, codeTheme } from "@/lib/highlight/themes";
import { Tooltip } from "../ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "@/lib/utils";
import { modKey } from "@/lib/util/keys";

function IconToggle({
  label,
  pressed,
  onClick,
  disabled,
  children,
}: Readonly<{
  label: string;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        // aria-disabled instead of disabled: a disabled button shows no tooltip, and the tooltip says why.
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        className={cn(
          "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground",
          pressed && "bg-accent-soft text-foreground hover:bg-accent-soft",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Swatch({ id }: Readonly<{ id: string }>) {
  const t = codeTheme(id);
  return (
    <span aria-hidden className="flex h-4 w-6 shrink-0 flex-col justify-center gap-[2px] rounded-[3px] border border-border px-1" style={{ background: t.vars.bg }}>
      <span className="block h-[1.5px] w-3 rounded" style={{ background: t.vars.annoRail }} />
      <span className="block h-[1.5px] w-4 rounded" style={{ background: t.vars.fg }} />
    </span>
  );
}

/** Sort key that puts dark themes before light ones. */
const darkFirst = (type: string) => (type === "dark" ? 0 : 1);

export function ThemeBadge({ showLabel, align = "end" }: Readonly<{ showLabel?: boolean; align?: "start" | "end" }> = {}) {
  const s = useSettings();
  const current = codeTheme(s.codeTheme);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? CODE_THEMES.filter((t) => t.label.toLowerCase().includes(q) || t.id.includes(q) || t.type === q) : CODE_THEMES;
    // Dark first, then light, alphabetical within each group; hand-tuned ones lead their group.
    return [...list].sort((a, b) => darkFirst(a.type) - darkFirst(b.type));
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(Math.max(0, CODE_THEMES.filter((t) => t.type === "dark").concat(CODE_THEMES.filter((t) => t.type === "light")).findIndex((t) => t.id === current.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (id: string) => {
    updateSettings({ codeTheme: id });
    setOpen(false);
  };

  const trigger = (
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Code theme: ${current.label}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-surface-2 hover:text-foreground cursor-pointer"
          >
            <Swatch id={current.id} />
            <span className={showLabel ? "truncate" : "hidden lg:inline"}>{current.label}</span>
          </button>
        </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {showLabel ? trigger : <Tooltip content="Code theme">{trigger}</Tooltip>}
      <PopoverContent className="flex w-72 flex-col overflow-hidden p-0" align={align} onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="relative border-b border-border p-1.5">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(matches.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && matches[active]) {
                e.preventDefault();
                pick(matches[active].id);
              }
            }}
            placeholder={`Search ${CODE_THEMES.length} themes`}
            aria-label="Search code themes"
            role="combobox"
            aria-expanded
            aria-controls="code-theme-list"
            aria-activedescendant={matches[active] ? `code-theme-${matches[active].id}` : undefined}
            className="h-8 w-full rounded-md bg-transparent pl-7 pr-2 text-[13px] text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </div>
        <ul ref={listRef} id="code-theme-list" aria-label="Code theme" className="max-h-[min(360px,60dvh)] overflow-y-auto p-1.5">
          {matches.length === 0 ? <li className="px-2 py-3 text-[12.5px] text-subtle-foreground">No theme matches.</li> : null}
          {matches.map((t, i) => (
            <Fragment key={t.id}>
              {i === 0 || matches[i - 1].type !== t.type ? (
                <li className="px-2 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">{t.type === "dark" ? "Dark" : "Light"}</li>
              ) : null}
              <li>
                <button
                  id={`code-theme-${t.id}`}
                  data-index={i}
                  type="button"
                  aria-current={t.id === current.id ? "true" : undefined}
                  onClick={() => pick(t.id)}
                  onPointerMove={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] cursor-pointer",
                    i === active && "bg-surface-2",
                  )}
                >
                  <Swatch id={t.id} />
                  <span className="flex-1 truncate text-foreground">{t.label}</span>
                  {t.id === current.id ? <Check className="size-3.5 text-accent" /> : null}
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** A−, size, A+ for the code text. */
export function CodeSizeControl({ disabled }: Readonly<{ disabled?: boolean }>) {
  const s = useSettings();
  return (
    <div className="flex items-center gap-0.5">
      <IconToggle label="Smaller code text" disabled={s.codeSize <= CODE_SIZE_MIN || disabled} onClick={() => updateSettings({ codeSize: s.codeSize - 1 })}>
        <span className="text-[11px] font-semibold">A</span>
        <Minus className="size-3" />
      </IconToggle>
      <output aria-live="polite" aria-label="Code text size" className="w-9 text-center text-[11.5px] tabular-nums text-muted-foreground">
        {s.codeSize}px
      </output>
      <IconToggle label="Larger code text" disabled={s.codeSize >= CODE_SIZE_MAX || disabled} onClick={() => updateSettings({ codeSize: s.codeSize + 1 })}>
        <span className="text-[13px] font-semibold">A</span>
        <Plus className="size-3" />
      </IconToggle>
    </div>
  );
}

/** Soft wrap toggle, remembered. */
export function WrapToggle({ disabled }: Readonly<{ disabled?: boolean }>) {
  const s = useSettings();
  return (
    <IconToggle
      label={s.softWrap ? "Wrap long lines: on (Alt+Z)" : "Wrap long lines: off (Alt+Z)"}
      pressed={s.softWrap}
      disabled={disabled}
      onClick={() => updateSettings({ softWrap: !s.softWrap })}
    >
      <WrapText className="size-4" strokeWidth={1.75} />
    </IconToggle>
  );
}

/** Markdown: rendered preview or source. */
export function MarkdownToggle({ showRendered, onMarkdownView }: Readonly<{ showRendered: boolean; onMarkdownView: (v: "rendered" | "source") => void }>) {
  return showRendered ? (
    <IconToggle label="Show source" onClick={() => onMarkdownView("source")}>
      <Code2 className="size-4" strokeWidth={1.75} />
    </IconToggle>
  ) : (
    <IconToggle label="Show rendered preview" onClick={() => onMarkdownView("rendered")}>
      <Eye className="size-4" strokeWidth={1.75} />
    </IconToggle>
  );
}

/** Code only, full screen; the same button (or Escape) brings everything back. */
function FocusModeToggle() {
  const on = useFocusMode();
  return (
    <IconToggle label={on ? "Exit full screen (Escape)" : "Full screen code"} pressed={on} onClick={() => setFocusMode(!on)}>
      {on ? <Minimize2 className="size-4" strokeWidth={1.75} /> : <Maximize2 className="size-4" strokeWidth={1.75} />}
    </IconToggle>
  );
}

/**
 * One slim bar above an open file: the language on the left, view controls on
 * the right (code theme, Markdown preview or source, soft wrap, text size).
 */
export function FileToolbar({
  language,
  semantic,
  note,
  markdown,
  showRendered,
  onMarkdownView,
  onReloadFile,
  onEdit,
  editBlocked,
}: Readonly<{
  /** Local folders: read the file from disk again. */
  onReloadFile?: () => void;
  /** Local folders: switch to edit mode. */
  onEdit?: () => void;
  /** Why this file cannot be edited here (browser, folder access); the pencil shows it disabled. */
  editBlocked?: string;
  language: string;
  semantic: boolean;
  note?: React.ReactNode;
  markdown: boolean;
  showRendered: boolean;
  onMarkdownView: (v: "rendered" | "source") => void;
}>) {
  const s = useSettings();
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface pl-3 pr-1.5">
      <LanguageBadge label={language} semantic={semantic} />
      <p className="min-w-0 flex-1 truncate text-[12px] text-subtle-foreground">{note}</p>
      <div role="toolbar" aria-label="File view" className="flex shrink-0 items-center gap-0.5">
        <ThemeBadge />
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {onReloadFile ? (
          <>
            {onEdit ? (
              <IconToggle label={editBlocked ?? `Edit this file (${modKey("E")})`} disabled={!!editBlocked} onClick={onEdit}>
                <Pencil className="size-4" strokeWidth={1.75} />
              </IconToggle>
            ) : null}
            <IconToggle label="Reload file from disk" onClick={onReloadFile}>
              <RefreshCw className="size-4" strokeWidth={1.75} />
            </IconToggle>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          </>
        ) : null}
        {markdown ? (
          <>
            <IconToggle label="Rendered preview" pressed={showRendered} onClick={() => onMarkdownView("rendered")}>
              <Eye className="size-4" strokeWidth={1.75} />
            </IconToggle>
            <IconToggle label="Source" pressed={!showRendered} onClick={() => onMarkdownView("source")}>
              <Code2 className="size-4" strokeWidth={1.75} />
            </IconToggle>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          </>
        ) : null}
        <IconToggle
          label={s.softWrap ? "Wrap long lines: on (Alt+Z)" : "Wrap long lines: off (Alt+Z)"}
          pressed={s.softWrap}
          disabled={markdown && showRendered}
          onClick={() => updateSettings({ softWrap: !s.softWrap })}
        >
          <WrapText className="size-4" strokeWidth={1.75} />
        </IconToggle>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <IconToggle label="Smaller code text" disabled={s.codeSize <= CODE_SIZE_MIN || (markdown && showRendered)} onClick={() => updateSettings({ codeSize: s.codeSize - 1 })}>
          <span className="text-[11px] font-semibold">A</span>
          <Minus className="size-3" />
        </IconToggle>
        <output aria-live="polite" aria-label="Code text size" className="w-9 text-center text-[11.5px] tabular-nums text-muted-foreground">
          {s.codeSize}px
        </output>
        <IconToggle label="Larger code text" disabled={s.codeSize >= CODE_SIZE_MAX || (markdown && showRendered)} onClick={() => updateSettings({ codeSize: s.codeSize + 1 })}>
          <span className="text-[13px] font-semibold">A</span>
          <Plus className="size-3" />
        </IconToggle>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <FocusModeToggle />
      </div>
    </div>
  );
}
