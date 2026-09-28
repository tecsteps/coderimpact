#!/usr/bin/env node
// Deployment-time model discovery for CoderImpact explanations.
//
//   node scripts/discover-models.mjs [--out public/models.json] [--max 8]
//
// 1. Fetches OpenCode's live model list (/inference/v1/models).
// 2. Cross-checks every model against models.dev (the model database OpenCode
//    itself uses) and keeps only models with an explicit price of 0 for input
//    and output that are served through the OpenAI Chat Completions API.
// 3. Smoke-tests the candidates with representative Go and PHP explanations,
//    using the exact prompt and response validation the browser uses.
// 4. Publishes a versioned models.json with ranked candidates and a TTL.
//
// If discovery or every smoke test fails, the last known good file is kept and
// the script exits with code 2. It never writes an empty or paid list. The
// newest model is not assumed to be the best: ranking is by smoke-test results.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildContext } from "../src/lib/explain/context.ts";
import { buildMessages } from "../src/lib/explain/prompt.ts";
import { parseExplanation } from "../src/lib/explain/validate.ts";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = arg("--out", "public/models.json");
const MAX_CANDIDATES = Number(arg("--max", "8"));
const LIVE_URL = "https://opencode.ai/inference/v1/models";
const METADATA_URL = "https://models.dev/api.json";
const ENDPOINT = "https://opencode.ai/inference/openai/v1/chat/completions";
const TTL_SECONDS = 6 * 3600;
const CHAT_FAMILY = new Set([undefined, "@ai-sdk/openai-compatible"]);

const GO_FILE = `package slug

// normalize lowercases s, transliterates it and trims separators.
func normalize(s string) (string, error) {
	if s == "" {
		return "", ErrEmpty
	}
	s = strings.ToLower(s)
	return strings.Trim(s, "-"), nil
}`.split("\n");

const PHP_FILE = `<?php

final class InvoiceTotals
{
    public function net(array $lines): Money
    {
        $sum = $this->zero;
        foreach ($lines as $line) {
            $sum = $sum->add(new Money($line['cents']));
        }
        return $sum;
    }
}`.split("\n");

const EXAMPLES = [
  {
    name: "go-line",
    ctx: buildContext({
      task: "line", path: "slug/normalize.go", language: "Go", lines: GO_FILE, start: 5, end: 5,
      blocks: [{ kind: "function", name: "normalize", label: "normalize", startLine: 4, endLine: 10, declLine: 4, signature: "func normalize(s string) (string, error)", decl: 0 }],
    }),
    check: (e) => /empty/i.test(e.summary),
  },
  {
    name: "php-method",
    ctx: buildContext({
      task: "declaration", path: "src/InvoiceTotals.php", language: "PHP", lines: PHP_FILE, start: 5, end: 12,
      blocks: [], block: { kind: "method", name: "net", label: "InvoiceTotals::net", startLine: 5, endLine: 12, declLine: 5, signature: "public function net(array $lines): Money", decl: 0 },
    }),
    check: (e) => /sum|total|money|line/i.test(e.summary),
  },
];

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

async function smoke(model) {
  const results = [];
  for (const ex of EXAMPLES) {
    const started = Date.now();
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: buildMessages(ex.ctx), temperature: 0.2, max_tokens: 600, stream: false }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (!res.ok) {
        results.push({ example: ex.name, ok: false, reason: `${res.status} ${text.slice(0, 160)}` });
        continue;
      }
      const content = JSON.parse(text)?.choices?.[0]?.message?.content ?? "";
      const e = parseExplanation(content, ex.ctx.task);
      const ok = !e.fallback && ex.check(e);
      results.push({ example: ex.name, ok, ms: Date.now() - started, reason: smokeFailure(ok, e) });
    } catch (err) {
      results.push({ example: ex.name, ok: false, reason: String(err).slice(0, 160) });
    }
  }
  return results;
}

/** Why an example failed the smoke test, or undefined when it passed. */
function smokeFailure(ok, explanation) {
  if (ok) return undefined;
  return explanation.fallback ? "ignored JSON contract" : "failed content check";
}

/** " (example: reason; ...)" for the failed examples, or "" when all passed. */
function failureSummary(results) {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return "";
  const reasons = failed.map((r) => r.example + ": " + r.reason).join("; ");
  return ` (${reasons})`;
}

function lastKnownGood() {
  if (!existsSync(OUT)) return null;
  try {
    const f = JSON.parse(readFileSync(OUT, "utf8"));
    return Array.isArray(f.models) && f.models.length > 0 ? f : null;
  } catch {
    return null;
  }
}

function keepLastGood(reason) {
  const prev = lastKnownGood();
  console.error(`Discovery did not produce a usable model list: ${reason}`);
  console.error(prev ? `Keeping last known good ${OUT} (version ${prev.version}).` : `No previous ${OUT} exists; nothing was written. The app will show explanations as unavailable.`);
  process.exit(2);
}

async function main() {
  let live;
  let meta;
  try {
    live = await getJson(LIVE_URL);
    meta = await getJson(METADATA_URL);
  } catch (e) {
    return keepLastGood(String(e));
  }
  const liveIds = new Set((live.data ?? []).map((m) => m.id));
  const provider = meta.opencode?.models ?? {};
  const candidates = [];
  for (const id of liveIds) {
    const m = provider[id];
    if (!m) continue; // no authoritative metadata: skip
    if (/^test/i.test(id)) continue;
    const cost = m.cost ?? {};
    const free = cost.input === 0 && cost.output === 0 && (cost.cache_read ?? 0) === 0;
    const family = m.provider?.npm;
    if (!free || !CHAT_FAMILY.has(family)) continue;
    candidates.push({ id, context: m.limit?.context, released: m.release_date });
  }
  console.log(`Live models: ${liveIds.size}. Free Chat Completions candidates: ${candidates.map((c) => c.id).join(", ") || "none"}`);
  if (candidates.length === 0) return keepLastGood("no free Chat Completions models in the live list");

  const tested = [];
  for (const c of candidates.slice(0, MAX_CANDIDATES)) {
    const results = await smoke(c.id);
    const passed = results.filter((r) => r.ok).length;
    const times = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
    console.log(`  ${c.id}: ${passed}/${results.length} passed${failureSummary(results)}`);
    tested.push({ ...c, passed, total: results.length, medianMs: times[Math.floor(times.length / 2)] });
  }
  const healthy = tested.filter((t) => t.passed > 0).sort((a, b) => b.passed - a.passed || (a.medianMs ?? 1e9) - (b.medianMs ?? 1e9));
  if (healthy.length === 0) return keepLastGood("every candidate failed the smoke test");

  // Keep models that are not OpenCode free models (for example the OpenRouter
  // model billed to the deployment), ranked after the verified free ones.
  const kept = (lastKnownGood()?.models ?? []).filter((m) => m.provider && m.provider !== "opencode");
  const now = new Date();
  const file = {
    version: now.toISOString().replace(/[-:]/g, "").slice(0, 13),
    generatedAt: now.toISOString(),
    ttlSeconds: TTL_SECONDS,
    endpoint: ENDPOINT,
    family: "chat-completions",
    source: { live: LIVE_URL, metadata: METADATA_URL },
    models: [
      ...healthy.map((t, i) => ({
        id: t.id,
        rank: i + 1,
        provider: "opencode",
        price: { input: 0, output: 0 },
        context: t.context,
        smoke: { passed: t.passed, total: t.total, medianMs: t.medianMs },
      })),
      ...kept.map((m, i) => ({ ...m, rank: healthy.length + i + 1 })),
    ],
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${OUT} with ${file.models.length} ranked models.`);
}

await main();
