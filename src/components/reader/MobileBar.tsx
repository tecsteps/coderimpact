import { FolderGit2 } from "lucide-react";
import { LineSparkIcon, ScanSearchIcon, SymbolsIcon } from "../icons";
import { cn } from "@/lib/utils";

export type MobilePanel = "files" | "repos" | "search" | "symbols" | "explain";

const ReposIcon = (p: React.SVGProps<SVGSVGElement>) => <FolderGit2 strokeWidth={1.6} {...(p as object)} />;

/** The one fixed bottom row on phones: Repos, Search, Symbols, Explain. Files open from the top left. */
export function MobileBar({
  active,
  onOpen,
  symbolBadge,
  disabled = [],
}: Readonly<{
  active: MobilePanel | null;
  onOpen: (p: MobilePanel) => void;
  symbolBadge?: boolean;
  /** Actions that need an open repository (the empty editor). */
  disabled?: MobilePanel[];
}>) {
  const items: { id: MobilePanel; label: string; Icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactElement }[] = [
    { id: "repos", label: "Repos", Icon: ReposIcon },
    { id: "search", label: "Search", Icon: ScanSearchIcon },
    { id: "symbols", label: "Symbols", Icon: SymbolsIcon },
    { id: "explain", label: "Explain", Icon: LineSparkIcon },
  ];
  return (
    <nav aria-label="Reader actions" className="pb-safe shrink-0 border-t border-border bg-surface">
      <ul className="grid h-14 grid-cols-4">
        {items.map(({ id, label, Icon }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onOpen(id)}
              aria-expanded={active === id}
              disabled={disabled.includes(id)}
              className={cn(
                "relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground cursor-pointer",
                id === "explain" && "text-accent",
                active === id && "text-foreground",
                "disabled:cursor-default disabled:opacity-35",
              )}
            >
              <Icon className="size-[22px]" />
              {label}
              {id === "symbols" && symbolBadge ? <span aria-hidden className="absolute top-2 right-[calc(50%-16px)] size-1.5 rounded-full bg-accent" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
