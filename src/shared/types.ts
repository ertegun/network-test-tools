// Main, preload ve renderer arasında paylaşılan veri tipleri (yalnızca tip; çalışma zamanı kodu yok).

export type IfaceKind = 'ethernet' | 'wifi' | 'vpn' | 'loopback' | 'other';

export interface IfaceAddress {
  address: string;
  netmask: string;
  cidr: string | null;
}

export interface NetInterface {
  name: string;
  description?: string;
  kind: IfaceKind;
  /** VPN/sanal arayüz işareti (M1). */
  virtual: boolean;
  up: boolean;
  mac?: string;
  ipv4: IfaceAddress[];
  ipv6: IfaceAddress[];
  gateway?: string;
  dns: string[];
  dhcp?: boolean;
  /** DHCP kira süresinin kalan kısmı (sn). */
  leaseSeconds?: number;
}

export interface PublicIpInfo {
  ip: string;
  serviceId: string;
  serviceHost: string;
  queriedAt: string;
  /** Public IP sorgusunun çıktığı yerel arayüz. */
  interfaceName?: string;
}

export interface NetworkSnapshot {
  hostname: string;
  interfaces: NetInterface[];
  publicIp?: PublicIpInfo;
  publicIpError?: string;
  publicIpDisabled?: boolean;
  updatedAt: string;
}

export type PortState = 'open' | 'closed' | 'filtered';

export interface PortResult {
  port: number;
  state: PortState;
  ms: number;
  service?: string;
}

export interface ContextStrip {
  timestamp: string;
  timeZone: string;
  hostname: string;
  target: string;
  resolvedIp: string;
  sourceIp: string;
  interfaceName?: string;
  publicIp?: string;
  publicIpService?: string;
  publicIpInterface?: string;
  splitTunnel: boolean;
}

export type PortPresetId = 'top100' | 'web' | 'mail' | 'remote' | 'database' | 'all';

export interface ScanRequest {
  target: string;
  ports?: string;
  preset?: PortPresetId;
  timeoutMs?: number;
  concurrency?: number;
}

export interface ScanProgress {
  scanId: string;
  result: PortResult;
  done: number;
  total: number;
}

export interface ScanFinished {
  scanId: string;
  results: PortResult[];
  aborted: boolean;
  durationMs: number;
}

export interface Ipv4Config {
  mode: 'dhcp' | 'static';
  ip?: string;
  /** Maske ("255.255.255.0") ya da önek ("/24"). */
  mask?: string;
  gateway?: string;
  /** Boş dizi: DNS sunucuları DHCP'den alınır. */
  dns: string[];
}

export interface NetProfile {
  name: string;
  config: Ipv4Config;
}

export type ChangePhase = 'applying' | 'awaitingConfirm' | 'confirmed' | 'rollingBack' | 'rolledBack' | 'failed';

export interface ChangeStatus {
  phase: ChangePhase;
  interfaceName: string;
  /** awaitingConfirm durumunda onay için son an (epoch ms). */
  deadline?: number;
  connectivityOk?: boolean;
  error?: string;
}

export interface PendingChangeJournal {
  interfaceName: string;
  previous: Ipv4Config;
  next: Ipv4Config;
  startedAt: string;
}

export interface HostsEntry {
  ip: string;
  hostnames: string[];
}

export interface HostsGroup {
  id: string;
  name: string;
  enabled: boolean;
  entries: HostsEntry[];
}

export interface HostsConflict {
  hostname: string;
  ips: string[];
  groups: string[];
}

export interface HostsView {
  path: string;
  /** NetKit bloğu dışındaki satırlar (salt okunur gösterim). */
  outsideLines: string[];
  groups: HostsGroup[];
  conflicts: HostsConflict[];
  backups: { id: string; createdAt: string; size: number }[];
}

export type PrivilegedErrorCode = 'notWhitelisted' | 'invalidParams' | 'cancelled' | 'failed';

export type PrivilegedResult =
  | { ok: true; output?: unknown }
  | { ok: false; code: PrivilegedErrorCode; message: string };

export type ThemePref = 'system' | 'light' | 'dark';
export type LanguagePref = 'system' | 'tr' | 'en';

export interface Settings {
  theme: ThemePref;
  language: LanguagePref;
  publicIpEnabled: boolean;
  publicIpService: string;
  warningAccepted: boolean;
}

/** DNS değiştirici listesindeki kayıt; hazır (builtin) kayıtlar düzenlenemez ve silinemez. */
export interface DnsEntry {
  id: string;
  name: string;
  primary: string;
  secondary?: string;
  builtin?: boolean;
}
