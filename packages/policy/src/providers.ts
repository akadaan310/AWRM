/**
 * Provider eligibility matrix (E004). Data only — the Gate decides from it.
 * Every record carries its documentary evidence and access date. Anything not
 * positively established stays 'unknown' and is therefore denied.
 *
 * Re-check before relying on it: terms change. Sources were fetched on
 * 2026-10-14 unless noted. OpenAI's policy pages returned HTTP 403 to the
 * fetcher on that date; the OpenAI rows cite the last revision that was
 * retrievable and are marked accordingly.
 */
import type { PermissionRecord } from '@awrm/core';

const D = '2026-10-14';

export type AccessMode = 'consumer-human' | 'consumer-automation' | 'official-api' | 'approved-connector' | 'owned-fixture' | 'local-inference';

export interface EligibilityRow {
  provider: 'openai' | 'anthropic' | 'google' | 'awrm-local';
  product: string;
  mode: AccessMode;
  status: 'permitted' | 'blocked' | 'unknown' | 'not-an-awrm-port';
  awrmPort: string | null;
  summary: string;
  record: PermissionRecord | null;
}

const rec = (r: Omit<PermissionRecord, 'decidedAt' | 'operations'> & { operations?: PermissionRecord['operations'] }): PermissionRecord => ({
  operations: ['prompt', 'observe'],
  decidedAt: `${D}T00:00:00.000Z`,
  ...r,
});

