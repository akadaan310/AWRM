/**
 * awrm.dmu — Dark Matter Unit: one independently typed and authorised
 * prompt↔response computation  U = (I, O, C, S, G, B, V, E).
 *
 *  I,O  → form.input / form.output           (Form)
 *  C    → form.context + prompt template     (bounded context construction)
 *  S    → explicit Keep/Pass refs per run    (never vendor hidden state)
 *  G    → evaluated by @awrm/policy at run time (not stored in the definition)
 *  B    → budget                             (per-run defaults)
 *  V    → allowedPortKinds                   (chosen per run)
 *  E    → every terminal outcome emits a Mark (@awrm/evidence)
 *
 * A DMU definition is pure data so it can be registered over the API.
 */
import { deepFreeze, digest } from './canonical';
import { AwrmError } from './errors';
import { defineForm, type Form, type FormSpec } from './form';
import type { ParseSpec } from './parse';
import type { BudgetSpec, PortKind } from './types';

export interface DmuSpec {
  id: string; // e.g. 'math.check.v1'
  version: number;
  title: string;
  description: string;
  form: FormSpec;
  prompt: { system?: string; template: string };
  parse: ParseSpec;
  budget: BudgetSpec;
  allowedPortKinds: PortKind[];
  example: { input: unknown; output: unknown };
}

export interface DmuDefinition extends Omit<DmuSpec, 'form'> {
  form: Form;
  readonly digest: string;
}

const DMU_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*\.v[0-9]+$/;
const PORT_KINDS: PortKind[] = ['local-model', 'official-api', 'approved-browser', 'owned-fixture'];
export const BUDGET_CEILING: BudgetSpec = { maxCalls: 8, maxWallMs: 120_000, maxOutputChars: 20_000, maxRetries: 3 };

export function defineDmu(spec: DmuSpec): DmuDefinition {
  const problems: string[] = [];
  if (!DMU_ID.test(spec.id)) problems.push('id must look like "name.part.v1"');
  for (const v of templateVariables(spec.prompt.template)) {
    const field = v.startsWith('input.') ? v.slice(6) : null;
    if (v !== 'context' && !(field && spec.form.input.properties && field in spec.form.input.properties)) problems.push(`template variable {{${v}}} is not context or a declared input field`);
  }
  for (const k of spec.allowedPortKinds) if (!PORT_KINDS.includes(k)) problems.push(`unknown port kind ${k}`);
  const b = spec.budget;
  if (!(b.maxCalls >= 1 && b.maxCalls <= BUDGET_CEILING.maxCalls)) problems.push('budget.maxCalls out of range');
  if (!(b.maxRetries >= 0 && b.maxRetries <= BUDGET_CEILING.maxRetries && b.maxRetries < b.maxCalls)) problems.push('budget.maxRetries out of range');
  if (!(b.maxWallMs > 0 && b.maxWallMs <= BUDGET_CEILING.maxWallMs)) problems.push('budget.maxWallMs out of range');
  if (!(b.maxOutputChars > 0 && b.maxOutputChars <= BUDGET_CEILING.maxOutputChars)) problems.push('budget.maxOutputChars out of range');
  if (problems.length) throw new AwrmError('invalid-definition', `invalid DMU ${spec.id}`, { problems });
  const form = defineForm(spec.form);
  const plain = JSON.parse(JSON.stringify({ ...spec, form: undefined })) as Omit<DmuSpec, 'form'>;
  const def = { ...plain, form };
  return deepFreeze({ ...def, digest: digest({ ...plain, form: form.digest }) });
}

/** Variables a template may reference: {{input.<field>}} and {{context}}. */
export function templateVariables(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]!);
}

export function renderPrompt(def: DmuDefinition, input: Record<string, unknown>, context: string): { system?: string; user: string } {
  const user = def.prompt.template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, name: string) => {
    if (name === 'context') return context;
    if (name.startsWith('input.')) {
      const v = input[name.slice(6)];
      if (v === undefined) return '';
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
    throw new AwrmError('invalid-definition', `unknown template variable ${name}`);
  });
  return def.prompt.system !== undefined ? { system: def.prompt.system, user } : { user };
}

/** The plain, registrable spec of a definition (digests stripped). */
export function toSpec(def: DmuDefinition): DmuSpec {
  const { digest: _d, form, ...rest } = JSON.parse(JSON.stringify(def)) as DmuDefinition & { form: Form };
  const { digest: _fd, ...formSpec } = form;
  return { ...(rest as Omit<DmuSpec, 'form'>), form: formSpec as FormSpec };
}
