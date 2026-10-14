# Accounts, seats and security

## Rules AWRM follows

* **Login, MFA, CAPTCHA, passkeys and consent are human steps** in the
  provider's own first-party UI. AWRM never types credentials into a site,
  never solves CAPTCHAs, and reports `human-login-required` instead.
* **No camouflage.** No stealth plugins, fingerprint spoofing, human-like fake
  timing, proxy or identity rotation, cookie forwarding or reverse-engineered
  consumer endpoints. If automation of a surface is not permitted, the port is
  disabled — the work continues on permitted ports.
* **No quota evasion.** Seats that are views of one account share one
  `quotaKey`. A denied, exhausted or rate-limited call is never re-sent through
  another seat or account (E006, X001).
* **Never asked in chat.** Passwords and keys are never requested in chat or
  written into prompts, logs, URLs, Marks, results or the store.

## Seats are handles

A `SeatRef` holds `seatId`, `provider`, `quotaKey`, allowed port kinds,
permission-record ids, and optional `credentialRef: "vault:<name>"` /
`profileRef`. Registration rejects any credential-shaped string anywhere in the
record (`checkSeat`). Records are frozen.

## Vault

`Vault.use(seat, handle, fn)` opens a secret **only** if `seat.credentialRef ===
handle`; any other seat gets `forbidden` (E003, E007). Secrets are `Secret`
objects whose `toJSON`, `toString` and `util.inspect` print `[REDACTED]`. The
default source is the environment (`AWRM_SECRET_<NAME>`); an OS keychain source
can implement the same two-method interface. Secrets are never exported to
remote workers (there are none).

## Browser profiles

The optional browser port uses a persistent Chromium profile directory named
by the seat. AWRM never reads cookies out of it. Requests to any origin not on
the port's allowlist are aborted. Profile restore is best-effort: server-side
expiry or logout wins and yields `human-login-required` (E003). The only code
that fills a login form is `emulateHumanLoginOnOwnedFixture`, which refuses
any non-loopback URL and exists to play the human's part in tests against the
owned fixture.

## Local API

Loopback-only bind (other hosts refused at start-up), bearer token compared in
constant time and stored at `$AWRM_HOME/api-token` mode 0600, Host header must
be a loopback name (DNS rebinding), any foreign `Origin` refused (CSRF), POST
bodies must be `application/json`, credentials in query strings refused,
responses carry no secrets. Tested in `tests/security/api-security.test.ts`.

## Untrusted content

Port output, page text, Pass content, URLs and SEURL descriptions are data. A
Pass or Keep is rendered between AWRM delimiters labelled *UNTRUSTED DATA*, and
any delimiter-looking text inside it is neutralised (bug found and fixed by
E010). Closed output types (enums, integers) cannot carry instructions; free
text is stored redacted and never interpreted. Nothing in the engine executes
model output, changes policy from it, or creates seats from it.

## Known limits

* The secret detector is pattern-based. E012's redaction Seed measured
  57% → 100% detection on a synthetic set by adding GitHub/Slack/AWS formats;
  that candidate is **not yet installed** (awaiting owner review).
* The Seed network guard patches in-process network primitives; it is a
  tripwire, not an OS sandbox.
* The API token gives full engine control to any local process that can read
  `$AWRM_HOME/api-token`.
