import type { IfaceDetails } from '../core/interfaces';
import type { Ipv4Config } from '../shared/types';

export type PlatformId = 'win32' | 'darwin' | 'linux';

export interface Support {
  supported: boolean;
  reason?: string;
}

/** Her işletim sistemi bu arayüzü gerçekler; platforma özel kod yalnızca bu katmandadır. */
export interface Platform {
  id: PlatformId;
  hostsPath(): string;
  interfaceDetails(): Promise<Record<string, IfaceDetails>>;
  /** Yapılandırma (M7) bu sistemde destekleniyor mu (ör. Linux'ta NetworkManager). */
  configSupport(): Promise<Support>;
  readIpv4Config(iface: string): Promise<Ipv4Config>;
  /** Tek ICMP yankısı; yanıt gelirse true. */
  ping(ip: string, timeoutMs: number): Promise<boolean>;
  // --- Aşağıdakiler yalnızca yetkili yardımcıdan çağrılır ---
  applyIpv4(iface: string, cfg: Ipv4Config): Promise<void>;
  flushDns(): Promise<void>;
}
