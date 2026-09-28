import { describe, expect, it } from "vitest";
import { applyRename, validRename } from "../src/lib/edit/rename";

describe("applyRename", () => {
  it("replaces every site, several on one line", () => {
    const text = "const total = 1;\nfoo(total, total);\n";
    const r = applyRename(text, [{ line: 1, col: 6, endCol: 11 }, { line: 2, col: 4, endCol: 9 }, { line: 2, col: 11, endCol: 16 }], "total", "sum");
    expect(r).toEqual({ text: "const sum = 1;\nfoo(sum, sum);\n", applied: 3, skipped: 0 });
  });

  it("skips sites whose text changed, and duplicates", () => {
    const r = applyRename("let a = b;\n", [{ line: 1, col: 4, endCol: 5 }, { line: 1, col: 4, endCol: 5 }, { line: 1, col: 8, endCol: 9 }, { line: 9, col: 0, endCol: 1 }], "a", "x");
    expect(r).toEqual({ text: "let x = b;\n", applied: 1, skipped: 2 });
  });

  it("keeps the PHP $ where the site has it and drops it where it does not", () => {
    const text = "$this->count = $count;";
    const r = applyRename(text, [{ line: 1, col: 7, endCol: 12 }, { line: 1, col: 15, endCol: 21 }], "$count", "$total");
    expect(r.text).toBe("$this->total = $total;");
  });

  it("keeps CRLF line endings", () => {
    expect(applyRename("a\r\nb a\r\n", [{ line: 2, col: 2, endCol: 3 }], "a", "z").text).toBe("a\r\nb z\r\n");
  });
});

describe("validRename", () => {
  it("accepts identifiers and rejects the rest", () => {
    expect(validRename("foo", "bar")).toBeNull();
    expect(validRename("foo", "foo")).not.toBeNull();
    expect(validRename("foo", "two words")).not.toBeNull();
    expect(validRename("foo", "1x")).not.toBeNull();
    expect(validRename("$foo", "bar")).not.toBeNull();
    expect(validRename("$foo", "$bar")).toBeNull();
  });
});

import { memberAccessAt, typeFromText } from "../src/lib/lang/completion";

describe("typeFromText", () => {
  it("finds declared types in several languages, closest last", () => {
    expect(typeFromText("const cart: Cart = make();\ncart.", "cart")).toBe("Cart");
    expect(typeFromText("$cart = new Cart();\n$cart->", "$cart")).toBe("Cart");
    expect(typeFromText("function f(Cart $cart) {\n  $cart->", "$cart")).toBe("Cart");
    expect(typeFromText("List<Item> items = x;\nitems.", "items")).toBe("List");
    expect(typeFromText("s := Server{}\ns.", "s")).toBe("Server");
    expect(typeFromText("let a: A;\na = new B();\na.", "a")).toBe("B");
    expect(typeFromText("mycart.x", "cart")).toBeNull();
  });
});

describe("memberAccessAt", () => {
  it("reads receiver, operator and the typed part", () => {
    expect(memberAccessAt("  cart.to")).toEqual({ receiver: "cart", op: ".", typed: "to" });
    expect(memberAccessAt("$this->")).toEqual({ receiver: "$this", op: "->", typed: "" });
    expect(memberAccessAt("Foo::$ba")).toEqual({ receiver: "Foo", op: "::", typed: "$ba" });
    expect(memberAccessAt("$a?->b")).toEqual({ receiver: "$a", op: "?->", typed: "b" });
    expect(memberAccessAt("x = 1.5")).toBeNull();
    expect(memberAccessAt("hello")).toBeNull();
  });
});
