/** E003 — Signed-in boundary on an owned login fixture: human login, profile restart, expiry, logout, vault isolation. */
import { readFileSync } from 'node:fs';
import { localSeat } from '@awrm/identity';
import { OwnedChatHttpPort } from '@awrm/ports';
import { openStore } from '@awrm/store';
import { startOwnedChat } from '@awrm/fixtures';
import { freshEngine, runExperiment, tempDir, verdictFrom } from '../harness';

export const E003 = () =>
  runExperiment({ id: 'E003', title: 'Signed-in boundary (owned fixture): human-only login, restart, expiry, logout, no cookie extraction', hypotheses: ['H-4'] }, async (r) => {
    const tmp = tempDir('e003');
    const fixture = await startOwnedChat({ sessionTtlMs: 60_000 });
    const { kernel, secrets } = await freshEngine({ dir: `${tmp.dir}/store`, seats: ['local-owner'] });
    try {
      const seat = kernel.seats.register(localSeat('fx-seat', { credentialRef: 'vault:fx-cred', profileRef: `profile:${tmp.dir}/profile` }));
      const other = kernel.seats.register(localSeat('other-seat'));
      for (const s of [seat, other]) kernel.ledger.configure({ quotaKey: s.quotaKey, limit: null, windowMs: null, source: 'owned fixture' });
      secrets.set('fx-cred', `${fixture.credential.username}:${fixture.credential.password}`);

      // Vault isolation: a seat that does not name the handle cannot open it.
      let otherErr = '';
      await kernel.vault.use(other, 'vault:fx-cred', async () => 'opened').catch((e) => (otherErr = (e as Error).message));
      r.check('another seat cannot open fx-seat credential', /not bound/.test(otherErr), true);

      // HTTP port without a credential-bearing seat → human-login-required
      await kernel.registerPort(new OwnedChatHttpPort('chat-http', fixture.url));
      const noCred = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 2 × 3?' }, seatId: 'other-seat', portId: 'chat-http' });
      r.check('no credential → human-login-required, no success', [noCred.state, /human-login-required/.test(noCred.error?.message ?? '')], ['failed', true]);
      const withCred = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 2 × 3?' }, seatId: 'fx-seat', portId: 'chat-http' });
      r.check('credential via vault handle → completed', [withCred.state, withCred.output], ['completed', { answer: 6 }]);
      fixture.expireAllSessions();
      const afterExpiry = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 3 × 3?' }, seatId: 'fx-seat', portId: 'chat-http' });
      r.check('expired fixture session → one re-login with own credential → completed', afterExpiry.state, 'completed');
      r.mark(noCred.markDigest, withCred.markDigest, afterExpiry.markDigest);

      // Browser profile: human (emulated) login, restart persistence, expiry, logout.
      if (process.env.AWRM_SKIP_BROWSER === '1') r.blocked.push({ path: 'browser profile flow', status: 'NOT_RUN', reason: 'AWRM_SKIP_BROWSER=1' });
      else {
        try {
          const bp = await import('@awrm/browser-port');
          const mk = () => new bp.BrowserChatPort({ id: 'chat-browser', startUrl: `${fixture.url}/chat`, allowedOrigins: [fixture.url], profileDir: `${tmp.dir}/profile` });
          let port = mk();
          await kernel.registerPort(port);
          const before = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 4 × 4?' }, seatId: 'fx-seat', portId: 'chat-browser' });
          r.check('browser before human login → human-login-required (AWRM never types credentials)', [before.state, /human-login-required/.test(before.error?.message ?? '')], ['failed', true]);
          await port.close();
          await bp.emulateHumanLoginOnOwnedFixture({ profileDir: `${tmp.dir}/profile`, fixtureUrl: fixture.url, ...fixture.credential });
          port = mk();
          await kernel.registerPort(port);
          const after = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 4 × 4?' }, seatId: 'fx-seat', portId: 'chat-browser' });
          r.check('after emulated human login → completed', [after.state, after.output], ['completed', { answer: 16 }]);
          await port.close(); // "restart": a new browser process on the same profile
          port = mk();
          await kernel.registerPort(port);
          const restarted = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 5 × 5?' }, seatId: 'fx-seat', portId: 'chat-browser' });
          r.check('profile restart keeps the fixture session (best-effort restore)', restarted.state, 'completed');
          fixture.expireAllSessions();
          const expired = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 6 × 6?' }, seatId: 'fx-seat', portId: 'chat-browser' });
          r.check('server-side expiry → human-login-required (revocation wins)', [expired.state, /human-login-required/.test(expired.error?.message ?? '')], ['failed', true]);
          await port.close();
          r.mark(before.markDigest, after.markDigest, restarted.markDigest, expired.markDigest);
        } catch (e) {
          r.blocked.push({ path: 'browser profile flow', status: 'NOT_RUN', reason: (e as Error).message.split('\n')[0]! });
        }
      }
      await kernel.closePorts();
      kernel.store.close();
      // No cookie or password reached AWRM's durable store.
      const journal = readFileSync(`${tmp.dir}/store/journal.jsonl`, 'utf8');
      r.check('store contains no fixture password', journal.includes(fixture.credential.password), false);
      r.check('store contains no fixture session cookie', /fx_session=/.test(journal), false);
      const reopened = openStore({ kind: 'jsonl', dir: `${tmp.dir}/store` });
      r.check('seat records are handles only (vault:/profile:)', JSON.stringify(seat).includes(fixture.credential.password), false);
      r.metrics = { fixtureLogins: fixture.stats.logins, failedLogins: fixture.stats.failedLogins, journalBytes: journal.length, reopenedRuns: reopened.list('runs').length };
      reopened.close();
      return verdictFrom(r, 'login stayed a human (emulated) step; restarts restored the owned session best-effort; expiry forced re-login; no credential material reached AWRM storage');
    } finally {
      await fixture.close();
      tmp.cleanup();
    }
  });
