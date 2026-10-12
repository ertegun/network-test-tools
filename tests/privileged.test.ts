import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup } from '../src/core/backups';
import { BLOCK_BEGIN, BLOCK_END, outsideLines } from '../src/core/hosts';
import { runHelper } from '../src/helper';
import { createEndpoint } from '../src/helper/channel';
import { AuditLog } from '../src/main/audit';
import { ConfigService, PREVIOUS_PROFILE } from '../src/main/config';
import { HostsService } from '../src/main/hosts';
import { HELPER_FLAG, PrivilegedRunner, type Elevator } from '../src/main/privileged';
import { JsonFile } from '../src/main/store';
import type { Platform } from '../src/platform';
import type { ChangeStatus, HostsGroup, Ipv4Config, NetProfile, PendingChangeJournal } from '../src/shared/types';
import { fakePlatform } from './fakePlatform';

let dir: string;
let auditPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'netkit-priv-'));
  auditPath = join(dir, 'audit.log');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const auditLines = async () => (await readFile(auditPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

/** Yükseltilmiş süreci taklit eder: yardımcı giriş noktası main'in verdiği argümanlarla, gerçek kanal üzerinden çalışır. */
function inProcessHelper(platform: Platform, opts: { confirmTimeoutMs?: number; tamper?: (args: string[]) => string[] } = {}) {
  return vi.fn<Elevator>(async (args) => {
    const a = opts.tamper ? opts.tamper(args) : args;
    expect(a[0]).toBe(HELPER_FLAG);
    const code = await runHelper({ endpoint: a[1], token: a[2], requestHash: a[3] }, platform, { confirmTimeoutMs: opts.confirmTimeoutMs });
    return { code, stderr: '' };
  });
}

describe('yetkili işlem çalıştırıcı (main)', () => {
  it('kabul kriteri: beyaz liste dışı komut yetki istenmeden reddedilir ve günlüğe yazılır', async () => {
    const elevate = vi.fn<Elevator>();
    const runner = new PrivilegedRunner(elevate, new AuditLog(auditPath));
    for (const op of ['calc.exe', 'rm -rf']) {
      const r = await runner.run(op, { args: ['/'] });
      expect(r).toMatchObject({ ok: false, code: 'notWhitelisted' });
    }
    expect(elevate).not.toHaveBeenCalled();
    const lines = await auditLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ op: 'calc.exe', outcome: 'rejected' });
    expect(lines[1]).toMatchObject({ op: 'rm -rf', outcome: 'rejected' });
    expect(typeof lines[0].time).toBe('string');
  });

  it('geçerli istek kanal üzerinden yardımcıya gider; önceki/yeni değer günlüğe yazılır', async () => {
    const platform = fakePlatform();
    const elevate = inProcessHelper(platform);
    const runner = new PrivilegedRunner(elevate, new AuditLog(auditPath));
    const cfg = { mode: 'dhcp', dns: [] };
    const r = await runner.run('ipv4.apply', { interface: 'Ethernet', config: cfg }, { previous: { mode: 'static' }, next: cfg });
    expect(r).toEqual({ ok: true, output: null });
    expect(platform.applyIpv4).toHaveBeenCalledWith('Ethernet', cfg);
    expect((await auditLines())[0]).toMatchObject({ op: 'ipv4.apply', outcome: 'ok', previous: { mode: 'static' }, next: cfg });
    // Komut satırında istek değil yalnızca kanal adresi, belirteç ve özet bulunur.
    const args = elevate.mock.calls[0][0];
    expect(args).toHaveLength(4);
    expect(args.join(' ')).not.toContain('Ethernet');
    expect(args[3]).toBe(createHash('sha256').update(JSON.stringify({ op: 'ipv4.apply', params: { interface: 'Ethernet', config: cfg } })).digest('hex'));
  });

  it('istek dosyaya yazılmaz: kanal Windows\'ta named pipe, diğerlerinde 0700 dizindeki Unix soketidir', async () => {
    const win = await createEndpoint('win32');
    expect(win.path).toMatch(/^\\\\\.\\pipe\\netkit-[0-9a-f]{32}$/);
    if (process.platform !== 'win32') {
      const unix = await createEndpoint('linux');
      expect((await stat(dirname(unix.path))).mode & 0o777).toBe(0o700);
      await unix.cleanup();
    }
  });

  it('özeti tutmayan (arada değiştirilmiş) istek yardımcıda çalıştırılmaz', async () => {
    const platform = fakePlatform();
    const elevate = inProcessHelper(platform, { tamper: (a) => [a[0], a[1], a[2], 'f'.repeat(64)] });
    const runner = new PrivilegedRunner(elevate, new AuditLog(auditPath));
    const r = await runner.run('dns.flush', {});
    expect(r).toMatchObject({ ok: false, code: 'failed', message: expect.stringContaining('bütünlük') });
    expect(platform.flushDns).not.toHaveBeenCalled();
  });

  it('belirteci bilmeyen bağlantı reddedilir, isteği alamaz', async () => {
    const platform = fakePlatform();
    const received: string[] = [];
    const elevate = vi.fn<Elevator>(async (args) => {
      // Önce sahte istemci bağlanır.
      await new Promise<void>((resolve) => {
        const rogue = connect(args[1]);
        rogue.setEncoding('utf8');
        rogue.on('connect', () => rogue.write(JSON.stringify({ t: 'hello', token: 'x'.repeat(64) }) + '\n'));
        rogue.on('data', (d: string) => received.push(d));
        rogue.on('error', () => resolve());
        rogue.on('close', () => resolve());
      });
      return { code: await runHelper({ endpoint: args[1], token: args[2], requestHash: args[3] }, platform), stderr: '' };
    });
    const runner = new PrivilegedRunner(elevate, new AuditLog(auditPath));
    expect(await runner.run('dns.flush', {})).toEqual({ ok: true, output: null });
    expect(received).toEqual([]);
  });

  it('kullanıcı yetki penceresini iptal ederse "cancelled" döner', async () => {
    const stderr = process.platform === 'darwin' ? 'User canceled. (-128)' : 'The operation was canceled by the user.';
    const runner = new PrivilegedRunner(vi.fn<Elevator>(async () => ({ code: process.platform === 'linux' ? 126 : 1, stderr })), new AuditLog(auditPath));
    const r = await runner.run('dns.flush', {});
    expect(r).toMatchObject({ ok: false, code: 'cancelled' });
    expect((await auditLines())[0]).toMatchObject({ outcome: 'cancelled' });
  });
});

