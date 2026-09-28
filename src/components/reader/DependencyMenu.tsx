import { ArrowUpRight, Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { REGISTRY_NAME, registryUrl, repositoryOf, type Dependency } from "@/lib/deps";
import { hrefFor } from "@/lib/router";

/** "Opens in a new tab", at the end of a menu entry. */
function NewTab() {
  return <ArrowUpRight aria-label="opens in a new tab" className="text-subtle-foreground" />;
}
import { LogoMark } from "../icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import type { SymbolMenuAnchor } from "./SymbolMenu";

/**
 * A click on a dependency in a manifest (package.json, composer.json, go.mod,
 * Cargo.toml, requirements, Gemfile): show it on its registry, or open its
 * source repository in CoderImpact, each in a new tab.
 */
export function DependencyMenu({
  dep,
  anchor,
  onClose,
}: Readonly<{ dep: Dependency | null; anchor: SymbolMenuAnchor | null; onClose: () => void }>) {
  const open = !!dep && !!anchor;
  // Looked up as soon as the menu opens: undefined while looking, null when the registry names no GitHub repository.
  const [repo, setRepo] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!dep) return;
    let alive = true;
    setRepo(undefined);
    repositoryOf(dep)
      .catch(() => null)
      .then((r) => {
        if (alive) setRepo(r);
      });
    return () => {
      alive = false;
    };
  }, [dep]);

  return (
    <DropdownMenu open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed w-px" style={anchor ? { left: anchor.x, top: anchor.top, height: anchor.bottom - anchor.top } : undefined} />
      </DropdownMenuTrigger>
      {dep ? (
        <DropdownMenuContent align="start" side="bottom" onCloseAutoFocus={(e) => e.preventDefault()} aria-label={`Actions for ${dep.name}`}>
          <DropdownMenuLabel>
            <code className="truncate font-mono text-[13px] font-semibold text-foreground">{dep.name}</code>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Both open a new tab (the arrow on the right says so), so the reader keeps its place here. */}
          <DropdownMenuItem asChild>
            <a href={registryUrl(dep)} target="_blank" rel="noopener noreferrer" onClick={onClose}>
              <Package />
              <span className="flex-1">Show on {REGISTRY_NAME[dep.ecosystem]}</span>
              <NewTab />
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!repo}>
            <a href={repo ? hrefFor(`/${repo}`) : undefined} target="_blank" rel="noopener" onClick={onClose} aria-disabled={!repo || undefined}>
              {repo === undefined ? <Loader2 className="animate-spin" /> : <LogoMark />}
              <span className="flex-1">Open in CoderImpact</span>
              <span className="font-mono text-[11.5px] text-subtle-foreground">{repo ?? (repo === null ? "not on GitHub" : "")}</span>
              {repo ? <NewTab /> : null}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

/** The dependency click handler for the code view, and the menu it opens. */
export function useDependencyMenu() {
  const [target, setTarget] = useState<{ dep: Dependency; anchor: SymbolMenuAnchor } | null>(null);
  const onDependency = useCallback((dep: Dependency, anchor: SymbolMenuAnchor) => setTarget({ dep, anchor }), []);
  const menu = <DependencyMenu dep={target?.dep ?? null} anchor={target?.anchor ?? null} onClose={() => setTarget(null)} />;
  return { onDependency, menu };
}
