import { baseUrl } from "@/lib/config";
import { isLocalOwner } from "@/lib/local/projects";

/** Shown while a repository or folder opens: what is happening, and that it is happening. */
export function OpeningRepository({ owner, repo }: Readonly<{ owner: string; repo: string }>) {
  const local = isLocalOwner(owner);
  return (
    <output className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-16 text-center">
      <img src={baseUrl("illustrations/loading-light.webp")} alt="" aria-hidden className="w-[min(440px,86%)] dark:hidden" width={1172} height={402} />
      <img src={baseUrl("illustrations/loading-dark.webp")} alt="" aria-hidden className="hidden w-[min(440px,86%)] dark:block" width={1172} height={402} />
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          Opening <span className="font-mono text-[20px]">{local ? repo : `${owner}/${repo}`}</span>
        </h1>
        <p className="max-w-[46ch] text-pretty text-[14px] text-muted-foreground">
          {local
            ? "Reading the folder from your disk. Nothing is uploaded."
            : "Loading the file list from GitHub. Big repositories take a few seconds; after that, everything runs in your browser."}
        </p>
      </div>
      <div aria-hidden className="loading-bar h-1 w-48 overflow-hidden rounded-full bg-border" />
    </output>
  );
}
