// TCP bağlantı (connect) taraması (M2). Yönetici yetkisi gerektirmez.

import { Socket } from 'node:net';
import type { PortResult, PortState } from '../shared/types';
import { serviceName } from './ports';

export interface ScanOptions {
  host: string;
  ports: number[];
  timeoutMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onResult?: (r: PortResult, done: number, total: number) => void;
}

export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_CONCURRENCY = 200;
export const MAX_CONCURRENCY = 1000;
export const MIN_TIMEOUT_MS = 100;
export const MAX_TIMEOUT_MS = 30_000;

// Hedef aktif olarak reddetti → kapalı. Diğer hatalar (yanıt yok, ulaşılamaz) → filtrelenmiş.
const CLOSED_CODES = new Set(['ECONNREFUSED', 'ECONNRESET']);

export function clampConcurrency(n: number | undefined): number {
  if (!n || !Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  return Math.min(Math.floor(n), MAX_CONCURRENCY);
}

export function clampTimeout(ms: number | undefined): number {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(ms), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

export function probePort(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<PortResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = new Socket();
    let settled = false;
    const finish = (state: PortState) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve({ port, state, ms: Math.round(performance.now() - started), service: serviceName(port) });
    };
    const onAbort = () => finish('filtered');
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('filtered'));
    socket.once('error', (err: NodeJS.ErrnoException) => finish(CLOSED_CODES.has(err.code ?? '') ? 'closed' : 'filtered'));
    socket.connect({ host, port });
  });
}

/** Portları eşzamanlılık sınırıyla tarar. İptal edilirse o ana kadarki sonuçları döndürür. */
export async function scanPorts(opts: ScanOptions): Promise<{ results: PortResult[]; aborted: boolean }> {
  const timeoutMs = clampTimeout(opts.timeoutMs);
  const concurrency = Math.min(clampConcurrency(opts.concurrency), opts.ports.length || 1);
  const results: PortResult[] = [];
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < opts.ports.length && !opts.signal?.aborted) {
      const port = opts.ports[next++];
      const r = await probePort(opts.host, port, timeoutMs, opts.signal);
      if (opts.signal?.aborted) return;
      results.push(r);
      done++;
      opts.onResult?.(r, done, opts.ports.length);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  results.sort((a, b) => a.port - b.port);
  return { results, aborted: Boolean(opts.signal?.aborted) };
}
