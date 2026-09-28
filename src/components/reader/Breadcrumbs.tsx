import { Fragment, useLayoutEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { hrefFor, navigate, readerUrl } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * The full path of the open file or folder: repository, then each folder
 * (clickable), then the file name. `compact` is the phone variant: one
 * scrollable line, scrolled to the end so the file name stays visible.
 */
export function Breadcrumbs({
  owner,
  repo,
  commit,
  path,
  isDir,
  compact,
  className,
}: Readonly<{
  owner: string;
  repo: string;
  commit: string;
  path: string;
  isDir: boolean;
  compact?: boolean;
  className?: string;
}>) {
  const ref = useRef<HTMLOListElement>(null);
  const parts = path ? path.split("/") : [];

  useLayoutEffect(() => {
    if (compact && ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [compact, path]);

  const link = (target: string, label: string, key: string, strong = false) => {
    const url = readerUrl(owner, repo, commit, target, "tree");
    return (
      <a
        key={key}
        href={hrefFor(url)}
        onClick={(e) => {
          e.preventDefault();
          navigate(url);
        }}
        className={cn(
          "whitespace-nowrap rounded px-1 py-0.5 hover:bg-surface-2 hover:text-foreground",
          strong ? "font-medium text-foreground" : "text-muted-foreground",
          !compact && "max-w-[16ch] truncate",
        )}
        title={target || `${owner}/${repo}`}
      >
        {label}
      </a>
    );
  };

  return (
    <nav aria-label="File path" className={cn("min-w-0", className)}>
      <ol
        ref={ref}
        className={cn(
          "flex min-w-0 items-center text-[13px]",
          compact ? "overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "overflow-hidden",
        )}
      >
        <li className="flex shrink-0 items-center">{link("", repo, "root", parts.length === 0)}</li>
        {parts.map((seg, i) => {
          const sub = parts.slice(0, i + 1).join("/");
          const last = i === parts.length - 1;
          return (
            <Fragment key={sub}>
              <li aria-hidden className="shrink-0 text-subtle-foreground">
                <ChevronRight className="size-3.5" />
              </li>
              <li className={cn("flex items-center", last || compact ? "shrink-0" : "min-w-0 shrink")}>
                {last && !isDir ? (
                  <span aria-current="page" className="whitespace-nowrap px-1 py-0.5 font-medium text-foreground">
                    {seg}
                  </span>
                ) : (
                  link(sub, seg, sub, last)
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
