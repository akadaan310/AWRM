/**
 * awrm.bond — typed directed dependency between DMU outputs and inputs.
 * A Bond carries data and the upstream Mark digest. It never carries a seat,
 * port, budget or permission: each node runs under its own configured seat.
 */
import { AwrmError, LEXICON, validate, type BondSpec, type DmuDefinition, type JsonSchema } from '@awrm/core';

const BOND_SCHEMA = LEXICON.find((e) => e.id === 'awrm.bond')!.schema;

export interface PlanNode {
  id: string;
  dmuId: string;
  seatId: string;
  portId: string;
  /** Static input fields; Bond targets are filled in at run time. */
  input: Record<string, unknown>;
  /** Explicit Keep/Pass context for this node (data only). */
  context?: { keeps?: string[]; passes?: string[] };
}

export interface PlanSpec {
  planId: string;
  nodes: PlanNode[];
  bonds: BondSpec[];
  stop: { onFailure: 'halt' | 'continue-independent'; maxNodes: number };
}

/** Structural type compatibility: can every value valid under `from` be accepted by `to`? (conservative) */
export function schemaAssignable(from: JsonSchema, to: JsonSchema): { ok: boolean; why?: string } {
  const types = (s: JsonSchema): string[] | null => {
    if (s.enum) return [...new Set(s.enum.map((v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v)))];
    if (s.const !== undefined) return [typeof s.const];
    if (s.type) return Array.isArray(s.type) ? s.type : [s.type];
    return null;
  };
  const tf = types(from);
  const tt = types(to);
  if (!tt) return { ok: true };
  if (!tf) return { ok: false, why: 'source schema is untyped but target is typed' };
  for (const t of tf) {
    const ok = tt.includes(t) || (t === 'integer' && tt.includes('number'));
    if (!ok) return { ok: false, why: `${t} is not assignable to ${tt.join('|')}` };
  }
  if (tf.includes('array') && from.items && to.items) {
    const inner = schemaAssignable(from.items, to.items);
    if (!inner.ok) return { ok: false, why: `items: ${inner.why}` };
  }
  if (to.enum && from.enum && !from.enum.every((v) => to.enum!.some((w) => JSON.stringify(w) === JSON.stringify(v)))) return { ok: false, why: 'enum not a subset' };
  if (to.enum && !from.enum) return { ok: false, why: 'target requires an enum the source does not guarantee' };
  if (to.maxLength !== undefined && (from.maxLength === undefined || from.maxLength > to.maxLength)) return { ok: false, why: `source maxLength ${from.maxLength ?? '∞'} exceeds target ${to.maxLength}` };
  if (to.maxItems !== undefined && (from.maxItems === undefined || from.maxItems > to.maxItems)) return { ok: false, why: 'source maxItems exceeds target' };
  return { ok: true };
}

export interface PlanCheck {
  ok: boolean;
  order: string[];
  problems: string[];
}

export function checkPlan(plan: PlanSpec, dmus: (id: string) => DmuDefinition): PlanCheck {
  const problems: string[] = [];
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  if (nodes.size !== plan.nodes.length) problems.push('duplicate node ids');
  if (plan.nodes.length > plan.stop.maxNodes) problems.push(`plan has ${plan.nodes.length} nodes > maxNodes ${plan.stop.maxNodes}`);
  const forbiddenInputKeys = ['seatId', 'portId', 'credentials', 'permissionRecordIds', 'quotaKey'];
  for (const n of plan.nodes) {
    let d: DmuDefinition;
    try {
      d = dmus(n.dmuId);
    } catch {
      problems.push(`node ${n.id}: unknown DMU ${n.dmuId}`);
      continue;
    }
    for (const k of Object.keys(n.input)) {
      if (forbiddenInputKeys.includes(k)) problems.push(`node ${n.id}: input may not carry ${k}`);
      else if (!d.form.input.properties?.[k]) problems.push(`node ${n.id}: input field ${k} not in Form`);
    }
  }
  const targetFields = new Set<string>();
  for (const b of plan.bonds) {
    const v = validate(BOND_SCHEMA, b);
    if (!v.ok) {
      problems.push(`bond ${JSON.stringify(b)}: ${v.errors.map((e) => e.message).join(', ')}`);
      continue;
    }
    const fromN = nodes.get(b.from.node);
    const toN = nodes.get(b.to.node);
    if (!fromN || !toN) {
      problems.push(`bond ${b.from.node}→${b.to.node}: unknown node`);
      continue;
    }
    const key = `${b.to.node}.${b.to.field}`;
    if (targetFields.has(key)) problems.push(`bond target ${key} bound twice`);
    targetFields.add(key);
    if (forbiddenInputKeys.includes(b.to.field)) {
      problems.push(`bond ${b.from.node}→${key}: Bonds cannot set ${b.to.field} (authority is never data)`);
      continue;
    }
    let fromD: DmuDefinition, toD: DmuDefinition;
    try {
      fromD = dmus(fromN.dmuId);
      toD = dmus(toN.dmuId);
    } catch {
      continue;
    }
    const src = b.from.field === null ? fromD.form.output : fromD.form.output.properties?.[b.from.field];
    const dst = toD.form.input.properties?.[b.to.field];
    if (!src) problems.push(`bond ${b.from.node}.${b.from.field}: no such output field`);
    else if (!dst) problems.push(`bond →${key}: no such input field`);
    else {
      const a = schemaAssignable(src, dst);
      if (!a.ok) problems.push(`bond ${b.from.node}.${b.from.field ?? '*'}→${key}: ${a.why}`);
    }
  }
  // topological order (Kahn); a cycle leaves nodes unsorted
  const indeg = new Map(plan.nodes.map((n) => [n.id, 0]));
  for (const b of plan.bonds) if (indeg.has(b.to.node)) indeg.set(b.to.node, indeg.get(b.to.node)! + 1);
  const order: string[] = [];
  const ready = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const b of plan.bonds.filter((x) => x.from.node === id)) {
      indeg.set(b.to.node, indeg.get(b.to.node)! - 1);
      if (indeg.get(b.to.node) === 0) ready.push(b.to.node);
    }
  }
  if (order.length !== plan.nodes.length) problems.push('plan has a cycle');
  return { ok: problems.length === 0, order, problems };
}
