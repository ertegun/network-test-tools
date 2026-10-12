import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clampConcurrency, clampTimeout, probePort, scanPorts } from '../src/core/portScan';

let server: Server;
let openPort: number;
let closedPort: number;

const listen = (s: Server) => new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)));

beforeAll(async () => {
  server = createServer((sock) => sock.destroy());
  openPort = await listen(server);
  // Bir portu açıp kapatarak "reddedilen" (kapalı) port elde edilir.
  const tmp = createServer();
  closedPort = await listen(tmp);
  await new Promise((r) => tmp.close(r));
});

afterAll(() => new Promise((r) => server.close(r)));

describe('TCP port taraması (M2)', () => {
  it('açık ve kapalı portları ayırır; ms içerir', async () => {
    const open = await probePort('127.0.0.1', openPort, 2000);
    expect(open.state).toBe('open');
    expect(open.ms).toBeGreaterThanOrEqual(0);
    const closed = await probePort('127.0.0.1', closedPort, 2000);
    expect(closed.state).toBe('closed');
  });

  it('servis adı eklenir', async () => {
    const r = await probePort('127.0.0.1', 443, 500);
    expect(r.service).toBe('HTTPS');
  });

  it('yanıt yoksa filtrelenmiş (zaman aşımı ya da ulaşılamaz)', async () => {
    // 192.0.2.0/24 (TEST-NET-1) internette yönlendirilmez.
    const r = await probePort('192.0.2.1', 81, 300);
    expect(r.state).toBe('filtered');
  });

  it('eşzamanlılık sınırı 1000', () => {
    expect(clampConcurrency(5000)).toBe(1000);
    expect(clampConcurrency(0)).toBe(200);
    expect(clampConcurrency(undefined)).toBe(200);
    expect(clampConcurrency(50)).toBe(50);
  });

  it('zaman aşımı 100 ms – 30 sn aralığına sınırlanır', () => {
    expect(clampTimeout(undefined)).toBe(2000);
    expect(clampTimeout(1e9)).toBe(30_000);
    expect(clampTimeout(5)).toBe(100);
    expect(clampTimeout(-1)).toBe(2000);
  });

  it('1–1024 taraması yerel hedefte 20 sn altında biter ve sıralı döner', async () => {
    const ports = Array.from({ length: 1024 }, (_, i) => i + 1);
    const started = Date.now();
    let progress = 0;
    const { results, aborted } = await scanPorts({ host: '127.0.0.1', ports, timeoutMs: 1000, onResult: (_r, done) => (progress = done) });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(aborted).toBe(false);
    expect(results).toHaveLength(1024);
    expect(progress).toBe(1024);
    expect(results.map((r) => r.port)).toEqual(ports);
  }, 30_000);

  it('durdurulunca erken biter', async () => {
    const controller = new AbortController();
    const ports = Array.from({ length: 200 }, (_, i) => i + 1);
    setTimeout(() => controller.abort(), 50);
    const { aborted, results } = await scanPorts({ host: '192.0.2.1', ports, timeoutMs: 5000, concurrency: 10, signal: controller.signal });
    expect(aborted).toBe(true);
    expect(results.length).toBeLessThan(200);
  });
});
