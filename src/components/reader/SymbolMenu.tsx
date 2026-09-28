import { Fragment, useEffect, useMemo } from "react";
import { ArrowUpRight, ClipboardCopy, ListTree, Loader2, PenLine, PhoneIncoming, Search } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import type { Resolution } from "@/lib/lang/semanticIndex";
import type { Block } from "@/lib/lang/types";
import { useSessionVersion } from "@/hooks/useSession";
import { useBackToClose } from "@/lib/router";
import { ClassIcon, FunctionIcon, LineSparkIcon } from "../icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Sheet, SheetContent } from "../ui/sheet";
import type { SymbolSelection } from "./RefsPanel";
import { cn } from "@/lib/utils";

export type SymbolAction =
  | { t: "definition"; resolution: Resolution }
  | { t: "panel"; tab: "references" | "callers" }
  | { t: "search"; name: string }
  | { t: "explain-line"; line: number }
  | { t: "explain-block"; block: Block }
  | { t: "rename"; resolution: Extract<Resolution, { status: "resolved" }> }
  | { t: "copy"; name: string };

export interface SymbolMenuAnchor {
  x: number;
  top: number;
  bottom: number;
}

interface Item {
  id: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  hint?: string;
  /** Tooltip, also shown while the item is disabled. */
  title?: string;
  shortcut?: string;
  disabled?: boolean;
  action: SymbolAction;
}

/**
 * The actions for a clicked identifier: a small menu at the click point on
 * desktop, a bottom action sheet on phones. Nothing else opens until the
 * reader picks an action, so a click never pushes a side panel into view.
 */
