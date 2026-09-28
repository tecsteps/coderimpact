// Turns dist-artifact/index.html into the page file the Artifact tool publishes.
// The tool wraps the page in its own document skeleton, so the page is the
// title, the inline theme script, the module script and stylesheet tags and
// the body content, without <html>, <head> or <body>.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist-artifact/index.html", "utf8");
const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const inlineScript = /<script>[\s\S]*?<\/script>/.exec(head)?.[0] ?? "";
const tags = head.match(/<(script type="module"|link rel="(?:stylesheet|modulepreload)")[^>]*>(<\/script>)?/g) ?? [];
const page = `<title>CoderImpact</title>\n${inlineScript}\n${tags.join("\n")}\n${body.trim()}\n`;
writeFileSync("dist-artifact/coderimpact.html", page);
console.log("artifact page: dist-artifact/coderimpact.html");

// The Artifact publisher rejects a literal U+FFFD. Some grammars contain it in
// regex strings; the \uFFFD escape is equivalent there.
for (const dir of ["dist-artifact/assets", "dist-artifact/snapshots"]) {
  for (const name of readdirSync(dir)) {
    if (!/\.(js|json)$/.test(name)) continue;
    const file = `${dir}/${name}`;
    const text = readFileSync(file, "utf8");
    if (text.includes("\uFFFD")) {
      writeFileSync(file, text.replaceAll("\uFFFD", String.raw`\uFFFD`));
      console.log(`escaped U+FFFD in ${file}`);
    }
  }
}
