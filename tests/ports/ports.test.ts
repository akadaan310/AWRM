import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { localSeat, MemorySecretSource, Vault } from '@awrm/identity';
import { AnthropicMessagesPort, DisabledConsumerPort, GeminiApiPort, OwnedChatHttpPort, RulePort, brainA, brainB, type PortEvent, type PortInvocation } from '@awrm/ports';
import { startOwnedChat } from '@awrm/fixtures';
import { kernelWithPorts, Q } from '../helpers';

async function collect(it: AsyncIterable<PortEvent>): Promise<PortEvent[]> {
  const out: PortEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const inv = (o: Partial<PortInvocation> = {}): PortInvocation => ({ runId: 'r', turnId: 't', attempt: 1, dmuId: 'math.check.v1', prompt: { system: 'Answer with a single integer and nothing else.', user: 'Question: What is 17 × 23?\nAnswer:' }, maxOutputChars: 1000, deadlineMs: 1000, seat: localSeat('s'), credentials: null, ...o });

test('awrm.port positive: two independent brains agree on the contract, differ in form', () => {
  const p = { system: 'Answer', user: 'Question: What is 17 × 23?\nAnswer:' };
  assert.equal(brainA(p), '391');
  assert.equal(brainB(p), 'The answer is 391.');
  const c = { system: 'Classify the text', user: 'Text: my parcel tracking is stuck' };
  assert.equal(brainA(c), 'shipping');
  assert.equal(brainB(c), 'Label: shipping');
});
test('awrm.port: swapping ports changes no kernel code and keeps the Form', async () => {
  const { kernel } = await kernelWithPorts();
  const a = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-a', portId: 'local-a' });
  const b = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-b', portId: 'local-b' });
  assert.deepEqual([a.output, b.output], [{ answer: 391 }, { answer: 391, explanation: 'The answer is 391.' }]);
  assert.equal(a.formDigest, b.formDigest);
  assert.notEqual(kernel.getMark(a.markDigest!)!.port.model, kernel.getMark(b.markDigest!)!.port.model);
});
test('rule port modes produce the declared event shapes', async () => {
  const kinds = async (mode: ConstructorParameters<typeof RulePort>[0]['mode']) => (await collect(new RulePort({ id: 'x', mode }).invoke(inv(), new AbortController().signal))).map((e) => e.type);
  assert.deepEqual(await kinds('refuse'), ['refusal']);
  assert.deepEqual(await kinds('error'), ['error']);
  assert.deepEqual(await kinds('rate-limit'), ['rate-limited']);
  assert.deepEqual(await kinds('partial'), ['chunk', 'error']);
  assert.equal((await kinds('correct')).at(-1), 'final');
});
test('disabled consumer ports describe themselves as disabled and cannot run', async () => {
  const p = new DisabledConsumerPort('c', 'openai', 'ChatGPT');
  assert.equal((await p.assess()).available, false);
  await assert.rejects(collect(p.invoke()));
});
test('official API ports: correct wire format, key only in headers, refusal and 429 mapping (owned fake server)', async () => {
  const seen: Array<{ url: string; headers: Record<string, unknown>; body: string }> = [];
  let mode: 'ok' | '429' = 'ok';
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ url: req.url!, headers: req.headers, body: b });
      if (mode === '429') {
        res.writeHead(429, { 'retry-after': '7' });
        return res.end('{}');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(req.url!.includes('generateContent') ? JSON.stringify({ candidates: [{ content: { parts: [{ text: '391' }] } }] }) : JSON.stringify({ content: [{ type: 'text', text: '391' }], stop_reason: 'end_turn' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const src = new MemorySecretSource();
  src.set('k', 'test-key-not-real');
  const vault = new Vault(src);
  const seat = { ...localSeat('api'), provider: 'anthropic', credentialRef: 'vault:k' };
  const credentials = { withCredential: <T,>(fn: (s: { reveal(): string }) => Promise<T>) => vault.use(seat, 'vault:k', fn) };
  try {
    const a = await collect(new AnthropicMessagesPort({ id: 'a', model: 'claude-haiku-5-5', baseUrl: base }).invoke(inv({ seat, credentials }), new AbortController().signal));
    assert.deepEqual(a.at(-1), { type: 'final', text: '391', model: 'claude-haiku-5-5' });
    assert.equal(seen[0]!.url, '/v1/messages');
    assert.equal(seen[0]!.headers['x-api-key'], 'test-key-not-real');
    assert.equal(seen[0]!.headers['anthropic-version'], '2023-06-01');
    assert.equal(JSON.parse(seen[0]!.body).system, 'Answer with a single integer and nothing else.');
    const g = await collect(new GeminiApiPort({ id: 'g', model: 'gemini-x', baseUrl: base }).invoke(inv({ seat: { ...seat, provider: 'google' }, credentials }), new AbortController().signal));
    assert.equal((g.at(-1) as { text: string }).text, '391');
    assert.ok(!seen[1]!.url.includes('key='), 'Gemini key never in the URL');
    assert.equal(seen[1]!.headers['x-goog-api-key'], 'test-key-not-real');
    mode = '429';
    const rl = await collect(new AnthropicMessagesPort({ id: 'a', model: 'm', baseUrl: base }).invoke(inv({ seat, credentials }), new AbortController().signal));
    assert.deepEqual(rl, [{ type: 'rate-limited', retryAfterMs: 7000 }]);
    assert.equal((await new AnthropicMessagesPort({ id: 'a', model: 'm' }).describe()).sideEffects, 'unknown');
  } finally {
    server.close();
  }
});
test('owned chat HTTP port: login via vault, SSE answer, 401 re-login, 429 surfaced', async () => {
  const fx = await startOwnedChat({ rateLimit: { limit: 2, windowMs: 60_000 } });
  const src = new MemorySecretSource();
  src.set('fx', `${fx.credential.username}:${fx.credential.password}`);
  const vault = new Vault(src);
  const seat = localSeat('fx', { credentialRef: 'vault:fx' });
  const credentials = { withCredential: <T,>(fn: (s: { reveal(): string }) => Promise<T>) => vault.use(seat, 'vault:fx', fn) };
  const port = new OwnedChatHttpPort('h', fx.url);
  try {
    const a = await collect(port.invoke(inv({ seat, credentials }), new AbortController().signal));
    assert.equal((a.at(-1) as { text: string }).text, '391');
    fx.expireAllSessions();
    const b = await collect(port.invoke(inv({ seat, credentials }), new AbortController().signal));
    assert.equal(b.at(-1)!.type, 'final');
    assert.equal(fx.stats.logins, 2);
    const c = await collect(port.invoke(inv({ seat, credentials }), new AbortController().signal));
    assert.equal(c.at(-1)!.type, 'final');
    const d = await collect(port.invoke(inv({ seat, credentials }), new AbortController().signal));
    assert.equal(d[0]!.type, 'rate-limited');
    const none = await collect(new OwnedChatHttpPort('h2', fx.url).invoke(inv(), new AbortController().signal));
    assert.equal((none[0] as { code: string }).code, 'human-login-required');
    assert.throws(() => new OwnedChatHttpPort('bad', 'https://chatgpt.com'));
  } finally {
    await fx.close();
  }
});