describe('onaylı değişiklik tek yetkili süreçte (M7)', () => {
  const PREVIOUS: Ipv4Config = { mode: 'dhcp', dns: [] };
  const WRONG: Ipv4Config = { mode: 'static', ip: '10.99.99.99', mask: '255.255.255.0', gateway: '10.99.99.1', dns: [] };
  // IPv4 adresi olan gerçek bir arayüz: bağlantı testindeki DHCP beklemesi hemen geçer.
  const IFACE = Object.entries(networkInterfaces()).find(([, l]) => l?.some((i) => i.family === 'IPv4' && !i.address.startsWith('169.254.')))![0];
  const TIMEOUT = 300;

  function setup() {
    const platform = fakePlatform();
    vi.mocked(platform.readIpv4Config).mockResolvedValue(PREVIOUS);
    const elevate = inProcessHelper(platform, { confirmTimeoutMs: TIMEOUT });
    const statuses: ChangeStatus[] = [];
    const journal = new JsonFile<PendingChangeJournal | null>(join(dir, 'pending-change.json'), () => null);
    const profiles = new JsonFile<NetProfile[]>(join(dir, 'profiles.json'), () => []);
    const service = new ConfigService(platform, new PrivilegedRunner(elevate, new AuditLog(auditPath)), journal, profiles, (s) => statuses.push(s));
    const settled = () => vi.waitFor(() => expect(['confirmed', 'rolledBack', 'failed']).toContain(statuses.at(-1)?.phase), { timeout: 5000 });
    // Oturum, yardımcı kapanıp denetim kaydı yazılınca biter.
    const sessionEnded = () => vi.waitFor(async () => expect((await auditLines()).some((l) => l.op === 'ipv4.change')).toBe(true));
    return { platform, elevate, statuses, journal, profiles, service, settled, sessionEnded };
  }

  it('kabul kriteri: onay gelmezse yardımcı eski ayarı ikinci yetki penceresi açmadan geri yükler', async () => {
    const { platform, elevate, statuses, journal, profiles, service, settled } = setup();
    const s = await service.apply(IFACE, WRONG);
    expect(s.phase).toBe('awaitingConfirm');
    expect(await journal.read()).toMatchObject({ interfaceName: IFACE, previous: PREVIOUS, next: WRONG });
    expect(await profiles.read()).toEqual([{ name: PREVIOUS_PROFILE, config: PREVIOUS }]);
    // Main hiçbir şey yapmaz; geri alma yardımcının kendi zamanlayıcısıyla gelir.
    await settled();
    expect(statuses.at(-1)?.phase).toBe('rolledBack');
    expect(vi.mocked(platform.applyIpv4).mock.calls).toEqual([
      [IFACE, WRONG],
      [IFACE, PREVIOUS],
    ]);
    expect(elevate).toHaveBeenCalledTimes(1);
    expect(await journal.exists()).toBe(false);
    // Denetim kaydı yardımcı kapandıktan sonra yazılır.
    await vi.waitFor(async () =>
      expect((await auditLines()).at(-1)).toMatchObject({ op: 'ipv4.change', outcome: 'ok', previous: PREVIOUS, next: WRONG, message: 'rolledBack' }),
    );
  });

  it('süre içinde onaylanırsa ayar kalır, günlük silinir', async () => {
    const { platform, elevate, journal, service, sessionEnded } = setup();
    await service.apply(IFACE, WRONG);
    expect(await service.confirm()).toBe(true);
    await sessionEnded();
    expect(platform.applyIpv4).toHaveBeenCalledTimes(1);
    expect(elevate).toHaveBeenCalledTimes(1);
    expect(await journal.exists()).toBe(false);
  });

  it('"şimdi geri al" aynı yardımcıdan geri yükler', async () => {
    const { platform, elevate, statuses, service, sessionEnded } = setup();
    await service.apply(IFACE, WRONG);
    await service.revert();
    await sessionEnded();
    expect(statuses.at(-1)?.phase).toBe('rolledBack');
    expect(vi.mocked(platform.applyIpv4).mock.calls.at(-1)).toEqual([IFACE, PREVIOUS]);
    expect(elevate).toHaveBeenCalledTimes(1);
  });

  it('yetki penceresi iptal edilirse hiçbir şey uygulanmaz ve geri alma için yeni pencere açılmaz', async () => {
    const platform = fakePlatform();
    const elevate = vi.fn<Elevator>(async () => ({ code: 1, stderr: 'The operation was canceled by the user.' }));
    const statuses: ChangeStatus[] = [];
    const service = new ConfigService(
      platform,
      new PrivilegedRunner(elevate, new AuditLog(auditPath)),
      new JsonFile<PendingChangeJournal | null>(join(dir, 'pending-change.json'), () => null),
      new JsonFile<NetProfile[]>(join(dir, 'profiles.json'), () => []),
      (s) => statuses.push(s),
    );
    const s = await service.apply(IFACE, WRONG);
    expect(s.phase).toBe('failed');
    await vi.waitFor(async () => expect((await auditLines()).at(-1)).toMatchObject({ op: 'ipv4.change', outcome: 'cancelled' }));
    expect(elevate).toHaveBeenCalledTimes(1);
    expect(platform.applyIpv4).not.toHaveBeenCalled();
  });
});

