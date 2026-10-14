/**
 * Quota ledger keyed by quotaKey (an account / resource allowance), never by
 * view, tab, profile or lane: many views of one account share one key (AX-5).
 * Reservations are taken atomically before invocation and either committed
 * (counted) or released (not counted, e.g. denied before any call).
 */
import type { QuotaSnapshot } from '@awrm/core';
import { AwrmError } from '@awrm/core';

export interface QuotaConfig {
  quotaKey: string;
  limit: number | null; // null = unknown
  windowMs: number | null; // null = fixed allowance, no refill
  source: string; // where the number comes from (published limit, owner config, fixture)
}

interface Window {
  cfg: QuotaConfig;
  windowStart: number;
  used: number;
  reserved: number;
  blockedUntil: number | null;
  rateLimitSignals: number;
}

export class QuotaLedger {
  private windows = new Map<string, Window>();
  constructor(private now: () => number = Date.now) {}

  configure(cfg: QuotaConfig): void {
    if (cfg.limit !== null && (!Number.isInteger(cfg.limit) || cfg.limit < 0)) throw new AwrmError('invalid-input', 'quota limit must be a non-negative integer or null');
    if (!Number.isFinite(cfg.limit ?? 0)) throw new AwrmError('invalid-input', 'quota cannot be infinite');
    const existing = this.windows.get(cfg.quotaKey);
    this.windows.set(cfg.quotaKey, existing ? { ...existing, cfg } : { cfg, windowStart: this.now(), used: 0, reserved: 0, blockedUntil: null, rateLimitSignals: 0 });
  }

  has(quotaKey: string): boolean {
    return this.windows.has(quotaKey);
  }

  private win(quotaKey: string): Window | undefined {
    const w = this.windows.get(quotaKey);
    if (w && w.cfg.windowMs !== null && this.now() - w.windowStart >= w.cfg.windowMs) {
      w.windowStart = this.now();
      w.used = 0;
    }
    return w;
  }

  snapshot(quotaKey: string): QuotaSnapshot | null {
    const w = this.win(quotaKey);
    if (!w) return null;
    return { quotaKey, limit: w.cfg.limit, used: w.used + w.reserved, windowMs: w.cfg.windowMs, blockedUntil: w.blockedUntil };
  }

  /** Atomically reserve one call. Returns false if it would exceed a known limit. */
  reserve(quotaKey: string): boolean {
    const w = this.win(quotaKey);
    if (!w) return false;
    if (w.blockedUntil !== null && w.blockedUntil > this.now()) return false;
    if (w.cfg.limit !== null && w.used + w.reserved >= w.cfg.limit) return false;
    w.reserved++;
    return true;
  }

  commit(quotaKey: string): void {
    const w = this.windows.get(quotaKey);
    if (!w || w.reserved === 0) return;
    w.reserved--;
    w.used++;
  }

  release(quotaKey: string): void {
    const w = this.windows.get(quotaKey);
    if (w && w.reserved > 0) w.reserved--;
  }

  /** Provider said 429 / Retry-After: hard stop for this key until then. */
  recordRateLimit(quotaKey: string, retryAfterMs: number | null): void {
    const w = this.windows.get(quotaKey);
    if (!w) return;
    w.rateLimitSignals++;
    // Without a Retry-After we stop for the rest of the window (or 60 s if no window).
    const ms = retryAfterMs ?? w.cfg.windowMs ?? 60_000;
    w.blockedUntil = Math.max(w.blockedUntil ?? 0, this.now() + ms);
  }

  report(): Array<QuotaConfig & { used: number; reserved: number; blockedUntil: number | null; rateLimitSignals: number }> {
    return [...this.windows.values()].map((w) => ({ ...w.cfg, used: w.used, reserved: w.reserved, blockedUntil: w.blockedUntil, rateLimitSignals: w.rateLimitSignals }));
  }
}
