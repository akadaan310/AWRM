import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startApi } from '@awrm/api';
import { kernelWithPorts } from '../helpers';

function raw(url: string, o: { method?: string; headers?: Record<string, string>; body?: string; path: string }): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path: o.path, method: o.method ?? 'GET', headers: o.headers ?? {} }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on('error', reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}

test('API refuses non-loopback binding', async () => {
  const { kernel } = await kernelWithPorts();
  await assert.rejects(startApi({ kernel, host: '0.0.0.0' }));
});
test('API requires the bearer token, loopback Host, same-origin and JSON bodies', async () => {
  const { kernel } = await kernelWithPorts();
  const api = await startApi({ kernel });
  const auth = { authorization: `Bearer ${api.token}` };
  try {
    assert.equal((await raw(api.url, { path: '/v1/status' })).status, 401);
    assert.equal((await raw(api.url, { path: '/v1/status', headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await raw(api.url, { path: '/v1/status', headers: auth })).status, 200);
    assert.equal((await raw(api.url, { path: '/v1/status', headers: { ...auth, host: 'evil.example' } })).status, 403);
    assert.equal((await raw(api.url, { path: '/v1/status', headers: { ...auth, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await raw(api.url, { path: '/v1/runs', method: 'POST', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' }, body: 'dmuId=math.check.v1' })).status, 400);
    assert.equal((await raw(api.url, { path: `/v1/status?token=${api.token}`, headers: auth })).status, 400);
    const status = await raw(api.url, { path: '/v1/status', headers: auth });
    assert.ok(!status.body.includes(api.token));
  } finally {
    await api.close();
  }
});
