import { describe, expect, it } from "vitest";
import { bracketPairs, bracketRange } from "../src/lib/explain/context";

const json = ['{', '  "name": "x",', '  "scripts": {', '    "dev": "vite",', '    "build": "tsc {x}"', '  },', '  "deps": [', '    "a"', '  ]', '}'];

describe("bracketRange", () => {
  it("takes the largest enclosing block that fits", () => {
    expect(bracketRange(json, 4, 4)).toEqual([1, 10]);
  });

  it("ignores brackets inside strings", () => {
    expect(bracketPairs(json)).toContainEqual([3, 6]);
    expect(bracketPairs(json)).not.toContainEqual([5, 5]);
  });

  it("caps a long block at 50 lines around the selection", () => {
    const long = ["function f() {", ...Array.from({ length: 200 }, (_, i) => `  call${i}();`), "}"];
    const [s, e] = bracketRange(long, 100, 100)!;
    expect(e - s + 1).toBe(50);
    expect(s).toBeLessThanOrEqual(100);
    expect(e).toBeGreaterThanOrEqual(100);
  });

  it("returns null without brackets", () => {
    expect(bracketRange(["a = 1", "b = 2"], 1, 1)).toBeNull();
  });
});
