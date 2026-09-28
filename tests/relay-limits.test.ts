import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { createRateLimiter } from "../relay/rateLimit.mjs";
// @ts-expect-error plain ESM module without types
import { readCapped } from "../relay/body.mjs";

describe("rate limiter", () => {
  it("counts only admitted requests and frees the window over time", () => {
    const limited = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(limited("a", 0)).toBe(false);
    expect(limited("a", 10)).toBe(false);
    for (let i = 0; i < 100; i++) expect(limited("a", 20)).toBe(true);
    expect(limited("a", 1005)).toBe(false);
  });

  it("evicts the least recently seen visitors, never everyone", () => {
    const limited = createRateLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
    limited("a", 0);
    limited("b", 1);
    expect(limited("b", 2)).toBe(true);
    limited("c", 3); // evicts a
    expect(limited("b", 4)).toBe(true);
    expect(limited("a", 5)).toBe(false);
  });
});

describe("capped body", () => {
  const stream = (n: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(1024));
        c.close();
      },
    });

  it("reads bodies up to the cap and refuses larger ones without a Content-Length", async () => {
    expect((await readCapped(stream(4), 4096))?.length).toBe(4096);
    expect(await readCapped(stream(5), 4096)).toBeNull();
  });
});