export const ELIGIBILITY: readonly EligibilityRow[] = [
  // ---------------- OpenAI ----------------
  {
    provider: 'openai', product: 'ChatGPT (chatgpt.com, apps)', mode: 'consumer-human', status: 'not-an-awrm-port', awrmPort: null,
    summary: 'A human using their own account in the first-party app. AWRM does not drive, read or relay this surface.', record: null,
  },
  {
    provider: 'openai', product: 'ChatGPT web UI', mode: 'consumer-automation', status: 'blocked', awrmPort: 'consumer.openai.chatgpt (disabled)',
    summary: 'Terms prohibit automated/programmatic extraction of data or Output and circumventing rate limits/protective measures. Live page returned 403 on 2026-10-14; current wording UNCONFIRMED, last retrievable revision 2024-12-11.',
    record: rec({
      id: 'perm.openai.consumer-web', provider: 'openai', portKind: 'approved-browser', method: 'consumer-web-ui-automation',
      ownerPermission: 'unknown', providerPermission: 'prohibited',
      evidence: [
        { source: 'OpenAI Terms of Use (current)', url: 'https://openai.com/policies/terms-of-use/', accessed: D, note: 'HTTP 403 to automated fetcher; text UNCONFIRMED' },
        { source: 'OpenAI Terms of Use, revision 2024-12-11', url: 'https://openai.com/policies/row-terms-of-use/revisions/2024-12-11/', accessed: D, note: 'search-result summary: prohibits automatically or programmatically extracting data or Output; prohibits circumventing rate limits or restrictions or bypassing protective measures' },
      ],
    }),
  },
  {
    provider: 'openai', product: 'OpenAI API', mode: 'official-api', status: 'unknown', awrmPort: null,
    summary: 'The documented programmatic path, but paid/credited and governed by separate terms that could not be fetched (403). No key present. Not implemented as a port in this build.',
    record: rec({
      id: 'perm.openai.api', provider: 'openai', portKind: 'official-api', method: 'openai-api',
      ownerPermission: 'unknown', providerPermission: 'unknown',
      evidence: [{ source: 'OpenAI Service Terms', url: 'https://openai.com/policies/service-terms/', accessed: D, note: 'HTTP 403; UNCONFIRMED' }],
    }),
  },
  // ---------------- Anthropic ----------------
  {
    provider: 'anthropic', product: 'Claude (claude.ai, apps)', mode: 'consumer-human', status: 'not-an-awrm-port', awrmPort: null,
    summary: 'Human use of the first-party app. Not an AWRM port.', record: null,
  },
  {
    provider: 'anthropic', product: 'claude.ai web UI', mode: 'consumer-automation', status: 'blocked', awrmPort: 'consumer.anthropic.claude-ai (disabled)',
    summary: 'Consumer Terms §3 prohibit access "through automated or non-human means, whether through a bot, script, or otherwise" except via an API key, and crawling/scraping.',
    record: rec({
      id: 'perm.anthropic.consumer-web', provider: 'anthropic', portKind: 'approved-browser', method: 'consumer-web-ui-automation',
      ownerPermission: 'unknown', providerPermission: 'prohibited',
      evidence: [
        { source: 'Anthropic Consumer Terms of Service (effective October 8, 2025)', url: 'https://www.anthropic.com/legal/consumer-terms', accessed: D, quote: 'Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, … to access the Services through automated or non-human means, whether through a bot, script, or otherwise.' },
        { source: 'Anthropic Consumer Terms §3 item 4', url: 'https://www.anthropic.com/legal/consumer-terms', accessed: D, quote: 'To crawl, scrape, or otherwise harvest data or information from our Services other than as permitted under these Terms.' },
      ],
    }),
  },
  {
    provider: 'anthropic', product: 'Claude API (Messages)', mode: 'official-api', status: 'unknown', awrmPort: 'api.anthropic.messages',
    summary: 'Permitted programmatic path under the Commercial Terms (API keys). Paid usage; no free API tier is published on the rate-limits page. Owner has not supplied a key or accepted terms in this environment ⇒ owner permission unknown ⇒ denied; NOT_RUN.',
    record: rec({
      id: 'perm.anthropic.api', provider: 'anthropic', portKind: 'official-api', method: 'messages-api',
      ownerPermission: 'unknown', providerPermission: 'permitted',
      evidence: [
        { source: 'Anthropic Commercial Terms (effective June 17, 2025)', url: 'https://www.anthropic.com/legal/commercial-terms', accessed: D, quote: "They govern Customer's use of Anthropic API keys and any other Anthropic offerings that references these Terms" },
        { source: 'Claude API rate limits', url: 'https://platform.claude.com/docs/en/api/rate-limits', accessed: D, note: 'tiers Evaluation/Start/Build/Scale/Custom; no free tier shown' },
      ],
    }),
  },
  // ---------------- Google ----------------
  {
    provider: 'google', product: 'Gemini Apps (gemini.google.com)', mode: 'consumer-human', status: 'not-an-awrm-port', awrmPort: null,
    summary: 'Human use of the first-party app. Not an AWRM port.', record: null,
  },
  {
    provider: 'google', product: 'Gemini Apps web UI', mode: 'consumer-automation', status: 'unknown', awrmPort: 'consumer.google.gemini (disabled)',
    summary: 'Google ToS (effective July 30, 2026) forbid bypassing protective measures and automated access in violation of machine-readable instructions; no permission for UI automation was found. Unknown ⇒ denied.',
    record: rec({
      id: 'perm.google.consumer-web', provider: 'google', portKind: 'approved-browser', method: 'consumer-web-ui-automation',
      ownerPermission: 'unknown', providerPermission: 'unknown',
      evidence: [
        { source: 'Google Terms of Service (effective July 30, 2026)', url: 'https://policies.google.com/terms', accessed: D, quote: 'using automated means to access content from any of our services in violation of the machine-readable instructions on our web pages' },
        { source: 'Google Terms of Service', url: 'https://policies.google.com/terms', accessed: D, quote: 'spamming, hacking, or bypassing our systems or protective measures' },
      ],
    }),
  },
  {
    provider: 'google', product: 'Gemini API', mode: 'official-api', status: 'unknown', awrmPort: 'api.google.gemini',
    summary: 'A free ("unpaid") tier with per-project limits exists for developers for professional/business purposes, not consumer use; unpaid-tier content may be used to improve Google products and reviewed by humans. No key present and owner has not accepted ⇒ denied; NOT_RUN.',
    record: rec({
      id: 'perm.google.gemini-api', provider: 'google', portKind: 'official-api', method: 'gemini-api',
      ownerPermission: 'unknown', providerPermission: 'permitted',
      evidence: [
        { source: 'Gemini API Additional Terms (effective March 23, 2026)', url: 'https://ai.google.dev/gemini-api/terms', accessed: D, quote: 'Use of Google AI Studio and Gemini API is for developers building with Google AI models for professional or business purposes, not for consumer use.' },
        { source: 'Gemini API rate limits (updated 2026-10-13)', url: 'https://ai.google.dev/gemini-api/docs/rate-limits', accessed: D, quote: 'Rate limits are applied per project, not per API key.' },
      ],
    }),
  },
  // ---------------- AWRM-owned ----------------
  {
    provider: 'awrm-local', product: 'Owned fixtures (in-process, owned-chat HTTP, owned-chat browser)', mode: 'owned-fixture', status: 'permitted', awrmPort: 'owned-fixture, owned-chat-http, owned-chat-browser',
    summary: 'AWRM-owned code and services under test control.', record: null,
  },
  {
    provider: 'awrm-local', product: 'Local open-weight models (ONNX via transformers.js)', mode: 'local-inference', status: 'permitted', awrmPort: 'onnx-local',
    summary: 'Executed on local CPU; model licences recorded on each port manifest.', record: null,
  },
];

export function providerPermissionRecords(): PermissionRecord[] {
  return ELIGIBILITY.flatMap((r) => (r.record ? [r.record] : []));
}
