/**
 * awrm.turn and the run state machine. Illegal transitions throw; there is no
 * path from a terminal state anywhere else (a timed-out Turn cannot later
 * become a success).
 */
import { AwrmError, type RunState, type TurnState } from '@awrm/core';

export const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  registered: ['eligible', 'failed', 'denied', 'cancelled'],
  eligible: ['queued', 'denied', 'cancelled'],
  queued: ['running', 'denied', 'cancelled', 'failed'],
  running: ['validating', 'queued', 'failed', 'denied', 'cancelled'], // queued = retry / crash recovery of side-effect-free work
  validating: ['completed', 'failed', 'queued'],
  completed: [],
  failed: [],
  denied: [],
  cancelled: [],
};

export const TURN_TRANSITIONS: Record<TurnState, TurnState[]> = {
  pending: ['running', 'cancelled', 'failure'],
  running: ['success', 'failure', 'cancelled'],
  success: [],
  failure: [],
  cancelled: [],
};

export function checkRunTransition(from: RunState, to: RunState): void {
  if (!RUN_TRANSITIONS[from].includes(to)) throw new AwrmError('illegal-transition', `run ${from} → ${to}`);
}

export function checkTurnTransition(from: TurnState, to: TurnState): void {
  if (!TURN_TRANSITIONS[from].includes(to)) throw new AwrmError('illegal-transition', `turn ${from} → ${to}`);
}
