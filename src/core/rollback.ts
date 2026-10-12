// Onaylı değişiklik (M7): önce yedek alınır, değişiklik uygulanır, bağlantı test
// edilir ve kullanıcı onayı beklenir. Süre içinde onay gelmezse eski ayar geri yüklenir.

import type { ChangeStatus, Ipv4Config, PendingChangeJournal } from '../shared/types';

export const CONFIRM_TIMEOUT_MS = 15_000;

export interface ChangeDeps {
  /** Mevcut ayarı okur (yedek). Hata verirse değişiklik yapılmaz. */
  snapshot(iface: string): Promise<Ipv4Config>;
  apply(iface: string, cfg: Ipv4Config): Promise<void>;
  verifyConnectivity(iface: string, cfg: Ipv4Config): Promise<boolean>;
  /** Yarım kalan işlemin çökme sonrası tespiti için günlük. */
  writeJournal(j: PendingChangeJournal): Promise<void>;
  clearJournal(): Promise<void>;
  onStatus(s: ChangeStatus): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export class ConfirmableChange {
  private timer: unknown;
  private previous?: Ipv4Config;
  private status?: ChangeStatus;
  private settled?: Promise<void>;

  constructor(
    private readonly deps: ChangeDeps,
    private readonly timeoutMs = CONFIRM_TIMEOUT_MS,
  ) {}

  get current(): ChangeStatus | undefined {
    return this.status;
  }

  private emit(s: ChangeStatus) {
    this.status = s;
    this.deps.onStatus(s);
  }

  /** Değişikliği başlatır; onay beklemeye geçince döner. */
  async start(iface: string, next: Ipv4Config): Promise<ChangeStatus> {
    if (this.status && (this.status.phase === 'applying' || this.status.phase === 'awaitingConfirm' || this.status.phase === 'rollingBack')) {
      throw new Error('Devam eden bir değişiklik var');
    }
    this.emit({ phase: 'applying', interfaceName: iface });
    let previous: Ipv4Config;
    try {
      previous = await this.deps.snapshot(iface);
    } catch (err) {
      // Yedeksiz değişiklik yapılmaz (Gereksinim 6).
      this.emit({ phase: 'failed', interfaceName: iface, error: `backup: ${(err as Error).message}` });
      return this.status!;
    }
    this.previous = previous;
    await this.deps.writeJournal({ interfaceName: iface, previous, next, startedAt: new Date(this.now()).toISOString() });
    try {
      await this.deps.apply(iface, next);
    } catch (err) {
      // Kısmi uygulama olmuş olabilir; eski ayara dönülür.
      await this.rollback(iface, `apply: ${(err as Error).message}`);
      return this.status!;
    }
    // Süre, yeni ayar etkin olduğu anda başlar; bağlantı testi bu süre içinde koşar.
    const deadline = this.now() + this.timeoutMs;
    this.emit({ phase: 'awaitingConfirm', interfaceName: iface, deadline });
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.settled = this.rollback(iface);
    }, this.timeoutMs);
    const connectivityOk = await this.deps.verifyConnectivity(iface, next).catch(() => false);
    if (this.status?.phase === 'awaitingConfirm') {
      this.emit({ ...this.status, connectivityOk });
    }
    return this.status!;
  }

  /** Kullanıcı onayı. Süre dolduysa false döner. */
  async confirm(): Promise<boolean> {
    if (this.status?.phase !== 'awaitingConfirm' || this.timer === undefined) return false;
    this.clearTimer(this.timer);
    this.timer = undefined;
    await this.deps.clearJournal();
    this.emit({ phase: 'confirmed', interfaceName: this.status.interfaceName });
    return true;
  }

  /** Kullanıcı süreyi beklemeden geri almak isterse. */
  async revertNow(): Promise<void> {
    if (this.status?.phase !== 'awaitingConfirm' || this.timer === undefined) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
    await this.rollback(this.status.interfaceName);
  }

  /** Testler için: zamanlayıcıyla tetiklenen geri almanın bitmesini bekler. */
  async whenSettled(): Promise<void> {
    await this.settled;
  }

  private async rollback(iface: string, reason?: string): Promise<void> {
    this.emit({ phase: 'rollingBack', interfaceName: iface, error: reason });
    try {
      await this.deps.apply(iface, this.previous!);
      await this.deps.clearJournal();
      this.emit({ phase: 'rolledBack', interfaceName: iface, error: reason });
    } catch (err) {
      // Günlük silinmez: bir sonraki açılışta geri alma yeniden önerilir.
      this.emit({ phase: 'failed', interfaceName: iface, error: `rollback: ${(err as Error).message}` });
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private setTimer(fn: () => void, ms: number): unknown {
    return this.deps.setTimer ? this.deps.setTimer(fn, ms) : setTimeout(fn, ms);
  }

  private clearTimer(t: unknown): void {
    if (this.deps.clearTimer) this.deps.clearTimer(t);
    else clearTimeout(t as NodeJS.Timeout);
  }
}
