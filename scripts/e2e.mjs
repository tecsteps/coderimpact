// End to end checks, see docs/TESTPLAN.md. Every test ID here is a row there.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://localhost:5173";
const LEGAL = process.env.E2E_LEGAL ?? "http://localhost:4173";
const ONLY = process.env.E2E_ONLY?.split(",");
const WITH_AI = process.env.E2E_AI !== "0";
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/coderimpact-e2e";
const GH = "tecsteps/coderimpact";
mkdirSync(SHOTS, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
// Installed Chrome first: Playwright's bundled Chromium can crash the page when a stored folder handle is read back from IndexedDB.
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? "chrome" }).catch(() => chromium.launch());
const results = [];

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const FILES = {
  "src/cart.ts": 'export class Cart {\n  items: string[] = [];\n  static readonly MAX = 10;\n\n  addItem(name: string): void {\n    this.items.push(name);\n  }\n\n  total(): number {\n    return this.items.length;\n  }\n}\n',
  "src/main.ts": 'import { Cart } from "./cart";\nimport { shout } from "./util/text";\n\nconst cart: Cart = new Cart();\ncart.addItem("apple");\nconsole.log(shout(String(cart.total())));\n',
  "src/util/text.ts": "export function shout(s: string): string {\n  return s.toUpperCase() + \"!\";\n}\n",
  "src/util/math.py": "def double(x):\n    return x * 2\n",
  "package.json": '{\n  "name": "shop",\n  "dependencies": {\n    "react": "^19.0.0",\n    "@types/node": "^22.0.0",\n    "zz-no-such-package-e2e": "1.0.0"\n  }\n}\n',
  "README.md": "# Shop\n\nA tiny **shop** for tests.\n\n- one\n- two\n",
  "docs/notes.txt": "plain notes\nsecond line\n",
};

/** One browser context per suite, so recents, settings and the OPFS fixture start clean. */
async function suite(area, opts, body) {
  if (ONLY && !ONLY.includes(area)) return;
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1400, height: 900 }, hasTouch: !!opts.touch, isMobile: !!opts.touch, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource|net::ERR|favicon/.test(text) && !opts.strictConsole) return;
    problems.push(`console: ${text.slice(0, 200)}`);
  });
  page.on("dialog", (d) => {
    problems.push(`native dialog: ${d.message()}`);
    d.dismiss();
  });
  const t = async (id, name, fn) => {
    if (opts.skip) return void results.push({ id, name, status: "skip", note: opts.skip });
    const started = Date.now();
    try {
      await fn();
      results.push({ id, name, status: "pass", ms: Date.now() - started });
    } catch (e) {
      const file = `${SHOTS}/${id}.png`;
      await page.screenshot({ path: file }).catch(() => {});
      results.push({ id, name, status: "FAIL", note: String(e.message ?? e).split("\n").slice(0, 6).join(" | "), file });
    }
  };
  try {
    await body(page, t, context);
  } catch (e) {
    results.push({ id: `${area}*`, name: "suite setup", status: "FAIL", note: String(e.message ?? e).slice(0, 300) });
  }
  await t(`H1-${area}`, `no page or console errors (${area})`, async () => assert.deepEqual(problems, []));
  await context.close();
}

const has = (page, sel) => page.locator(sel).count().then((n) => n > 0);
const text = (page, sel) => page.locator(sel).first().innerText();

/** Creates the fixture folder in OPFS and returns helpers for it. */
async function makeFolder(page, name = "shop", files = FILES) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector("body");
  const info = await page.evaluate(
    async ({ name, files, PNG }) => {
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry(name, { recursive: true }); } catch {}
      const top = await root.getDirectoryHandle(name, { create: true });
      const put = async (path, data) => {
        const parts = path.split("/");
        let d = top;
        for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
        const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await w.write(data);
        await w.close();
      };
      for (const [p, c] of Object.entries(files)) await put(p, c);
      await put("docs/logo.png", Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)));
      const m = await import("/src/lib/local/projects.ts");
      const p = await m.addHandle(top);
      return { slug: p.slug, id: p.id };
    },
    { name, files, PNG },
  );
  const url = (path, kind = "blob") => `/~/${info.slug}/${kind}/${info.id}${path ? `/${path}` : ""}`.replace("//", "/");
  return {
    ...info,
    async open(path, kind = "blob") {
      const u = await page.evaluate(([slug, id, p, k]) => import("/src/lib/router.ts").then((r) => r.readerUrl("~", slug, id, p, k)), [info.slug, info.id, path, kind]);
      await page.evaluate((u) => import("/src/lib/router.ts").then((r) => r.navigate(u)), u);
    },
    async read(path) {
      return page.evaluate(async ([name, p]) => {
        let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        const parts = p.split("/");
        for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x);
        return (await (await d.getFileHandle(parts.at(-1))).getFile()).text();
      }, [name, path]);
    },
    async write(path, content) {
      await page.evaluate(async ([name, p, c]) => {
        let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        const parts = p.split("/");
        for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x);
        const w = await (await d.getFileHandle(parts.at(-1))).createWritable();
        await w.write(c);
        await w.close();
      }, [name, path, content]);
    },
    url,
  };
}

const codeReady = (page, line = 1) => page.waitForSelector(`.cl[data-line="${line}"]`, { timeout: 30000 });
const lineBox = (page, line, word) =>
  page.evaluate(([line, word]) => {
    const n = [...document.querySelectorAll(`.cl[data-line="${line}"] .cc span`)].find((e) => e.textContent === word);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { x: b.left + 4, y: b.top + b.height / 2 };
  }, [line, word]);
