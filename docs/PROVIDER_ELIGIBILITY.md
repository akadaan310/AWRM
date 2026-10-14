# Provider eligibility (E004) — accessed 2026-10-14

**This is a recorded policy reading for engineering purposes, not a legal
ruling.** Terms change; re-check before relying on any row. The machine-readable
version is `packages/policy/src/providers.ts`; the Gate decides from it, and
anything not positively established is **denied**.

Access modes are kept distinct:
(a) a human using the consumer app, (b) an official programmatic API,
(c) an approved automation/connector, (d) an AWRM-owned fixture, (e) local inference.
A consumer login is not an API key and is not permission for browser automation.

## Matrix

| Provider | Mode | Status | Gate today | If the owner consents | Why |
|---|---|---|---|---|---|
| OpenAI | ChatGPT used by a human | not an AWRM port | n/a | n/a | AWRM never drives, reads or relays the consumer app. |
| OpenAI | ChatGPT web UI automation | **BLOCKED** | deny | deny (`provider-permission-not-established`) | Terms prohibit automated/programmatic extraction of data or Output and circumventing rate limits (see sources; live page returned 403 to the fetcher). |
| OpenAI | OpenAI API | UNKNOWN | deny | deny | Terms pages returned HTTP 403 to automated fetching on 2026-10-14; no port implemented; no key present. |
| Anthropic | Claude app used by a human | not an AWRM port | n/a | n/a | — |
| Anthropic | claude.ai web UI automation | **BLOCKED** | deny | deny | Consumer Terms §3 forbid access "through automated or non-human means, whether through a bot, script, or otherwise" except via an API key. |
| Anthropic | Claude API (Messages) | UNKNOWN (owner) | deny | **permit** — still needs a key in the vault and a configured quota | Permitted programmatic path under the Commercial Terms; paid; no free API tier published. Port implemented (`api.anthropic.messages`), wire-tested against an owned fake server, **NOT_RUN** live. |
| Google | Gemini app used by a human | not an AWRM port | n/a | n/a | — |
| Google | Gemini web UI automation | UNKNOWN ⇒ denied | deny | deny | Google ToS forbid bypassing protective measures and automated access in violation of machine-readable instructions; no affirmative permission found. |
| Google | Gemini API | UNKNOWN (owner) | deny | **permit** — still needs key + quota | A free ("unpaid") tier exists for developers for professional/business purposes, not consumer use; unpaid-tier content may be used to improve Google products and may be read by human reviewers; limits are per project. Port implemented (`api.google.gemini`), wire-tested offline, **NOT_RUN** live. |
| AWRM | Owned fixtures (in-process, chat over HTTP, chat in Chromium) | PERMITTED | permit | — | AWRM's own code and services. |
| AWRM | Local open-weight model (ONNX, `Xenova/flan-t5-small`, Apache-2.0) | PERMITTED | permit | — | Runs on local CPU after a one-time public weight download. |

The "If the owner consents" column is produced by `awrm providers assess`, which
evaluates the same Gate with `ownerPermission: 'granted'`. It shows that owner
consent alone never unlocks consumer-UI automation.

## Sources and quotes

| Source | Effective / updated | Quote or note |
|---|---|---|
| Anthropic Consumer Terms — https://www.anthropic.com/legal/consumer-terms | Effective October 8, 2025 | §3 item 7: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, … to access the Services through automated or non-human means, whether through a bot, script, or otherwise." §3 item 4: "To crawl, scrape, or otherwise harvest data or information from our Services other than as permitted under these Terms." §3: "…bypassing any of our systems or protective measures." §2: "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else." |
| Anthropic Commercial Terms — https://www.anthropic.com/legal/commercial-terms | Effective June 17, 2025 | "They govern Customer's use of Anthropic API keys and any other Anthropic offerings that references these Terms"; "Services under these Terms are not for consumer use." |
| Claude API rate limits — https://platform.claude.com/docs/en/api/rate-limits | no date shown | Tiers Evaluation, Start, Build, Scale, Custom; no free tier shown. |
| Google Terms of Service — https://policies.google.com/terms | Effective July 30, 2026 | "using automated means to access content from any of our services in violation of the machine-readable instructions on our web pages"; "spamming, hacking, or bypassing our systems or protective measures"; "creating fake accounts". |
| Google Generative AI Prohibited Use Policy — https://policies.google.com/terms/generative-ai/use-policy | Last modified December 17, 2024 | "Circumvention of abuse protections or safety filters". |
| Gemini API Additional Terms — https://ai.google.dev/gemini-api/terms | Effective March 23, 2026 | "Use of Google AI Studio and Gemini API is for developers building with Google AI models for professional or business purposes, not for consumer use."; unpaid services: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products"; "Do not submit sensitive, confidential, or personal information to the Unpaid Services." |
| Gemini API rate limits — https://ai.google.dev/gemini-api/docs/rate-limits | Updated 2026-10-13 | A Free tier exists ("Active project or free trial"); "Rate limits are applied per project, not per API key." Per-model free numbers are shown only in AI Studio — **not recorded here, therefore unknown to AWRM**. |
| OpenAI Terms of Use — https://openai.com/policies/terms-of-use/ | **UNCONFIRMED** — HTTP 403 to the fetcher on 2026-10-14 | Search results for OpenAI's own revision page (https://openai.com/policies/row-terms-of-use/revisions/2024-12-11/) summarise prohibitions on automatically or programmatically extracting data or Output and on circumventing rate limits or protective measures. Current wording not verified. |
| OpenAI Service Terms — https://openai.com/policies/service-terms/ | **UNCONFIRMED** (403) | — |

## What AWRM does with this

* Consumer-UI ports exist only as `DisabledConsumerPort` objects whose `invoke()`
  throws; E004 shows every run aimed at them ends `denied` before a Turn, with
  **zero** network requests.
* API ports exist and are wire-tested against owned fake servers. They run only
  after the owner (1) records consent in a permission record, (2) puts a key in
  the vault (`AWRM_SECRET_<NAME>`), and (3) configures a known quota. Unknown
  quota ⇒ denied.
* No step asks the owner to copy responses, move tabs or run manual browser
  chores. Where a provider requires a human sign-in, AWRM reports
  `human-login-required` and stops; it never types credentials or solves a
  CAPTCHA.
