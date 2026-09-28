import { useEffect, useState } from "react";
import { LegalLinks } from "./LegalLinks";
import { Database, Settings2, Trash2 } from "lucide-react";
import { cacheUsage, clearCache, type CacheUsage } from "@/lib/cache/db";
import { clearRecents } from "@/lib/cache/recents";
import { formatBytes } from "@/lib/util/files";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { FAMILIAR_LANGUAGE_OPTIONS, updateSettings, useSettings } from "@/lib/cache/settings";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/** "Languages I know": explanations are written for this reader. */
export function FamiliarLanguages() {
  const s = useSettings();
  return (
    <section className="flex flex-col gap-2">
        <h3 id="familiar-label" className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">
          Languages I know
        </h3>
        <p className="text-[12px] text-subtle-foreground">
          Optional. Explanations are written for you and, when the code is in another language, compare to these where it helps.
        </p>
        <fieldset aria-labelledby="familiar-label" className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
          {FAMILIAR_LANGUAGE_OPTIONS.map((lang) => {
            const on = s.familiarLanguages.includes(lang);
            return (
              <button
                key={lang}
                type="button"
                aria-pressed={on}
                disabled={!on && s.familiarLanguages.length >= 4}
                onClick={() =>
                  updateSettings({
                    familiarLanguages: on ? s.familiarLanguages.filter((l) => l !== lang) : [...s.familiarLanguages, lang],
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[12px] cursor-pointer disabled:cursor-default disabled:opacity-40",
                  on ? "border-accent bg-accent-soft text-foreground" : "border-border text-muted-foreground hover:bg-surface-2",
                )}
              >
                {lang}
              </button>
            );
          })}
        </fieldset>
      </section>
  );
}

export function useCacheUsage(refreshKey: unknown) {
  const [usage, setUsage] = useState<CacheUsage | null>(null);
  useEffect(() => {
    let alive = true;
    cacheUsage().then((u) => alive && setUsage(u));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return usage;
}

export function CacheSummary({ onCleared }: Readonly<{ onCleared?: () => void }>) {
  const [tick, setTick] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const usage = useCacheUsage(tick);
  const files = usage?.counts.blobs ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13px]">
        <Database className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <span className="text-foreground">Local cache</span>
        <span className="ml-auto tabular-nums text-muted-foreground">
          {usage?.usage !== undefined ? formatBytes(usage.usage) : "…"}
        </span>
      </div>
      <p className="text-[12px] text-subtle-foreground">
        {files.toLocaleString()} files, {(usage?.counts.indexes ?? 0).toLocaleString()} file indexes and {(usage?.counts.explanations ?? 0).toLocaleString()} explanations are stored in this browser only.
      </p>
      {confirm ? (
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-muted-foreground">Remove all cached data?</span>
          <Button
            size="sm"
            variant="default"
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              await clearCache();
              setClearing(false);
              setConfirm(false);
              setTick((t) => t + 1);
              onCleared?.();
            }}
          >
            Clear
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
            <Trash2 /> Clear cache
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearRecents();
              onCleared?.();
            }}
          >
            Clear recent list
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Use AI explanations": the same decision the consent dialog asks for. */
function AiToggle() {
  const s = useSettings();
  const on = s.aiConsent;
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span id="ai-toggle-label" className="text-[13px] font-medium text-foreground">
          Use AI explanations
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="ai-toggle-label"
          onClick={() => updateSettings({ aiConsent: !on })}
          className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer", on ? "bg-accent" : "bg-border-strong")}
        >
          <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", on && "translate-x-4")} />
        </button>
      </div>
      <p className="text-[12px] text-subtle-foreground">
        {on
          ? "On: the code you ask about is sent to our backend, OpenRouter and OpenAI. Everything else stays in your browser."
          : "Off: you are asked before any code is sent. Everything else stays in your browser."}
      </p>
    </section>
  );
}

export function SettingsMenu({ codeOptions }: { codeOptions?: React.ReactNode } = {}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings2 strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="flex flex-col gap-4">
          <AiToggle />
          {codeOptions ? <div className="flex flex-col gap-2 border-t border-border pt-3">{codeOptions}</div> : null}
          <div className="border-t border-border pt-3">
            <FamiliarLanguages />
          </div>
          <div className="border-t border-border pt-3">
            <CacheSummary />
          </div>
          <p className="border-t border-border pt-3 text-[12px] text-subtle-foreground">
            No account and no tracking. CoderImpact reads public GitHub repositories and your local files right in your browser; local files are never uploaded.
          </p>
          <LegalLinks className="justify-start" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