export function SymbolMenu({
  session,
  selection,
  anchor,
  isMobile,
  canRename,
  onOpenChange,
  onAction,
}: Readonly<{
  session: RepoSession;
  selection: SymbolSelection | null;
  anchor: SymbolMenuAnchor | null;
  isMobile: boolean;
  /** Local folders that can be saved. */
  canRename?: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (a: SymbolAction) => void;
}>) {
  const version = useSessionVersion(session);
  const open = !!selection && !!anchor;
  useBackToClose(open && isMobile, () => onOpenChange(false));

  const resolution = useMemo<Resolution | null>(
    () => (selection ? session.index.resolveOccurrence(selection.path, selection.index) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, selection, version],
  );

  // Fetch the declaring file in the background so the definition entry fills in.
  useEffect(() => {
    if (!open || !selection || resolution?.status === "resolved") return;
    const ctl = new AbortController();
    session.resolveDeep(selection.path, selection.index, ctl.signal).catch(() => undefined);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selection?.path, selection?.index]);

  if (!selection || !resolution) return null;
  const name = selection.name.replace(/^\$/, "");
  const { shortName, qualifier } = splitQualified(name);
  const resolved = resolution.status === "resolved" ? resolution : null;
  const items = buildItems(session, selection, resolution, isMobile, name, shortName, canRename);

  if (isMobile) {
    return (
      <SymbolSheet
        open={open}
        onOpenChange={onOpenChange}
        name={name}
        shortName={shortName}
        qualifier={qualifier}
        kind={resolved?.kind}
        line={selection.line}
        items={items}
        onAction={onAction}
      />
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed w-px"
          style={anchor ? { left: anchor.x, top: anchor.top, height: anchor.bottom - anchor.top } : undefined}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" onCloseAutoFocus={(e) => e.preventDefault()} aria-label={`Actions for ${name}`}>
        <DropdownMenuLabel>
          <span className="flex min-w-0 items-baseline gap-2">
            <code className="truncate font-mono text-[13px] font-semibold text-foreground" title={name}>
              {shortName}
            </code>
            {resolved?.kind ? <span className="text-[11.5px] text-subtle-foreground">{resolved.kind}</span> : null}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((it) => (
          <Fragment key={it.id}>
            {it.id === "search" ? <DropdownMenuSeparator /> : null}
            <div title={it.title}>
            <DropdownMenuItem disabled={it.disabled} onSelect={() => onAction(it.action)}>
              {it.icon}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint ? <span className={cn("text-[11.5px] text-subtle-foreground", hintFont(it.hint))}>{it.hint}</span> : null}
              {it.shortcut ? <DropdownMenuShortcut>{it.shortcut}</DropdownMenuShortcut> : null}
            </DropdownMenuItem>
            </div>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hints with words read as prose, bare counts and locations as code. */
const hintFont = (hint: string) => (/\s/.test(hint) ? "font-sans" : "font-mono");

/** Qualified names (PHP `Foo\Bar\Baz`, `Mod::f`): short name as the title, the qualifier below it. */
function splitQualified(name: string): { shortName: string; qualifier: string } {
  const colons = name.includes("::") ? name.lastIndexOf("::") + 1 : -1;
  const cut = Math.max(name.lastIndexOf("\\"), colons);
  if (cut < 0) return { shortName: name, qualifier: "" };
  const qualifierEnd = name[cut] === ":" ? cut - 1 : cut;
  return { shortName: name.slice(cut + 1), qualifier: name.slice(0, qualifierEnd) };
}

function usageKeyOf(resolution: Resolution): string | undefined {
  if (resolution.status === "resolved" || resolution.status === "external") return resolution.key;
  return undefined;
}

function definitionItem(session: RepoSession, selection: SymbolSelection, resolution: Resolution, isMobile: boolean): Item {
  const def = resolution.status === "resolved" ? resolution.defs[0] : undefined;
  const isDef = !!def && def.path === selection.path && def.line === selection.line && def.col === selection.col;
  const loading = resolution.status === "unresolved" && session.progress.phase === "running";
  // Built-ins and dependencies: nothing to jump to (unless indexing may still find it).
  const outside = resolution.status === "external" && session.progress.phase !== "running";

  let label = "Go to definition";
  if (isDef) label = "This is the definition";
  else if (resolution.status === "candidates") label = `Show ${resolution.candidates.length} definitions`;

  let hint: string | undefined;
  if (outside) hint = "Outside the indexed code";
  else if (def && !isDef) hint = `${def.path.split("/").pop()}:${def.line}`;

  const reason = resolution.status === "external" ? resolution.reason : "";
  return {
    id: "def",
    icon: loading ? <Loader2 className="animate-spin" /> : <ArrowUpRight />,
    label,
    hint,
    title: outside ? `Outside the indexed code: ${reason}` : undefined,
    shortcut: isMobile || outside ? undefined : "F12",
    disabled: isDef || resolution.status === "dynamic" || outside,
    action: { t: "definition", resolution },
  };
}

/**
 * The function, method, class or type the clicked name stands for, when its
 * body is in this file: the name in its declaration, or a use of it here.
 */
function blockOf(session: RepoSession, selection: SymbolSelection, resolution: Resolution): Block | undefined {
  const fi = session.index.get(selection.path);
  if (!fi) return undefined;
  const occ = fi.occurrences[selection.index];
  if (occ?.role === "def" && occ.target.t === "decl") {
    const id = occ.target.decl;
    return fi.blocks.find((b) => b.decl === id);
  }
  const def = resolution.status === "resolved" ? resolution.defs[0] : undefined;
  if (def?.path !== selection.path) return undefined;
  return fi.blocks.find((b) => b.declLine === def.line && b.name === def.name.replace(/^\$/, ""));
}

function explainBlockItem(block: Block): Item {
  const Icon = block.kind === "class" || block.kind === "type" ? ClassIcon : FunctionIcon;
  return { id: "explain-block", icon: <Icon />, label: `Explain ${block.kind} ${block.label}`, action: { t: "explain-block", block } };
}

function buildItems(session: RepoSession, selection: SymbolSelection, resolution: Resolution, isMobile: boolean, name: string, shortName: string, canRename?: boolean): Item[] {
  const usageKey = usageKeyOf(resolution);
  const refCount = usageKey ? session.index.references(usageKey).refs.length : 0;
  const callable = resolution.status === "resolved" && (resolution.kind === "function" || resolution.kind === "method");
  const items: Item[] = [
    definitionItem(session, selection, resolution, isMobile),
    {
      id: "refs",
      icon: <ListTree />,
      label: "Find usages",
      hint: usageKey ? String(refCount) : undefined,
      shortcut: isMobile ? undefined : "R",
      action: { t: "panel", tab: "references" },
    },
  ];
  if (callable) items.push({ id: "callers", icon: <PhoneIncoming />, label: "Show callers", action: { t: "panel", tab: "callers" } });
  items.push(
    { id: "search", icon: <Search />, label: <>Search for <code className="font-mono">{shortName}</code></>, action: { t: "search", name: shortName } },
    { id: "explain", icon: <LineSparkIcon />, label: `Explain line ${selection.line}`, shortcut: isMobile ? undefined : "E", action: { t: "explain-line", line: selection.line } },
  );
  const block = blockOf(session, selection, resolution);
  if (block) items.push(explainBlockItem(block));
  if (canRename && resolution.status === "resolved" && resolution.defs.length > 0) {
    items.push({ id: "rename", icon: <PenLine />, label: "Rename…", shortcut: isMobile ? undefined : "F2", action: { t: "rename", resolution } });
  }
  items.push({ id: "copy", icon: <ClipboardCopy />, label: "Copy name", action: { t: "copy", name } });
  return items;
}

/** The phone variant: a bottom action sheet. */
function SymbolSheet({
  open,
  onOpenChange,
  name,
  shortName,
  qualifier,
  kind,
  line,
  items,
  onAction,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  shortName: string;
  qualifier: string;
  kind?: string;
  line: number;
  items: Item[];
  onAction: (a: SymbolAction) => void;
}>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? (
        <SheetContent title={shortName} description={`Actions for ${name}`}>
          <div className="flex flex-col gap-0.5 px-4 pb-1 text-[12px] text-subtle-foreground">
            {qualifier ? <span className="break-all font-mono text-[11.5px]">{qualifier}</span> : null}
            <span>
              {kind ?? "symbol"} · line {line}
            </span>
          </div>
          <ul className="flex flex-col px-2 pb-3">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  disabled={it.disabled}
                  title={it.title}
                  onClick={() => onAction(it.action)}
                  className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-foreground active:bg-surface-2 disabled:opacity-45 [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground cursor-pointer"
                >
                  {it.icon}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint ? <span className={cn("shrink-0 text-[12px] text-subtle-foreground", hintFont(it.hint))}>{it.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
