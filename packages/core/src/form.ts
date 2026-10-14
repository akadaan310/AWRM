/**
 * awrm.form — the immutable, versioned input/output/context/error contract of a DMU.
 */
import { deepFreeze, digest } from './canonical';
import { AwrmError } from './errors';
import { checkSchema, validate, type JsonSchema, type ValidationResult } from './schema';

export interface FormSpec {
  formId: string; // e.g. 'form.math.check'
  version: number;
  input: JsonSchema;
  output: JsonSchema;
  context: { maxContextChars: number; acceptsKeeps: boolean; acceptsPasses: boolean };
  /** Failure codes this Form declares as legitimate terminal outcomes. */
  errors: string[];
}

export interface Form extends FormSpec {
  readonly digest: string;
}

const FORM_ID = /^form\.[a-z0-9][a-z0-9.-]{0,80}$/;

export function defineForm(spec: FormSpec): Form {
  const problems: string[] = [];
  if (!FORM_ID.test(spec.formId)) problems.push('formId must match ' + FORM_ID.source);
  if (!Number.isInteger(spec.version) || spec.version < 1) problems.push('version must be a positive integer');
  for (const e of checkSchema(spec.input, '#/input')) problems.push(`${e.path}: ${e.message}`);
  for (const e of checkSchema(spec.output, '#/output')) problems.push(`${e.path}: ${e.message}`);
  if (spec.output.type !== 'object') problems.push('output schema must be an object schema');
  if (spec.input.type !== 'object') problems.push('input schema must be an object schema');
  if (problems.length) throw new AwrmError('invalid-definition', 'invalid Form', { problems });
  const plain = JSON.parse(JSON.stringify(spec)) as FormSpec;
  return deepFreeze({ ...plain, digest: digest(plain) });
}

export function validateInput(form: Form, input: unknown): ValidationResult {
  return validate(form.input, input);
}

export function validateOutput(form: Form, output: unknown): ValidationResult {
  return validate(form.output, output);
}
