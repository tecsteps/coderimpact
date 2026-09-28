import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { explainSettings, handleExplain, modelsDocument, REASONING_EFFORTS } from "../relay/handler.mjs";
// @ts-expect-error plain ESM module without types
import { fromOwnSite } from "../relay/guard.mjs";

describe("explanation settings from the environment", () => {
  it("reads the model and OpenRouter's reasoning effort", () => {
    expect(explainSettings({ OPENROUTER_MODEL: "openai/gpt-6-luna", OPENROUTER_REASONING_EFFORT: "low" })).toEqual({ model: "openai/gpt-6-luna", reasoningEffort: "low" });
    expect(explainSettings({})).toEqual({ model: null, reasoningEffort: "none" });
    expect(REASONING_EFFORTS).toEqual(["max", "xhigh", "high", "medium", "low", "minimal", "none"]);
  });

  it("refuses an effort OpenRouter does not know", () => {
    expect(() => explainSettings({ OPENROUTER_REASONING_EFFORT: "turbo" })).toThrow(/must be one of/);
  });

  it("publishes the configured model and sends the configured effort", async () => {
    const seen: { reasoning: unknown }[] = [];
    const env = {
      allowedOrigins: ["https://coderimpact.com"],
      models: new Set(["openai/gpt-6-luna"]),
      model: "openai/gpt-6-luna",
      reasoningEffort: "minimal",
      openrouterKey: "k",
      fetch: async (_u: string, init: { body: string }) => {
        seen.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
      },
    };
    const get = await handleExplain({ method: "GET", origin: "https://coderimpact.com", contentLength: null, text: async () => "" }, env);
    expect(JSON.parse(get.body).models.map((m: { id: string }) => m.id)).toEqual(["openai/gpt-6-luna"]);
    expect(modelsDocument(null).models).toEqual([]);
    const body = JSON.stringify({ model: "openai/gpt-6-luna", messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }] });
    await handleExplain({ method: "POST", origin: "https://coderimpact.com", contentLength: body.length, text: async () => body }, env);
    expect(seen[0].reasoning).toEqual({ effort: "minimal" });
  });
});

describe("API guard", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("lets our own pages through", () => {
    expect(fromOwnSite(h({ "sec-fetch-site": "same-origin" }), ["https://coderimpact.com"])).toBe(true);
    expect(fromOwnSite(h({ origin: "https://coderimpact.com" }), ["https://coderimpact.com"])).toBe(true);
  });
  it("refuses scripts, other sites and embeds", () => {
    expect(fromOwnSite(h({}), ["https://coderimpact.com"])).toBe(false);
    expect(fromOwnSite(h({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }), ["https://coderimpact.com"])).toBe(false);
    expect(fromOwnSite(h({ "sec-fetch-site": "none" }), ["https://coderimpact.com"])).toBe(false);
  });
});
