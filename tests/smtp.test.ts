import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSmtpRequest, sendTestMail } from '../src/core/smtp';
import { SMTP_LOG_LIMIT, SmtpService } from '../src/main/smtp';
import { JsonFile } from '../src/main/store';
import type { SmtpRequest, SmtpTestRecord } from '../src/shared/types';

const PASSWORD = 'S3cret!pass';

interface FakeOptions {
  auth?: string;
  authReply?: string;
  greet?: boolean;
}

/** Komutları kaydeden, betikli yanıt veren en küçük SMTP sunucusu. */
function fakeSmtp(opts: FakeOptions = {}) {
  const commands: string[] = [];
  const server = createServer((sock) => {
    if (opts.greet === false) return;
    sock.write('220 fake ESMTP\r\n');
    let buf = '';
    let inData = false;
    let login = 0;
    sock.on('data', (d) => {
      buf += d.toString();
      for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 queued\r\n');
          } else commands.push(`DATA> ${line}`);
          continue;
        }
        commands.push(line);
        const authReply = `${opts.authReply ?? '235 2.7.0 Accepted'}\r\n`;
        if (login > 0) {
          sock.write(login === 1 ? '334 UGFzc3dvcmQ6\r\n' : authReply);
          login = login === 1 ? 2 : 0;
        }
        else if (line.startsWith('EHLO')) sock.write(`250-fake\r\n250-AUTH ${opts.auth ?? 'PLAIN LOGIN'}\r\n250 OK\r\n`);
        else if (line === 'AUTH LOGIN') {
          login = 1;
          sock.write('334 VXNlcm5hbWU6\r\n');
        } else if (line.startsWith('AUTH PLAIN')) sock.write(authReply);
        else if (line === 'DATA') {
          inData = true;
          sock.write('354 go ahead\r\n');
        } else if (line === 'STARTTLS') {
          // Sertifikasız sahte sunucu: el sıkışma yerine düz metin gelir, TLS kurulamaz.
          sock.write('220 ready\r\n');
          setTimeout(() => sock.write('not tls\r\n'), 50);
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => undefined);
  });
  return { server, commands };
}

const listen = (s: Server) => new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)));

const request = (port: number, patch: Partial<SmtpRequest> = {}): SmtpRequest => ({
  host: '127.0.0.1',
  port,
  security: 'none',
  username: 'user@example.com',
  password: PASSWORD,
  from: 'user@example.com',
  to: 'to@example.com',
  ...patch,
});

let servers: Server[] = [];
async function start(opts?: FakeOptions) {
  const fake = fakeSmtp(opts);
  servers.push(fake.server);
  return { ...fake, port: await listen(fake.server) };
}

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});

describe('SMTP isteği doğrulama', () => {
  const base = { host: 'smtp.example.com', port: 587, security: 'starttls', username: 'u@example.com', password: 'x', from: '', to: 'a@example.com' };

  it('geçerli istek; gönderen boşsa kullanıcı adı kullanılır', () => {
    const { req, errors } = parseSmtpRequest(base);
    expect(errors).toEqual({});
    expect(req.from).toBe('u@example.com');
  });

  it('boş sunucu, geçersiz port ve alıcı alan bazında reddedilir', () => {
    expect(parseSmtpRequest({ ...base, host: '' }).errors).toEqual({ host: 'required' });
    expect(parseSmtpRequest({ ...base, host: 'bad host' }).errors).toEqual({ host: 'invalid' });
    expect(parseSmtpRequest({ ...base, port: 0 }).errors).toEqual({ port: 'invalid' });
    expect(parseSmtpRequest({ ...base, port: 65536 }).errors).toEqual({ port: 'invalid' });
    expect(parseSmtpRequest({ ...base, port: '25' }).errors).toEqual({ port: 'invalid' });
    expect(parseSmtpRequest({ ...base, to: '' }).errors).toEqual({ to: 'required' });
    expect(parseSmtpRequest({ ...base, to: 'a@b' }).errors).toEqual({ to: 'invalid' });
    expect(parseSmtpRequest({ ...base, to: 'a@example.com\r\nBcc: x@example.com' }).errors).toEqual({ to: 'invalid' });
  });

  it('gönderen ve kullanıcı adı boşsa ya da gönderen e-posta değilse reddedilir', () => {
    expect(parseSmtpRequest({ ...base, username: '' }).errors).toEqual({ from: 'required' });
    expect(parseSmtpRequest({ ...base, username: 'apikey' }).errors).toEqual({ from: 'invalid' });
    expect(parseSmtpRequest({ ...base, username: 'apikey', from: 'me@example.com' }).errors).toEqual({});
  });

  it('bilinmeyen güvenlik türü reddedilir', () => {
    expect(() => parseSmtpRequest({ ...base, security: 'ssl3' })).toThrow('invalidRequest');
  });
});

