// Asgari SOCKS5 istemcisi (RFC 1928): kimlik doğrulamasız CONNECT. Port testinin Tor yolu için.

import { isIPv4, Socket } from 'node:net';
import type { PortState } from '../shared/types';

export interface SocksProxy {
  host: string;
  port: number;
}

export const TOR_PROXY: SocksProxy = { host: '127.0.0.1', port: 9050 };

export type SocksOutcome = Extract<PortState, 'open' | 'closed' | 'filtered' | 'proxyError'>;

const GREETING = Buffer.from([5, 1, 0]); // sürüm 5, tek yöntem: kimlik doğrulamasız
const REP_SUCCEEDED = 0;
const REP_CONNECTION_REFUSED = 5;

function connectRequest(host: string, port: number): Buffer {
  const addr = isIPv4(host)
    ? Buffer.from([1, ...host.split('.').map(Number)])
    : Buffer.concat([Buffer.from([3, Buffer.byteLength(host)]), Buffer.from(host)]);
  return Buffer.concat([Buffer.from([5, 1, 0]), addr, Buffer.from([port >> 8, port & 0xff])]);
}

// request verilmezse yalnızca selamlaşma yapılır (proxy erişilebilir mi?).
function exchange(proxy: SocksProxy, timeoutMs: number, signal?: AbortSignal, request?: Buffer): Promise<SocksOutcome> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let buf = Buffer.alloc(0);
    let greeted = false;
    let settled = false;
    const finish = (o: SocksOutcome) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(o);
    };
    // Selamlaşmadan sonra proxy çalışıyor demektir: yanıt gelmemesi hedefin sorunudur (Tor devresi yavaş, port filtreli).
    const failed = () => finish(greeted ? 'filtered' : 'proxyError');
    const onAbort = () => finish('proxyError');
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs);
    socket.once('timeout', failed);
    socket.once('error', failed);
    socket.once('close', failed);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 2) return;
      if (buf[0] !== 5) return finish('proxyError');
      if (!greeted) {
        if (buf[1] !== 0) return finish('proxyError');
        greeted = true;
        buf = buf.subarray(2);
        if (!request) return finish('open');
        socket.write(request);
        return;
      }
      // Tor, reddedilen bağlantı dışındaki çıkış hatalarını (genel hata 1, ulaşılamaz 3/4, zaman aşımı 6) da döner.
      finish(buf[1] === REP_SUCCEEDED ? 'open' : buf[1] === REP_CONNECTION_REFUSED ? 'closed' : 'filtered');
    });
    socket.connect(proxy.port, proxy.host, () => socket.write(GREETING));
  });
}

/** Proxy üzerinden host:port'a bağlanır. Yalnızca hedefin reddi "kapalı"dır; selamlaşmadan sonraki zaman aşımı ve diğer yanıtlar "filtreli", proxy'nin kendisine ulaşılamaması "proxyError". */
export function socksProbe(proxy: SocksProxy, host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<SocksOutcome> {
  return exchange(proxy, timeoutMs, signal, connectRequest(host, port));
}

export async function socksReachable(proxy: SocksProxy, timeoutMs: number): Promise<boolean> {
  return (await exchange(proxy, timeoutMs)) === 'open';
}
