import type { SVGProps } from "react";

/**
 * Custom icons for the options picked on the design sheet:
 * logo F, explain class/type B, explain function/method D, explain line C,
 * mobile bottom bar B. Utility icons come from lucide (outline, style A).
 */
type P = Readonly<SVGProps<SVGSVGElement>>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Logo F: three stacked rounded bars, the middle one longer and teal. */
export function LogoMark({ className, ...p }: P) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...p}>
      <rect x="3" y="5" width="12" height="3" rx="1.5" fill="currentColor" />
      <rect x="3" y="10.5" width="18" height="3" rx="1.5" fill="var(--accent)" />
      <rect x="3" y="16" width="12" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** Explain class/type (B): two overlapping rounded rectangles. */
export function ClassIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="3.5" y="3.5" width="12" height="10" rx="2.5" />
      <rect x="8.5" y="10.5" width="12" height="10" rx="2.5" />
    </svg>
  );
}

/** Explain function/method (D): an arrow going right, then down. */
export function FunctionIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M3.5 6.5h13a2 2 0 0 1 2 2v10" />
      <path d="m14.5 14.5 4 4 4-4" />
    </svg>
  );
}

/** Explain line (C): a four-point sparkle inside a circle. */
export function LineSparkIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 6.8c.45 2.9 2.3 4.75 5.2 5.2-2.9.45-4.75 2.3-5.2 5.2-.45-2.9-2.3-4.75-5.2-5.2 2.9-.45 4.75-2.3 5.2-5.2Z" />
    </svg>
  );
}

/** Small filled sparkle for the "AI explanation" label. */
export function SparkIcon(p: P) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...p}>
      <path fill="currentColor" d="M12 2.5c.7 4.7 3.1 7.1 7.8 7.8.9.1.9 1.3 0 1.4-4.7.7-7.1 3.1-7.8 7.8-.1.9-1.3.9-1.4 0-.7-4.7-3.1-7.1-7.8-7.8-.9-.1-.9-1.3 0-1.4 4.7-.7 7.1-3.1 7.8-7.8.1-.9 1.3-.9 1.4 0Z" />
    </svg>
  );
}

/** Bottom bar B: Search, a scan frame with a dot. */
export function ScanSearchIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Bottom bar B: Symbols, a small tree in brackets. */
export function SymbolsIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M5 4H3.5v16H5M19 4h1.5v16H19" />
      <circle cx="12" cy="8" r="1.8" />
      <circle cx="8.5" cy="16" r="1.8" />
      <circle cx="15.5" cy="16" r="1.8" />
      <path d="M12 9.8v2.2M8.5 14.2V13h7v1.2" />
    </svg>
  );
}