async function clickWord(page, line, word) {
  const b = await lineBox(page, line, word);
  assert.ok(b, `word "${word}" not found on line ${line}`);
  await page.mouse.click(b.x, b.y);
}
const repoInput = (page) => page.locator("input:not([type=file])").first();
const indexed = (page) => page.waitForSelector('[aria-label^="Semantic index"]', { timeout: 60000 });

// ---------------------------------------------------------------------------
await suite("start", {}, async (page, t) => {
  await page.goto(`${BASE}/`);
  await t("L1", "headline and subline", async () => {
    await page.waitForSelector("h1");
    assert.equal(await page.title(), "CoderImpact");
    const body = await page.locator("body").innerText();
    assert.match(body, /Lightweight IDE in your browser/i);
    assert.match(body, /For humans who want to understand code/i);
  });
  await t("L2", "copy rules", async () => {
    const body = await page.locator("body").innerText();
    assert.ok(!body.includes("—"), "em-dash on the page");
    assert.ok(!/read-only/i.test(body), "mentions read-only");
    assert.ok(!/design partner/i.test(body), "mentions design partner");
    assert.ok(!/Coderimpact/.test(body), "wrong spelling Coderimpact");
    assert.ok(/CoderImpact/.test(body), "brand missing");
  });
  await t("L6", "no history, no recents switcher", async () => {
    assert.equal(await page.getByRole("button", { name: "Open a recent project" }).count(), 0);
  });
  await t("L3", "owner/repo + Enter opens the repository", async () => {
    const input = repoInput(page);
    await input.fill(GH);
    await input.press("Enter");
    await page.waitForURL(new RegExp(`/${GH}`), { timeout: 20000 });
    await page.waitForSelector("[aria-label='Repository files'], [aria-label='Repository']", { timeout: 30000 });
  });
  await t("L7", "history shows a switcher on the start page", async () => {
    await page.goto(`${BASE}/`);
    const trigger = page.getByRole("button", { name: "Open a recent project" });
    await trigger.waitFor({ timeout: 10000 });
    await trigger.click();
    const list = page.getByRole("list", { name: "Projects" });
    await list.waitFor();
    assert.match(await list.innerText(), new RegExp(GH.replace("/", "\\/")));
    await page.keyboard.press("Escape");
  });
  await t("L4", "GitHub URL opens the repository", async () => {
    await page.goto(`${BASE}/`);
    const input = repoInput(page);
    await input.fill(`https://github.com/${GH}`);
    await input.press("Enter");
    await page.waitForURL(new RegExp(`/${GH}`), { timeout: 20000 });
  });
});

await suite("legal", {}, async (page, t) => {
  await page.goto(`${BASE}/`);
  await t("L5", "legal links open in the same tab", async () => {
    for (const name of ["Imprint", "Privacy", "Terms"]) {
      await page.goto(`${BASE}/`);
      const link = page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name });
      assert.equal(await link.getAttribute("target"), null, `${name} opens a new tab`);
    }
  });
  await t("X3", "legal pages exist on the built site", async () => {
    for (const p of ["imprint", "privacy", "terms"]) {
      const r = await page.goto(`${LEGAL}/${p}`);
      assert.equal(r?.status(), 200, `${p} status`);
      assert.ok((await page.locator("body").innerText()).length > 400, `${p} has content`);
    }
  });
});

