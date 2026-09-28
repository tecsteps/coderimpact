export class Slugger {
  constructor(private readonly max: number) {}

  make(title: string): string {
    const lower = title.toLowerCase();
    return normalize(lower).slice(0, this.max);
  }
}

export function normalize(s: string): string {
  const trimmed = s.trim();
  return trimmed.replace(/[^a-z0-9]+/g, "-");
}
