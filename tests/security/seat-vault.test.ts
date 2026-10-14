import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { isAwrmError } from '@awrm/core';
import { MemorySecretSource, Secret, SeatRegistry, Vault, localSeat } from '@awrm/identity';

test('awrm.seat positive: handle-only seat registers and is frozen', () => {
  const reg = new SeatRegistry();
  const s = reg.register(localSeat('s1', { credentialRef: 'vault:s1-key', profileRef: 'profile:/tmp/p' }));
  assert.ok(Object.isFrozen(s));
});
test('awrm.seat negative: credential material anywhere in a seat is rejected', () => {
  const reg = new SeatRegistry();
  for (const bad of [
    localSeat('s2', { accountAlias: 'Bearer abcdefghijklmnopqrstuv' }),
    localSeat('s3', { profileRef: 'cookie=SAPISID=abcdefghijk' }),
    localSeat('s4', { accountAlias: 'sk-ant-api03-ABCDEFGHIJKLMNOP' }),
  ])
    assert.throws(() => reg.register(bad), (e) => isAwrmError(e, 'secret-material'));
  assert.throws(() => reg.register({ ...localSeat('s5'), password: 'x' } as never), (e) => isAwrmError(e, 'invalid-input'));
});
test('Secret values never serialise or print', () => {
  const s = new Secret('super-secret-value');
  assert.equal(JSON.stringify({ s }), '{"s":"[REDACTED:secret]"}');
  assert.equal(String(s), '[REDACTED:secret]');
  assert.ok(!inspect(s).includes('super-secret'));
});
test('vault opens a credential only for the seat bound to it', async () => {
  const src = new MemorySecretSource();
  src.set('a-key', 'value-a');
  const v = new Vault(src);
  const a = localSeat('a', { credentialRef: 'vault:a-key' });
  const b = localSeat('b');
  assert.equal(await v.use(a, 'vault:a-key', async (x) => x.reveal()), 'value-a');
  await assert.rejects(v.use(b, 'vault:a-key', async (x) => x.reveal()), (e) => isAwrmError(e, 'forbidden'));
  await assert.rejects(v.use({ ...b, credentialRef: 'vault:a-key' }, 'vault:missing', async (x) => x.reveal()));
});
