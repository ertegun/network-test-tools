import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probeViaProxy, scanPorts } from '../src/core/portScan';
import { socksProbe, socksReachable, type SocksProxy } from '../src/core/socks5';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

// Sahte SOCKS5: selamlaşmayı kabul eder, CONNECT'e `rep` ile yanıt verir (null: hiç yanıt vermez).
async function fakeSocks(rep: (port: number) => number | null): Promise<SocksProxy> {
  const server = createServer((sock: Socket) => {
    let greeted = false;
    sock.on('error', () => {});
    sock.on('data', (d) => {
      if (!greeted) {
        greeted = true;
        sock.write(Buffer.from([5, 0]));
        return;
      }
      const code = rep(d.readUInt16BE(d.length - 2));
      if (code !== null) sock.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { host: '127.0.0.1', port: (server.address() as { port: number }).port };
}

describe('SOCKS5 / Tor yolu', () => {
  it('başarılı → açık, reddedildi (5) → kapalı, diğer yanıtlar → proxy hatası', async () => {
    const proxy = await fakeSocks((port) => ({ 80: 0, 81: 5, 82: 1, 83: 6 })[port] ?? 1);
    expect(await socksProbe(proxy, '192.0.2.1', 80, 1000)).toBe('open');
    expect(await socksProbe(proxy, '192.0.2.1', 81, 1000)).toBe('closed');
    expect(await socksProbe(proxy, '192.0.2.1', 82, 1000)).toBe('proxyError');
    expect(await socksProbe(proxy, 'example.com', 83, 1000)).toBe('proxyError');
  });

  it('zaman aşımı kapalı sayılmaz', async () => {
    const proxy = await fakeSocks(() => null);
    const r = await probeViaProxy(proxy, '192.0.2.1', 443, 200);
    expect(r).toMatchObject({ port: 443, state: 'proxyError', service: 'HTTPS' });
  });

  it('proxy yoksa erişilemez; tarama hiçbir portu kapalı göstermez', async () => {
    const proxy = await fakeSocks(() => 0);
    servers.pop()!.close();
    expect(await socksReachable(proxy, 1000)).toBe(false);
    const { results } = await scanPorts({ host: '192.0.2.1', ports: [22, 80, 443], proxy, timeoutMs: 500 });
    expect(results.map((r) => r.state)).toEqual(['proxyError', 'proxyError', 'proxyError']);
  });

  it('proxy çalışıyorsa erişilebilir', async () => {
    expect(await socksReachable(await fakeSocks(() => 0), 1000)).toBe(true);
  });

  it('iptal yanıt beklenirken taramayı hemen durdurur', async () => {
    const proxy = await fakeSocks(() => null);
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 100);
    const { aborted } = await scanPorts({ host: '192.0.2.1', ports: [1, 2, 3, 4, 5], proxy, timeoutMs: 30_000, signal: controller.signal });
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
