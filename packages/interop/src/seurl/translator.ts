/**
 * SEURL observation/translation adapter — PARTIAL, CONSERVATIVE.
 *
 * Source reviewed: akadaan310/seurl@620ff955 (README.md, NAI-CI.md, index.html).
 * What exists there: a static page naming seven verbs
 *   START SWITCH WRITE COMMIT BUILD TALK PERTURB
 * and describing URL-as-program semantics in prose. No grammar, interpreter,
 * argument syntax, registry or conformance suite was found.
 *
 * Therefore this adapter:
 *  - accepts *descriptions* (untrusted data) using an AWRM-defined argument
 *    convention (documented below) — this convention is AWRM's, not SEURL's;
 *  - translates TALK and COMMIT into AWRM plan *proposals* that still need a
 *    Gate decision to execute; START is a no-op plan boundary;
 *  - reports SWITCH, WRITE, BUILD, PERTURB as unsupported with reasons;
 *  - never mints seurl:// URIs and never grants authority.
 *
 * Accepted input (one step per line, or JSON array):
 *   TALK dmu=<dmuId> input=<json>          → proposal: run DMU (needs Gate)
 *   COMMIT kind=keep|pass ref=<markDigest>  → proposal: Keep/Pass checkpoint
 *   START                                    → plan boundary
 */

export const SEURL_VERBS = ['START', 'SWITCH', 'WRITE', 'COMMIT', 'BUILD', 'TALK', 'PERTURB'] as const;
export type SeurlVerb = (typeof SEURL_VERBS)[number];

export interface SeurlStep {
  verb: string;
  args: Record<string, string>;
  raw: string;
}

export type AwrmProposal =
  | { kind: 'plan-boundary'; from: SeurlVerb }
  | { kind: 'run-dmu-proposal'; from: 'TALK'; dmuId: string; input: unknown; requiresGate: true }
  | { kind: 'checkpoint-proposal'; from: 'COMMIT'; target: 'keep' | 'pass'; markDigest: string; requiresOwnerApproval: true };

export interface NonConformance {
  step: number;
  verb: string;
  status: 'unsupported' | 'underspecified' | 'unknown-verb' | 'malformed';
  reason: string;
}

export interface SeurlTranslation {
  adapter: 'awrm.interop.seurl';
  support: 'partial';
  sourceRevision: string;
  proposals: AwrmProposal[];
  nonConformance: NonConformance[];
  authorityGranted: false;
  executed: false;
  mintedUris: [];
}

const UNSUPPORTED: Record<string, string> = {
  SWITCH: 'No AWRM equivalent: AWRM does not switch provider sessions/views; a different Port is chosen per run by the owner, and the source defines no SWITCH arguments.',
  WRITE: 'Underspecified in the source (no target, payload or authority model). AWRM refuses to map it to any mutation.',
  BUILD: 'Underspecified in the source. Code generation/execution is outside the DMU contract; not mapped.',
  PERTURB: 'Underspecified in the source. Fault injection exists only in AWRM-owned fixtures under test control, never from untrusted descriptions.',
};

export function parseSeurl(text: string): SeurlStep[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as Array<{ verb: string; args?: Record<string, string> }>;
    return arr.map((s) => ({ verb: String(s.verb), args: s.args ?? {}, raw: JSON.stringify(s) }));
  }
  return trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((raw) => {
      const [verb = '', ...rest] = raw.split(/\s+/);
      const args: Record<string, string> = {};
      const restStr = rest.join(' ');
      for (const m of restStr.matchAll(/([a-z]+)=('[^']*'|\{.*\}|\S+)/g)) args[m[1]!] = m[2]!.replace(/^'(.*)'$/, '$1');
      return { verb, args, raw };
    });
}

export function translateSeurl(text: string, knownDmus: (id: string) => boolean): SeurlTranslation {
  const out: SeurlTranslation = {
    adapter: 'awrm.interop.seurl',
    support: 'partial',
    sourceRevision: 'akadaan310/seurl@620ff955b87857c3eb7a7700a81b6a4d0217400a',
    proposals: [],
    nonConformance: [],
    authorityGranted: false,
    executed: false,
    mintedUris: [],
  };
  let steps: SeurlStep[];
  try {
    steps = parseSeurl(text);
  } catch (e) {
    out.nonConformance.push({ step: 0, verb: '', status: 'malformed', reason: `unparseable description: ${(e as Error).message}` });
    return out;
  }
  steps.forEach((s, i) => {
    const verb = s.verb.toUpperCase();
    if (!(SEURL_VERBS as readonly string[]).includes(verb)) {
      out.nonConformance.push({ step: i, verb: s.verb, status: 'unknown-verb', reason: 'not one of the seven SEURL verbs' });
      return;
    }
    if (verb === 'START') out.proposals.push({ kind: 'plan-boundary', from: 'START' });
    else if (verb === 'TALK') {
      const dmuId = s.args.dmu;
      if (!dmuId || !knownDmus(dmuId)) {
        out.nonConformance.push({ step: i, verb, status: 'underspecified', reason: `TALK needs dmu=<registered DMU id>; got ${dmuId ?? 'none'}` });
        return;
      }
      let input: unknown = {};
      try {
        input = s.args.input ? JSON.parse(s.args.input) : {};
      } catch {
        out.nonConformance.push({ step: i, verb, status: 'malformed', reason: 'input= is not JSON' });
        return;
      }
      out.proposals.push({ kind: 'run-dmu-proposal', from: 'TALK', dmuId, input, requiresGate: true });
    } else if (verb === 'COMMIT') {
      const kind = s.args.kind;
      const ref = s.args.ref ?? '';
      if ((kind !== 'keep' && kind !== 'pass') || !/^sha256:[0-9a-f]{64}$/.test(ref)) {
        out.nonConformance.push({ step: i, verb, status: 'underspecified', reason: 'COMMIT needs kind=keep|pass and ref=<mark digest>' });
        return;
      }
      out.proposals.push({ kind: 'checkpoint-proposal', from: 'COMMIT', target: kind, markDigest: ref, requiresOwnerApproval: true });
    } else {
      out.nonConformance.push({ step: i, verb, status: verb === 'SWITCH' ? 'unsupported' : 'underspecified', reason: UNSUPPORTED[verb]! });
    }
  });
  return out;
}
