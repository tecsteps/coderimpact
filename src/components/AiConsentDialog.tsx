import { Dialog as D } from "radix-ui";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useBackToClose } from "@/lib/router";
import { Button } from "./ui/button";

/**
 * Asked before the first AI explanation: which code leaves the browser and
 * where it goes. "Allow" is remembered; "Not now" asks again next time.
 */
export function AiConsentDialog({ open, onAllow, onDecline }: Readonly<{ open: boolean; onAllow: () => void; onDecline: () => void }>) {
  useBackToClose(open, onDecline);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onDecline()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[70] bg-black/45" />
        <D.Content className="fixed top-1/2 left-1/2 z-[71] flex w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-surface p-5 text-foreground shadow-pop outline-none">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <ShieldCheck className="size-5" strokeWidth={1.75} />
            </span>
            <div className="flex flex-col gap-1">
              <D.Title className="text-[16px] font-semibold">Send code for AI explanations?</D.Title>
              <D.Description className="text-[13.5px] text-muted-foreground">
                Everything else runs in your browser. Explanations are the exception: they need a language model.
              </D.Description>
            </div>
          </div>

          <ol className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[13px]">
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium [&>span]:whitespace-nowrap">
              <span>Your browser</span>
              <ArrowRight className="size-3.5 text-subtle-foreground" />
              <span>CoderImpact backend</span>
              <ArrowRight className="size-3.5 text-subtle-foreground" />
              <span>OpenRouter</span>
              <ArrowRight className="size-3.5 text-subtle-foreground" />
              <span>OpenAI</span>
            </li>
            <li className="text-muted-foreground">
              Sent: the lines you ask about and the code around them (at most 12 KB, obvious secrets removed), the file path and language. Nothing else from the repository or folder.
            </li>
            <li className="text-muted-foreground">Our backend only forwards the request and stores nothing. OpenRouter and OpenAI handle it under their own policies. Details in the{" "}
              <a href="/privacy" target="_blank" rel="noopener" className="text-accent underline-offset-2 hover:underline">
                privacy policy
              </a>
              <span>.</span>
            </li>
          </ol>

          <p className="text-[12.5px] text-subtle-foreground">
            Allow once and it applies to all explanations in this browser; you can withdraw it in the settings. Not now sends nothing and asks again next time.
          </p>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onDecline}>
              Not now
            </Button>
            <Button onClick={onAllow} autoFocus>
              Allow and explain
            </Button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
