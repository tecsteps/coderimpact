/** One place to rename: 1-based line, 0-based columns [col, endCol). */
export interface RenameSite {
  line: number;
  col: number;
  endCol: number;
}

const bare = (s: string) => s.replace(/^\$/, "");

/** Identifiers only; a PHP variable keeps its `$`. */
export function validRename(oldName: string, newName: string): string | null {
  if (!newName) return "Enter a new name.";
  if (bare(newName) === bare(oldName)) return "The name is unchanged.";
  if (!/^\$?[A-Za-z_À-￿][\wÀ-￿]*$/.test(newName)) return "Use letters, digits and underscores; no spaces.";
  if (oldName.startsWith("$") !== newName.startsWith("$")) return oldName.startsWith("$") ? "PHP variables keep their $." : "Only PHP variables start with $.";
  return null;
}

/**
 * Replaces the name at every site, from the end of the file backwards so the
 * earlier columns stay valid. A site whose text is no longer the old name
 * (the file changed since it was indexed) is skipped and counted.
 */
export function applyRename(text: string, sites: RenameSite[], oldName: string, newName: string): { text: string; applied: number; skipped: number } {
  const lines = text.split("\n");
  let applied = 0;
  let skipped = 0;
  const ordered = [...sites].sort((a, b) => b.line - a.line || b.col - a.col);
  const seen = new Set<string>();
  for (const s of ordered) {
    const id = `${s.line}:${s.col}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const line = lines[s.line - 1];
    const found = line?.slice(s.col, s.endCol);
    let replacement: string | null = null;
    if (found === oldName) replacement = newName;
    else if (found === bare(oldName)) replacement = bare(newName);
    if (line === undefined || replacement === null) {
      skipped++;
      continue;
    }
    lines[s.line - 1] = line.slice(0, s.col) + replacement + line.slice(s.endCol);
    applied++;
  }
  return { text: lines.join("\n"), applied, skipped };
}
