/** Runtime configuration, loaded from config.json so deployments can change it without a rebuild. */
export interface SnapshotInfo {
  owner: string;
  repo: string;
  /** Path of the snapshot JSON, relative to the app. */
  file: string;
  language: "Go" | "PHP";
  note: string;
}

export interface RuntimeConfig {
  ai: {
    /** direct: browser calls the provider. relay: same-origin relay. off: explanations disabled. */
    mode: "direct" | "relay" | "off";
    endpoint: string;
    relayUrl: string;
    modelsUrl: string;
    timeoutMs: number;
  };
  github: {
    contentMode: "raw-first" | "api";
    /** git: refs, file lists and batched contents over the Git protocol via /api/git. api: REST API only. */
    transport: "git" | "api";
  };
  /** github: live public GitHub. snapshot: bundled repository snapshots only (offline demo). */
  source: {
    kind: "github" | "snapshot";
    snapshots: SnapshotInfo[];
  };
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  ai: {
    mode: "direct",
    endpoint: "https://opencode.ai/inference/openai/v1/chat/completions",
    relayUrl: "/api/explain",
    modelsUrl: "models.json",
    timeoutMs: 30_000,
  },
  github: { contentMode: "raw-first", transport: "git" },
  source: { kind: "github", snapshots: [] },
};

let loaded: Promise<RuntimeConfig> | null = null;
let current: RuntimeConfig | null = null;

export function baseUrl(path: string): string {
  const base = import.meta.env?.BASE_URL ?? "/";
  if (base === "./" || base === "") return "./" + path.replace(/^\//, "");
  return base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
}

export function loadConfig(): Promise<RuntimeConfig> {
  loaded ??= fetch(baseUrl("config.json"), { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((json: Partial<RuntimeConfig>) => {
      current = {
        ai: { ...DEFAULT_CONFIG.ai, ...json.ai },
        github: { ...DEFAULT_CONFIG.github, ...json.github },
        source: { ...DEFAULT_CONFIG.source, ...json.source },
      };
      return current;
    });
  return loaded;
}
