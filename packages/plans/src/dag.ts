/** Execute a checked plan in topological order. Each node is an ordinary kernel run. */
import { AwrmError, type RunRecord } from '@awrm/core';
import type { Kernel } from '@awrm/runtime';
import { checkPlan, type PlanSpec } from './bond';

export interface PlanResult {
  planId: string;
  ok: boolean;
  order: string[];
  runs: Record<string, RunRecord>;
  skipped: string[];
}

export async function executePlan(kernel: Kernel, plan: PlanSpec, signal?: AbortSignal): Promise<PlanResult> {
  const check = checkPlan(plan, (id) => kernel.getDmu(id));
  if (!check.ok) throw new AwrmError(check.problems.some((p) => p.includes('cycle')) ? 'plan-cycle' : 'bond-type-mismatch', 'plan rejected', { problems: check.problems });
  const runs: Record<string, RunRecord> = {};
  const skipped: string[] = [];
  const failed = new Set<string>();
  for (const id of check.order) {
    const node = plan.nodes.find((n) => n.id === id)!;
    const incoming = plan.bonds.filter((b) => b.to.node === id);
    if (incoming.some((b) => failed.has(b.from.node)) || (plan.stop.onFailure === 'halt' && failed.size)) {
      skipped.push(id);
      failed.add(id);
      continue;
    }
    const input: Record<string, unknown> = { ...node.input };
    const parents: string[] = [];
    for (const b of incoming) {
      const up = runs[b.from.node]!;
      const out = up.output as Record<string, unknown>;
      input[b.to.field] = b.from.field === null ? out : out[b.from.field];
      parents.push(up.markDigest!);
    }
    const run = await kernel.run({ dmuId: node.dmuId, input, seatId: node.seatId, portId: node.portId, parentMarks: parents, ...(node.context ? { context: node.context } : {}), actor: { id: plan.planId, kind: 'plan' }, tags: [`plan:${plan.planId}`, `node:${id}`] }, signal);
    runs[id] = run;
    if (run.state !== 'completed') failed.add(id);
  }
  return { planId: plan.planId, ok: failed.size === 0, order: check.order, runs, skipped };
}
