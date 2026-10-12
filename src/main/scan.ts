// M2: port taraması oturumları ve bağlam şeridi.

import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { parsePortList, PORT_PRESETS } from '../core/ports';
import { scanPorts } from '../core/portScan';
import { isSplitTunnel, routeTo } from '../core/route';
import { isValidTarget } from '../core/validate';
import type { ContextStrip, NetworkSnapshot, ScanFinished, ScanProgress, ScanRequest } from '../shared/types';

const PROGRESS_FLUSH_MS = 100;

export interface ScanEvents {
  progress(batch: ScanProgress[]): void;
  finished(f: ScanFinished): void;
}

export async function buildContext(target: string, snapshot: NetworkSnapshot, now = new Date()): Promise<ContextStrip> {
  const route = await routeTo(target, networkInterfaces());
  return {
    timestamp: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hostname: hostname(),
    target,
    resolvedIp: route.resolvedIp,
    sourceIp: route.sourceIp,
    interfaceName: route.interfaceName,
    publicIp: snapshot.publicIp?.ip,
    publicIpService: snapshot.publicIp?.serviceHost,
    publicIpInterface: snapshot.publicIp?.interfaceName,
    splitTunnel: isSplitTunnel(route.interfaceName, snapshot.publicIp?.interfaceName, route.resolvedIp),
  };
}

export function portsFor(req: ScanRequest): number[] {
  if (req.preset) {
    const preset = PORT_PRESETS[req.preset];
    if (!preset) throw new Error('invalidPreset');
    return [...preset].sort((a, b) => a - b);
  }
  return parsePortList(req.ports ?? '');
}

export class ScanManager {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly events: ScanEvents) {}

  async start(req: ScanRequest, snapshot: NetworkSnapshot): Promise<{ scanId: string; total: number; context: ContextStrip }> {
    const target = (req.target ?? '').trim();
    if (!isValidTarget(target)) throw new Error('invalidTarget');
    let ports: number[];
    try {
      ports = portsFor(req);
    } catch {
      throw new Error('invalidPorts');
    }
    // Hedef bir kez çözülür; her bağlantı aynı IP'ye gider.
    const context = await buildContext(target, snapshot);
    const scanId = randomUUID();
    const controller = new AbortController();
    this.running.set(scanId, controller);

    let pending: ScanProgress[] = [];
    const flush = () => {
      if (pending.length > 0) this.events.progress(pending);
      pending = [];
    };
    const flushTimer = setInterval(flush, PROGRESS_FLUSH_MS);
    const started = Date.now();

    void scanPorts({
      host: context.resolvedIp,
      ports,
      timeoutMs: req.timeoutMs,
      concurrency: req.concurrency,
      signal: controller.signal,
      onResult: (result, done, total) => pending.push({ scanId, result, done, total }),
    })
      .then(({ results, aborted }) => {
        clearInterval(flushTimer);
        flush();
        this.events.finished({ scanId, results, aborted, durationMs: Date.now() - started });
      })
      .finally(() => this.running.delete(scanId));

    return { scanId, total: ports.length, context };
  }

  stop(scanId: string): void {
    this.running.get(scanId)?.abort();
  }

  stopAll(): void {
    for (const c of this.running.values()) c.abort();
  }
}
