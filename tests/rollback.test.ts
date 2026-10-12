import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_TIMEOUT_MS, ConfirmableChange, type ChangeDeps } from '../src/core/rollback';
import type { ChangeStatus, Ipv4Config, PendingChangeJournal } from '../src/shared/types';

const PREVIOUS: Ipv4Config = { mode: 'dhcp', dns: [] };
const WRONG: Ipv4Config = { mode: 'static', ip: '10.99.99.99', mask: '255.255.255.0', gateway: '10.99.99.1', dns: [] };

function setup(overrides: Partial<ChangeDeps> = {}) {
  const applied: Ipv4Config[] = [];
  const statuses: ChangeStatus[] = [];
  let journal: PendingChangeJournal | null = null;
  const deps: ChangeDeps = {
    snapshot: vi.fn(async () => PREVIOUS),
    apply: vi.fn(async (_i: string, c: Ipv4Config) => {
      applied.push(c);
    }),
    verifyConnectivity: vi.fn(async () => false),
    writeJournal: vi.fn(async (j: PendingChangeJournal) => {
      journal = j;
    }),
    clearJournal: vi.fn(async () => {
      journal = null;
    }),
    onStatus: (s) => statuses.push(s),
    ...overrides,
  };
  return { deps, applied, statuses, journal: () => journal, change: new ConfirmableChange(deps) };
}

describe('onaylı değişiklik ve otomatik geri alma (M7)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('kabul kriteri: yanlış statik IP onaylanmazsa 15 sn içinde eski ayara dönülür', async () => {
    const { change, applied, statuses, journal } = setup();
    const startedAt = Date.now();
    const s = await change.start('Ethernet', WRONG);
    expect(s.phase).toBe('awaitingConfirm');
    expect(s.deadline! - startedAt).toBeLessThanOrEqual(CONFIRM_TIMEOUT_MS);
    expect(applied).toEqual([WRONG]);
    expect(journal()).toMatchObject({ interfaceName: 'Ethernet', previous: PREVIOUS, next: WRONG });

    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS - 1);
    expect(applied).toEqual([WRONG]);
    await vi.advanceTimersByTimeAsync(1);
    await change.whenSettled();
    expect(applied).toEqual([WRONG, PREVIOUS]);
    expect(statuses.at(-1)?.phase).toBe('rolledBack');
    expect(journal()).toBeNull();
    expect(CONFIRM_TIMEOUT_MS).toBe(15_000);
  });

  it('süre içinde onaylanırsa geri alma yapılmaz', async () => {
    const { change, applied, statuses, journal } = setup();
    await change.start('Ethernet', WRONG);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await change.confirm()).toBe(true);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS * 2);
    expect(applied).toEqual([WRONG]);
    expect(statuses.at(-1)?.phase).toBe('confirmed');
    expect(journal()).toBeNull();
  });

  it('süre dolduktan sonra gelen onay kabul edilmez', async () => {
    const { change } = setup();
    await change.start('Ethernet', WRONG);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
    await change.whenSettled();
    expect(await change.confirm()).toBe(false);
  });

  it('yedek alınamazsa değişiklik yapılmaz', async () => {
    const { change, applied, statuses, deps } = setup({ snapshot: vi.fn(async () => Promise.reject(new Error('okunamadı'))) });
    const s = await change.start('Ethernet', WRONG);
    expect(s.phase).toBe('failed');
    expect(applied).toEqual([]);
    expect(deps.writeJournal).not.toHaveBeenCalled();
    expect(statuses.map((x) => x.phase)).toEqual(['applying', 'failed']);
  });

  it('uygulama hata verirse hemen eski ayara dönülür', async () => {
    const calls: Ipv4Config[] = [];
    const { change, statuses } = setup({
      apply: vi.fn(async (_i: string, c: Ipv4Config) => {
        calls.push(c);
        if (c === WRONG) throw new Error('netsh hata');
      }),
    });
    await change.start('Ethernet', WRONG);
    expect(calls).toEqual([WRONG, PREVIOUS]);
    expect(statuses.at(-1)?.phase).toBe('rolledBack');
  });

  it('geri alma da başarısızsa günlük silinmez (sonraki açılışta önerilir)', async () => {
    const { change, statuses, journal } = setup({
      apply: vi.fn(async (_i: string, c: Ipv4Config) => {
        if (c === PREVIOUS) throw new Error('geri alınamadı');
      }),
    });
    await change.start('Ethernet', WRONG);
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
    await change.whenSettled();
    expect(statuses.at(-1)?.phase).toBe('failed');
    expect(journal()).not.toBeNull();
  });

  it('devam eden değişiklik varken ikincisi başlatılamaz', async () => {
    const { change } = setup();
    await change.start('Ethernet', WRONG);
    await expect(change.start('Ethernet', WRONG)).rejects.toThrow();
  });

  it('"şimdi geri al" süreyi beklemeden geri yükler', async () => {
    const { change, applied } = setup();
    await change.start('Ethernet', WRONG);
    await change.revertNow();
    expect(applied).toEqual([WRONG, PREVIOUS]);
  });
});
