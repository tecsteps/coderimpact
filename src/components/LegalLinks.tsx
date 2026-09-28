import { cn } from "@/lib/utils";

/** Imprint, privacy policy and terms (pages served next to the app, not part of it). */
export const LEGAL_LINKS = [
  { href: "/imprint", label: "Imprint" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

export function LegalLinks({ className }: Readonly<{ className?: string }>) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-subtle-foreground", className)}>
      {LEGAL_LINKS.map((l) => (
        <a key={l.href} href={l.href} className="hover:text-foreground hover:underline">
          {l.label}
        </a>
      ))}
    </nav>
  );
}