describe('hosts yedeğinden geri yükleme (M8, Gereksinim 7)', () => {
  it('yalnızca yedekteki NetKit bloğu uygulanır; blok dışı satırlar ve hash değişmez', async () => {
    const hostsPath = join(dir, 'hosts');
    const current = '# sistem\r\n127.0.0.1 localhost\r\n10.0.0.5 elle.eklendi\r\n';
    await writeFile(hostsPath, current);
    const backupDir = join(dir, 'backups');
    // Kurcalanmış yedek: blok dışında saldırgan satırı, blokta geçerli bir kayıt.
    const tampered = `6.6.6.6 bank.example\r\n${BLOCK_BEGIN}\r\n127.0.0.1  proje.local\r\n${BLOCK_END}\r\n`;
    const id = await createBackup(backupDir, tampered);
    const platform = fakePlatform(hostsPath);
    const hosts = new HostsService(
      platform,
      new PrivilegedRunner(inProcessHelper(platform), new AuditLog(auditPath)),
      new JsonFile<HostsGroup[]>(join(dir, 'groups.json'), () => []),
      backupDir,
    );
    expect(await hosts.restore(id)).toMatchObject({ ok: true });
    const after = await readFile(hostsPath, 'utf8');
    expect(outsideLines(after)).toEqual(outsideLines(current));
    expect(after).toContain('127.0.0.1  proje.local');
    expect(after).not.toContain('bank.example');
    expect((await auditLines()).at(-1)).toMatchObject({ op: 'hosts.writeBlock', outcome: 'ok' });
  });
});