await suite("phone-start", { viewport: { width: 390, height: 800 }, touch: true }, async (page, t) => {
  await page.goto(`${BASE}/`);
  await page.waitForSelector("h1");
  await t("P1", "no bottom bar, taller header, larger logo, no horizontal scroll", async () => {
    assert.equal(await page.locator("nav[aria-label='Start'], [aria-label='Primary']").count(), 0);
    const header = await page.locator("header").first().boundingBox();
    assert.ok(header && Math.round(header.height) >= 48, `header height ${header?.height}`);
    const logo = await page.locator("header svg, header img").first().boundingBox();
    assert.ok(logo && logo.width > 20, `logo ${logo?.width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  });
  await t("P2", "Recent switcher after a visit", async () => {
    await page.goto(`${BASE}/${GH}`);
    await page.waitForFunction(() => !!localStorage.getItem("ci.recents"), null, { timeout: 30000 });
    await page.goto(`${BASE}/`);
    const trigger = page.getByRole("button", { name: /Open a recent project/ });
    await trigger.first().waitFor({ timeout: 10000 });
    await trigger.first().click();
    const list = page.getByRole("list", { name: "Projects" });
    await list.waitFor();
    const t = await list.innerText();
    assert.match(t, /Add a repository/);
    assert.match(t, /Open a local folder/);
  });
});

// suites are appended below

// ---------------------------------------------------------------------------
await suite("local", {}, async (page, t) => {
  const f = await makeFolder(page);
  await f.open("src/main.ts");
  await codeReady(page, 1);
  await t("F1", "opening a folder shows the tree", async () => {
    await page.waitForSelector("[role=treeitem]");
    const items = await page.locator("[role=treeitem]").allInnerTexts();
    for (const n of ["src", "docs", "package.json", "README.md"]) assert.ok(items.some((i) => i.startsWith(n)), `tree lacks ${n}: ${items}`);
  });
  await t("F2", "folder counts and tooltip", async () => {
    const src = page.locator("[role=treeitem]", { hasText: /^src/ }).first();
    assert.match(await src.innerText(), /src\s*\n?\s*\d+/, "no number behind the folder");
    await src.locator("span.font-mono").hover();
    const tip = page.locator("[role=tooltip]").first();
    await tip.waitFor({ timeout: 5000 });
    assert.match(await tip.innerText(), /folder|file/i);
  });
  await t("F3", "index badge is a quiet icon with a tooltip", async () => {
    const badge = page.getByRole("button", { name: /Semantic index/ });
    await badge.waitFor({ timeout: 30000 });
    await page.waitForFunction(() => /indexed/.test(document.querySelector('[aria-label^="Semantic index"]')?.getAttribute("aria-label") ?? ""), null, { timeout: 30000 });
    assert.equal(await page.getByText(/^\d+ files? indexed$/).count(), 0, "a visible pill with text");
    await page.mouse.move(700, 500);
    await page.waitForTimeout(700);
    const box = await badge.boundingBox();
    await page.mouse.move(box.x + 3, box.y + 3);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    const tip = page.locator("[role=tooltip]", { hasText: /indexed/i }).first();
    await tip.waitFor({ timeout: 8000 });
  });
  await t("F4", "file view: badge, breadcrumbs, URL", async () => {
    assert.match(await text(page, "[aria-label='File path']"), /shop.*src.*main\.ts/s);
    assert.ok(await page.getByText("TypeScript", { exact: true }).first().isVisible());
    assert.ok(await has(page, "span[title^='TypeScript'] svg path"), "language logo");
    await page.locator("[role=treeitem]", { hasText: "cart.ts" }).click();
    await page.waitForURL(/src\/cart\.ts/);
    await codeReady(page, 5);
    assert.match(await text(page, ".cl[data-line='1']"), /export class Cart/);
  });
  await t("F5", "image viewer", async () => {
    await f.open("docs/logo.png");
    await page.waitForSelector("main img, img[src^='blob:']", { timeout: 15000 });
  });
  await t("F6", "markdown: rendered by default, source toggle", async () => {
    await f.open("README.md");
    await page.waitForSelector("h1", { timeout: 15000 });
    assert.ok(await page.getByRole("heading", { name: "Shop" }).isVisible());
    await page.getByRole("button", { name: "Source" }).click();
    await codeReady(page, 1);
    await page.waitForFunction(() => /# Shop/.test(document.querySelector(".cl[data-line='1']")?.textContent ?? ""), null, { timeout: 5000 });
    await page.getByRole("button", { name: "Rendered preview" }).click();
    await page.getByRole("heading", { name: "Shop" }).waitFor();
  });
  await t("F7", "tree filter", async () => {
    await f.open("src/main.ts");
    await codeReady(page, 1);
    const filter = page.getByRole("textbox", { name: "Filter files by name" });
    await filter.fill("math");
    await page.waitForTimeout(500);
    const side = await text(page, "aside[aria-label='Repository']");
    assert.ok(side.includes("math.py"), `filter result ${side}`);
    assert.ok(!side.includes("README"), "README still listed");
    await filter.fill("");
    await page.waitForSelector("[role=treeitem]");
  });
  await t("F8", "collapse and expand all", async () => {
    await page.getByRole("button", { name: "Collapse all folders" }).click();
    await page.waitForTimeout(200);
    const names = async () => (await page.locator("[role=treeitem]").allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
    const collapsed = await names();
    await page.getByRole("button", { name: "Expand all folders" }).click();
    await page.waitForTimeout(500);
    const expanded = await names();
    assert.ok(expanded.length > collapsed.length, `expand did not show more: ${collapsed} => ${expanded}`);
  });
  await t("F9", "line link selects the lines", async () => {
    await page.evaluate(() => import("/src/lib/router.ts").then((r) => r.navigate(location.pathname.replace(/[^/]*$/, "cart.ts") + "#L5-L7")));
    await codeReady(page, 5);
    await page.waitForTimeout(700);
    const marked = await page.evaluate(() => [...document.querySelectorAll(".cl")].filter((e) => e.classList.contains("is-focused") || e.classList.contains("in-range")).map((e) => e.getAttribute("data-line")));
    assert.ok(marked.includes("5") && marked.includes("7"), `highlighted lines: ${marked}`);
  });
  await t("F11", "folder page counts files with semantic navigation, any language", async () => {
    await f.open("src", "tree");
    await page.waitForFunction(() => /with semantic navigation/.test(document.body.innerText), null, { timeout: 10000 });
    assert.ok(!/Go or PHP/.test(await page.locator("body").innerText()));
  });
  await t("F10", "file reload picks up a change on disk", async () => {
    await f.open("docs/notes.txt");
    await codeReady(page, 1);
    await f.write("docs/notes.txt", "changed on disk\n");
    await page.getByRole("button", { name: "Reload file from disk" }).click();
    await page.waitForFunction(() => document.querySelector(".cl[data-line='1']")?.textContent?.includes("changed on disk"), null, { timeout: 10000 });
  });
});

await suite("read", {}, async (page, t) => {
  const f = await makeFolder(page);
  await f.open("src/main.ts");
  await codeReady(page, 6);
  await page.waitForFunction(() => /indexed/.test(document.querySelector('[aria-label^="Semantic index"]')?.getAttribute("aria-label") ?? ""), null, { timeout: 30000 });
  await t("R1", "identifier click opens the action menu", async () => {
    await clickWord(page, 5, "addItem");
    const menu = page.getByRole("menu");
    await menu.waitFor();
    const txt = await menu.innerText();
    for (const w of [/Go to definition/, /Find usages/, /Show callers/, /Explain line 5/, /Copy name/, /Rename/]) assert.match(txt, w);
    await page.keyboard.press("Escape");
  });
  await t("R2", "go to definition and back", async () => {
    await clickWord(page, 5, "addItem");
    await page.getByRole("menuitem", { name: /Go to definition/ }).click();
    await page.waitForURL(/cart\.ts/);
    await codeReady(page, 5);
    await page.goBack();
    await page.waitForURL(/main\.ts/);
    await codeReady(page, 5);
  });
  await t("R3", "find usages lists references, click jumps", async () => {
    await clickWord(page, 5, "addItem");
    await page.getByRole("menuitem", { name: /Find usages/ }).click();
    const panel = page.getByRole("complementary", { name: "References" }).or(page.locator("[aria-label='References']")).first();
    await panel.waitFor({ timeout: 10000 });
    assert.match(await panel.innerText(), /main\.ts/);
    await page.getByRole("button", { name: "Close references" }).click();
  });
  await t("R4", "mouse selection shows the toolbar, selection is visible", async () => {
    const a = await lineBox(page, 4, "cart");
    const b = await lineBox(page, 4, "Cart");
    await page.mouse.move(a.x - 3, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y, { steps: 6 });
    await page.mouse.up();
    const bar = page.getByRole("toolbar", { name: "Selection actions" });
    await bar.waitFor({ timeout: 5000 });
    const txt = await bar.innerText();
    for (const w of [/Explain selection/, /Copy/, /Copy link/]) assert.match(txt, w);
    await bar.getByRole("button", { name: /^Copy$/ }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(clip.length > 3, "clipboard empty");
    await page.keyboard.press("Escape");
  });
  await t("R5", "keyboard line focus", async () => {
    await page.locator(".code-scroller").click({ position: { x: 600, y: 500 } });
    for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    const focused = await page.evaluate(() => [...document.querySelectorAll(".cl")].filter((e) => e.classList.contains("is-focused") || e.classList.contains("in-range")).map((e) => e.getAttribute("data-line")));
    assert.ok(focused.length >= 2, `focus lines ${focused}`);
    await page.keyboard.press("Escape");
  });
  await t("R6", "find in file", async () => {
    await page.locator(".code-scroller").click({ position: { x: 600, y: 500 } });
    await page.keyboard.press("ControlOrMeta+f");
    const box = page.getByRole("textbox", { name: "Find in this file" });
    await box.waitFor();
    await box.fill("cart");
    await page.waitForTimeout(300);
    assert.match(await text(page, "[role=search]"), /\d+\s*(\/|of)\s*\d+|\d+ match/i);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Close find" }).click();
    assert.equal(await page.getByRole("search", { name: "Find in file" }).count(), 0);
  });
  await t("R7", "wrap and text size", async () => {
    const size = () => text(page, "[aria-label='Code text size']");
    const before = await size();
    await page.getByRole("button", { name: "Larger code text" }).click();
    assert.notEqual(await size(), before);
    await page.getByRole("button", { name: "Smaller code text" }).click();
    assert.equal(await size(), before);
    const wrap = page.getByRole("button", { name: /Wrap long lines/ });
    const l0 = await wrap.getAttribute("aria-label");
    await page.locator(".code-scroller").click({ position: { x: 600, y: 500 } });
    await page.keyboard.press("Alt+z");
    assert.notEqual(await wrap.getAttribute("aria-label"), l0);
    await wrap.click();
    assert.equal(await wrap.getAttribute("aria-label"), l0);
  });
  await t("R8", "full screen and Escape", async () => {
    // Headless Chromium keeps real fullscreen on Escape; without the API the app leaves focus mode itself.
    await page.evaluate(() => { document.documentElement.requestFullscreen = undefined; });
    await page.getByRole("button", { name: "Full screen code" }).click();
    await page.getByRole("button", { name: /Exit full screen/ }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Full screen code" }).waitFor();
  });
  await t("R9", "code theme picker", async () => {
    const trigger = page.getByRole("button", { name: /Code theme:/ });
    const before = await trigger.getAttribute("aria-label");
    await trigger.click();
    await page.getByLabel("Search code themes").fill("nord");
    await page.waitForTimeout(200);
    await page.getByRole("list", { name: "Code theme" }).getByRole("button").first().click();
    await page.waitForFunction((b) => document.querySelector("[aria-label^='Code theme:']")?.getAttribute("aria-label") !== b, before);
  });
  await t("R10", "global search with double Shift", async () => {
    await page.locator(".code-scroller").click({ position: { x: 600, y: 500 } });
    await page.keyboard.press("Shift");
    await page.keyboard.press("Shift");
    const box = page.getByRole("combobox", { name: /Search files, symbols and code/ }).or(page.getByRole("textbox", { name: /Search files, symbols and code/ }));
    await box.first().waitFor({ timeout: 5000 });
    await box.first().fill("shout");
    await page.waitForTimeout(800);
    const res = page.getByRole("listbox", { name: "Search results" }).or(page.locator("[aria-label='Search results']"));
    assert.match(await res.first().innerText(), /shout/);
    await page.keyboard.press("Enter");
    await page.waitForURL(/text\.ts/, { timeout: 10000 });
  });
  await t("R11", "symbols panel lists symbols, click jumps", async () => {
    await f.open("src/cart.ts");
    await codeReady(page, 5);
    await page.getByRole("tab", { name: "Symbols" }).click();
    const list = page.getByRole("list", { name: "Symbols in this file" });
    await list.waitFor();
    const txt = await list.innerText();
    assert.match(txt, /Cart/);
    assert.match(txt, /addItem/);
    await list.getByText("total", { exact: false }).first().click();
    await page.waitForFunction(() => location.hash.includes("L9"), null, { timeout: 5000 });
  });
});

await suite("edit", {}, async (page, t) => {
  const f = await makeFolder(page);
  await f.open("src/main.ts");
  await codeReady(page, 6);
  await page.waitForFunction(() => /indexed/.test(document.querySelector('[aria-label^="Semantic index"]')?.getAttribute("aria-label") ?? ""), null, { timeout: 30000 });
  await t("E1", "pencil is enabled with the shortcut in its tooltip", async () => {
    const pen = page.getByRole("button", { name: /Edit this file/ });
    assert.match(await pen.getAttribute("aria-label"), /Edit this file \((⌘|Ctrl\+)E\)/);
    assert.equal(await pen.isDisabled(), false);
    await page.mouse.move(700, 500);
    await pen.hover();
    await page.locator("[role=tooltip]", { hasText: /Edit this file/ }).first().waitFor({ timeout: 5000 });
  });
  await t("E2", "Cmd+E opens the editor at once, no dialog", async () => {
    await page.locator(".code-scroller").click({ position: { x: 600, y: 500 } });
    await page.keyboard.press("ControlOrMeta+e");
    await page.waitForSelector(".cm-content", { timeout: 15000 });
    assert.equal(await page.getByRole("dialog").count(), 0, "a dialog opened");
    assert.equal(await page.locator("[role=alertdialog]").count(), 0);
  });
  await t("E3", "member completion after `cart.`", async () => {
    await page.locator(".cm-line").nth(4).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("cart.", { delay: 40 });
    await page.waitForSelector(".cm-tooltip-autocomplete li", { timeout: 5000 });
    const items = await page.locator(".cm-tooltip-autocomplete li").allInnerTexts();
    // Methods only: class fields that are not functions are not indexed (yet).
    for (const m of ["addItem", "total"]) assert.ok(items.some((i) => i.includes(m)), `completion lacks ${m}: ${items}`);
  });
  await t("E4", "unsaved state after typing", async () => {
    await page.keyboard.type("to");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.keyboard.type("();");
    await page.getByText("Unsaved changes").waitFor({ timeout: 3000 });
  });
  await t("E5", "Cmd+S writes to disk", async () => {
    await page.keyboard.press("ControlOrMeta+s");
    await page.getByText("Saved to disk").waitFor({ timeout: 5000 });
    assert.match(await f.read("src/main.ts"), /cart\.total\(\);/);
  });
  await t("E7", "Shift+arrows show a visible selection", async () => {
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    const sel = await page.evaluate(() => {
      const el = document.querySelector(".cm-selectionBackground");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const bg = getComputedStyle(el).backgroundColor;
      const alpha = bg.startsWith("rgba") ? Number(bg.split(",")[3].replace(")", "")) : 1;
      return { w: r.width, alpha, bg };
    });
    assert.ok(sel && sel.w > 4 && sel.alpha > 0.15, `selection not visible: ${JSON.stringify(sel)}`);
    await page.keyboard.press("ArrowRight");
  });
  await t("E6", "Cmd+E returns to reading with the edit visible", async () => {
    await page.keyboard.press("ControlOrMeta+e");
    await page.waitForFunction(() => !document.querySelector(".cm-content"), null, { timeout: 8000 });
    await codeReady(page, 6);
    const lines = await page.locator(".cl").allInnerTexts();
    assert.ok(lines.some((l) => l.includes("cart.total();")), `edit not shown: ${lines}`);
    assert.equal(await page.getByRole("dialog").count(), 0);
  });
  await t("E8", "rename across files from the menu", async () => {
    await f.open("src/main.ts");
    await page.waitForFunction(() => [...document.querySelectorAll('.cl[data-line="5"] .cc span')].some((e) => e.textContent === "addItem"), null, { timeout: 15000 });
    await clickWord(page, 5, "addItem");
    await page.getByRole("menuitem", { name: /Rename/ }).click();
    const input = page.getByLabel("New name");
    await input.fill("add");
    await page.getByRole("button", { name: /Rename \d+ place/ }).click();
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"), null, { timeout: 8000 });
    assert.match(await f.read("src/cart.ts"), /add\(name: string\)/);
    assert.match(await f.read("src/main.ts"), /cart\.add\("apple"\)/);
    assert.ok(!(await f.read("src/main.ts")).includes("addItem"));
  });
  await t("E9", "a change on disk is reported as a conflict, not overwritten", async () => {
    await f.open("docs/notes.txt");
    await codeReady(page, 1);
    await page.locator(".code-scroller").click({ position: { x: 600, y: 500 } });
    await page.keyboard.press("ControlOrMeta+e");
    await page.waitForSelector(".cm-content");
    await page.locator(".cm-content").click();
    await page.keyboard.type("mine ");
    await f.write("docs/notes.txt", "theirs\n");
    await page.keyboard.press("ControlOrMeta+s");
    await page.getByRole("alert").getByText(/changed on disk/).waitFor({ timeout: 5000 });
    assert.equal(await f.read("docs/notes.txt"), "theirs\n");
    await page.getByRole("button", { name: "Discard mine, load theirs" }).click();
    await page.waitForFunction(() => !document.querySelector(".cm-content"), null, { timeout: 8000 });
  });
});

await suite("edit-blocked", {}, async (page, t) => {
  const f = await makeFolder(page);
  await page.addInitScript(() => {
    // Safari and Firefox: no writable file handles.
    if (typeof FileSystemFileHandle !== "undefined") delete FileSystemFileHandle.prototype.createWritable;
  });
  const u = await page.evaluate(([s, i]) => import("/src/lib/router.ts").then((r) => r.readerUrl("~", s, i, "src/main.ts", "blob")), [f.slug, f.id]);
  await page.goto(`${BASE}${u}`);
  await codeReady(page, 1);
  await t("E10", "pencil is shown but disabled with a reason", async () => {
    const pen = page.getByRole("button", { name: /Editing works in Chrome and Edge/ });
    await pen.waitFor({ timeout: 10000 });
    assert.equal(await pen.isDisabled(), true);
    await page.locator(".code-scroller").click({ position: { x: 600, y: 500 } });
    await page.keyboard.press("ControlOrMeta+e");
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".cm-content").count(), 0, "editor opened although blocked");
  });
});

await suite("deps", {}, async (page, t, context) => {
  const f = await makeFolder(page);
  await f.open("package.json");
  await codeReady(page, 4);
  const find = (line, needle) =>
    page.evaluate(([line, needle]) => {
      const n = [...document.querySelectorAll(`.cl[data-line="${line}"] .cc span`)].find((e) => e.textContent.includes(needle));
      if (!n) return null;
      const b = n.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, [line, needle]);
  await t("D1", "click a dependency: menu with two entries", async () => {
    const at = await find(4, "react");
    assert.ok(at, "react not found");
    await page.mouse.click(at.x, at.y);
    const menu = page.getByRole("menu", { name: /Actions for react/ });
    await menu.waitFor({ timeout: 5000 });
    const txt = await menu.innerText();
    assert.match(txt, /Show on npm/);
    assert.match(txt, /Open in CoderImpact/);
  });
  await t("D2", "both entries open a new tab and show an arrow", async () => {
    const menu = page.getByRole("menu", { name: /Actions for react/ });
    const items = menu.getByRole("menuitem");
    assert.equal(await items.count(), 2);
    await menu.getByText(/^[\w.-]+\/react$/).waitFor({ timeout: 15000 });
    for (let i = 0; i < 2; i++) {
      assert.equal(await items.nth(i).getAttribute("target"), "_blank", `entry ${i} target`);
      assert.equal(await items.nth(i).locator("[aria-label='opens in a new tab']").count(), 1, `entry ${i} arrow`);
    }
    const before = page.url();
    const [popup] = await Promise.all([context.waitForEvent("page"), items.nth(1).click()]);
    await popup.waitForLoadState("domcontentloaded");
    assert.match(new URL(popup.url()).pathname, /^\/[\w.-]+\/react/);
    assert.equal(page.url(), before, "the current tab navigated");
    await popup.close();
  });
  await t("D3", "registry without a GitHub repository: entry disabled", async () => {
    await page.keyboard.press("Escape");
    const at = await find(6, "zz-no-such");
    assert.ok(at, "package not found");
    await page.mouse.click(at.x, at.y);
    const menu = page.getByRole("menu", { name: /Actions for zz-no-such/ });
    await menu.waitFor();
    await menu.getByText("not on GitHub").waitFor({ timeout: 15000 });
    assert.equal(await menu.getByRole("menuitem", { name: /Open in CoderImpact/ }).getAttribute("aria-disabled"), "true");
    await page.keyboard.press("Escape");
  });
});

await suite("switcher", {}, async (page, t) => {
  const f = await makeFolder(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "ci.recents",
      JSON.stringify([
        { owner: "spf13", repo: "cobra", sha: "a".repeat(40), openedAt: Date.now() - 3600_000 },
        { owner: "slimphp", repo: "Slim", sha: "b".repeat(40), openedAt: Date.now() - 7200_000 },
      ]),
    ),
  );
  await f.open("src/main.ts");
  await codeReady(page, 1);
  const trigger = () => page.getByRole("button", { name: /Switch project/ });
  await t("S1", "popover: search, recents, current project checked", async () => {
    await trigger().click();
    const search = page.getByLabel("Find a project");
    await search.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Find a project", "search not focused");
    const list = page.getByRole("list", { name: "Projects" });
    const txt = await list.innerText();
    for (const w of [/shop/, /spf13\/cobra/, /slimphp\/Slim/, /Open a local folder/, /Add a repository/]) assert.match(txt, w);
    assert.equal(await list.locator("[aria-current=true]").count(), 1, "current project not marked");
  });
  await t("S6", "search field has no heavy focus ring", async () => {
    const shadow = await page.getByLabel("Find a project").evaluate((e) => {
      const c = getComputedStyle(e);
      return { outline: c.outlineStyle, ring: c.boxShadow };
    });
    assert.ok(shadow.outline === "none" && (shadow.ring === "none" || /rgba\(0, 0, 0, 0\)/.test(shadow.ring)), JSON.stringify(shadow));
  });
  await t("S3", "arrow keys move the highlight", async () => {
    const active = () => page.evaluate(() => [...document.querySelectorAll("#project-switcher-list button")].findIndex((b) => b.classList.contains("bg-surface-2")));
    const a = await active();
    await page.keyboard.press("ArrowDown");
    assert.notEqual(await active(), a);
  });
  await t("S2", "typing filters, Enter opens the match", async () => {
    await page.getByLabel("Find a project").fill("cobra");
    const items = await page.locator("#project-switcher-list button").allInnerTexts();
    assert.match(items[0], /spf13\/cobra/);
    assert.ok(!items.some((i) => /Slim/.test(i)));
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/spf13\/cobra/, { timeout: 10000 });
  });
  await t("S4", "typed owner/repo with no match offers to open it", async () => {
    await f.open("src/main.ts");
    await codeReady(page, 1);
    await trigger().click();
    await page.getByLabel("Find a project").fill("octocat/hello-world");
    await page.getByRole("button", { name: "Open octocat/hello-world" }).waitFor();
    await page.keyboard.press("Escape");
  });
  await t("S7", "Add a repository goes to the start page", async () => {
    await trigger().click();
    await page.getByRole("button", { name: /Add a repository/ }).click();
    await page.waitForURL(`${BASE}/`);
  });
});

await suite("github", {}, async (page, t) => {
  const OLD = "5e20865e480603a130483b44b6d587848b0a515f";
  const badge = () => page.locator("button[aria-label^='Branch or tag']").first();
  await t("G1", "repo home shows files and the README", async () => {
    await page.goto(`${BASE}/${GH}`);
    await page.waitForSelector("[role=treeitem]", { timeout: 40000 });
    await page.waitForFunction(() => /CoderImpact/.test(document.body.innerText) && document.querySelector("h1, h2"), null, { timeout: 30000 });
    assert.match(page.url(), new RegExp(`/${GH}/tree/[0-9a-f]{40}`));
  });
  await t("G2", "ref badge shows the branch, not a hash", async () => {
    await badge().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => /Branch or tag: main\./.test(document.querySelector("button[aria-label^='Branch or tag']")?.getAttribute("aria-label") ?? ""), null, { timeout: 20000 });
    assert.equal((await badge().innerText()).trim(), "main");
  });
  await t("G3", "the branch tip commit URL still says just the branch", async () => {
    const tip = page.url().match(/tree\/([0-9a-f]{40})/)[1];
    await page.goto(`${BASE}/${GH}/tree/${tip}`);
    await page.waitForFunction(() => /Branch or tag: main\./.test(document.querySelector("button[aria-label^='Branch or tag']")?.getAttribute("aria-label") ?? ""), null, { timeout: 30000 });
    assert.ok(!/@/.test(await badge().innerText()));
  });
  await t("G4", "an older commit shows the short hash", async () => {
    await page.goto(`${BASE}/${GH}/tree/${OLD}`);
    await page.waitForFunction(() => /5e20865/.test(document.querySelector("button[aria-label^='Branch or tag']")?.textContent ?? ""), null, { timeout: 30000 });
  });
  await t("G5", "branch switcher lists refs and filters", async () => {
    await badge().click();
    const search = page.getByLabel("Find a branch or tag");
    await search.waitFor();
    await page.getByRole("option", { name: /main/ }).first().waitFor({ timeout: 15000 }).catch(() => page.getByText("main", { exact: true }).first().waitFor({ timeout: 15000 }));
    await search.fill("zz-no-such-branch");
    await page.waitForTimeout(400);
    assert.equal(await page.getByText("main", { exact: true }).count(), 0, "filter did not remove main");
    await search.fill("main");
    await page.getByText("main", { exact: true }).first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
  });
  await t("G7", "index becomes ready and definitions work in TypeScript", async () => {
    await page.goto(`${BASE}/${GH}/blob/${OLD}/src/lib/deps.ts`);
    await codeReady(page, 140);
    await indexed(page);
    await page.locator('.cl[data-line="140"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await clickWord(page, 140, "isValidPackageName");
    await page.getByRole("menuitem", { name: /Go to definition/ }).click();
    await page.waitForFunction(() => /#L131/.test(location.hash) || document.querySelector(".cl.is-focused[data-line='131']"), null, { timeout: 15000 });
  });
  await t("E11", "no pencil on a GitHub file, Cmd+E does nothing", async () => {
    assert.equal(await page.getByRole("button", { name: /Edit this file/ }).count(), 0);
    await page.locator(".code-scroller").click({ position: { x: 600, y: 300 } });
    await page.keyboard.press("ControlOrMeta+e");
    await page.waitForTimeout(400);
    assert.equal(await page.locator(".cm-content").count(), 0);
  });
  await t("G6", "unknown repository shows an error screen", async () => {
    await page.goto(`${BASE}/tecsteps/zz-no-such-repo-e2e-404`);
    await page.getByRole("button", { name: /Switch project|Open a recent project/ }).first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => /not found|couldn.t|doesn.t exist|private/i.test(document.body.innerText), null, { timeout: 30000 });
  });
  await t("S5", "error screen keeps the project switcher", async () => {
    await page.getByRole("button", { name: /Switch project|Open a recent project/ }).first().click();
    await page.getByLabel("Find a project").waitFor();
    await page.keyboard.press("Escape");
  });
});

await suite("ai", { skip: WITH_AI ? undefined : "E2E_AI=0" }, async (page, t) => {
  const f = await makeFolder(page);
  let calls = 0;
  page.on("request", (r) => {
    if (/\/api\/explain/.test(r.url()) && r.method() === "POST") calls++;
  });
  await f.open("src/cart.ts");
  await codeReady(page, 5);
  await page.waitForFunction(() => /indexed/.test(document.querySelector('[aria-label^="Semantic index"]')?.getAttribute("aria-label") ?? ""), null, { timeout: 30000 });
  const notes = () => page.locator("[role=note]");
  await t("A1", "consent dialog first, Not now sends nothing", async () => {
    await clickWord(page, 5, "addItem");
    await page.getByRole("menuitem", { name: /Explain line 5/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Send code for AI explanations?").waitFor();
    await dialog.getByRole("button", { name: "Not now" }).click();
    await page.waitForTimeout(800);
    assert.equal(calls, 0, "request sent without consent");
    assert.equal(await notes().count(), 0);
  });
  await t("A2", "allow and explain: one request, an explanation appears", async () => {
    await clickWord(page, 5, "addItem");
    await page.getByRole("menuitem", { name: /Explain line 5/ }).click();
    await page.getByRole("button", { name: "Allow and explain" }).click();
    await notes().first().waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const n = document.querySelector("[role=note]");
      return n && !n.querySelector(".skeleton") && (n.textContent ?? "").length > 40;
    }, null, { timeout: 90000 });
    assert.equal(calls, 1, `expected one request, saw ${calls}`);
    assert.equal(await notes().count(), 1);
  });
  await t("A3", "explained line is marked", async () => {
    assert.ok((await page.locator(".cl.is-explained").count()) > 0);
  });
  await t("A5", "closing removes explanation and marker", async () => {
    await page.getByLabel("Close explanation").first().click();
    await page.waitForFunction(() => !document.querySelector("[role=note]"), null, { timeout: 5000 });
    assert.equal(await page.locator(".cl.is-explained").count(), 0);
  });
  await t("A4", "selected fragment: term paragraph plus one Here", async () => {
    const b = await lineBox(page, 6, "push");
    assert.ok(b, "push not found");
    await page.mouse.dblclick(b.x + 6, b.y);
    await page.getByRole("button", { name: /Explain selection/ }).click();
    await notes().first().waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const n = document.querySelector("[role=note]");
      return n && !n.querySelector(".skeleton") && (n.textContent ?? "").length > 40;
    }, null, { timeout: 90000 });
    const txt = await notes().first().innerText();
    assert.equal((txt.match(/Here/g) ?? []).length, 1, JSON.stringify(txt));
    assert.ok(!/(`?\bpush\b`?)\s+\1\s/.test(txt.replace(/\n/g, " ")), `fragment repeated: ${JSON.stringify(txt)}`);
  });
});

await suite("phone-reader", { viewport: { width: 390, height: 800 }, touch: true }, async (page, t) => {
  const f = await makeFolder(page);
  await f.open("src/main.ts");
  await codeReady(page, 5);
  await page.waitForFunction(() => /indexed/.test(document.querySelector('[aria-label^="Semantic index"]')?.getAttribute("aria-label") ?? "") || /indexed/.test(document.body.innerText), null, { timeout: 30000 });
  await t("M1", "header: tree button, repository switcher, no bottom bar", async () => {
    const tree = page.getByRole("button", { name: /^Files of/ });
    const box = await tree.boundingBox();
    assert.ok(box && box.width >= 40 && box.height >= 40, `tree button ${box?.width}x${box?.height}`);
    await page.getByRole("button", { name: /Switch project/ }).waitFor();
    assert.equal(await page.locator("nav[aria-label='Reader actions']").count(), 0);
  });
  await t("M2", "switcher lists projects and actions, no keyboard pop-up", async () => {
    await page.getByRole("button", { name: /Switch project/ }).tap();
    const list = page.getByRole("list", { name: "Projects" });
    await list.waitFor();
    const txt = await list.innerText();
    assert.match(txt, /shop/);
    assert.match(txt, /Open a local folder/);
    assert.match(txt, /Add a repository/);
    assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Find a project", "search field took focus");
    await page.keyboard.press("Escape");
  });
  await t("M3", "files sheet: one search field and the tree", async () => {
    await page.getByRole("button", { name: /^Files of/ }).tap();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor();
    await sheet.getByRole("treeitem", { name: /cart\.ts/ }).waitFor();
    const visible = await sheet.locator("input:not([type=file])").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
    assert.equal(visible, 1, `${visible} search fields`);
  });
  await t("M4", "inline search replaces the tree, tapping a result opens it", async () => {
    const sheet = page.getByRole("dialog");
    await sheet.locator("input:not([type=file])").first().fill("addItem");
    await page.waitForTimeout(800);
    assert.equal(await sheet.getByRole("treeitem").count(), 0, "tree still shown");
    await sheet.getByText(/cart\.ts/).first().tap();
    await page.waitForURL(/cart\.ts/, { timeout: 10000 });
    await codeReady(page, 5);
    assert.equal(await page.getByRole("dialog").count(), 0, "sheet stayed open");
  });
  await t("M5", "no Symbols or Explain panels", async () => {
    await page.getByRole("button", { name: /^Files of/ }).tap();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor();
    assert.equal(await page.getByRole("tab", { name: /Symbols|Explain/ }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /^(Symbols|Explain|Outline)$/ }).count(), 0);
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" }).catch(() => {});
  });
  await t("M6", "tapping a symbol opens an action sheet", async () => {
    await f.open("src/main.ts");
    await codeReady(page, 5);
    await page.waitForTimeout(1500);
    const b = await lineBox(page, 5, "addItem");
    assert.ok(b, "addItem not found");
    await page.touchscreen.tap(b.x + 6, b.y);
    await page.getByText(/Go to definition/).first().waitFor({ timeout: 8000 });
    await page.keyboard.press("Escape");
  });
  await t("M7", "no horizontal page scroll", async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  });
});

await suite("settings", {}, async (page, t) => {
  const f = await makeFolder(page);
  await f.open("src/main.ts");
  await codeReady(page, 1);
  await t("X1", "settings: AI switch toggles and persists, cache summary shown", async () => {
    await page.getByRole("button", { name: "Settings" }).click();
    const sw = page.getByRole("switch", { name: "Use AI explanations" });
    await sw.waitFor();
    assert.equal(await sw.getAttribute("aria-checked"), "false");
    await sw.click();
    assert.equal(await sw.getAttribute("aria-checked"), "true");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("ci.settings") ?? "{}").aiConsent), true);
    await sw.click();
    assert.equal(await sw.getAttribute("aria-checked"), "false");
    assert.match(await page.getByRole("dialog").or(page.locator("[data-radix-popper-content-wrapper]")).first().innerText(), /stored in this browser only/);
    await page.keyboard.press("Escape");
  });
  await t("X2", "theme switcher: light and dark apply", async () => {
    const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
    const btn = () => page.getByRole("button", { name: /^Appearance:/ });
    while (!/Switch to Light/.test((await btn().getAttribute("aria-label")) ?? "")) await btn().click();
    await btn().click();
    assert.equal(await dark(), false, "Light did not apply");
    await btn().click();
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await btn().click();
    assert.match((await btn().getAttribute("aria-label")) ?? "", /System/);
  });
});

// ---------------------------------------------------------------------------
await browser.close();
const width = Math.max(...results.map((r) => r.id.length));
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.id.padEnd(width)}  ${r.name}${r.note ? `\n     ${r.note}` : ""}${r.file ? `\n     screenshot: ${r.file}` : ""}`);
const failed = results.filter((r) => r.status === "FAIL");
console.log(`\n${results.filter((r) => r.status === "pass").length} passed, ${failed.length} failed, ${results.filter((r) => r.status === "skip").length} skipped`);
process.exit(failed.length ? 1 : 0);
