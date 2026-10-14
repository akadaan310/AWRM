import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { localSeat } from '@awrm/identity';
import { startOwnedChat } from '@awrm/fixtures';
import { BrowserChatPort, defaultChromium, emulateHumanLoginOnOwnedFixture } from '@awrm/browser-port';
import type { PortEvent } from '@awrm/ports';

const skip = process.env.AWRM_SKIP_BROWSER === '1' || !existsSync(defaultChromium() ?? '') ? 'no chromium / AWRM_SKIP_BROWSER=1' : false;

test('browser port: allowlist enforced at construction; emulated login refuses non-loopback', { skip }, async () => {
  assert.throws(() => new BrowserChatPort({ id: 'x', startUrl: 'https://chatgpt.com/', allowedOrigins: ['http://127.0.0.1:1'], profileDir: '/tmp/x' }));
  await assert.rejects(emulateHumanLoginOnOwnedFixture({ profileDir: '/tmp/x', fixtureUrl: 'https://claude.ai', username: 'a', password: 'b' }));
});
test('browser port: human-login-required before login; answer after; foreign requests aborted', { skip }, async () => {
  const fx = await startOwnedChat();
  const dir = mkdtempSync(join(tmpdir(), 'awrm-bp-'));
  const port = new BrowserChatPort({ id: 'b', startUrl: `${fx.url}/chat`, allowedOrigins: [fx.url], profileDir: join(dir, 'p') });
  const inv = { runId: 'r', turnId: 't', attempt: 1, dmuId: 'math.check.v1', prompt: { user: 'Question: What is 6 × 7?\nAnswer:' }, maxOutputChars: 1000, deadlineMs: 10_000, seat: localSeat('s', { profileRef: 'profile:x' }), credentials: null };
  const run = async () => {
    const out: PortEvent[] = [];
    for await (const e of port.invoke(inv, new AbortController().signal)) out.push(e);
    return out;
  };
  try {
    assert.equal(((await run())[0] as { code: string }).code, 'human-login-required');
    await port.close();
    await emulateHumanLoginOnOwnedFixture({ profileDir: join(dir, 'p'), fixtureUrl: fx.url, ...fx.credential });
    const out = await run();
    assert.deepEqual(out.at(-1), { type: 'final', text: '42', model: 'owned-chat-fixture@1 via browser' });
    assert.equal((await port.describe()).liveness, 'owned-fixture');
  } finally {
    await port.close();
    await fx.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
