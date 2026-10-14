/** E006 — Quota confinement: views on one account never amplify allowance (H-5, AX-5). */
import { localSeat } from '@awrm/identity';
import { RulePort } from '@awrm/ports';
import { Fleet } from '@awrm/scheduler';
import { startOwnedChat } from '@awrm/fixtures';
import { OwnedChatHttpPort } from '@awrm/ports';
import { freshEngine, runExperiment, tempDir, verdictFrom } from '../harness';

export const E006 = () =>
  runExperiment({ id: 'E006', title: 'Quota confinement: 4 views on 1 account vs 4 independent resources', hypotheses: ['H-5', 'AX-5'] }, async (r) => {
    const { kernel, secrets } = await freshEngine({ seats: [] });
    await kernel.registerPort(new RulePort({ id: 'view-port', latencyMs: 5 }));
    // Case A: four views (seats/lanes) of ONE account → shared quotaKey with 3 calls.
    for (let i = 1; i <= 4; i++) kernel.seats.register(localSeat(`acct1-view${i}`, { quotaKey: 'sim:account-1' }));
    kernel.ledger.configure({ quotaKey: 'sim:account-1', limit: 3, windowMs: null, source: 'simulated owner allowance: 3 calls' });
    const fleetA = new Fleet(kernel, { lanes: [1, 2, 3, 4].map((i) => ({ laneId: `v${i}`, portId: 'view-port', seatId: `acct1-view${i}`, concurrency: 2 })), globalCap: 8, maxQueue: 32 });
    const resA = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => fleetA.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} × 2?` } })));
    const runsA = resA.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
    const completedA = runsA.filter((x) => x.state === 'completed').length;
    const deniedA = runsA.filter((x) => x.state === 'denied').length;
    r.check('case A: exactly 3 calls admitted for 4 views of one account', completedA, 3);
    r.check('case A: the rest denied or not dispatched (never rerouted)', completedA + deniedA + resA.filter((x) => x.status === 'rejected').length, 12);
    r.check('case A: ledger used = 3', kernel.ledger.snapshot('sim:account-1')?.used, 3);
    r.metrics.caseA = { completed: completedA, denied: deniedA, notDispatched: resA.filter((x) => x.status === 'rejected').length, capacity: fleetA.capacity() };

    // Case B: four independent simulated resources, 3 calls each → 12.
    for (let i = 1; i <= 4; i++) {
      kernel.seats.register(localSeat(`res${i}`, { quotaKey: `sim:resource-${i}` }));
      kernel.ledger.configure({ quotaKey: `sim:resource-${i}`, limit: 3, windowMs: null, source: 'simulated independent resource' });
    }
    const fleetB = new Fleet(kernel, { lanes: [1, 2, 3, 4].map((i) => ({ laneId: `r${i}`, portId: 'view-port', seatId: `res${i}`, concurrency: 2 })), globalCap: 8, maxQueue: 32 });
    const resB = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => fleetB.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} × 5?` }, laneId: `r${(i % 4) + 1}` })));
    const completedB = resB.filter((x) => x.status === 'fulfilled' && x.value.state === 'completed').length;
    r.check('case B: 4 independent resources × 3 = 12 admitted', completedB, 12);

    // Case C: provider 429 is a hard stop — subsequent calls denied, not shifted to another identity.
    const fixture = await startOwnedChat({ rateLimit: { limit: 2, windowMs: 60_000 } });
    const tmp = tempDir('e006');
    try {
      const s = kernel.seats.register(localSeat('rl-seat', { credentialRef: 'vault:rl', quotaKey: 'fixture:rl' }));
      kernel.ledger.configure({ quotaKey: s.quotaKey, limit: 100, windowMs: 60_000, source: 'owner-configured ceiling (fixture enforces 2/min)' });
      secrets.set('rl', `${fixture.credential.username}:${fixture.credential.password}`);
      await kernel.registerPort(new OwnedChatHttpPort('rl-http', fixture.url));
      const states: string[] = [];
      for (let i = 0; i < 5; i++) {
        const run = await kernel.run({ dmuId: 'math.check.v1', input: { question: `What is ${i} + 4?` }, seatId: 'rl-seat', portId: 'rl-http' });
        states.push(`${run.state}:${run.error?.code ?? run.gate?.code ?? ''}`);
      }
      r.check('case C: 2 complete, then 429 recorded, then hard stop (denied: rate-limited)', states, ['completed:permit', 'completed:permit', 'failed:rate-limited', 'denied:gate-denied', 'denied:gate-denied']);
      r.check('case C: fixture saw exactly one 429 (no hammering after the signal)', fixture.stats.rateLimited, 1);
      r.metrics.caseC = { states, fixtureChats: fixture.stats.chats };

      // Case D: browser "virtual views" — 4 tabs on one profile share the seat's allowance.
      if (process.env.AWRM_SKIP_BROWSER === '1') r.blocked.push({ path: 'browser virtual views', status: 'NOT_RUN', reason: 'AWRM_SKIP_BROWSER=1' });
      else {
        try {
          const bp = await import('@awrm/browser-port');
          const fx2 = await startOwnedChat();
          await bp.emulateHumanLoginOnOwnedFixture({ profileDir: `${tmp.dir}/p`, fixtureUrl: fx2.url, ...fx2.credential });
          const port = new bp.BrowserChatPort({ id: 'views', startUrl: `${fx2.url}/chat`, allowedOrigins: [fx2.url], profileDir: `${tmp.dir}/p` });
          await kernel.registerPort(port);
          const vs = kernel.seats.register(localSeat('browser-acct', { profileRef: `profile:${tmp.dir}/p`, quotaKey: 'fixture:browser-acct' }));
          kernel.ledger.configure({ quotaKey: vs.quotaKey, limit: 3, windowMs: null, source: 'simulated 3-call allowance' });
          const fleetD = new Fleet(kernel, { lanes: [{ laneId: 'tabs', portId: 'views', seatId: 'browser-acct', concurrency: 4 }], globalCap: 4, maxQueue: 16 });
          const resD = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => fleetD.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} × 7?` } })));
          const done = resD.filter((x) => x.status === 'fulfilled' && x.value.state === 'completed').length;
          r.check('case D: 4 browser tabs on one profile → 3 admitted', done, 3);
          r.metrics.caseD = { completed: done, tabsOpened: port.views, maxInFlight: fleetD.stats.maxInFlightObserved };
          await port.close();
          await fx2.close();
        } catch (e) {
          r.blocked.push({ path: 'browser virtual views', status: 'NOT_RUN', reason: (e as Error).message.split('\n')[0]! });
        }
      }
    } finally {
      await fixture.close();
      tmp.cleanup();
    }
    return verdictFrom(r, 'shared quota keys capped admitted calls at the allowance regardless of views; independent resources scaled; a 429 stopped the key');
  });
