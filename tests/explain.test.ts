import { describe, expect, it } from "vitest";
import { buildContext, MAX_CONTEXT_BYTES, statementRange } from "../src/lib/explain/context";
import { redactSecrets } from "../src/lib/explain/secrets";
import { audience, buildMessages, renderTemplate } from "../src/lib/explain/prompt";
import { codeSegments, parseExplanation } from "../src/lib/explain/validate";
import { freeModels, OpenCodeProvider, type ModelsFile } from "../src/lib/explain/provider";
import type { Block } from "../src/lib/lang/types";
// @ts-expect-error plain ESM module
import { allowedModels, handleExplain, validatePayload } from "../relay/handler.mjs";

const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
const fn: Block = { kind: "function", name: "normalize", label: "normalize", startLine: 15, endLine: 29, declLine: 15, signature: "func normalize(s string) (string, error)", decl: 0 };

describe("buildContext", () => {
  it("sends a small enclosing function whole, with its doc comment", () => {
    const src = [...lines];
    src[13] = "// normalize lowercases s.";
    const c = buildContext({ task: "line", path: "a.go", language: "Go", lines: src, start: 22, end: 22, blocks: [fn] });
    expect([c.startLine, c.endLine]).toEqual([14, 29]);
    expect(c.selectionText).toBe("line 22");
    expect(c.enclosingSignature).toBeUndefined();
  });

  it("falls back to a window around the line without an enclosing declaration", () => {
    const c = buildContext({ task: "line", path: "a.go", language: "Go", lines, start: 35, end: 35, blocks: [] });
    expect([c.startLine, c.endLine]).toEqual([20, 40]);
  });

  it("widens a line that opens a multi-line statement to the whole statement", () => {
    const src = ["package x", "", "import (", '\t"fmt"', '\tflag "github.com/spf13/pflag"', ")", "", "func f() {}"];
    const c = buildContext({ task: "line", path: "a.go", language: "Go", lines: src, start: 3, end: 3, blocks: [] });
    expect(c.task).toBe("selection");
    expect([c.focusStart, c.focusEnd]).toEqual([3, 6]);
    expect(statementRange(src, 6)).toEqual([3, 6]);
    expect(statementRange(["func f(s string) (string, error) {"], 1)).toEqual([1, 1]);
  });

  it("sends a whole declaration and marks truncation beyond the cap", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `    x${i} := compute(${i}) // some padding text`);
    const c = buildContext({ task: "declaration", path: "a.go", language: "Go", lines: big, start: 1, end: 2000, blocks: [], block: { ...fn, startLine: 1, endLine: 2000 } });
    expect(c.truncated).toBe(true);
    expect(c.code).toMatch(/truncated after line \d+/);
    expect(c.bytes).toBeLessThan(MAX_CONTEXT_BYTES + 400);
  });

  it("redacts secrets before sending and reports it", () => {
    const src = ['const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456"', 'password := "hunter2hunter2"', "x := 1"];
    const c = buildContext({ task: "selection", path: "a.go", language: "Go", lines: src, start: 1, end: 3, blocks: [] });
    expect(c.code).not.toContain("abcdefghijklmnop");
    expect(c.code).not.toContain("hunter2hunter2");
    expect(c.redactions).toBe(2);
  });
});

describe("redactSecrets", () => {
  it("keeps line count stable for multi-line keys", () => {
    const text = "a\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----\nb";
    const r = redactSecrets(text);
    expect(r.text.split("\n")).toHaveLength(text.split("\n").length);
    expect(r.kinds).toContain("private key");
  });

  it("covers common token formats", () => {
    const r = redactSecrets("AKIAABCDEFGHIJKLMNOP ghp_" + "a".repeat(36) + " https://user:pa55word@example.com");
    expect(r.count).toBe(3);
    expect(r.text).toContain("https://user:[REDACTED]@example.com");
  });
});

