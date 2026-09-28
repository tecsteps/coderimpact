/**
 * Removes obvious secrets from code before it is sent for an explanation.
 * Detection is best effort: it catches common token formats and literal
 * credential assignments, not every possible secret.
 */
interface Rule {
  kind: string;
  re: RegExp;
  /** Replace only this capture group; otherwise the whole match. */
  group?: number;
}

/** Key names that mark a literal credential assignment (regex fragments). */
const CREDENTIAL_NAMES = ["password", "passwd", "pwd", "secret", "api[_-]?key", "apikey", "access[_-]?key", "auth[_-]?token", "token", "client[_-]?secret", "private[_-]?key"];
/** `name`, an optional closing quote, and an assignment operator: the part kept before the value. */
const CREDENTIAL_PREFIX = String.raw`((?:${CREDENTIAL_NAMES.join("|")})["']?\s*(?:=>|:=|=|:)\s*)`;
/** The quoted value (8 or more characters) and its matching closing quote. */
const BACKTICK = "`";
const CREDENTIAL_VALUE = String.raw`(["'${BACKTICK}])([^"'${BACKTICK}\s]{8,})\2`;

/** Token formats, redacted whole. */
const TOKEN_RULES: Rule[] = [
  { kind: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{40,})\b/g },
  { kind: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "Stripe key", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "API key", re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
];

/** Literal credential assignments: only the value is redacted. */
const CREDENTIAL_RULE: Rule = { kind: "credential literal", re: new RegExp(CREDENTIAL_PREFIX + CREDENTIAL_VALUE, "gi"), group: 3 };

/** The part of a URL after the scheme up to the password: `://user:`. The password follows, then `@`. */
const URL_LOGIN = /:\/\/[^\s:/@]+:([^\s@/]{3,})@/y;
const SCHEME_CHAR = /[a-z0-9+.-]/i;
const LETTER = /[a-z]/i;

/** Whether a URL scheme (a letter, then letters, digits, `+`, `.` or `-`) ends right before `end`, starting at `from` or later. */
function hasScheme(text: string, from: number, end: number): boolean {
  for (let i = end - 1; i >= from && SCHEME_CHAR.test(text[i]); i--) {
    if (LETTER.test(text[i])) return true;
  }
  return false;
}

/**
 * Redacts passwords in URLs (`scheme://user:password@host`), keeping the rest. Scans for `://`
 * and checks around it, so it runs in linear time. Calls onMatch once per password.
 */
function redactUrlCredentials(text: string, onMatch: () => void): string {
  let out = "";
  let from = 0;
  for (let k = text.indexOf("://"); k >= 0; k = text.indexOf("://", Math.max(k + 1, from))) {
    if (!hasScheme(text, from, k)) continue;
    URL_LOGIN.lastIndex = k;
    const m = URL_LOGIN.exec(text);
    if (!m) continue;
    onMatch();
    const passwordStart = k + m[0].length - 1 - m[1].length;
    out += text.slice(from, passwordStart) + "[REDACTED]@";
    from = k + m[0].length;
  }
  return out + text.slice(from);
}

export interface RedactionResult {
  text: string;
  count: number;
  kinds: string[];
}

export function redactSecrets(input: string): RedactionResult {
  let count = 0;
  const kinds = new Set<string>();
  const found = (kind: string) => {
    count++;
    kinds.add(kind);
  };
  let text = input;
  for (const rule of TOKEN_RULES) text = applyRule(text, rule, found);
  text = redactUrlCredentials(text, () => found("URL credentials"));
  text = applyRule(text, CREDENTIAL_RULE, found);
  return { text, count, kinds: [...kinds] };
}

function applyRule(text: string, rule: Rule, found: (kind: string) => void): string {
  return text.replace(rule.re, (...args: unknown[]) => {
    const match = args[0] as string;
    found(rule.kind);
    if (rule.group === undefined) {
      // Keep line structure so line numbers stay aligned.
      const lines = match.split("\n").length;
      return "[REDACTED]" + "\n".repeat(lines - 1);
    }
    // credential literal: prefix, quote, value
    const groups = args.slice(1, -2) as (string | undefined)[];
    return `${groups[0]}${groups[1]}[REDACTED]${groups[1]}`;
  });
}

/**
 * A fragment selected within one line, as it may be sent: unchanged when it
 * survives the redaction of its line, else redacted (a selection inside a
 * token never leaves the browser).
 */
export function redactFragment(fragment: string, line: string): string {
  const redactedLine = redactSecrets(line);
  if (redactedLine.count === 0 || redactedLine.text.includes(fragment)) return fragment;
  const own = redactSecrets(fragment);
  return own.count > 0 ? own.text : "[REDACTED]";
}
