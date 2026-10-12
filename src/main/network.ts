// M1: ağ bilgi paneli verisi ve değişiklik izleme. os.networkInterfaces() sık ve ucuz
// yoklanır; değişiklikte panel hemen (önbellekteki ayrıntılarla) güncellenir, ardından
// platform ayrıntıları ve public IP yenilenir.

import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { hostname, networkInterfaces } from 'node:os';
import { buildInterfaceList, interfacesSignature, type IfaceDetails } from '../core/interfaces';
import { fetchPublicIp, type FetchText } from '../core/publicIp';
import { interfaceForAddress, sourceIpFor } from '../core/route';
import type { Platform } from '../platform';
import type { NetworkSnapshot, PublicIpInfo } from '../shared/types';

export const POLL_MS = 1000;

export interface PublicIpPrefs {
  enabled: boolean;
  serviceId: string;
}

export class NetworkMonitor extends EventEmitter {
  private details: Record<string, IfaceDetails> = {};
  private signature = '';
  private publicIp?: PublicIpInfo;
  private publicIpError?: string;
  private timer?: NodeJS.Timeout;
  private detailsSeq = 0;

  constructor(
    private readonly platform: Platform,
    private readonly prefs: () => Promise<PublicIpPrefs>,
    private readonly fetchText?: FetchText,
    private readonly readInterfaces = networkInterfaces,
  ) {
    super();
  }

  /** Yoklamayı başlatır; ayrıntılar ve public IP arka planda gelir, gelince 'change' yayılır. */
  start(): void {
    this.signature = interfacesSignature(this.readInterfaces());
    this.timer = setInterval(() => this.poll(), POLL_MS);
    void this.refreshDetails().then(() => this.emitSnapshot());
    void this.refreshPublicIp().then(() => this.emitSnapshot());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<NetworkSnapshot> {
    const prefs = await this.prefs();
    return {
      hostname: hostname(),
      interfaces: buildInterfaceList(this.readInterfaces(), this.details),
      publicIp: prefs.enabled ? this.publicIp : undefined,
      publicIpError: prefs.enabled ? this.publicIpError : undefined,
      publicIpDisabled: !prefs.enabled,
      updatedAt: new Date().toISOString(),
    };
  }

  private async emitSnapshot() {
    this.emit('change', await this.snapshot());
  }

  private poll() {
    const sig = interfacesSignature(this.readInterfaces());
    if (sig === this.signature) return;
    this.signature = sig;
    void this.emitSnapshot();
    void this.refreshDetails().then(() => this.emitSnapshot());
    void this.refreshPublicIp().then(() => this.emitSnapshot());
  }

  private async refreshDetails() {
    const seq = ++this.detailsSeq;
    const d = await this.platform.interfaceDetails().catch(() => ({}));
    // Daha yeni bir istek başladıysa eski sonuç yazılmaz; ayrıntı yoksa önbellek korunur.
    if (seq === this.detailsSeq && Object.keys(d).length > 0) this.details = d;
  }

  /** Uygulamanın kendiliğinden yaptığı tek dış istek. Ayarlardan kapatılabilir. */
  async refreshPublicIp(): Promise<void> {
    const prefs = await this.prefs();
    if (!prefs.enabled) {
      this.publicIp = undefined;
      this.publicIpError = undefined;
      return;
    }
    try {
      const r = await fetchPublicIp(prefs.serviceId, this.fetchText);
      let interfaceName: string | undefined;
      try {
        const { address } = await lookup(r.serviceHost);
        interfaceName = interfaceForAddress(await sourceIpFor(address), this.readInterfaces());
      } catch {
        interfaceName = undefined;
      }
      this.publicIp = { ...r, interfaceName };
      this.publicIpError = undefined;
    } catch (err) {
      this.publicIp = undefined;
      this.publicIpError = (err as Error).message;
    }
  }
}
