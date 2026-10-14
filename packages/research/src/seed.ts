/**
 * awrm.seed — bounded self-discovery loop:
 *   observe → propose → preregister → validate permissions → run in sandbox
 *   → measure → refute / retain as candidate → Mark-like record.
 *
 * A Seed can never: name a procedure outside the fixed registry, request
 * network / external ports / policy writes / seat creation / budget raises,
 * or change anything outside its own record. Promotion means "candidate for
 * human review", never automatic installation.
 */
import { AwrmError, digest, LEXICON, validate, type SeedCapability, type SeedRecord } from '@awrm/core';
import { PROCEDURES, type ProcedureOutcome } from './procedures';
import { withNetworkGuard } from './sandbox';

const SEED_SCHEMA = LEXICON.find((e) => e.id === 'awrm.seed')!.schema;
export const ALLOWED_SEED_CAPABILITIES: readonly SeedCapability[] = ['local-compute', 'owned-fixture', 'read-own-evidence'];

export interface SeedProposal {
  title: string;
  hypothesis: string;
  metric: string;
  prediction: string;
  procedure: string;
  params?: Record<string, unknown>;
  requestedCapabilities: SeedCapability[];
  /** Preregistered promotion rule: relative improvement threshold. */
  minRelativeImprovement: number;
}

export interface SeedRun {
  seed: SeedRecord;
  preregistration: { digest: string; at: string; body: unknown } | null;
  outcome: ProcedureOutcome | null;
  violations: string[];
}

export function generateSeeds(observations: Record<string, unknown>): SeedProposal[] {
  const obs = (k: string, d: string) => String(observations[k] ?? d);
  return [
    {
      title: 'Strict integer parsing',
      hypothesis: 'Accepting only whole-response integers lowers the false-accept rate of math.check.v1 without losing more than 5% of correct answers.',
      metric: 'false-accept rate', prediction: 'false-accept rate falls; goodput drop ≤ 5%', procedure: 'parser-strict-integer',
      requestedCapabilities: ['local-compute'], minRelativeImprovement: 0.1,
    },
    {
      title: 'Redaction coverage for more token formats',
      hypothesis: `Adding GitHub/Slack/AWS key patterns raises secret detection above the current ${obs('redactionBaseline', 'baseline')} without new false positives.`,
      metric: 'detection rate', prediction: 'detection rate rises by ≥ 10%', procedure: 'redaction-coverage',
      requestedCapabilities: ['local-compute'], minRelativeImprovement: 0.1,
    },
    {
      title: 'Property tests for canonical JSON',
      hypothesis: 'Canonical JSON is idempotent and key-order invariant on 500 generated values.',
      metric: 'passing generated cases', prediction: '500/500 pass', procedure: 'canonical-json-property',
      requestedCapabilities: ['local-compute'], minRelativeImprovement: 1,
    },
    {
      title: 'Lane count matching cores',
      hypothesis: `CPU-bound local DMU throughput saturates near the core count (${obs('cpus', '?')}); more lanes add latency, not throughput.`,
      metric: 'throughput', prediction: 'best lane count ≤ cores; 8 lanes < 1.15× 4 lanes', procedure: 'fleet-lane-optimum', params: { cpuWorkMs: 10 },
      requestedCapabilities: ['local-compute', 'owned-fixture'], minRelativeImprovement: 0.5,
    },
    {
      title: 'Smaller context budget for summaries',
      hypothesis: 'Cutting text.summarize context from 4000 to 400 chars leaves outputs unchanged on the Pass-chain corpus.',
      metric: 'unchanged fraction', prediction: '100% unchanged', procedure: 'context-budget',
      requestedCapabilities: ['local-compute', 'owned-fixture', 'read-own-evidence'], minRelativeImprovement: 0,
    },
    {
      title: 'Shorter retry backoff for local ports',
      hypothesis: 'A 5 ms backoff base halves median latency of single-retry local runs versus 50 ms with equal success.',
      metric: 'p50 latency', prediction: 'p50 falls ≥ 30%', procedure: 'backoff-tune',
      requestedCapabilities: ['local-compute', 'owned-fixture'], minRelativeImprovement: 0.3,
    },
    {
      title: 'Activate consumer ChatGPT port for more capacity',
      hypothesis: 'Routing DMUs through chatgpt.com would add capacity.',
      metric: 'throughput', prediction: 'more DMU/s', procedure: 'remote-benchmark',
      requestedCapabilities: ['network', 'external-port'], minRelativeImprovement: 0,
    },
    {
      title: 'Treat unknown quota as unlimited',
      hypothesis: 'Relaxing the Gate rule "unknown quota ⇒ deny" raises admitted calls.',
      metric: 'admitted calls', prediction: 'more admitted', procedure: 'parser-strict-integer',
      requestedCapabilities: ['policy-write'], minRelativeImprovement: 0,
    },
    {
      title: 'Create extra seats to multiply allowance',
      hypothesis: 'Registering more seats on the same account multiplies permitted calls.',
      metric: 'admitted calls', prediction: 'N× calls', procedure: 'fleet-lane-optimum',
      requestedCapabilities: ['seat-create', 'budget-raise'], minRelativeImprovement: 0,
    },
    {
      title: 'Remote benchmark (declared local)',
      hypothesis: 'A remote benchmark endpoint gives better latency baselines.',
      metric: 'latency', prediction: 'n/a', procedure: 'remote-benchmark',
      requestedCapabilities: ['local-compute'], minRelativeImprovement: 0,
    },
  ];
}