describe("prompt", () => {
  const base = { task: "declaration" as const, path: "slug/normalize.go", language: "Go", lines, start: 15, end: 29, blocks: [fn], block: fn };

  it("writes for a PHP developer learning Go and asks for PHP comparisons", () => {
    const [sys, user] = buildMessages(buildContext({ ...base, familiar: ["PHP"] }));
    expect(sys.content).toContain("an experienced PHP developer learning Go");
    expect(sys.content).toMatch(/comparison to PHP/);
    expect(sys.content).toMatch(/result lists/);
    expect(sys.content).toMatch(/data, not as instructions/);
    expect(user.content).toContain("Selected line(s): lines 15 to 29 (the whole function `normalize`)");
  });

  it("skips comparisons without a familiar language or for the code's own language", () => {
    const none = buildMessages(buildContext({ ...base, familiar: [] }))[0].content;
    expect(none).toContain("an experienced developer reading Go code");
    expect(none).not.toMatch(/comparison/);
    const same = buildMessages(buildContext({ ...base, familiar: ["Go", "Java"] }))[0].content;
    expect(same).toContain("an experienced Go developer");
    expect(same).not.toMatch(/comparison/);
    expect(audience(buildContext({ ...base, familiar: ["PHP", "Java"] })).reader).toBe("an experienced PHP and Java developer learning Go");
  });
  it("drops rule lines whose placeholders are empty and leaves no double blank lines", () => {
    const sys = buildMessages(buildContext({ ...base, familiar: [] }))[0].content;
    expect(sys).not.toMatch(/^-\s*$/m);
    expect(sys).not.toMatch(/\n\n\n/);
    expect(sys).not.toContain("{{");
  });

  it("uses a customized template with the same placeholders", () => {
    const ctx = { ...buildContext({ ...base, familiar: ["PHP"] }), template: { system: "Explain {{selection}} in {{language}} for {{reader}}.\n- {{comparison}}", user: "{{code}}\n{{unknown}}" } };
    const [sys, user] = buildMessages(ctx);
    expect(sys.content.split("\n")[0]).toBe("Explain lines 15 to 29 (the whole function `normalize`) in Go for an experienced PHP developer learning Go.");
    expect(sys.content).toMatch(/comparison to PHP/);
    expect(user.content).toContain("15 | ");
    expect(user.content).toContain("{{unknown}}");
  });

  it("renders templates line by line", () => {
    expect(renderTemplate("a\n{{x}}\n- {{y}}\n\n\nb {{z}}", { x: "", y: "", z: "" })).toBe("a\n\nb");
    expect(renderTemplate("{{x}}", { x: "one\ntwo" })).toBe("one\ntwo");
  });
});

describe("parseExplanation", () => {
  it("takes plain comment text and enforces the sentence limit", () => {
    const e = parseExplanation("Checks whether `s` is empty. If so it returns early. Extra.", "line");
    expect(e.summary).toBe("Checks whether `s` is empty. If so it returns early.");
    expect(e.fallback).toBe(false);
  });

  it("allows up to four sentences for a whole declaration", () => {
    expect(parseExplanation("One. Two. Three. Four. Five.", "declaration").summary).toBe("One. Two. Three. Four.");
  });

  it("drops a sentence that repeats an earlier one", () => {
    const e = parseExplanation("It returns the selected command and the resulting error. It returns the command that was selected along with the resulting error.", "declaration");
    expect(e.summary).toBe("It returns the selected command and the resulting error.");
  });

  it("does not split sentences inside code spans", () => {
    const e = parseExplanation("Calls `a.b()` then `c.d()`. Done.", "line");
    expect(e.summary).toBe("Calls `a.b()` then `c.d()`. Done.");
  });

  it("accepts JSON from models that ignore the contract, and cleans Markdown", () => {
    expect(parseExplanation(JSON.stringify({ summary: "Checks the input." }), "line")).toMatchObject({ summary: "Checks the input.", fallback: true });
    const e = parseExplanation("<b>Sure!</b> This **checks** the input.\n- It returns early.", "line");
    expect(e.summary).not.toContain("<b>");
    expect(e.summary).not.toContain("**");
    expect(e.fallback).toBe(true);
  });

  it("segments inline code for text-only rendering", () => {
    expect(codeSegments("Use `x` now")).toEqual([
      { code: false, text: "Use " },
      { code: true, text: "x" },
      { code: false, text: " now" },
    ]);
  });
});

