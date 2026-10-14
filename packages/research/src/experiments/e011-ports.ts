import type { PortManifest } from '@awrm/core';
import { RulePort } from '@awrm/ports';

/** A loopback test port that *declares* unknown external side effects (like a billed API). */
export class UnknownEffectsPort extends RulePort {
  constructor(id: string, latencyMs: number) {
    super({ id, latencyMs });
  }
  override async describe(): Promise<PortManifest> {
    return { ...(await super.describe()), label: 'test port declaring unknown side effects', sideEffects: 'unknown' };
  }
}
