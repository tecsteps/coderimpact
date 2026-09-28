export type AppErrorKind =
  | "invalid-url"
  | "not-found"
  | "rate-limit"
  | "offline"
  | "network"
  | "server"
  | "ambiguous-ref"
  | "too-large"
  | "binary"
  | "lfs"
  | "submodule"
  | "repo-too-large"
  | "local-access"
  | "conflict"
  | "aborted";

export interface AppErrorDetails {
  /** Epoch ms when the GitHub rate limit resets. */
  resetAt?: number;
  /** Seconds GitHub asked us to wait (Retry-After). */
  retryAfter?: number;
  limit?: number;
  /** Candidate refs when a ref/path split is ambiguous. */
  candidates?: string[];
  status?: number;
  url?: string;
  size?: number;
  /** Local folder whose access has to be granted again. */
  localId?: string;
  /** The browser can ask for access again (Chrome, Edge); otherwise the folder is picked again. */
  canRequest?: boolean;
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly details: AppErrorDetails;

  constructor(kind: AppErrorKind, message: string, details: AppErrorDetails = {}) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.details = details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function isAbort(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof AppError && e.kind === "aborted")
  );
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (isAbort(e)) return new AppError("aborted", "The request was cancelled.");
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) return new AppError("offline", "You are offline.");
  return new AppError("network", e instanceof Error ? e.message : String(e));
}
