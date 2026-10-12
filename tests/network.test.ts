import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkMonitor, POLL_MS } from '../src/main/network';
import type { NetworkSnapshot } from '../src/shared/types';
import { fakePlatform } from './fakePlatform';

const v4 = (address: string) => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:01', cidr: `${address}/24` }) as NetworkInterfaceInfo;

describe('ağ izleme (M1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('kabul kriteri: VPN bağlanınca 5 sn içinde VPN arayüzü ve IP panelde görünür', async () => {
    let raw: NodeJS.Dict<NetworkInterfaceInfo[]> = { eth0: [v4('192.168.1.5')] };
    const platform = fakePlatform();
    const monitor = new NetworkMonitor(platform, async () => ({ enabled: false, serviceId: 'ipify' }), undefined, () => raw);
    const snapshots: NetworkSnapshot[] = [];
    monitor.on('change', (s: NetworkSnapshot) => snapshots.push(s));
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    snapshots.length = 0;

    raw = { ...raw, wg0: [v4('10.8.0.2')] };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const vpn = snapshots.at(-1)?.interfaces.find((i) => i.name === 'wg0');
    expect(POLL_MS).toBeLessThanOrEqual(5000);
    expect(vpn).toMatchObject({ kind: 'vpn', virtual: true, ipv4: [{ address: '10.8.0.2' }] });
    monitor.stop();
  });

  it('public IP kapalıyken dış istek yapılmaz', async () => {
    const fetchText = vi.fn(async () => '1.2.3.4');
    const monitor = new NetworkMonitor(fakePlatform(), async () => ({ enabled: false, serviceId: 'ipify' }), fetchText, () => ({}));
    await monitor.refreshPublicIp();
    const s = await monitor.snapshot();
    expect(fetchText).not.toHaveBeenCalled();
    expect(s.publicIpDisabled).toBe(true);
    expect(s.publicIp).toBeUndefined();
  });

  it('değişiklik yoksa yeniden yayın yapılmaz', async () => {
    const platform = fakePlatform();
    const monitor = new NetworkMonitor(platform, async () => ({ enabled: false, serviceId: 'ipify' }), undefined, () => ({ eth0: [v4('192.168.1.5')] }));
    const onChange = vi.fn();
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    monitor.on('change', onChange);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(onChange).not.toHaveBeenCalled();
    expect(platform.interfaceDetails).toHaveBeenCalledTimes(1);
    monitor.stop();
  });
});
