import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEURL_VERBS, translateSeurl } from '@awrm/interop';

test('SEURL: the seven external verbs are preserved verbatim, not adopted as AWRM operations', () => {
  assert.deepEqual([...SEURL_VERBS], ['START', 'SWITCH', 'WRITE', 'COMMIT', 'BUILD', 'TALK', 'PERTURB']);
});
test('SEURL: TALK becomes a gated proposal; unknown DMU is underspecified; JSON form accepted', () => {
  const t = translateSeurl('[{"verb":"TALK","args":{"dmu":"math.check.v1","input":"{\\"question\\":\\"1+1\\"}"}},{"verb":"TALK","args":{"dmu":"nope.v1"}}]', (id) => id === 'math.check.v1');
  assert.equal(t.proposals[0]!.kind, 'run-dmu-proposal');
  assert.equal(t.nonConformance[0]!.status, 'underspecified');
  assert.equal(t.support, 'partial');
  assert.equal(t.authorityGranted, false);
});
test('SEURL: malformed input and seurl:// strings are data, never minted or executed', () => {
  assert.equal(translateSeurl('[not json', () => true).nonConformance[0]!.status, 'malformed');
  const t = translateSeurl('seurl://anything/at/all', () => true);
  assert.equal(t.proposals.length, 0);
  assert.equal(t.mintedUris.length, 0);
});
