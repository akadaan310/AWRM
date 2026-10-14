import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsSecret, redactText, redactValue } from '@awrm/evidence';

test('redaction removes known credential shapes and is idempotent', () => {
  const samples = ['Bearer abcdefghijklmnop', 'sk-ant-api03-AAAAAAAAAAAAAAAA', 'AIzaSyA1234567890abcdefghij', 'acsp_cap_ABC_DEF123', 'purl_abcdefghijklmnopqrstu', 'awrm_tok_abcdefghijklmnopqrstuvwx', 'Cookie: sid=12345678abcdefgh', 'password=hunter2'];
  for (const s of samples) {
    const r = redactText(`before ${s} after`);
    assert.ok(!r.text.includes(s), s);
    assert.ok(r.kinds.length >= 1, s);
    assert.equal(redactText(r.text).text, r.text, 'idempotent');
    assert.ok(containsSecret(s));
  }
  assert.equal(containsSecret('The invoice is overdue.'), false);
  assert.deepEqual(redactValue({ a: ['Bearer abcdefghijklmnop'] }).value, { a: ['[REDACTED:bearer-token]'] });
});
