# CoderImpact test plan

Automated end to end checks live in `scripts/e2e.mjs` (Playwright, real Chromium). Every case below has the same ID in the script.

```bash
npm run dev                      # http://localhost:5173
E2E_LEGAL=http://localhost:4173 npm run e2e     # 4173: `npm run build && npm run preview`, serves the legal pages
E2E_ONLY=edit npm run e2e        # one area only
E2E_AI=0 npm run e2e             # skip the cases that call the AI relay
```

Playwright is not a dependency: set `PLAYWRIGHT_MODULE` to its `index.mjs` if `import "playwright"` does not resolve.

Local folders are created in the browser's private file system (OPFS), so no real folder or dialog is needed. The script launches the installed Chrome (`E2E_CHANNEL`, default `chrome`) and falls back to Playwright's Chromium, which can crash the page when a stored folder handle is read back from IndexedDB. GitHub cases use the public repository `tecsteps/coderimpact` and need network.

## 1. Start page (desktop)

| ID | Case | Expected |
| --- | --- | --- |
| L1 | Open `/` | Title CoderImpact, headline "Lightweight IDE in your browser", subline "For humans who want to understand code" |
| L2 | Visible copy | Spelled "CoderImpact", no em-dashes, no "read-only", no "design partner" |
| L3 | Type `tecsteps/coderimpact` and press Enter | Opens the repository |
| L4 | Paste a GitHub URL | Opens the repository |
| L5 | Legal links (Imprint, Privacy, Terms) | Open in the same tab, page renders |
| L6 | No history | No "Recent projects" switcher in the header |
| L7 | With history | Switcher in the header lists recents |

## 2. Start page (phone, 390 wide)

| ID | Case | Expected |
| --- | --- | --- |
| P1 | Layout | No bottom bar, header 48px, logo larger than 20px, no horizontal scroll |
| P2 | "Recent" switcher | Present when there is history, lists projects and "Add a repository…" |

## 3. Local folder: browsing

| ID | Case | Expected |
| --- | --- | --- |
| F1 | Open a folder | Tree shows files and folders, no error |
| F2 | Folder counts | A number behind each folder, tooltip says folders, files and kinds |
| F3 | Index badge | Quiet icon (no coloured pill), tooltip explains the index |
| F4 | Open a file | Code shown, language badge with logo, breadcrumbs, URL updates |
| F5 | Open an image | Image viewer |
| F6 | Open Markdown | Rendered by default, Source toggle shows the text |
| F7 | Tree filter | Filters by file name |
| F8 | Collapse / expand all | Works |
| F9 | Line link | `#L4-L6` selects and scrolls to the lines |
| F10 | Reload file / folder | Picks up a file changed on disk |
| F11 | Folder page | "N files with semantic navigation", no language named |

## 4. Reading code

| ID | Case | Expected |
| --- | --- | --- |
| R1 | Click an identifier | Menu: definition, references, callers, explain, copy |
| R2 | Go to definition | Jumps to the declaration, URL updates, back button returns |
| R3 | References | Panel lists usages grouped by file, click jumps |
| R4 | Select text with the mouse | Toolbar with Explain, Copy, Copy link, selection clearly visible |
| R5 | Keyboard | Arrow keys move the line focus, Shift extends, Escape clears |
| R6 | Find in file (Cmd/Ctrl+F) | Highlights, Enter goes to next, Escape closes |
| R7 | Wrap (Alt+Z), text size | Toggle and change |
| R8 | Full screen | Enters and leaves with Escape |
| R9 | Code theme picker | Search and select changes the theme |
| R10 | Global search (double Shift) | Files, symbols and code results, Enter opens |
| R11 | Sidebar panels | Symbols panel lists the file's symbols, click jumps |

## 5. Editing (local folders, Chrome/Edge)

| ID | Case | Expected |
| --- | --- | --- |
| E1 | Pencil | Enabled with tooltip "Edit this file (Cmd+E)" |
| E2 | Cmd+E | Opens the editor at once, no consent or other dialog |
| E3 | Completion | `cart.` lists the members of the class |
| E4 | Unsaved state | "Unsaved changes" shown after typing |
| E5 | Cmd+S | Written to disk, "Saved to disk" |
| E6 | Cmd+E again | Back to reading, the edit is visible |
| E7 | Shift+arrows in the editor | Selection is visible |
| E8 | F2 / menu Rename | Dialog lists the places, renames across files, disk updated |
| E9 | External change | Save reports a conflict instead of overwriting |
| E10 | Read-only browser | Pencil shown but disabled, tooltip gives the reason |
| E11 | GitHub repository | No pencil, Cmd+E does nothing |

## 6. Dependencies (package.json)

| ID | Case | Expected |
| --- | --- | --- |
| D1 | Click a dependency | Menu with "Show on npm" and "Open in CoderImpact" |
| D2 | Both entries | Each has a ↗ icon and opens a new tab, the current tab stays |
| D3 | Registry without GitHub repository | Second entry disabled, "not on GitHub" |

## 7. Project switcher

| ID | Case | Expected |
| --- | --- | --- |
| S1 | Click the owner in the header | Popover with search, recents, current project checked |
| S2 | Type | Filters, Enter opens the first match |
| S3 | Arrow keys | Move the highlight |
| S4 | Type `owner/repo` with no match | "Open owner/repo" entry |
| S5 | Error screen | Header still has the switcher |
| S6 | Search field | No heavy focus ring |
| S7 | Add a repository… | Goes to the start page |

## 8. GitHub repository

| ID | Case | Expected |
| --- | --- | --- |
| G1 | Open `tecsteps/coderimpact` | Files load, README shown on the repo home |
| G2 | Ref badge | Shows `main`, not a hash |
| G3 | Commit URL of the branch tip | Badge shows just the branch, no hash |
| G4 | Old commit | Badge shows `main @ shorthash` |
| G5 | Branch switcher | Lists branches and tags, search works |
| G6 | Unknown repository | Clear error screen, no crash |
| G7 | Index progress | Becomes "indexed"; Go to definition works in a TypeScript file |

## 9. AI explanations (network, cheap model)

| ID | Case | Expected |
| --- | --- | --- |
| A1 | Explain a line without consent | Consent dialog, choosing "Not now" sends nothing |
| A2 | Agree and explain a line | One request, an explanation appears under the line |
| A3 | Marker | The explained line has a coloured line number rail |
| A4 | Fragment | Term paragraph plus one "Here:" paragraph, no duplicate "Here" |
| A5 | Close explanation | Explanation and marker go away |

## 10. Phone layout (390 wide)

| ID | Case | Expected |
| --- | --- | --- |
| M1 | Reader header | Large tree button, repository switcher, no bottom bar |
| M2 | Switcher | Recents, "Open a local folder…", "Add a repository…"; no keyboard pop-up |
| M3 | Files sheet | Branch, one search field, tree |
| M4 | Inline search | Results replace the tree, tapping one opens it |
| M5 | Symbols / Explain panels | Not offered |
| M6 | Symbol tap | Action sheet |
| M7 | No horizontal page scroll | `scrollWidth` equals viewport |

## 11. Settings and legal

| ID | Case | Expected |
| --- | --- | --- |
| X1 | Settings | AI switch toggles, recents/cache summary shown |
| X2 | Theme switcher | Light and dark apply |
| X3 | `/imprint`, `/privacy`, `/terms` | 200, content present (needs the built site) |

## 12. Health

| ID | Case | Expected |
| --- | --- | --- |
| H1 | Every area above | No uncaught page errors, no console errors |