describe('SMTP gönderimi', () => {
  it('AUTH PLAIN ile gönderir; konu ve uygulama adı mesajda', async () => {
    const { port, commands } = await start();
    const r = await sendTestMail(request(port));
    expect(r).toMatchObject({ ok: true });
    expect(commands).toContain('MAIL FROM:<user@example.com>');
    expect(commands).toContain('RCPT TO:<to@example.com>');
    expect(commands).toContain('DATA> Subject: NetKit SMTP test');
    expect(commands.find((c) => c.startsWith('AUTH PLAIN'))).toBeDefined();
  });

  it('yalnız LOGIN destekleniyorsa AUTH LOGIN kullanılır', async () => {
    const { port, commands } = await start({ auth: 'LOGIN' });
    expect(await sendTestMail(request(port))).toMatchObject({ ok: true });
    expect(commands).toContain('AUTH LOGIN');
    expect(commands).toContain(Buffer.from(PASSWORD).toString('base64'));
  });

  it('yanlış parola: auth hatası, SMTP kodu ve sunucu metni', async () => {
    const { port } = await start({ authReply: '535 5.7.8 Authentication credentials invalid' });
    const r = await sendTestMail(request(port));
    expect(r).toMatchObject({ ok: false, errorKind: 'auth', code: 535, error: '5.7.8 Authentication credentials invalid' });
  });

  it('sunucu parolayı hata metninde geri yansıtsa bile gizlenir', async () => {
    const plain = Buffer.from(`\0user@example.com\0${PASSWORD}`).toString('base64');
    const { port } = await start({ authReply: `535 bad ${PASSWORD} ${plain}` });
    const r = await sendTestMail(request(port));
    expect(r.error).toBe('bad *** ***');
  });

  it('kullanıcı adı boşsa AUTH yapılmaz', async () => {
    const { port, commands } = await start();
    expect(await sendTestMail(request(port, { username: '', password: '' }))).toMatchObject({ ok: true });
    expect(commands.some((c) => c.startsWith('AUTH'))).toBe(false);
  });

  it('sunucu yanıt vermezse zaman aşımı', async () => {
    const { port } = await start({ greet: false });
    const r = await sendTestMail(request(port), 200);
    expect(r).toMatchObject({ ok: false, errorKind: 'timeout' });
  });

  it('STARTTLS ya da SSL/TLS el sıkışması kurulamazsa tls hatası', async () => {
    const { port, commands } = await start();
    expect(await sendTestMail(request(port, { security: 'starttls' }))).toMatchObject({ ok: false, errorKind: 'tls' });
    expect(commands).toContain('STARTTLS');
    expect(commands.some((c) => c.startsWith('AUTH'))).toBe(false);
    expect(await sendTestMail(request(port, { security: 'tls' }))).toMatchObject({ ok: false, errorKind: 'tls' });
  });

  it('bağlantı reddedilirse connect hatası', async () => {
    const tmp = createServer();
    const port = await listen(tmp);
    await new Promise((r) => tmp.close(r));
    expect(await sendTestMail(request(port))).toMatchObject({ ok: false, errorKind: 'connect' });
  });
});

describe('SMTP kayıtları', () => {
  let dir: string;
  let file: JsonFile<SmtpTestRecord[]>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'netkit-smtp-'));
    file = new JsonFile<SmtpTestRecord[]>(join(dir, 'smtp-log.json'), () => []);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const input = { host: 'smtp.example.com', port: 587, security: 'starttls', username: 'u@example.com', password: PASSWORD, from: '', to: 'a@example.com' };

  it('başarılı ve başarısız denemeler yeni→eski kaydedilir, parola dosyada yok, yeniden açılınca durur', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, ms: 10 })
      .mockResolvedValueOnce({ ok: false, ms: 5, errorKind: 'auth', code: 535, error: 'bad credentials' });
    const svc = new SmtpService(file, send);
    await svc.test(input);
    const r = await svc.test(input);
    expect(r.records.map((x) => x.ok)).toEqual([false, true]);
    expect(r.records[0]).toMatchObject({ host: 'smtp.example.com', from: 'u@example.com', code: 535 });
    expect(await readFile(join(dir, 'smtp-log.json'), 'utf8')).not.toContain(PASSWORD);
    expect(await new SmtpService(file, send).records()).toHaveLength(2);
  });

  it('geçersiz istekte gönderim yapılmaz, kayıt eklenmez', async () => {
    const send = vi.fn();
    const r = await new SmtpService(file, send).test({ ...input, to: 'x' });
    expect(r.errors).toEqual({ to: 'invalid' });
    expect(r.records).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it(`en fazla ${SMTP_LOG_LIMIT} kayıt tutulur; temizle hepsini siler`, async () => {
    const old = Array.from({ length: SMTP_LOG_LIMIT }, (_, i) => ({ id: String(i) }) as SmtpTestRecord);
    await file.write(old);
    const svc = new SmtpService(file, vi.fn().mockResolvedValue({ ok: true, ms: 1 }));
    const r = await svc.test(input);
    expect(r.records).toHaveLength(SMTP_LOG_LIMIT);
    expect(r.records[SMTP_LOG_LIMIT - 1].id).toBe(String(SMTP_LOG_LIMIT - 2));
    expect(await svc.clear()).toEqual([]);
    expect(await svc.records()).toEqual([]);
  });
});
