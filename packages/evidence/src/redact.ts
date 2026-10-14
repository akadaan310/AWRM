/**
 * Redaction of secret-shaped material. Applied to everything that leaves the
 * kernel (Marks, events, Passes, API responses). Conservative by design: a
 * false positive costs readability, a false negative leaks a credential.
 */
export interface RedactionRule {
  kind: string;
  re: RegExp;
}

export const REDACTION_RULES: readonly RedactionRule[] = [
  { kind: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { kind: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g },
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { kind: 'acsp-capability', re: /\bacsp_cap_[A-Za-z0-9]+_[A-Za-z0-9]+/g },
  { kind: 'purl-token', re: /\bpurl_[A-Za-z0-9_-]{16,}/g },
  { kind: 'awrm-api-token', re: /\bawrm_tok_[A-Za-z0-9_-]{16,}/g },
  { kind: 'cookie', re: /\b(?:set-)?cookie\s*[:=]\s*[^\n;]{4,}/gi },
  { kind: 'session-cookie-value', re: /\b(?:session|sid|__Secure-[A-Za-z0-9-]+|SAPISID|sessionKey)=[A-Za-z0-9%._-]{8,}/g },
  { kind: 'password-field', re: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi },
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

export interface Redacted {
  text: string;
  kinds: string[];
}

export function redactText(input: string): Redacted {
  let text = input;
  const kinds = new Set<string>();
  for (const r of REDACTION_RULES) {
    text = text.replace(r.re, () => {
      kinds.add(r.kind);
      return `[REDACTED:${r.kind}]`;
    });
  }
  return { text, kinds: [...kinds].sort() };
}

/** True if the string contains anything a redaction rule would remove. */
export function containsSecret(input: string): boolean {
  return REDACTION_RULES.some((r) => {
    r.re.lastIndex = 0;
    const hit = r.re.test(input);
    r.re.lastIndex = 0;
    return hit;
  });
}

/** Redact every string inside a JSON value. */
export function redactValue<T>(value: T): { value: T; kinds: string[] } {
  const kinds = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redactText(v);
      r.kinds.forEach((k) => kinds.add(k));
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, kinds: [...kinds].sort() };
}

export function preview(text: string, max = 280): string {
  const r = redactText(text).text;
  return r.length > max ? r.slice(0, max) + '…' : r;
}
