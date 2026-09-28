import { describe, expect, it } from "vitest";
import { githubRepoFromUrl, parseDependencies } from "../src/lib/deps";

describe("manifest dependencies", () => {
  it("finds npm dependencies with positions, not scripts", () => {
    const text = `{
  "name": "app",
  "scripts": { "build": "vite" },
  "dependencies": {
    "react": "^19.0.0",
    "@scope/pkg": "1.0.0"
  },
  "devDependencies": {
    "vitest": "5"
  }
}`;
    const deps = parseDependencies("package.json", text);
    expect(deps.map((d) => `${d.name}@${d.line}:${d.col}`)).toEqual(["react@5:5", "@scope/pkg@6:5", "vitest@9:5"]);
    expect(text.split("\n")[4].slice(deps[0].col, deps[0].endCol)).toBe("react");
  });

  it("skips php and extensions in composer.json", () => {
    const text = `{\n  "require": {\n    "php": ">=8.2",\n    "ext-json": "*",\n    "symfony/console": "^7.0"\n  }\n}`;
    expect(parseDependencies("composer.json", text).map((d) => d.name)).toEqual(["symfony/console"]);
  });

  it("reads go.mod require blocks and single requires", () => {
    const text = "module example.com/app\n\ngo 1.23\n\nrequire github.com/spf13/cobra v1.8.0\n\nrequire (\n\tgolang.org/x/sync v0.7.0\n\tgithub.com/stretchr/testify v1.9.0 // indirect\n)\n";
    expect(parseDependencies("go.mod", text).map((d) => d.name)).toEqual(["github.com/spf13/cobra", "golang.org/x/sync", "github.com/stretchr/testify"]);
  });

  it("reads Cargo.toml, requirements.txt and Gemfile", () => {
    expect(parseDependencies("Cargo.toml", `[package]\nname = "x"\n\n[dependencies]\nserde = "1"\ntokio = { version = "1" }\n`).map((d) => d.name)).toEqual(["serde", "tokio"]);
    expect(parseDependencies("requirements.txt", "# pinned\nrequests==2.32\n-e .\nflask>=3\n").map((d) => d.name)).toEqual(["requests", "flask"]);
    expect(parseDependencies("Gemfile", `source "https://rubygems.org"\ngem "rails", "~> 7"\n  gem 'pg'\n`).map((d) => d.name)).toEqual(["rails", "pg"]);
  });

  it("extracts GitHub repositories from registry URLs", () => {
    expect(githubRepoFromUrl("git+https://github.com/facebook/react.git")).toBe("facebook/react");
    expect(githubRepoFromUrl("https://github.com/vercel/next.js/tree/canary/packages/next")).toBe("vercel/next.js");
    expect(githubRepoFromUrl("git@github.com:spf13/cobra.git")).toBe("spf13/cobra");
    expect(githubRepoFromUrl("https://gitlab.com/x/y")).toBeNull();
  });
});
