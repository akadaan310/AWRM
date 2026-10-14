/**
 * awrm.keep — explicit, local, revisable continuity bound to the Mark that
 * produced it. A Keep is *data AWRM chose to keep*; it is never evidence of,
 * or a substitute for, any provider's hidden conversation memory.
 */
import { AwrmError, digest, type Clock, type KeepRecord, type Mark } from '@awrm/core';
import { redactValue, verifyMark } from '@awrm/evidence';
import type { Store } from '@awrm/store';

export interface KeepWrite {
  keepId: string;
  content: unknown;
  mark: Mark;
  scope: string;
  readers: string[];
  consentRecord: string;
  claims?: string[];
  uncertainties?: string[];
  expiration?: string | null;
}

export class KeepStore {
  constructor(private store: Store, private clock: Clock) {}

  write(w: KeepWrite): KeepRecord {
    const check = verifyMark(w.mark);
    if (!check.ok) throw new AwrmError('integrity', 'Keep must cite a verifying Mark', { problems: check.problems });
    if (w.mark.verdict !== 'completed' || !w.mark.turnId || !w.mark.seatId) throw new AwrmError('invalid-input', 'Keep must cite a completed Mark');
    if (!w.consentRecord) throw new AwrmError('invalid-input', 'consentRecord required');
    const prev = this.latest(w.keepId);
    const { value: content } = redactValue(w.content);
    const body: Omit<KeepRecord, 'digest'> = {
      schema: 'awrm.keep/1',
      keepId: w.keepId,
      revision: (prev?.revision ?? 0) + 1,
      content,
      contentHash: digest(content),
      producerTurnId: w.mark.turnId,
      producerMarkHash: w.mark.digest,
      scope: w.scope,
      sourceSeatRef: w.mark.seatId,
      sourceModelClaim: w.mark.port.model,
      identityAssurance: 'local-principal',
      readers: [...w.readers],
      expiration: w.expiration ?? null,
      consentRecord: w.consentRecord,
      claims: w.claims ?? [],
      uncertainties: w.uncertainties ?? ['content is a model/port output; not independently verified'],
      lineage: prev ? [...prev.lineage, prev.digest] : [],
      createdAt: this.clock.iso(),
    };
    const rec: KeepRecord = { ...body, digest: digest(body) };
    if (!this.store.putIfAbsent('keeps', `${rec.keepId}@${rec.revision}`, rec)) throw new AwrmError('integrity', 'concurrent Keep revision');
    this.store.put('keep-heads', rec.keepId, { revision: rec.revision });
    return rec;
  }

  latest(keepId: string): KeepRecord | undefined {
    const head = this.store.get<{ revision: number }>('keep-heads', keepId);
    return head ? this.store.get<KeepRecord>('keeps', `${keepId}@${head.revision}`) : undefined;
  }

  history(keepId: string): KeepRecord[] {
    return this.store.list<KeepRecord>('keeps').filter((k) => k.keepId === keepId).sort((a, b) => a.revision - b.revision);
  }

  /** The only way Keep content enters a DMU context: an explicit read by a listed reader. */
  readFor(seatId: string, keepId: string): KeepRecord {
    const k = this.latest(keepId);
    if (!k) throw new AwrmError('not-found', `no keep ${keepId}`);
    if (!k.readers.includes(seatId)) throw new AwrmError('forbidden', `seat ${seatId} is not a reader of keep ${keepId}`);
    if (k.expiration && Date.parse(k.expiration) <= this.clock.now()) throw new AwrmError('forbidden', `keep ${keepId} expired`);
    return k;
  }

  /** Verify every revision: digest, content hash, lineage chain and producing Mark. */
  verifyAll(markLookup: (d: string) => Mark | undefined): { ok: boolean; checked: number; problems: string[] } {
    const problems: string[] = [];
    const all = this.store.list<KeepRecord>('keeps');
    const byId = new Map<string, KeepRecord[]>();
    for (const k of all) byId.set(k.keepId, [...(byId.get(k.keepId) ?? []), k]);
    for (const k of all) {
      const { digest: d, ...body } = k;
      if (digest(body) !== d) problems.push(`${k.keepId}@${k.revision}: digest mismatch`);
      if (digest(k.content) !== k.contentHash) problems.push(`${k.keepId}@${k.revision}: content hash mismatch`);
      const m = markLookup(k.producerMarkHash);
      if (!m) problems.push(`${k.keepId}@${k.revision}: producing mark missing`);
      else if (!verifyMark(m).ok) problems.push(`${k.keepId}@${k.revision}: producing mark fails verification`);
      const prevs = (byId.get(k.keepId) ?? []).filter((x) => x.revision < k.revision).sort((a, b) => a.revision - b.revision);
      if (JSON.stringify(prevs.map((p) => p.digest)) !== JSON.stringify(k.lineage)) problems.push(`${k.keepId}@${k.revision}: lineage mismatch`);
    }
    return { ok: problems.length === 0, checked: all.length, problems };
  }
}
