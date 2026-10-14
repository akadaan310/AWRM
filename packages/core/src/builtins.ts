/** Built-in DMU catalogue used by tests, experiments and the CLI demo. */
import { defineDmu, type DmuDefinition } from './dmu';
import type { BudgetSpec } from './types';

const LOCAL: BudgetSpec = { maxCalls: 2, maxWallMs: 30_000, maxOutputChars: 4_000, maxRetries: 1 };
export const CLASSIFY_LABELS = ['billing', 'shipping', 'technical', 'other'] as const;

export const mathCheck: DmuDefinition = defineDmu({
  id: 'math.check.v1',
  version: 1,
  title: 'Integer arithmetic check',
  description: 'One arithmetic question in, one integer answer out.',
  form: {
    formId: 'form.math.check',
    version: 1,
    input: {
      type: 'object',
      required: ['question'],
      additionalProperties: false,
      properties: {
        question: { type: 'string', minLength: 1, maxLength: 200 },
        response_format: { const: 'integer' },
      },
    },
    output: {
      type: 'object',
      required: ['answer'],
      additionalProperties: false,
      properties: { answer: { type: 'integer' }, explanation: { type: 'string', maxLength: 2000 } },
    },
    context: { maxContextChars: 2_000, acceptsKeeps: true, acceptsPasses: true },
    errors: ['timeout', 'refused', 'invalid-output', 'gate-denied', 'rate-limited', 'cancelled'],
  },
  prompt: { system: 'Answer with a single integer and nothing else.', template: '{{context}}Question: {{input.question}}\nAnswer:' },
  parse: { mode: 'integer', field: 'answer' },
  budget: LOCAL,
  allowedPortKinds: ['owned-fixture', 'local-model', 'official-api', 'approved-browser'],
  example: { input: { question: 'What is 17 × 23?', response_format: 'integer' }, output: { answer: 391 } },
});

export const textClassify: DmuDefinition = defineDmu({
  id: 'text.classify.v1',
  version: 1,
  title: 'Support-ticket topic classification',
  description: 'Assign exactly one label from a closed set to a short text.',
  form: {
    formId: 'form.text.classify',
    version: 1,
    input: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } },
    },
    output: {
      type: 'object',
      required: ['label'],
      additionalProperties: false,
      properties: { label: { enum: [...CLASSIFY_LABELS] } },
    },
    context: { maxContextChars: 2_000, acceptsKeeps: true, acceptsPasses: true },
    errors: ['timeout', 'refused', 'invalid-output', 'gate-denied', 'rate-limited', 'cancelled'],
  },
  prompt: {
    system: `Classify the text into exactly one of: ${CLASSIFY_LABELS.join(', ')}. Reply with the label only.`,
    template: '{{context}}Text: {{input.text}}\nLabel:',
  },
  parse: { mode: 'label', field: 'label', labels: [...CLASSIFY_LABELS] },
  budget: LOCAL,
  allowedPortKinds: ['owned-fixture', 'local-model', 'official-api', 'approved-browser'],
  example: { input: { text: 'The invoice is overdue.' }, output: { label: 'billing' } },
});

export const textSummarize: DmuDefinition = defineDmu({
  id: 'text.summarize.v1',
  version: 1,
  title: 'One-sentence summary',
  description: 'Summarise a text in at most 300 characters, optionally using passed context.',
  form: {
    formId: 'form.text.summarize',
    version: 1,
    input: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 8000 }, topic: { type: 'string', maxLength: 64 } },
    },
    output: {
      type: 'object',
      required: ['summary'],
      additionalProperties: false,
      properties: { summary: { type: 'string', minLength: 1, maxLength: 300 } },
    },
    context: { maxContextChars: 4_000, acceptsKeeps: true, acceptsPasses: true },
    errors: ['timeout', 'refused', 'invalid-output', 'gate-denied', 'rate-limited', 'cancelled'],
  },
  prompt: { system: 'Summarize in one sentence.', template: '{{context}}Summarize: {{input.text}}' },
  parse: { mode: 'text', field: 'summary' },
  budget: LOCAL,
  allowedPortKinds: ['owned-fixture', 'local-model', 'official-api', 'approved-browser'],
  example: { input: { text: 'The invoice is overdue and must be paid by Friday.' }, output: { summary: 'An overdue invoice must be paid by Friday.' } },
});

export const factsExtract: DmuDefinition = defineDmu({
  id: 'facts.extract.v1',
  version: 1,
  title: 'Fact extraction',
  description: 'Split a text into at most 8 atomic factual statements, one per line.',
  form: {
    formId: 'form.facts.extract',
    version: 1,
    input: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 8000 } } },
    output: {
      type: 'object',
      required: ['facts'],
      additionalProperties: false,
      properties: { facts: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 400 } } },
    },
    context: { maxContextChars: 0, acceptsKeeps: false, acceptsPasses: false },
    errors: ['timeout', 'invalid-output', 'gate-denied', 'cancelled'],
  },
  prompt: { system: 'List the facts, one per line.', template: 'Extract facts: {{input.text}}' },
  parse: { mode: 'lines', field: 'facts', maxLines: 8 },
  budget: LOCAL,
  allowedPortKinds: ['owned-fixture', 'local-model', 'official-api'],
  example: { input: { text: 'The invoice is overdue. Payment is due Friday.' }, output: { facts: ['The invoice is overdue.', 'Payment is due Friday.'] } },
});

export const factsCite: DmuDefinition = defineDmu({
  id: 'facts.cite.v1',
  version: 1,
  title: 'Attach citations to facts',
  description: 'Return each fact suffixed with a citation to its source label.',
  form: {
    formId: 'form.facts.cite',
    version: 1,
    input: {
      type: 'object',
      required: ['facts', 'source'],
      additionalProperties: false,
      properties: {
        facts: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 400 } },
        source: { type: 'string', minLength: 1, maxLength: 120 },
      },
    },
    output: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } },
    },
    context: { maxContextChars: 0, acceptsKeeps: false, acceptsPasses: false },
    errors: ['timeout', 'invalid-output', 'gate-denied', 'cancelled'],
  },
  prompt: { system: 'Cite each fact.', template: 'Cite these facts from {{input.source}}: {{input.facts}}' },
  parse: { mode: 'text', field: 'text' },
  budget: LOCAL,
  allowedPortKinds: ['owned-fixture', 'local-model', 'official-api'],
  example: { input: { facts: ['The invoice is overdue.'], source: 'ticket-1' }, output: { text: 'The invoice is overdue. [ticket-1]' } },
});

export const BUILTIN_DMUS: readonly DmuDefinition[] = [mathCheck, textClassify, textSummarize, factsExtract, factsCite];