export function preregister(p: SeedProposal, at: string, seedId: string): { record: SeedRecord; preregistration: SeedRun['preregistration'] } {
  const body = { seedId, title: p.title, hypothesis: p.hypothesis, metric: p.metric, prediction: p.prediction, procedure: p.procedure, params: p.params ?? {}, requestedCapabilities: p.requestedCapabilities, promotionRule: { minRelativeImprovement: p.minRelativeImprovement, guardMustHold: true } };
  const d = digest(body);
  const record: SeedRecord = {
    schema: 'awrm.seed/1',
    seedId,
    title: p.title,
    hypothesis: p.hypothesis,
    metric: p.metric,
    prediction: p.prediction,
    procedure: p.procedure,
    requestedCapabilities: [...p.requestedCapabilities],
    status: 'preregistered',
    preregistrationDigest: d,
    rejection: null,
    result: null,
  };
  const v = validate(SEED_SCHEMA, record);
  if (!v.ok) throw new AwrmError('invalid-input', 'invalid seed', { errors: v.errors });
  return { record, preregistration: { digest: d, at, body } };
}

export function validateSeedPermissions(rec: SeedRecord): string | null {
  const bad = rec.requestedCapabilities.filter((c) => !ALLOWED_SEED_CAPABILITIES.includes(c));
  if (bad.length) return `requests prohibited capabilities: ${bad.join(', ')}`;
  if (!(rec.procedure in PROCEDURES)) return `unknown procedure ${rec.procedure}`;
  return null;
}

export async function executeSeed(p: SeedProposal, seedId: string, at: string): Promise<SeedRun> {
  const { record, preregistration } = preregister(p, at, seedId);
  const problem = validateSeedPermissions(record);
  if (problem) return { seed: { ...record, status: 'rejected', rejection: problem }, preregistration, outcome: null, violations: [] };
  const violations: string[] = [];
  let outcome: ProcedureOutcome;
  try {
    outcome = await withNetworkGuard(() => PROCEDURES[record.procedure]!(p.params ?? {}), (w) => violations.push(w));
  } catch (e) {
    return { seed: { ...record, status: 'rejected', rejection: `runtime: ${(e as Error).message}` }, preregistration, outcome: null, violations };
  }
  if (violations.length) return { seed: { ...record, status: 'rejected', rejection: `runtime violations: ${violations.join('; ')}` }, preregistration, outcome: null, violations };
  const delta = outcome.higherIsBetter ? outcome.candidate - outcome.baseline : outcome.baseline - outcome.candidate;
  // Relative change is undefined against a zero baseline; report the absolute gain instead.
  const rel = outcome.baseline === 0 ? null : delta / Math.abs(outcome.baseline);
  const improved = rel === null ? delta > 0 : p.minRelativeImprovement === 0 ? delta >= -1e-12 : rel >= p.minRelativeImprovement;
  const status: SeedRecord['status'] = improved && outcome.guard.ok ? 'candidate' : 'refuted';
  return {
    seed: { ...record, status, result: { relativeImprovement: rel === null ? null : Number(rel.toFixed(4)), absoluteChange: Number(delta.toFixed(6)), baseline: outcome.baseline, candidate: outcome.candidate, guard: outcome.guard, metric: outcome.metric } },
    preregistration,
    outcome,
    violations,
  };
}
