import { describe, expect, it } from 'vitest';
import { startTor, torStarter, type DockerExec, type DockerResult } from '../src/main/tor';

const ok = (stdout = ''): DockerResult => ({ code: 0, stdout, stderr: '', missing: false });

/** Sırayla verilen yanıtları döndürür, çağrıları kaydeder. */
function fakeDocker(...replies: DockerResult[]) {
  const calls: { args: readonly string[]; timeoutMs: number }[] = [];
  const exec: DockerExec = async (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    return replies.shift() ?? ok();
  };
  return { exec, calls };
}

describe('startTor', () => {
  it('docker yoksa (ENOENT) notInstalled, başka komut çalışmaz', async () => {
    const d = fakeDocker({ code: 1, stdout: '', stderr: 'spawn docker ENOENT', missing: true });
    expect(await startTor(d.exec)).toEqual({ state: 'notInstalled' });
    expect(d.calls).toHaveLength(1);
  });

  it('docker info başarısız ya da zaman aşımı: daemonOff, container oluşturulmaz', async () => {
    const d = fakeDocker({ code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon', missing: false });
    expect(await startTor(d.exec)).toEqual({ state: 'daemonOff' });
    expect(d.calls.map((c) => c.args)).toEqual([['info']]);
    expect(d.calls[0].timeoutMs).toBe(5000);
  });

  it('container yoksa sabit argümanlarla docker run, süre sınırsız', async () => {
    const d = fakeDocker(ok(), { code: 1, stdout: '', stderr: 'No such container', missing: false }, ok('abc'));
    expect(await startTor(d.exec)).toEqual({ state: 'running' });
    expect(d.calls[2]).toEqual({
      args: ['run', '-d', '--name', 'netkit-tor', '--restart', 'unless-stopped', '-p', '127.0.0.1:9050:9050', 'osminogin/tor-simple'],
      timeoutMs: 0,
    });
  });

  it('container varsa yenisi oluşturulmaz, mevcut başlatılır', async () => {
    const d = fakeDocker(ok(), ok('[]'), ok('netkit-tor'));
    expect(await startTor(d.exec)).toEqual({ state: 'running' });
    expect(d.calls.map((c) => c.args)).toEqual([['info'], ['container', 'inspect', 'netkit-tor'], ['start', 'netkit-tor']]);
  });

  it('hata: stderr ilk satırı gösterilir', async () => {
    const d = fakeDocker(ok(), ok(), { code: 1, stdout: '', stderr: 'Error: port is already allocated\nmore detail', missing: false });
    expect(await startTor(d.exec)).toEqual({ state: 'error', message: 'Error: port is already allocated' });
  });
});

describe('torStarter', () => {
  it('eşzamanlı ikinci istek aynı işlemi bekler (tek container)', async () => {
    const d = fakeDocker(ok(), { code: 1, stdout: '', stderr: '', missing: false }, ok());
    const start = torStarter(d.exec);
    const [a, b] = await Promise.all([start(), start()]);
    expect(a).toEqual({ state: 'running' });
    expect(b).toBe(a);
    expect(d.calls.filter((c) => c.args[0] === 'run')).toHaveLength(1);
  });
});
