import { useEffect, useState } from "react";
import { AlertTriangle, CloudOff, ExternalLink, FileWarning, GitBranch, Lock, RotateCw, Timer, FolderLock } from "lucide-react";
import type { AppError } from "@/lib/errors";
import { formatBytes } from "@/lib/util/files";
import { Button } from "./ui/button";

function Countdown({ until }: Readonly<{ until: number }>) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((until - now) / 1000));
  if (s <= 0) return <>now</>;
  const m = Math.floor(s / 60);
  return <>{m > 0 ? `${m} min ${s % 60} s` : `${s} s`}</>;
}

const TITLES: Record<AppError["kind"], string> = {
  "invalid-url": "That is not a repository link",
  "not-found": "Not found",
  "rate-limit": "GitHub rate limit reached",
  offline: "You are offline",
  network: "Could not reach GitHub",
  server: "GitHub is having trouble",
  "ambiguous-ref": "Which branch or tag did you mean?",
  "too-large": "File too large",
  binary: "Binary file",
  lfs: "Stored with Git LFS",
  submodule: "Git submodule",
  "repo-too-large": "Repository too large",
  "local-access": "Allow access to the folder",
  conflict: "Changed on disk",
  aborted: "Cancelled",
};

function iconFor(kind: AppError["kind"]) {
  switch (kind) {
    case "rate-limit":
      return Timer;
    case "offline":
    case "network":
      return CloudOff;
    case "not-found":
      return Lock;
    case "ambiguous-ref":
      return GitBranch;
    case "binary":
    case "lfs":
    case "too-large":
    case "submodule":
      return FileWarning;
    case "local-access":
      return FolderLock;
    default:
      return AlertTriangle;
  }
}

export function ErrorState({
  error,
  onRetry,
  githubUrl,
  onPickCandidate,
  children,
}: Readonly<{
  children?: React.ReactNode;
  error: AppError;
  onRetry?: () => void;
  githubUrl?: string;
  onPickCandidate?: (ref: string) => void;
}>) {
  const Icon = iconFor(error.kind);
  const resetAt = error.details.resetAt;
  const retryable = ["rate-limit", "offline", "network", "server"].includes(error.kind);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-start gap-3 px-6 py-16">
      <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{TITLES[error.kind]}</h2>
        <p className="mt-1 text-[13.5px] text-muted-foreground text-pretty">{error.message}</p>
        {error.kind === "rate-limit" && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            {error.details.limit ? `Unauthenticated visitors get ${error.details.limit} requests per hour. ` : ""}
            {resetAt ? (
              <>
                Resets at {new Date(resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (in <Countdown until={resetAt} />). Files you already opened still work.
              </>
            ) : null}
          </p>
        )}
        {error.kind === "too-large" && error.details.size ? (
          <p className="mt-2 text-[13px] text-muted-foreground">Size: {formatBytes(error.details.size)}.</p>
        ) : null}
      </div>
      {error.kind === "ambiguous-ref" && error.details.candidates && onPickCandidate ? (
        <div className="flex flex-wrap gap-2">
          {error.details.candidates.map((c) => {
            const [type, name] = [c.slice(0, c.indexOf(":")), c.slice(c.indexOf(":") + 1)];
            return (
              <Button key={c} variant="outline" size="sm" onClick={() => onPickCandidate(name)}>
                <GitBranch /> {name} <span className="text-subtle-foreground">{type}</span>
              </Button>
            );
          })}
        </div>
      ) : null}
      {children}
      <div className="flex flex-wrap gap-2">
        {onRetry && retryable ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw /> Try again
          </Button>
        ) : null}
        {githubUrl ? (
          <Button size="sm" variant="outline" asChild>
            <a href={githubUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Open on GitHub
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
