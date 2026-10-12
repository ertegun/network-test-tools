import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runHelperFromFiles } from '../src/helper';
import { AuditLog } from '../src/main/audit';
import { HELPER_FLAG, PrivilegedRunner, type Elevator } from '../src/main/privileged';
import { fakePlatform } from './fakePlatform';

let dir: string;
let auditPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'netkit-priv-'));
  auditPath = join(dir, 'audit.log');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const auditLines = async () => (await readFile(auditPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

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

  it('geçerli istek yardımcı bayrağıyla yükseltilir; önceki/yeni değer günlüğe yazılır', async () => {
    const platform = fakePlatform();
    // Yükseltilmiş süreci taklit eder: yardımcı giriş noktasını aynı dosyalarla çalıştırır.
    const elevate = vi.fn<Elevator>(async (args) => {
      expect(args[0]).toBe(HELPER_FLAG);
      return { code: await runHelperFromFiles(args[1], args[2], platform), stderr: '' };
    });
    const runner = new PrivilegedRunner(elevate, new AuditLog(auditPath));
    const cfg = { mode: 'dhcp', dns: [] };
    const r = await runner.run('ipv4.apply', { interface: 'Ethernet', config: cfg }, { previous: { mode: 'static' }, next: cfg });
    expect(r).toEqual({ ok: true, output: null });
    expect(platform.applyIpv4).toHaveBeenCalledWith('Ethernet', cfg);
    expect((await auditLines())[0]).toMatchObject({ op: 'ipv4.apply', outcome: 'ok', previous: { mode: 'static' }, next: cfg });
  });

  it('kullanıcı yetki penceresini iptal ederse "cancelled" döner', async () => {
    const stderr = process.platform === 'darwin' ? 'User canceled. (-128)' : 'The operation was canceled by the user.';
    const runner = new PrivilegedRunner(vi.fn<Elevator>(async () => ({ code: process.platform === 'linux' ? 126 : 1, stderr })), new AuditLog(auditPath));
    const r = await runner.run('dns.flush', {});
    expect(r).toMatchObject({ ok: false, code: 'cancelled' });
    expect((await auditLines())[0]).toMatchObject({ outcome: 'cancelled' });
  });
});
