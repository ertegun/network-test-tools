import { vi } from 'vitest';
import type { Platform } from '../src/platform';

/** Sistem komutu çalıştırmayan sahte platform; çağrılar kaydedilir. */
export function fakePlatform(hostsPath = '/nonexistent/hosts'): Platform {
  return {
    id: 'linux',
    hostsPath: () => hostsPath,
    interfaceDetails: vi.fn(async () => ({})),
    configSupport: vi.fn(async () => ({ supported: true })),
    readIpv4Config: vi.fn(async () => ({ mode: 'dhcp' as const, dns: [] })),
    ping: vi.fn(async () => false),
    applyIpv4: vi.fn(async () => undefined),
    flushDns: vi.fn(async () => undefined),
  };
}
