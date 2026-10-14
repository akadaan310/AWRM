/**
 * OPTIONAL approved-browser port (Playwright, Chromium).
 *
 * Scope is deliberately narrow:
 *  - it only navigates to origins on an explicit allowlist (owned fixtures by
 *    default); every other request from the page is aborted;
 *  - it never types credentials and never solves CAPTCHAs: if the page
 *    redirects to a login, it reports `human-login-required`;
 *  - no stealth, fingerprint spoofing, human-like timing or anti-bot evasion;
 *  - the persistent profile directory is a handle owned by the seat; AWRM
 *    never reads cookies out of it.
 *
 * Several pages ("virtual views") on one profile share one seat and one quota.
 * Nothing in the kernel imports this package.
 */
import type { PortManifest, SeatRef } from '@awrm/core';
import type { AwrmPort, PortEvent, PortInvocation, PortPermission } from '@awrm/ports';

type PwContext = {
  newPage(): Promise<PwPage>;
  route(url: string, handler: (route: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => Promise<void>): Promise<void>;
  close(): Promise<void>;
  pages(): PwPage[];
};
type PwPage = {
  goto(url: string, o?: { waitUntil?: string }): Promise<unknown>;
  url(): string;
  fill(sel: string, v: string): Promise<void>;
  click(sel: string): Promise<void>;
  evaluate<T>(fn: string | ((arg: any) => T), arg?: unknown): Promise<T>;
  waitForFunction(fn: string, arg?: unknown, o?: { timeout?: number }): Promise<unknown>;
  textContent(sel: string): Promise<string | null>;
  getAttribute(sel: string, name: string): Promise<string | null>;
  waitForURL(u: string): Promise<void>;
  close(): Promise<void>;
};

export interface BrowserPortOptions {
  id: string;
  startUrl: string; // the chat page of an allowlisted origin
  allowedOrigins: string[];
  profileDir: string;
  executablePath?: string;
  headless?: boolean;
}

export function browserAvailable(): { ok: boolean; reason: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    import.meta.resolve('playwright-core');
    return { ok: true, reason: 'playwright-core resolvable' };
  } catch (e) {
    return { ok: false, reason: `playwright-core not installed: ${(e as Error).message}` };
  }
}

export function defaultChromium(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  return `${base}/chromium-1194/chrome-linux/chrome`;
}

export class BrowserChatPort implements AwrmPort {
  readonly kind = 'approved-browser' as const;
  readonly id: string;
  private ctx: PwContext | null = null;
  private starting: Promise<PwContext> | null = null;
  views = 0;

  constructor(private o: BrowserPortOptions) {
    this.id = o.id;
    const origin = new URL(o.startUrl).origin;
    if (!o.allowedOrigins.includes(origin)) throw new Error(`start URL origin ${origin} is not allowlisted`);
  }

  async describe(): Promise<PortManifest> {
    const loopback = this.o.allowedOrigins.every((o) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o));
    return {
      id: this.id,
      kind: 'approved-browser',
      label: `Chromium (Playwright) restricted to ${this.o.allowedOrigins.join(', ')}`,
      liveness: loopback ? 'owned-fixture' : 'external-live',
      provider: loopback ? 'awrm-local' : 'unapproved',
      network: loopback ? 'loopback' : 'external',
      sideEffects: loopback ? 'none' : 'unknown',
      streaming: false,
      model: 'owned-chat-fixture@1 via browser',
      notes: 'No credential entry, no CAPTCHA handling, no stealth. Login is a human step.',
    };
  }

  async assess(seat: SeatRef): Promise<PortPermission> {
    return seat.profileRef ? { available: true, reason: 'seat has an isolated profile handle' } : { available: false, reason: 'seat has no profile handle' };
  }

  private async context(): Promise<PwContext> {
    if (this.ctx) return this.ctx;
    this.starting ??= (async () => {
      const pw = (await import('playwright-core')) as unknown as {
        chromium: { launchPersistentContext(dir: string, o: Record<string, unknown>): Promise<PwContext> };
      };
      const ctx = await pw.chromium.launchPersistentContext(this.o.profileDir, {
        headless: this.o.headless ?? true,
        executablePath: this.o.executablePath ?? defaultChromium(),
        args: ['--no-first-run'],
      });
      await ctx.route('**/*', async (route) => {
        const origin = safeOrigin(route.request().url());
        if (origin && this.o.allowedOrigins.includes(origin)) await route.continue();
        else await route.abort();
      });
      this.ctx = ctx;
      return ctx;
    })();
    return this.starting;
  }

  async *invoke(req: PortInvocation, signal: AbortSignal): AsyncIterable<PortEvent> {
    const ctx = await this.context();
    const page = await ctx.newPage();
    this.views++;
    const onAbort = (): void => void page.close().catch(() => {});
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await page.goto(this.o.startUrl, { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).pathname.includes('login')) {
        yield { type: 'error', code: 'human-login-required', message: 'the site requires a human sign-in in this profile', retryable: false };
        return;
      }
      if (req.prompt.system) await page.evaluate(`document.getElementById('system').value = ${JSON.stringify(req.prompt.system)}`);
      await page.fill('#prompt', req.prompt.user);
      await page.click('#send');
      await page.waitForFunction("['done','error'].includes(document.getElementById('answer').dataset.state)", undefined, { timeout: Math.max(1000, req.deadlineMs) });
      const state = await page.getAttribute('#answer', 'data-state');
      if (state === 'error') {
        const status = await page.getAttribute('#answer', 'data-status');
        if (status === '429') {
          const ra = await page.getAttribute('#answer', 'data-retry-after');
          yield { type: 'rate-limited', retryAfterMs: ra ? Number(ra) * 1000 : null };
          return;
        }
        if (status === '401') {
          yield { type: 'error', code: 'human-login-required', message: 'session expired; a human must sign in again', retryable: false };
          return;
        }
        yield { type: 'error', code: `page-error-${status ?? 'stream'}`, message: 'chat page reported an error', retryable: false };
        return;
      }
      const text = (await page.textContent('#answer')) ?? '';
      yield { type: 'final', text, model: 'owned-chat-fixture@1 via browser' };
    } finally {
      signal.removeEventListener('abort', onAbort);
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.starting = null;
  }
}

/**
 * Test-harness helper that plays the *human's* part on an OWNED fixture:
 * opens the login page in the seat's profile and submits the fixture's test
 * credential. Refuses any non-loopback origin — it must never be pointed at a
 * real provider.
 */
export async function emulateHumanLoginOnOwnedFixture(o: { profileDir: string; fixtureUrl: string; username: string; password: string; executablePath?: string }): Promise<void> {
  const u = new URL(o.fixtureUrl);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('emulated login is only for owned loopback fixtures');
  const pw = (await import('playwright-core')) as unknown as { chromium: { launchPersistentContext(dir: string, o: Record<string, unknown>): Promise<PwContext> } };
  const ctx = await pw.chromium.launchPersistentContext(o.profileDir, { headless: true, executablePath: o.executablePath ?? defaultChromium() });
  try {
    const page = await ctx.newPage();
    await page.goto(new URL('/login', o.fixtureUrl).toString());
    await page.fill('#username', o.username);
    await page.fill('#password', o.password);
    await page.click('#login');
    await page.waitForURL('**/chat');
  } finally {
    await ctx.close();
  }
}

function safeOrigin(u: string): string | null {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}
