/** Machine-readable interop support matrix served at GET /v1/interop. Updated by tests/experiments. */
export const INTEROP_MATRIX = {
  seurl: {
    adapter: 'awrm.interop.seurl',
    support: 'partial',
    reference: 'akadaan310/seurl@620ff955b87857c3eb7a7700a81b6a4d0217400a (static page; no executable grammar)',
    supported: { START: 'plan boundary', TALK: 'DMU run proposal (requires Gate)', COMMIT: 'Keep/Pass checkpoint proposal (requires owner approval)' },
    unsupported: ['SWITCH', 'WRITE', 'BUILD', 'PERTURB'],
    mintsUris: false,
  },
  purl: {
    adapter: 'awrm.interop.purl',
    protocol: 'PURL/0.1',
    reference: 'akadaan310/purl@3df4452a3624b3f5492bf23c2dacc49d8d2b33c7',
    operationsUsed: ['GET /.well-known/purl', 'POST /principals', 'POST /r', 'GET /r/{id}', 'GET /r/{id}/manifest', 'GET /r/{id}/{verify|continuity|events|status}', 'POST /r/{id}/ops/checkpoint', 'POST /r/{id}/ops/annotate'],
    notImplemented: ['grant/delegate/revoke', 'assign/handoff/forward', 'transfer', 'fork/merge', 'link', 'lifecycle transitions', 'SSE subscribe', 'HTML representation'],
    facade: false,
  },
  acsp: {
    adapter: 'awrm.interop.acsp',
    protocol: 'ACSP/0.1',
    reference: 'akadaan310/NetGovComEduGovOrgEduGovComNet@9fcf2e1da3ce01a4e66eb5be5e2249b1f211878b',
    operationsUsed: ['GET /.well-known/acsp', 'POST /r (create)', 'GET /r/{id}.json', 'GET /r/{id}?action=prepare_*', 'POST /r/{id}/operations: append, checkpoint, acknowledge'],
    notImplemented: ['annotate', 'update', 'supersede', 'fork', 'delegate', 'revoke', 'handoff (issued by AWRM)', 'propose', 'resolve_proposal', 'close', 'HTML forms'],
    facade: false,
  },
} as const;
