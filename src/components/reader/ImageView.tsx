import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageOff, Loader2, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { RepoSession } from "@/lib/session";
import { formatBytes } from "@/lib/util/files";
import { useBackToClose } from "@/lib/router";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

const CHECKER =
  "bg-[conic-gradient(var(--surface-2)_25%,transparent_0_50%,var(--surface-2)_0_75%,transparent_0)] bg-[length:20px_20px]";

/** Candidate URLs for the image (blob URLs are revoked when the path changes); [] when none could be made. */
function useImageUrls(session: RepoSession, path: string) {
  const [urls, setUrls] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    let created: string[] = [];
    setUrls(null);
    session
      .imageUrls(path)
      .then((u) => {
        created = u.filter((x) => x.startsWith("blob:"));
        if (alive) setUrls(u);
        else created.forEach((x) => URL.revokeObjectURL(x));
      })
      .catch(() => alive && setUrls([]));
    return () => {
      alive = false;
      created.forEach((x) => URL.revokeObjectURL(x));
    };
  }, [session, path]);
  return urls;
}

/**
 * An image file: fitted to the available space, with a full screen view that
 * switches between "fit" and "actual size" (tap the image or the zoom button).
 */
export function ImageView({ session, path }: Readonly<{ session: RepoSession; path: string }>) {
  const urls = useImageUrls(session, path);
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [full, setFull] = useState(false);
  const entry = session.tree.get(path);

  useEffect(() => {
    setAttempt(0);
    setSize(null);
  }, [session, path]);

  useBackToClose(full, () => setFull(false));

  const name = path.split("/").pop();
  const src = urls?.[attempt];
  if (urls && !src) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[13.5px] text-muted-foreground">
        <ImageOff className="size-6 text-subtle-foreground" strokeWidth={1.5} />
        {name} could not be shown here.
      </div>
    );
  }

  const sizeText = size ? `${size.w} × ${size.h}` : null;
  const meta = [sizeText, entry?.size ? formatBytes(entry.size) : null].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6", CHECKER)}>
        {src ? (
          <>
            <button type="button" onClick={() => setFull(true)} className="flex max-h-full max-w-full cursor-zoom-in items-center justify-center" aria-label={`Show ${name} full screen`}>
              <img
                src={src}
                alt={name}
                draggable={false}
                onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setAttempt((a) => a + 1)}
                className="block max-h-full max-w-full object-contain [image-rendering:auto]"
              />
            </button>
            <Button variant="outline" size="icon" className="absolute top-3 right-3 bg-surface/90 shadow-pop backdrop-blur" aria-label="Full screen" onClick={() => setFull(true)}>
              <Maximize2 strokeWidth={1.75} />
            </Button>
          </>
        ) : (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        )}
      </div>
      {meta ? <p className="shrink-0 border-t border-border bg-surface px-3 py-1.5 text-center text-[12px] tabular-nums text-subtle-foreground">{meta}</p> : null}

      {full && src ? <FullScreenImage src={src} name={name} onClose={() => setFull(false)} /> : null}
    </div>
  );
}

/**
 * Full screen view as a native modal dialog: it traps focus and closes on
 * Escape through the dialog's cancel event. Mounted only while open, so it
 * starts in "fit" mode every time.
 */
function FullScreenImage({ src, name, onClose }: Readonly<{ src: string; name: string | undefined; onClose: () => void }>) {
  const [actual, setActual] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  // Before paint, so the dialog never shows as a non-modal element first.
  useLayoutEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-modal
      aria-label={name}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 z-[60] m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-black p-0"
    >
      <div className="pt-safe absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-1 bg-gradient-to-b from-black/60 to-transparent p-2">
        <span className="mr-auto truncate px-2 text-[13px] text-white/80">{name}</span>
        <button
          type="button"
          aria-label={actual ? "Fit to screen" : "Actual size"}
          onClick={() => setActual((a) => !a)}
          className="rounded-full p-2.5 text-white hover:bg-white/15 cursor-pointer"
        >
          {actual ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
        </button>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-2.5 text-white hover:bg-white/15 cursor-pointer" autoFocus>
          <X className="size-5" />
        </button>
      </div>
      <div className={cn("flex min-h-0 flex-1 overflow-auto", actual ? "items-start justify-start" : "items-center justify-center")}>
        {/* Tapping the image toggles the size too. The zoom button above is the
            keyboard route, so this one stays out of the tab order, and
            display: contents keeps the image laid out as before. */}
        <button type="button" tabIndex={-1} aria-label={actual ? "Fit to screen" : "Actual size"} onClick={() => setActual((a) => !a)} className="contents">
          <img
            src={src}
            alt={name}
            draggable={false}
            className={cn("m-auto block", actual ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
          />
        </button>
      </div>
    </dialog>
  );
}
