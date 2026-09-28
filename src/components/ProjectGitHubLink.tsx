import { GitHubMark } from "./reader/TopBar";
import { Tooltip } from "./ui/tooltip";
import { cn } from "@/lib/utils";

export const PROJECT_REPO_URL = "https://github.com/tecsteps/coderimpact";

/** CoderImpact's own repository, top right on every page. */
export function ProjectGitHubLink({ className }: Readonly<{ className?: string }>) {
  return (
    <Tooltip content="CoderImpact on GitHub">
      <a
        href={PROJECT_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="CoderImpact on GitHub"
        className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground", className)}
      >
        <GitHubMark className="size-[18px]" />
      </a>
    </Tooltip>
  );
}
