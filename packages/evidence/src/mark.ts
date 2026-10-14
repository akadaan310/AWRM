/**
 * awrm.mark — content-addressed witness of one terminal DMU outcome.
 *
 * digest = sha256(canonical(MarkBody)). A Mark is written once; verification
 * recomputes the digest, checks the schema, checks every parent exists and
 * verifies, and (when the content is available) recomputes input/output digests.
 */
import { digest, isDigest, validate, LEXICON, type Mark, type MarkBody } from '@awrm/core';

const MARK_SCHEMA = LEXICON.find((e) => e.id === 'awrm.mark')!.schema;

export function sealMark(body: MarkBody): Mark {
  return { ...body, digest: digest(body) };
}

export interface MarkCheck {
  ok: boolean;
  problems: string[];
}

export function verifyMark(mark: Mark): MarkCheck {
  const problems: string[] = [];
  const v = validate(MARK_SCHEMA, mark);
  if (!v.ok) problems.push(...v.errors.map((e) => `schema ${e.path}: ${e.message}`));
  const { digest: claimed, ...body } = mark;
  if (!isDigest(claimed)) problems.push('digest malformed');
  else if (digest(body) !== claimed) problems.push('digest mismatch (content altered)');
  if (mark.verdict === 'completed' && mark.outputDigest === null) problems.push('completed mark without output digest');
  if (mark.verdict !== 'completed' && mark.outputDigest !== null) problems.push('non-completed mark claims a validated output');
  if (mark.verdict === 'denied' && mark.gate?.verdict !== 'deny') problems.push('denied mark without a deny gate decision');
  if (mark.verdict === 'completed' && mark.gate?.verdict !== 'permit') problems.push('completed mark without a permit gate decision');
  const t = mark.timing;
  if (t.startedAt && Date.parse(t.endedAt) < Date.parse(t.startedAt)) problems.push('timing: ended before started');
  if (t.elapsedMs !== null && t.elapsedMs < 0) problems.push('timing: negative elapsed');
  return { ok: problems.length === 0, problems };
}

/** Recompute content digests against the stored input/output. */
export function verifyMarkContent(mark: Mark, input: unknown, output: unknown | null): MarkCheck {
  const problems: string[] = [];
  if (digest(input) !== mark.inputDigest) problems.push('input digest mismatch');
  if (mark.outputDigest !== null && digest(output) !== mark.outputDigest) problems.push('output digest mismatch');
  return { ok: problems.length === 0, problems };
}

/** Verify a set of Marks as a provenance graph: each verifies and every parent resolves. */
export function verifyMarkGraph(marks: Mark[]): { ok: boolean; checked: number; problems: Array<{ digest: string; problem: string }> } {
  const byDigest = new Map(marks.map((m) => [m.digest, m]));
  const problems: Array<{ digest: string; problem: string }> = [];
  for (const m of marks) {
    for (const p of verifyMark(m).problems) problems.push({ digest: m.digest, problem: p });
    for (const parent of m.parents) {
      const pm = byDigest.get(parent);
      if (!pm) problems.push({ digest: m.digest, problem: `missing parent ${parent}` });
      else if (Date.parse(pm.timing.endedAt) > Date.parse(m.timing.endedAt)) problems.push({ digest: m.digest, problem: `parent ${parent} ends after child` });
    }
  }
  return { ok: problems.length === 0, checked: marks.length, problems };
}
