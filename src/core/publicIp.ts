// Public IP sorgusu: uygulamanın kendiliğinden yaptığı tek dış istek (Gereksinim 9).
// Birinci servis yanıt vermezse sıradakine geçilir.

import { isValidIP } from './validate';

export interface PublicIpService {
  id: string;
  url: string;
}

export const PUBLIC_IP_SERVICES: readonly PublicIpService[] = [
  { id: 'ipify', url: 'https://api.ipify.org' },
  { id: 'icanhazip', url: 'https://icanhazip.com' },
  { id: 'ifconfig.me', url: 'https://ifconfig.me/ip' },
];

export interface PublicIpResult {
  ip: string;
  serviceId: string;
  serviceHost: string;
  queriedAt: string;
}

export type FetchText = (url: string, timeoutMs: number) => Promise<string>;

export const defaultFetchText: FetchText = async (url, timeoutMs) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/** Tercih edilen servisi başa alarak sırayla dener. Hiçbiri yanıt vermezse Error fırlatır. */
export async function fetchPublicIp(
  preferredId: string | undefined,
  fetchText: FetchText = defaultFetchText,
  timeoutMs = 4000,
): Promise<PublicIpResult> {
  const ordered = [...PUBLIC_IP_SERVICES].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
  const errors: string[] = [];
  for (const svc of ordered) {
    try {
      const ip = (await fetchText(svc.url, timeoutMs)).trim();
      if (!isValidIP(ip)) throw new Error('invalid response');
      return { ip, serviceId: svc.id, serviceHost: new URL(svc.url).hostname, queriedAt: new Date().toISOString() };
    } catch (err) {
      errors.push(`${svc.id}: ${(err as Error).message}`);
    }
  }
  throw new Error(`public IP alınamadı (${errors.join('; ')})`);
}
