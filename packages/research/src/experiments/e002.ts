/** E002 — Port substitution: same Form through different ports, kernel unchanged (H-1). */
import { textClassify, mathCheck } from '@awrm/core';
import { OwnedChatHttpPort } from '@awrm/ports';
import { startOwnedChat } from '@awrm/fixtures';
import { freshEngine, runExperiment, tempDir, verdictFrom } from '../harness';

export const E002 = () =>
  runExperiment({ id: 'E002', title: 'Port substitution: one Form, several conforming ports', hypotheses: ['H-1'] }, async (r) => {
    const { kernel, secrets } = await freshEngine({ seats: ['local-owner'] });
    const fixture = await startOwnedChat();
    const tmp = tempDir('e002');
    const reports: Record<string, unknown>[] = [];
    try {
      // owned chat over HTTP — needs a seat bound to the fixture test credential
      const { localSeat } = await import('@awrm/identity');
      const seat = kernel.seats.register(localSeat('fixture-seat', { credentialRef: 'vault:owned-chat-test', profileRef: `profile:${tmp.dir}/profile` }));
      kernel.ledger.configure({ quotaKey: seat.quotaKey, limit: null, windowMs: null, source: 'owned fixture' });
      secrets.set('owned-chat-test', `${fixture.credential.username}:${fixture.credential.password}`);
      await kernel.registerPort(new OwnedChatHttpPort('owned-chat-http', fixture.url));

      const ports: Array<{ portId: string; seatId: string }> = [
        { portId: 'owned-fixture', seatId: 'local-owner' },
        { portId: 'owned-chat-http', seatId: 'fixture-seat' },
      ];
      // browser port (optional)
      if (process.env.AWRM_SKIP_BROWSER !== '1') {
        try {
          const bp = await import('@awrm/browser-port');
          await bp.emulateHumanLoginOnOwnedFixture({ profileDir: `${tmp.dir}/profile`, fixtureUrl: fixture.url, ...fixture.credential });
          await kernel.registerPort(new bp.BrowserChatPort({ id: 'owned-chat-browser', startUrl: `${fixture.url}/chat`, allowedOrigins: [fixture.url], profileDir: `${tmp.dir}/profile` }));
          ports.push({ portId: 'owned-chat-browser', seatId: 'fixture-seat' });
        } catch (e) {
          r.blocked.push({ path: 'owned-chat-browser', status: 'NOT_RUN', reason: `browser unavailable: ${(e as Error).message.split('\n')[0]}` });
        }
      } else r.blocked.push({ path: 'owned-chat-browser', status: 'NOT_RUN', reason: 'AWRM_SKIP_BROWSER=1' });
      // real local open-weight model (optional)
      if (process.env.AWRM_SKIP_MODEL !== '1') {
        try {
          const { OnnxText2TextPort } = await import('@awrm/port-onnx');
          const onnx = new OnnxText2TextPort({ id: 'onnx-local' });
          const loadMs = await onnx.warm();
          await kernel.registerPort(onnx);
          ports.push({ portId: 'onnx-local', seatId: 'local-owner' });
          r.metrics.onnxLoadMs = Math.round(loadMs);
        } catch (e) {
          r.blocked.push({ path: 'onnx-local (Xenova/flan-t5-small)', status: 'NOT_RUN', reason: `model unavailable: ${(e as Error).message.split('\n')[0]}` });
        }
      } else r.blocked.push({ path: 'onnx-local', status: 'NOT_RUN', reason: 'AWRM_SKIP_MODEL=1' });

      const formDigests = new Set<string>();
      const tasks = [
        { dmu: mathCheck, input: { question: 'What is 17 × 23?' }, truth: { answer: 391 } },
        { dmu: textClassify, input: { text: 'The invoice is overdue.' }, truth: { label: 'billing' } },
        { dmu: textClassify, input: { text: 'My package never arrived and tracking is stuck.' }, truth: { label: 'shipping' } },
      ];
      for (const p of ports) {
        const m = kernel.portManifest(p.portId);
        for (const t of tasks) {
          const run = await kernel.run({ dmuId: t.dmu.id, input: t.input, seatId: p.seatId, portId: p.portId });
          const mk = kernel.getMark(run.markDigest!)!;
          formDigests.add(mk.dmu.formDigest);
          r.mark(mk.digest);
          reports.push({ port: p.portId, kind: m.kind, liveness: m.liveness, dmu: t.dmu.id, state: run.state, output: run.output, error: run.error?.code ?? null, correct: JSON.stringify(run.output) === JSON.stringify(t.truth), elapsedMs: mk.timing.elapsedMs, mark: mk.digest });
        }
      }
      r.check('same Form digest across all ports', formDigests.size, 2); // one per DMU, regardless of port
      const nonModel = reports.filter((x) => x.liveness !== 'local-open-weight-model');
      r.check('fixture/HTTP/browser ports all completed correctly', nonModel.every((x) => x.state === 'completed' && x.correct), true);
      const onnx = reports.filter((x) => x.liveness === 'local-open-weight-model');
      if (onnx.length) {
        r.check('real model runs reached a terminal state through the same kernel path', onnx.every((x) => ['completed', 'failed'].includes(String(x.state))), true);
        r.notes.push(`onnx-local outcomes: ${onnx.map((x) => `${x.dmu}=${x.state}${x.error ? `(${x.error})` : ''}:${JSON.stringify(x.output)}`).join(', ')}`);
      }
      r.metrics.portsExercised = ports.map((p) => p.portId);
      r.metrics.reports = reports;
      r.metrics.chatFixtureStats = { logins: fixture.stats.logins, chats: fixture.stats.chats };
      return verdictFrom(r, `one Form ran unchanged through ${ports.length} ports (${ports.map((p) => p.portId).join(', ')}); outputs differ only where the port's model differs`);
    } finally {
      await kernel.closePorts();
      await fixture.close();
      tmp.cleanup();
    }
  });
