import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRunTransition, checkTurnTransition, RUN_TRANSITIONS } from '@awrm/runtime';

test('awrm.turn positive: legal lifecycle', () => {
  checkTurnTransition('pending', 'running');
  checkTurnTransition('running', 'success');
  checkRunTransition('registered', 'eligible');
  checkRunTransition('validating', 'completed');
});
test('awrm.turn negative: terminal states are absorbing (timeout cannot become success)', () => {
  assert.throws(() => checkTurnTransition('failure', 'success'));
  assert.throws(() => checkTurnTransition('cancelled', 'running'));
  for (const t of ['completed', 'failed', 'denied', 'cancelled'] as const) assert.deepEqual(RUN_TRANSITIONS[t], []);
  assert.throws(() => checkRunTransition('failed', 'completed'));
  assert.throws(() => checkRunTransition('queued', 'completed'));
});
