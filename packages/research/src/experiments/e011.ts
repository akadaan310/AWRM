/** E011 — Failure and recovery: SIGKILL mid-Turn, restart, replay, no false success, no unsafe re-send (H-7). */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { RulePort } from '@awrm/ports';
import { createKernel } from '@awrm/runtime';
import { openStore } from '@awrm/store';
import { verifyMarkGraph } from '@awrm/evidence';
import { repoRoot, runExperiment, tempDir, verdictFrom } from '../harness';
import { UnknownEffectsPort } from './e011-ports';

export const E011 = () =>
  runExperiment({ id: 'E011', title: 'Crash mid-Turn, restart, reconcile, replay', hypotheses: ['H-7'] }, async (r) => {
    const tmp = tempDir('e011');
    try {
      const dir = join(tmp.dir, 'store');
      const child = spawn(process.execPath, ['--import', 'tsx', join(repoRoot(), 'packages/research/src/crash-worker.ts'), dir], { cwd: repoRoot(), stdio: ['ignore', 'pipe', 'pipe'] });
      const info = await new Promise<{ completed: string; a: string; b: string }>((resolve, reject) => {
        let buf = '';
        let err = '';
        child.stderr.on('data', (d) => (err += d));
        child.stdout.on('data', (d) => {
          buf += d;
          const line = buf.split('\n').find((l) => l.includes('"ready"'));
          if (line) resolve(JSON.parse(line));
        });
        child.on('exit', (c) => reject(new Error(`worker exited early (${c}): ${err.slice(0, 400)}`)));
        setTimeout(() => reject(new Error('worker did not become ready')), 30_000);
      });
      child.kill('SIGKILL');
      await new Promise((res) => child.once('exit', res));
      r.check('worker killed with SIGKILL mid-Turn', child.signalCode, 'SIGKILL');
      // Simulate a torn final write as well.
      appendFileSync(join(dir, 'journal.jsonl'), '{"c":"runs","id":"run_TORN","d":"{\\"state\\":');

      const store = openStore({ kind: 'jsonl', dir });
      r.check('journal reopened; torn tail tolerated', store.openReport.tornLines, 1);
      const kernel = createKernel({ store, localSeats: ['local-owner'] });
      const fast = new RulePort({ id: 'fast' });
      const slowLocal = new RulePort({ id: 'slow-local' }); // restarted worker is fast now
      const ext = new UnknownEffectsPort('slow-external-like', 0);
      for (const p of [fast, slowLocal, ext]) await kernel.registerPort(p);
      const pre = { a: kernel.getRun(info.a).state, b: kernel.getRun(info.b).state };
      r.check('both long runs were mid-flight (running) at crash', [pre.a, pre.b], ['running', 'running']);
      const report = kernel.recover();
      r.check('side-effect-free run requeued', report.requeued, [info.a]);
      r.check('unknown-side-effect run failed as ambiguous, not re-sent', report.ambiguous, [info.b]);
      const a = await kernel.execute(info.a);
      r.check('requeued run completes on a new attempt', [a.state, a.output, a.turns.length], ['completed', { answer: 42 }, 2]);
      const t1 = kernel.getTurn(a.turns[0]!)!;
      r.check('interrupted Turn recorded as failure(interrupted) with its own Mark', [t1.state, t1.error?.code, Boolean(t1.markDigest)], ['failure', 'interrupted', true]);
      const b = kernel.getRun(info.b);
      r.check('ambiguous run is terminal failed(ambiguous-side-effect)', [b.state, b.error?.code], ['failed', 'ambiguous-side-effect']);
      r.check('ambiguous run never re-invoked after restart', ext.invocations, 0);
      r.check('completed pre-crash run still completed (no duplicate)', [kernel.getRun(info.completed).state, kernel.getRun(info.completed).turns.length], ['completed', 1]);
      const keep = kernel.keeps.latest('last-square');
      r.check('Keep reconstructed from journal', keep?.content, { q: '12×12', a: 144 });
      r.check('Keeps verify against their producing Marks', kernel.keeps.verifyAll((d) => kernel.getMark(d)).ok, true);
      const g = verifyMarkGraph(kernel.listMarks());
      r.check('whole Mark graph verifies after restart', g.ok, true);
      r.check('torn record ignored (no phantom run)', kernel.listRuns().some((x) => x.runId === 'run_TORN'), false);
      r.metrics = { recoverReport: report, marks: g.checked, runs: kernel.listRuns().map((x) => ({ runId: x.runId, state: x.state, turns: x.turns.length, error: x.error?.code ?? null })) };
      r.mark(...kernel.listMarks().map((m) => m.digest));
      store.close();
      return verdictFrom(r, 'after SIGKILL, local work resumed exactly once, ambiguous external-like work was failed rather than re-sent, Keeps and Marks replayed intact');
    } finally {
      tmp.cleanup();
    }
  });
