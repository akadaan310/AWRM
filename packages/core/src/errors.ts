/** Typed AWRM errors. Codes are stable identifiers used in Marks and API problems. */
export type AwrmErrorCode =
  | 'invalid-input'
  | 'invalid-output'
  | 'invalid-definition'
  | 'unknown-dmu'
  | 'unknown-port'
  | 'unknown-seat'
  | 'unknown-run'
  | 'not-found'
  | 'gate-denied'
  | 'budget-exhausted'
  | 'rate-limited'
  | 'timeout'
  | 'cancelled'
  | 'refused'
  | 'port-error'
  | 'partial-response'
  | 'idempotency-conflict'
  | 'illegal-transition'
  | 'ambiguous-side-effect'
  | 'secret-material'
  | 'authority-transfer'
  | 'bond-type-mismatch'
  | 'plan-cycle'
  | 'backpressure'
  | 'circuit-open'
  | 'integrity'
  | 'unauthorized'
  | 'forbidden'
  | 'interop'
  | 'unsupported';

export class AwrmError extends Error {
  readonly code: AwrmErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: AwrmErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AwrmError';
    this.code = code;
    this.details = details;
  }
  toJSON(): { code: AwrmErrorCode; message: string; details?: Record<string, unknown> } {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
  }
}

export function isAwrmError(e: unknown, code?: AwrmErrorCode): e is AwrmError {
  return e instanceof AwrmError && (code === undefined || e.code === code);
}
