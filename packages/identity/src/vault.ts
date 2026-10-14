/**
 * Secret handling. Secrets live in an OS keychain / environment / encrypted
 * profile *outside* AWRM's store. The kernel only ever sees `vault:<name>`
 * handles. `Secret` values refuse serialisation, and a secret can only be
 * opened for the seat whose record names that handle.
 */
import { inspect } from 'node:util';
import { AwrmError, type SeatRef } from '@awrm/core';

export class Secret {
  #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return '[REDACTED:secret]';
  }
  toString(): string {
    return '[REDACTED:secret]';
  }
  [inspect.custom](): string {
    return 'Secret([REDACTED])';
  }
}

export interface SecretSource {
  /** Returns the secret for a handle name, or null when absent. Never logs. */
  lookup(name: string): Secret | null;
  /** Presence check that reveals nothing. */
  has(name: string): boolean;
}

/** Reads `AWRM_SECRET_<NAME>` (or an explicit env name map) from the process environment. */
export class EnvSecretSource implements SecretSource {
  constructor(private map: Record<string, string> = {}, private env: NodeJS.ProcessEnv = process.env) {}
  private envName(name: string): string {
    return this.map[name] ?? `AWRM_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  }
  lookup(name: string): Secret | null {
    const v = this.env[this.envName(name)];
    return v ? new Secret(v) : null;
  }
  has(name: string): boolean {
    return Boolean(this.env[this.envName(name)]);
  }
}

export class MemorySecretSource implements SecretSource {
  private m = new Map<string, Secret>();
  set(name: string, value: string): void {
    this.m.set(name, new Secret(value));
  }
  lookup(name: string): Secret | null {
    return this.m.get(name) ?? null;
  }
  has(name: string): boolean {
    return this.m.has(name);
  }
}

export class Vault {
  constructor(private source: SecretSource) {}

  /** Opens the secret for `seat` only if the seat itself names this handle. */
  async use<T>(seat: SeatRef, handle: string, fn: (secret: Secret) => Promise<T>): Promise<T> {
    if (!handle.startsWith('vault:')) throw new AwrmError('invalid-input', 'vault handles look like vault:<name>');
    if (seat.credentialRef !== handle) throw new AwrmError('forbidden', `seat ${seat.seatId} is not bound to ${handle}`);
    const secret = this.source.lookup(handle.slice(6));
    if (!secret) throw new AwrmError('forbidden', `no secret present for ${handle}`);
    return fn(secret);
  }

  present(handle: string): boolean {
    return handle.startsWith('vault:') && this.source.has(handle.slice(6));
  }
}
