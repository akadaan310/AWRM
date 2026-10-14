/**
 * Seed sandbox network guard. While a Seed procedure runs, outbound network
 * primitives in this process throw. This is a defence-in-depth tripwire for
 * in-process code, not an OS sandbox: worker threads and child processes are
 * not covered and Seeds may not create them (procedures are a fixed registry).
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class SandboxViolation extends Error {
  constructor(what: string) {
    super(`sandbox violation: ${what}`);
    this.name = 'SandboxViolation';
  }
}

export async function withNetworkGuard<T>(fn: () => Promise<T>, onViolation: (what: string) => void = () => {}): Promise<T> {
  const saved = {
    fetch: globalThis.fetch,
    connect: net.Socket.prototype.connect,
    httpRequest: http.request,
    httpsRequest: https.request,
    lookup: dns.lookup,
  };
  const trip = (what: string): never => {
    onViolation(what);
    throw new SandboxViolation(what);
  };
  globalThis.fetch = (async (u: unknown) => trip(`fetch ${String(u)}`)) as typeof fetch;
  net.Socket.prototype.connect = function () {
    return trip('net.Socket.connect');
  } as never;
  (http as { request: unknown }).request = () => trip('http.request');
  (https as { request: unknown }).request = () => trip('https.request');
  (dns as { lookup: unknown }).lookup = () => trip('dns.lookup');
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved.fetch;
    net.Socket.prototype.connect = saved.connect;
    (http as { request: unknown }).request = saved.httpRequest;
    (https as { request: unknown }).request = saved.httpsRequest;
    (dns as { lookup: unknown }).lookup = saved.lookup;
  }
}
