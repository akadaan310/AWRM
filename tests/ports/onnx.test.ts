import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OnnxText2TextPort, onnxAvailable } from '@awrm/port-onnx';
import { createKernel } from '@awrm/runtime';

const skip = process.env.AWRM_TEST_MODEL === '1' && onnxAvailable().ok ? false : 'set AWRM_TEST_MODEL=1 (downloads ~80 MB of public weights on first run)';

test('real local model port: same DMU contract; the Form, not the model, decides validity', { skip }, async () => {
  const k = createKernel();
  const p = new OnnxText2TextPort({ id: 'onnx-local' });
  await k.registerPort(p);
  const c = await k.run({ dmuId: 'text.classify.v1', input: { text: 'The invoice is overdue.' }, seatId: 'local-owner', portId: 'onnx-local' });
  assert.equal(c.state, 'completed');
  assert.equal(k.getMark(c.markDigest!)!.port.liveness, 'local-open-weight-model');
  const m = await k.run({ dmuId: 'math.check.v1', input: { question: 'What is 17 × 23?' }, seatId: 'local-owner', portId: 'onnx-local' });
  assert.ok(['completed', 'failed'].includes(m.state));
  if (m.state === 'completed') assert.equal(Number.isInteger((m.output as { answer: number }).answer), true);
});
test('onnx manifest declares licence, offline inference and liveness', async () => {
  const d = await new OnnxText2TextPort({ id: 'x' }).describe();
  assert.equal(d.liveness, 'local-open-weight-model');
  assert.equal(d.network, 'none');
  assert.match(d.license ?? '', /Apache-2\.0/);
});
