// Preload'un renderer'a açtığı API'nin tipi. Renderer yalnızca bu yüzeyi görür;
// Node.js, Electron ya da dosya sistemine doğrudan erişemez.

import type {
  ChangeStatus,
  ContextStrip,
  DnsEntry,
  HostsGroup,
  HostsView,
  Ipv4Config,
  NetProfile,
  NetworkSnapshot,
  PendingChangeJournal,
  PrivilegedResult,
  ScanFinished,
  ScanProgress,
  ScanRequest,
  Settings,
} from './types';

export type Unsubscribe = () => void;

export interface ConfigValidation {
  errors: string[];
  /** Hedef IP başka bir cihazdan yanıt veriyorsa true. */
  conflict: boolean;
}

export interface NetkitApi {
  platform: 'win32' | 'darwin' | 'linux';
  network: {
    snapshot(): Promise<NetworkSnapshot>;
    refreshPublicIp(): Promise<NetworkSnapshot>;
    onChange(cb: (s: NetworkSnapshot) => void): Unsubscribe;
  };
  scan: {
    start(req: ScanRequest): Promise<{ scanId: string; total: number; context: ContextStrip }>;
    stop(scanId: string): Promise<void>;
    onProgress(cb: (batch: ScanProgress[]) => void): Unsubscribe;
    onFinished(cb: (f: ScanFinished) => void): Unsubscribe;
  };
  config: {
    support(): Promise<{ supported: boolean; reason?: string }>;
    read(iface: string): Promise<Ipv4Config>;
    validate(iface: string, cfg: Ipv4Config): Promise<ConfigValidation>;
    apply(iface: string, cfg: Ipv4Config): Promise<ChangeStatus>;
    confirm(): Promise<boolean>;
    revert(): Promise<void>;
    onStatus(cb: (s: ChangeStatus) => void): Unsubscribe;
    pendingRecovery(): Promise<PendingChangeJournal | null>;
    recover(): Promise<PrivilegedResult>;
    dismissRecovery(): Promise<void>;
    profiles(): Promise<NetProfile[]>;
    saveProfile(p: NetProfile): Promise<NetProfile[]>;
    deleteProfile(name: string): Promise<NetProfile[]>;
  };
  dns: {
    /** Hazır kayıtlar ve kullanıcı kayıtları. */
    list(): Promise<DnsEntry[]>;
    /** Ekler ya da (id varsa) günceller; geçersizse hata kodları virgülle ayrılmış Error. */
    save(entry: { id?: string; name: string; primary: string; secondary?: string }): Promise<DnsEntry[]>;
    remove(id: string): Promise<DnsEntry[]>;
    /** Yalnızca DNS'i değiştirir (boş liste: DHCP); durum config.onStatus ile gelir, onay config.confirm ile. */
    apply(iface: string, dns: string[]): Promise<ChangeStatus>;
  };
  hosts: {
    view(): Promise<HostsView>;
    saveGroups(groups: HostsGroup[]): Promise<HostsView>;
    apply(): Promise<PrivilegedResult>;
    removeAll(): Promise<PrivilegedResult>;
    restore(backupId: string): Promise<PrivilegedResult>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    systemLocale(): Promise<string>;
  };
}
