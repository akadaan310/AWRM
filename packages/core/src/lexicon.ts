/**
 * The AWRM controlled vocabulary: 12 namespaced terms. research/lexicon.json and
 * research/LEXICON.md are generated from / checked against this module.
 * External vocabularies are listed only so collision tests can prove disjointness.
 */
import type { JsonSchema } from './schema';

export interface LexiconEntry {
  id: `awrm.${string}`;
  name: string;
  definition: string;
  example: string;
  artifact: string; // implementing module
  schema: JsonSchema; // schema of the term's record
  falsifier: string;
  tests: string[]; // test files exercising positive and negative cases
}

const DIGEST: JsonSchema = { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' };
const ISO: JsonSchema = { type: 'string', minLength: 10, maxLength: 40 };
const PORT_KIND: JsonSchema = { enum: ['local-model', 'official-api', 'approved-browser', 'owned-fixture'] };
const ID: JsonSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' };
const NULLABLE_DIGEST: JsonSchema = { anyOf: [DIGEST, { type: 'null' }] };
const NULLABLE_STR: JsonSchema = { type: ['string', 'null'] };
const ERROR_INFO: JsonSchema = {
  anyOf: [{ type: 'null' }, { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } }],
};

export const LEXICON: readonly LexiconEntry[] = [
  {
    id: 'awrm.dmu',
    name: 'Dark Matter Unit',
    definition:
      'One independently typed and authorised prompt↔response computation U=(I,O,C,S,G,B,V,E) with local explicit state and evidence. Not model weights, not free tokens, not an entitlement.',
    example: 'math.check.v1: {"question":"What is 17 × 23?"} ⇒ {"answer":391}, with a Mark recording port, gate verdict and elapsed time.',
    artifact: 'packages/core/src/dmu.ts',
    schema: {
      type: 'object',
      required: ['id', 'version', 'title', 'form', 'prompt', 'parse', 'budget', 'allowedPortKinds'],
      properties: {
        id: { type: 'string', pattern: '^[a-z][a-z0-9-]*(\\.[a-z0-9-]+)*\\.v[0-9]+$' },
        version: { type: 'integer', minimum: 1 },
        title: { type: 'string' },
        description: { type: 'string' },
        form: { type: 'object' },
        prompt: { type: 'object', required: ['template'], properties: { system: { type: 'string' }, template: { type: 'string' } } },
        parse: { type: 'object', required: ['mode'] },
        budget: { type: 'object', required: ['maxCalls', 'maxWallMs', 'maxOutputChars', 'maxRetries'] },
        allowedPortKinds: { type: 'array', items: PORT_KIND, minItems: 1 },
        example: { type: 'object' },
        digest: DIGEST,
      },
    },
    falsifier: 'An incomplete or schema-invalid response is recorded as a completed invocation.',
    tests: ['tests/core/dmu.test.ts', 'tests/integration/kernel.test.ts'],
  },
  {
    id: 'awrm.form',
    name: 'Form',
    definition: 'Immutable, versioned input/output/context/error schema of a DMU, identified by its digest.',
    example: 'form.math.check v1 requires an integer "answer"; the reply "maybe" fails validation.',
    artifact: 'packages/core/src/form.ts',
    schema: {
      type: 'object',
      required: ['formId', 'version', 'input', 'output', 'context', 'errors'],
      properties: {
        formId: { type: 'string', pattern: '^form\\.[a-z0-9][a-z0-9.-]{0,80}$' },
        version: { type: 'integer', minimum: 1 },
        input: { type: 'object' },
        output: { type: 'object' },
        context: { type: 'object', required: ['maxContextChars', 'acceptsKeeps', 'acceptsPasses'] },
        errors: { type: 'array', items: { type: 'string' } },
        digest: DIGEST,
      },
    },
    falsifier: 'An invalid answer passes validation, or a Form mutates after definition.',
    tests: ['tests/core/form.test.ts'],
  },
  {
    id: 'awrm.seat',
    name: 'Seat',
    definition: 'Owner-bound execution identity or local principal reference. Its id and record never contain credential material; it points to vault/profile handles.',
    example: 'seat "gemini-personal-1" (provider google, quotaKey google:personal) — currently has no permitted automated port.',
    artifact: 'packages/identity/src/seat.ts',
    schema: {
      type: 'object',
      required: ['seatId', 'provider', 'principal', 'quotaKey', 'allowedPortKinds', 'permissionRecordIds', 'scopes'],
      additionalProperties: false,
      properties: {
        seatId: ID,
        provider: { type: 'string', minLength: 1, maxLength: 64 },
        principal: { enum: ['owner-account', 'local-principal'] },
        accountAlias: { type: 'string', maxLength: 64 },
        quotaKey: { type: 'string', minLength: 1, maxLength: 128 },
        profileRef: { type: 'string', maxLength: 256 },
        credentialRef: { type: 'string', pattern: '^vault:[A-Za-z0-9._-]+$' },
        allowedPortKinds: { type: 'array', items: PORT_KIND },
        permissionRecordIds: { type: 'array', items: ID },
        scopes: { type: 'array', items: { type: 'string' } },
        expiry: ISO,
      },
    },
    falsifier: 'Another seat can reuse this seat’s vault credentials, or a seat record contains a secret.',
    tests: ['tests/security/seat-vault.test.ts'],
  },
  {
    id: 'awrm.port',
    name: 'Port',
    definition: 'Replaceable typed means of executing a DMU attempt. Browser, API, local model and fixture are peers; none is the core.',
    example: 'Swap the owned-chat browser port for the local ONNX model port: same Form, different Mark.port.',
    artifact: 'packages/ports/src/interface.ts',
    schema: {
      type: 'object',
      required: ['id', 'kind', 'label', 'liveness', 'provider', 'network', 'sideEffects', 'streaming'],
      properties: {
        id: ID,
        kind: PORT_KIND,
        label: { type: 'string' },
        liveness: { enum: ['deterministic-test-double', 'owned-fixture', 'local-open-weight-model', 'external-live'] },
        provider: { type: 'string' },
        network: { enum: ['none', 'loopback', 'external'] },
        sideEffects: { enum: ['none', 'unknown'] },
        streaming: { type: 'boolean' },
        maxConcurrency: { type: 'integer', minimum: 1 },
        model: { type: 'string' },
        license: { type: 'string' },
        notes: { type: 'string' },
      },
    },
    falsifier: 'The kernel imports Playwright, Android, Golden Surface or any port implementation.',
    tests: ['tests/security/dependency-boundaries.test.ts', 'tests/ports/ports.test.ts'],
  },
  {
    id: 'awrm.gate',
    name: 'Gate',
    definition: 'Deterministic pure decision over actor, seat, port, operation, permission evidence, quota and budget, evaluated at enqueue and again immediately before invocation. Unknown ⇒ deny.',
    example: 'Consumer chatgpt.com UI automation: providerPermission unknown/prohibited ⇒ deny(provider-permission-not-established).',
    artifact: 'packages/policy/src/gate.ts',
    schema: {
      type: 'object',
      required: ['verdict', 'code', 'reasons', 'phase'],
      additionalProperties: false,
      properties: {
        verdict: { enum: ['permit', 'deny'] },
        code: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' } },
        phase: { enum: ['enqueue', 'pre-invoke'] },
      },
    },
    falsifier: 'A denied run opens a network connection or invokes its port.',
    tests: ['tests/core/gate.test.ts', 'tests/integration/kernel.test.ts'],
  },
  {
    id: 'awrm.turn',
    name: 'Turn',
    definition: 'One attempt with its own id and lifecycle pending→running→success|failure|cancelled. Retries are new child Turns.',
    example: 'A slow port exceeds maxWallMs: Turn 1 ends failure(timeout); its late reply is discarded, never reported as success.',
    artifact: 'packages/runtime/src/turn.ts',
    schema: {
      type: 'object',
      required: ['turnId', 'runId', 'attempt', 'parentTurnId', 'state', 'portId'],
      properties: {
        turnId: ID,
        runId: ID,
        attempt: { type: 'integer', minimum: 1 },
        parentTurnId: NULLABLE_STR,
        state: { enum: ['pending', 'running', 'success', 'failure', 'cancelled'] },
        portId: ID,
        startedAt: NULLABLE_STR,
        endedAt: NULLABLE_STR,
        elapsedMs: { type: ['number', 'null'] },
        firstChunkMs: { type: ['number', 'null'] },
        outputChars: { type: 'integer', minimum: 0 },
        error: ERROR_INFO,
        markDigest: NULLABLE_DIGEST,
      },
    },
    falsifier: 'A timed-out Turn later reports success, or a retry silently re-bills without a new Turn.',
    tests: ['tests/core/turn.test.ts', 'tests/integration/kernel.test.ts'],
  },
  {
    id: 'awrm.mark',
    name: 'Mark',
    definition: 'Content-addressed, redacted witness of one terminal outcome: input/output digests, port, gate, timing, parents, verdict.',
    example: 'marks/sha256:… shows which port returned 391 for math.check.v1 and that the gate permitted it.',
    artifact: 'packages/evidence/src/mark.ts',
    schema: {
      type: 'object',
      required: ['schema', 'runId', 'turnId', 'attempt', 'dmu', 'inputDigest', 'outputDigest', 'port', 'gate', 'verdict', 'timing', 'usage', 'parents', 'digest'],
      properties: {
        schema: { const: 'awrm.mark/1' },
        runId: ID,
        turnId: NULLABLE_STR,
        attempt: { type: 'integer', minimum: 0 },
        dmu: { type: 'object', required: ['id', 'version', 'formDigest'] },
        inputDigest: DIGEST,
        outputDigest: NULLABLE_DIGEST,
        rawResponseDigest: NULLABLE_DIGEST,
        port: { type: 'object', required: ['id', 'kind', 'liveness', 'provider'] },
        gate: { anyOf: [{ type: 'null' }, { type: 'object', required: ['verdict', 'code', 'decisionDigest'] }] },
        verdict: { enum: ['completed', 'failed', 'denied', 'cancelled'] },
        error: ERROR_INFO,
        timing: { type: 'object', required: ['createdAt', 'endedAt'] },
        usage: { type: 'object', required: ['calls', 'outputChars'] },
        parents: { type: 'array', items: DIGEST },
        digest: DIGEST,
      },
    },
    falsifier: 'A Mark whose output, input digest, timing or parent link was altered still verifies.',
    tests: ['tests/core/mark.test.ts'],
  },
  {
    id: 'awrm.keep',
    name: 'Keep',
    definition: 'Explicit, local, revisable, source-attributed continuity record bound to the Mark that produced it. Never a claim about hidden model memory.',
    example: 'Keep "last-arithmetic" rev 1 = {question, answer:391} produced by Mark sha256:…; reused as context in the next DMU.',
    artifact: 'packages/continuity/src/keep.ts',
    schema: {
      type: 'object',
      required: ['schema', 'keepId', 'revision', 'content', 'contentHash', 'producerTurnId', 'producerMarkHash', 'scope', 'sourceSeatRef', 'identityAssurance', 'readers', 'consentRecord', 'lineage', 'digest'],
      properties: {
        schema: { const: 'awrm.keep/1' },
        keepId: ID,
        revision: { type: 'integer', minimum: 1 },
        contentHash: DIGEST,
        producerTurnId: ID,
        producerMarkHash: DIGEST,
        scope: { type: 'string' },
        sourceSeatRef: ID,
        sourceModelClaim: NULLABLE_STR,
        identityAssurance: { enum: ['local-principal', 'self-asserted'] },
        readers: { type: 'array', items: ID },
        expiration: NULLABLE_STR,
        consentRecord: { type: 'string', minLength: 1 },
        claims: { type: 'array', items: { type: 'string' } },
        uncertainties: { type: 'array', items: { type: 'string' } },
        lineage: { type: 'array', items: DIGEST },
        createdAt: ISO,
        digest: DIGEST,
      },
    },
    falsifier: 'A fresh seat automatically knows Keep content that was never placed in its context.',
    tests: ['tests/integration/continuity.test.ts'],
  },
  {
    id: 'awrm.pass',
    name: 'Pass',
    definition: 'Redacted, typed transfer of permitted data from one DMU/seat to another. Carries data and citations — never identity, credentials, quota or authority.',
    example: 'local-a classifies a ticket; a Pass carries "label=billing [mark sha256:…]" to local-b, which summarises it.',
    artifact: 'packages/continuity/src/pass.ts',
    schema: {
      type: 'object',
      required: ['schema', 'passId', 'from', 'to', 'payload', 'scope', 'redactions', 'consentRecord', 'identityAssurance', 'createdAt', 'digest'],
      additionalProperties: false,
      properties: {
        schema: { const: 'awrm.pass/1' },
        passId: ID,
        from: {
          type: 'object',
          required: ['seatId', 'turnId', 'markDigest'],
          additionalProperties: false,
          properties: { seatId: ID, turnId: ID, markDigest: DIGEST },
        },
        to: { type: 'object', required: ['seatId'], additionalProperties: false, properties: { seatId: ID } },
        payload: {
          type: 'object',
          required: ['content', 'citations'],
          additionalProperties: false,
          properties: { content: { type: 'string', maxLength: 8000 }, citations: { type: 'array', items: DIGEST, maxItems: 32 } },
        },
        scope: { type: 'string' },
        redactions: { type: 'array', items: { type: 'string' } },
        consentRecord: { type: 'string', minLength: 1 },
        sourceModelClaim: NULLABLE_STR,
        identityAssurance: { enum: ['local-principal', 'self-asserted'] },
        createdAt: ISO,
        expiration: NULLABLE_STR,
        digest: DIGEST,
      },
    },
    falsifier: 'The destination seat inherits source credentials, quota, or the source identity.',
    tests: ['tests/integration/continuity.test.ts', 'tests/security/injection.test.ts'],
  },
  {
    id: 'awrm.fleet',
    name: 'Fleet',
    definition: 'A set of independently accountable execution lanes scheduled only across authorised, measured capacity. Unknown quota ⇒ unknown capacity, never infinity.',
    example: '32 math-check DMUs across 4 worker lanes with a hard global cap of 8 in flight.',
    artifact: 'packages/scheduler/src/fleet.ts',
    schema: {
      type: 'object',
      required: ['lanes', 'globalCap', 'maxQueue'],
      properties: {
        globalCap: { type: 'integer', minimum: 1, maximum: 256 },
        maxQueue: { type: 'integer', minimum: 1 },
        lanes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['laneId', 'portId', 'seatId', 'concurrency'],
            properties: { laneId: ID, portId: ID, seatId: ID, concurrency: { type: 'integer', minimum: 1, maximum: 64 }, weight: { type: 'number', minimum: 0 } },
          },
        },
      },
    },
    falsifier: 'The fleet exceeds its configured global cap or quota, or ignores a rate-limit signal.',
    tests: ['tests/perf/fleet.test.ts'],
  },
  {
    id: 'awrm.bond',
    name: 'Bond',
    definition: 'Typed directed dependency carrying the output (or one field) of DMU A into an input field of DMU B, with provenance, never authority.',
    example: 'facts.extract.v1.facts → facts.cite.v1.facts → text.summarize.v1.text.',
    artifact: 'packages/plans/src/bond.ts',
    schema: {
      type: 'object',
      required: ['from', 'to'],
      additionalProperties: false,
      properties: {
        from: { type: 'object', required: ['node', 'field'], additionalProperties: false, properties: { node: ID, field: NULLABLE_STR } },
        to: { type: 'object', required: ['node', 'field'], additionalProperties: false, properties: { node: ID, field: { type: 'string' } } },
      },
    },
    falsifier: 'Incompatible schemas are silently linked, or a Bond widens the downstream seat or scope.',
    tests: ['tests/integration/plans.test.ts'],
  },
  {
    id: 'awrm.seed',
    name: 'Seed',
    definition: 'Machine-generated, preregistered, testable hypothesis for extending AWRM within fixed authority. Seeds cannot change policy, budgets, seats or activate external ports.',
    example: 'Seed: "a prompt-echo validator reduces accepted wrong answers on the hostile fixture" — preregistered, run locally, kept as candidate.',
    artifact: 'packages/research/src/seed.ts',
    schema: {
      type: 'object',
      required: ['schema', 'seedId', 'title', 'hypothesis', 'metric', 'prediction', 'procedure', 'requestedCapabilities', 'status'],
      properties: {
        schema: { const: 'awrm.seed/1' },
        seedId: ID,
        title: { type: 'string' },
        hypothesis: { type: 'string' },
        metric: { type: 'string' },
        prediction: { type: 'string' },
        procedure: { type: 'string' },
        requestedCapabilities: {
          type: 'array',
          items: { enum: ['local-compute', 'owned-fixture', 'read-own-evidence', 'network', 'external-port', 'policy-write', 'seat-create', 'budget-raise'] },
        },
        status: { enum: ['proposed', 'preregistered', 'rejected', 'executed', 'refuted', 'candidate', 'inconclusive'] },
        preregistrationDigest: NULLABLE_DIGEST,
        rejection: NULLABLE_STR,
        result: { type: ['object', 'null'] },
      },
    },
    falsifier: 'A generated Seed activates a blocked external port, opens a network connection, or edits policy.',
    tests: ['tests/integration/seeds.test.ts'],
  },
];

/** External vocabularies (reference only — never AWRM terms). */
export const EXTERNAL_VOCABULARY = {
  seurl: ['START', 'SWITCH', 'WRITE', 'COMMIT', 'BUILD', 'TALK', 'PERTURB'],
  purl: [
    'resource', 'principal', 'right', 'grant', 'authority source', 'delegation chain', 'event', 'primitive', 'operation',
    'invocation', 'projection', 'checkpoint', 'continuity package', 'communication profile', 'genesis', 'patch', 'append',
    'revoke', 'assign', 'link', 'transition', 'transfer', 'handoff', 'fork', 'merge',
  ],
  acsp: ['continuity resource', 'session', 'agent', 'actor', 'TOK', 'checkpoint', 'capability', 'operation intent', 'handoff', 'acknowledge', 'propose', 'delegate', 'annotation'],
} as const;
