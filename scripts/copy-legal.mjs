// Copies the legal pages (imprint, privacy, terms) into the build output when the
// local, git-ignored legal/ folder exists. They are served at /imprint, /privacy, /terms.
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const from = "legal";
const to = process.argv[2] ?? "dist";
if (existsSync(from) && existsSync(to)) {
  const pages = readdirSync(from).filter((f) => f.endsWith(".html"));
  for (const f of pages) copyFileSync(join(from, f), join(to, f));
  console.log(`legal pages: ${pages.join(", ")}`);
}
