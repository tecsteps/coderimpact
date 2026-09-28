/**
 * Dependencies declared in package manifests, and the GitHub repository each
 * one comes from, so a manifest's dependency names can open their source in
 * Coderimpact.
 */
export type Ecosystem = "npm" | "packagist" | "go" | "crates" | "pypi" | "rubygems";

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  line: number;
  col: number;
  endCol: number;
}

const ECOSYSTEM_BY_FILE: Record<string, Ecosystem> = {
  "package.json": "npm",
  "composer.json": "packagist",
  "go.mod": "go",
  "cargo.toml": "crates",
  "requirements.txt": "pypi",
  "requirements-dev.txt": "pypi",
  gemfile: "rubygems",
};

export function manifestEcosystem(path: string): Ecosystem | null {
  return ECOSYSTEM_BY_FILE[(path.split("/").pop() ?? "").toLowerCase()] ?? null;
}

/** Finds dependency names and their positions (1-based lines, 0-based columns). */
export function parseDependencies(path: string, text: string): Dependency[] {
  const eco = manifestEcosystem(path);
  if (!eco) return [];
  const lines = text.split(/\r?\n/);
  const out: Dependency[] = [];
  const push = (i: number, name: string, col: number) => out.push({ ecosystem: eco, name, line: i + 1, col, endCol: col + name.length });

  if (eco === "npm" || eco === "packagist") {
    const sections = eco === "npm" ? /"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/ : /"(require|require-dev)"\s*:\s*\{/;
    let depth = 0;
    lines.forEach((l, i) => {
      if (depth === 0) {
        if (sections.test(l) && !/\}/.test(l.slice(l.indexOf("{")))) depth = 1;
        return;
      }
      const m = /^(\s*)"([^"]+)"\s*:/.exec(l);
      if (m && depth === 1) {
        const name = m[2];
        const skip = eco === "packagist" && (name === "php" || name.startsWith("ext-") || name.startsWith("lib-") || !name.includes("/"));
        if (!skip) push(i, name, m[1].length + 1);
      }
      for (const ch of l) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth < 0) depth = 0;
    });
  } else if (eco === "go") {
    let block = false;
    lines.forEach((l, i) => {
      if (/^\s*require\s*\(/.test(l)) block = true;
      else if (block && /^\s*\)/.test(l)) block = false;
      const m = block ? goBlockRequire(l) : /^(\s*require\s+)([^\s(]+)\s+v/.exec(l);
      if (m) push(i, m[2], m[1].length);
    });
  } else if (eco === "crates") {
    let section = false;
    lines.forEach((l, i) => {
      const h = /^\s*\[([^\]]+)\]/.exec(l);
      if (h) {
        section = /(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(h[1].trim());
        return;
      }
      const m = section ? /^(\s*)([A-Za-z0-9_-]+)\s*=/.exec(l) : null;
      if (m) push(i, m[2], m[1].length);
    });
  } else if (eco === "pypi") {
    lines.forEach((l, i) => {
      const m = /^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(l);
      if (m && !l.trim().startsWith("#") && !l.trim().startsWith("-")) push(i, m[2], m[1].length);
    });
  } else if (eco === "rubygems") {
    lines.forEach((l, i) => {
      const m = /^(\s*gem\s+["'])([^"']+)["']/.exec(l);
      if (m) push(i, m[2], m[1].length);
    });
  }
  return out;
}

/**
 * A module line inside a go.mod require block: a path with a slash (not
 * leading, not trailing) followed by a version. Checked in code because the
 * equivalent single regex backtracks super-linearly on long tokens.
 */
function goBlockRequire(l: string): RegExpExecArray | null {
  const m = /^(\s*)(\S+)\s+v/.exec(l);
  if (!m) return null;
  const name = m[2];
  return !name.startsWith("/") && name.slice(0, -1).includes("/") ? m : null;
}

/** owner/repo from a repository URL, when it is on GitHub. */
export function githubRepoFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = /github\.com[/:]([a-z0-9-]+)\/([a-z0-9._-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

const cache = new Map<string, Promise<string | null>>();

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/**
 * Package names as each registry allows them. Names come from the repository's
 * manifest, so anything else (.., ?, #, spaces) never reaches a registry URL.
 */
const NAME_RULES: Record<Dependency["ecosystem"], RegExp> = {
  npm: /^(?:@[\w.~-]+\/)?[\w.~-]+$/,
  packagist: /^[\w.-]+\/[\w.-]+$/,
  go: /^[\w.~-]+(?:\/[\w.~-]+)*$/,
  crates: /^[\w-]+$/,
  pypi: /^[\w.-]+$/,
  rubygems: /^[\w.-]+$/,
};

export function isValidPackageName({ ecosystem, name }: Pick<Dependency, "ecosystem" | "name">): boolean {
  return NAME_RULES[ecosystem].test(name) && !name.split("/").some((part) => part.startsWith("."));
}

/** Each path segment of a package name, URL-encoded. */
const encoded = (name: string) => name.split("/").map(encodeURIComponent).join("/");

/** The GitHub repository a dependency is developed in, or null when the registry does not say. */
export function repositoryOf(dep: Pick<Dependency, "ecosystem" | "name">): Promise<string | null> {
  if (!isValidPackageName(dep)) return Promise.resolve(null);
  const key = `${dep.ecosystem}:${dep.name}`;
  let p = cache.get(key);
  if (!p) {
    p = lookup(dep).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function lookup({ ecosystem, name }: Pick<Dependency, "ecosystem" | "name">): Promise<string | null> {
  switch (ecosystem) {
    case "npm": {
      const j = (await json(`https://registry.npmjs.org/${name.replace("/", "%2F")}`)) as { repository?: string | { url?: string }; homepage?: string };
      const repo = typeof j.repository === "string" ? j.repository.replace(/^github:/, "https://github.com/") : j.repository?.url;
      return githubRepoFromUrl(repo) ?? githubRepoFromUrl(j.homepage);
    }
    case "packagist": {
      const j = (await json(`https://repo.packagist.org/p2/${encoded(name)}.json`)) as { packages?: Record<string, { source?: { url?: string } }[]> };
      return githubRepoFromUrl(j.packages?.[name]?.[0]?.source?.url);
    }
    case "go":
      return goRepository(name);
    case "crates": {
      const j = (await json(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`)) as { crate?: { repository?: string; homepage?: string } };
      return githubRepoFromUrl(j.crate?.repository) ?? githubRepoFromUrl(j.crate?.homepage);
    }
    case "pypi": {
      const j = (await json(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)) as { info?: { project_urls?: Record<string, string>; home_page?: string } };
      const urls = [...Object.values(j.info?.project_urls ?? {}), j.info?.home_page];
      return firstGithubRepo(urls);
    }
    case "rubygems": {
      const j = (await json(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`)) as { source_code_uri?: string; homepage_uri?: string };
      return githubRepoFromUrl(j.source_code_uri) ?? githubRepoFromUrl(j.homepage_uri);
    }
  }
}

/** Go module paths map to repositories by convention, without a registry lookup. */
function goRepository(name: string): string | null {
  if (name.startsWith("github.com/")) return name.split("/").slice(1, 3).join("/");
  if (name.startsWith("golang.org/x/")) return `golang/${name.split("/")[2]}`;
  if (name.startsWith("google.golang.org/protobuf")) return "protocolbuffers/protobuf-go";
  if (name.startsWith("google.golang.org/grpc")) return "grpc/grpc-go";
  if (name.startsWith("gopkg.in/")) return gopkgRepository(name);
  return null;
}

/** gopkg.in/user/pkg.v1 is github.com/user/pkg; gopkg.in/pkg.v1 is github.com/go-pkg/pkg. */
function gopkgRepository(name: string): string | null {
  const m = /^gopkg\.in\/(?:([^/]+)\/)?([^.]+)\.v\d+/.exec(name);
  if (!m) return null;
  return m[1] ? `${m[1]}/${m[2]}` : `go-${m[2]}/${m[2]}`;
}

function firstGithubRepo(urls: (string | undefined)[]): string | null {
  for (const u of urls) {
    const r = githubRepoFromUrl(u);
    if (r) return r;
  }
  return null;
}

/** The package's page on its registry, as a fallback when no repository is known. */
export function registryUrl(dep: Pick<Dependency, "ecosystem" | "name">): string {
  const valid = isValidPackageName(dep);
  const name = encoded(dep.name);
  switch (dep.ecosystem) {
    case "npm":
      return valid ? `https://www.npmjs.com/package/${name}` : "https://www.npmjs.com/";
    case "packagist":
      return valid ? `https://packagist.org/packages/${name}` : "https://packagist.org/";
    case "go":
      return valid ? `https://pkg.go.dev/${name}` : "https://pkg.go.dev/";
    case "crates":
      return valid ? `https://crates.io/crates/${name}` : "https://crates.io/";
    case "pypi":
      return valid ? `https://pypi.org/project/${name}/` : "https://pypi.org/";
    case "rubygems":
      return valid ? `https://rubygems.org/gems/${name}` : "https://rubygems.org/";
  }
}
