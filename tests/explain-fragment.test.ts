import { describe, expect, it } from "vitest";
import { boxCodeWords, codeWordsOf, parseExplanation } from "../src/lib/explain/validate";
import { redactFragment } from "../src/lib/explain/secrets";
import { buildMessages } from "../src/lib/explain/prompt";
import { buildContext } from "../src/lib/explain/context";

describe("explaining a selected fragment", () => {
  it("splits the precise term explanation from its role here", () => {
    const raw = "`protected` makes a property visible inside its class and subclasses, but not from outside.\n\nHere: it keeps `$calculationFacade` reachable for `Operation` subclasses only.";
    const e = parseExplanation(raw, "selection", { fragment: "protected" });
    expect(e.term).toMatch(/visible inside its class/);
    expect(e.summary).toMatch(/^it keeps/);
  });

  it("falls back to one text when the model skips the Here paragraph", () => {
    const e = parseExplanation("`protected` limits visibility to the class and its subclasses.", "selection", { fragment: "protected" });
    expect(e.term).toBeUndefined();
    expect(e.summary).toMatch(/limits visibility/);
  });
});

describe("boxing code words", () => {
  const code = "protected $calculationFacade;\n$this->calculationFacade->calculate($quote);\nuser_id = get_user(1)";
  const words = codeWordsOf(code, "protected");

  it("boxes code-shaped names from the sent code and the selected term", () => {
    expect(boxCodeWords("The protected property $calculationFacade calls calculate via user_id.", words)).toBe(
      "The `protected` property `$calculationFacade` calls calculate via `user_id`.",
    );
  });

  it("leaves text already in backticks and plain English alone", () => {
    expect(boxCodeWords("It uses `$this` and returns the total.", words)).toBe("It uses `$this` and returns the total.");
  });
});

describe("sending a selected fragment", () => {
  const token = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
  const line = `const auth = "${token}";`;

  it("never sends a selection inside a secret", () => {
    expect(redactFragment(token.slice(4, 20), line)).toBe("[REDACTED]");
    expect(redactFragment(token, line)).not.toContain(token);
  });

  it("keeps the fragment out of the system prompt", () => {
    const ctx = buildContext({ task: "selection", path: "a.php", language: "PHP", lines: ["protected $uniqueWord;"], blocks: [], familiar: [], start: 1, end: 1 });
    ctx.fragment = "uniqueWord";
    const [system, user] = buildMessages(ctx);
    expect(system.content).not.toContain("uniqueWord");
    expect(user.content).toContain("Selected text: `uniqueWord`");
  });

  it("keeps ordinary fragments, also on a line with a secret", () => {
    expect(redactFragment("const", line)).toBe("const");
    expect(redactFragment("protected", "protected $x;")).toBe("protected");
  });
});

describe("inline Here in the term part", () => {
  it("drops the inline repeat when a Here paragraph follows", () => {
    const raw = "In JSON, a string is a sequence of characters. Here: `spf13/cobra` is the first argument.\n\nHere: `spf13/cobra` is the first argument passed to the script.";
    const e = parseExplanation(raw, "selection", { fragment: "spf13/cobra" });
    expect(e.term).toBe("In JSON, a string is a sequence of characters.");
    expect(e.summary).toContain("first argument passed to the script");
  });
});