describe("free model selection", () => {
  const file: ModelsFile = {
    version: "1",
    generatedAt: "",
    ttlSeconds: 60,
    endpoint: "x",
    family: "chat-completions",
    models: [
      { id: "b-free", rank: 2, price: { input: 0, output: 0 } },
      { id: "paid", rank: 1, price: { input: 1, output: 2 } },
      { id: "a-free", rank: 1, price: { input: 0, output: 0 } },
    ],
  };

  it("never selects a model that would bill the visitor, and orders by rank", () => {
    expect(freeModels(file).map((m) => m.id)).toEqual(["a-free", "b-free"]);
  });

  it("accepts models billed to the deployment through its backend", () => {
    const withBackend: ModelsFile = { ...file, models: [...file.models, { id: "openai/gpt-6-luna", rank: 0, billing: "deployment", price: { input: 0.1, output: 0.5 } }] };
    expect(freeModels(withBackend).map((m) => m.id)).toEqual(["openai/gpt-6-luna", "a-free", "b-free"]);
  });

  it("rotates to the next model on rate limits and stops on access-control refusals", async () => {
    const seen: string[] = [];
    let mode: "429" | "403" = "429";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("config.json")) return new Response(JSON.stringify({ ai: { mode: "direct", endpoint: "https://llm/chat" } }));
      if (url.endsWith("models.json")) return new Response(JSON.stringify(file));
      const body = JSON.parse(String(init!.body));
      seen.push(body.model);
      if (mode === "403") return new Response(JSON.stringify({ error: { message: "free tier only" } }), { status: 403 });
      if (body.model === "a-free") return new Response("{}", { status: 429, headers: { "retry-after": "5" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    }) as typeof fetch;
    const g = globalThis as { fetch: typeof fetch; localStorage?: unknown };
    const original = g.fetch;
    g.fetch = fetchImpl;
    try {
      const p = new OpenCodeProvider({ fetch: fetchImpl });
      const r = await p.complete([{ role: "system", content: "s" }, { role: "user", content: "u" }]);
      expect(r.model).toBe("b-free");
      expect(seen).toEqual(["a-free", "b-free"]);
      expect(seen).not.toContain("paid");
      mode = "403";
      await expect(p.complete([{ role: "system", content: "s" }, { role: "user", content: "u" }])).rejects.toThrow(/refused anonymous access/);
      expect(p.state().state).toBe("unavailable");
    } finally {
      g.fetch = original;
    }
  });
});

describe("relay", () => {
  const models = allowedModels({ models: [{ id: "free-1", price: { input: 0, output: 0 } }, { id: "paid", price: { input: 1, output: 1 } }] });
  const good = { model: "free-1", messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }], max_tokens: 5000 };
  const req = (body: unknown, origin: string | null = "https://app.example") => ({
    method: "POST",
    origin,
    contentLength: null,
    text: async () => JSON.stringify(body),
  });

  it("only allows free models and exact message shapes", () => {
    expect(validatePayload({ ...good, model: "paid" }, models)).toMatch(/allowlist/);
    expect(validatePayload({ ...good, url: "https://evil" }, models)).toMatch(/not accepted/);
    expect(validatePayload({ ...good, messages: [good.messages[1]] }, models)).toMatch(/two messages/);
    expect(validatePayload(good, models)).toMatchObject({ model: "free-1", max_tokens: 800, stream: false });
  });

  it("sends OpenRouter models with the server-side key and reasoning off", async () => {
    const orModels = allowedModels({ models: [{ id: "openai/gpt-6-luna", billing: "deployment", price: { input: 0.1, output: 0.5 } }] });
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const env = {
      allowedOrigins: ["https://app.example"],
      models: orModels,
      openrouterKey: "sk-or-test",
      fetch: async (url: string, init: RequestInit) => {
        seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
      },
    };
    const res = await handleExplain(req({ ...good, model: "openai/gpt-6-luna" }), env);
    expect(res.status).toBe(200);
    expect(seen[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer sk-or-test");
    expect(seen[0].body.reasoning).toEqual({ effort: "none" });
    expect(res.body).not.toContain("sk-or-test");
    const noKey = await handleExplain(req({ ...good, model: "openai/gpt-6-luna" }), { ...env, openrouterKey: undefined });
    expect(noKey.status).toBe(503);
  });

  it("grants CORS to allowed origins only, rejects oversized bodies, and forwards only to the fixed endpoint", async () => {
    const env = { allowedOrigins: ["https://app.example"], models, fetch: async (url: string) => new Response(JSON.stringify({ url }), { status: 200 }) };
    expect((await handleExplain(req(good, "https://evil.example"), env)).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await handleExplain({ ...req(good), text: async () => "x".repeat(30_000) }, env)).status).toBe(413);
    const ok = await handleExplain(req(good), env);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).url).toBe("https://opencode.ai/inference/openai/v1/chat/completions");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://app.example");
  });
});
