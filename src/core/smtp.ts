// SMTP testi. Yeni bağımlılık eklememek için node:net/tls ile en küçük istemci:
// EHLO, STARTTLS, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA. Parola hiçbir çıktıya yazılmaz.

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect as netConnect, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { connect as tlsConnect } from 'node:tls';
import type { SmtpErrorKind, SmtpField, SmtpRequest, SmtpSecurity } from '../shared/types';
import { isValidHostname, isValidIP } from './validate';

export const SMTP_TIMEOUT_MS = 15_000;

const SECURITY: SmtpSecurity[] = ['none', 'starttls', 'tls'];
const LOCAL_PART = /^[^\s@<>()[\]",;:\\]{1,64}$/;

export function isValidEmail(value: string): boolean {
  const at = value.lastIndexOf('@');
  if (value.length > 254 || at < 1) return false;
  const domain = value.slice(at + 1);
  return LOCAL_PART.test(value.slice(0, at)) && domain.includes('.') && isValidHostname(domain);
}

/** Renderer'dan gelen isteği süzer ve doğrular. Gönderen boşsa kullanıcı adı kullanılır. */
export function parseSmtpRequest(raw: unknown): { req: SmtpRequest; errors: Partial<Record<SmtpField, string>> } {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  if (!SECURITY.includes(p.security as SmtpSecurity)) throw new Error('invalidRequest');
  const username = str('username').trim();
  const req: SmtpRequest = {
    host: str('host').trim(),
    port: typeof p.port === 'number' ? p.port : NaN,
    security: p.security as SmtpSecurity,
    username,
    password: str('password'),
    from: str('from').trim() || username,
    to: str('to').trim(),
  };
  const errors: Partial<Record<SmtpField, string>> = {};
  if (!req.host) errors.host = 'required';
  else if (!isValidHostname(req.host) && !isValidIP(req.host)) errors.host = 'invalid';
  if (!Number.isInteger(req.port) || req.port < 1 || req.port > 65535) errors.port = 'invalid';
  if (!req.from) errors.from = 'required';
  else if (!isValidEmail(req.from)) errors.from = 'invalid';
  if (!req.to) errors.to = 'required';
  else if (!isValidEmail(req.to)) errors.to = 'invalid';
  return { req, errors };
}

export type SmtpOutcome = { ok: boolean; ms: number; errorKind?: SmtpErrorKind; code?: number; error?: string };

interface Reply {
  code: number;
  text: string;
  lines: string[];
}

class SmtpReplyError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

class TimeoutError extends Error {}

/** Soketten SMTP yanıtlarını okur; çok satırlı yanıtlar ("250-...") tek yanıtta birleşir. */
class ReplyReader {
  private buf = '';
  private lines: string[] = [];
  private queue: Reply[] = [];
  private waiting?: { resolve: (r: Reply) => void; reject: (e: Error) => void };
  private failed?: Error;
  private sock?: Socket;

  private readonly onData = (d: Buffer) => {
    this.buf += d.toString('latin1');
    for (let i = this.buf.indexOf('\n'); i >= 0; i = this.buf.indexOf('\n')) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.lines.push(line);
      if (line[3] === '-') continue;
      const lines = this.lines.splice(0);
      const reply = { code: /^\d{3}/.test(line) ? Number(line.slice(0, 3)) : 0, text: lines.map((l) => l.slice(4)).join('\n'), lines };
      if (this.waiting) this.settle().resolve(reply);
      else this.queue.push(reply);
    }
  };

  private readonly onEnd = (e?: unknown) => {
    this.failed ??= e instanceof Error ? e : new Error('connection closed');
    if (this.waiting) this.settle().reject(this.failed);
  };

  private settle() {
    const w = this.waiting!;
    this.waiting = undefined;
    return w;
  }

  /** STARTTLS sonrası okuma yeni sokete geçer; eski soketin hata dinleyicisi kalır (yakalanmamış hata olmasın). */
  attach(sock: Socket) {
    this.sock?.off('data', this.onData);
    this.sock = sock;
    sock.on('data', this.onData).on('error', this.onEnd).on('close', () => this.onEnd());
  }

  read(): Promise<Reply> {
    const r = this.queue.shift();
    if (r) return Promise.resolve(r);
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => (this.waiting = { resolve, reject }));
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function message(req: SmtpRequest, date: Date): string {
  return [
    `From: <${req.from}>`,
    `To: <${req.to}>`,
    'Subject: NetKit SMTP test',
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${randomUUID()}@netkit>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `NetKit SMTP test: ${date.toISOString()}`,
    '.',
  ].join('\r\n');
}

/** Hata metninde parola ya da AUTH sırasında gönderilen kodlanmış hali geçiyorsa gizlenir. */
function scrub(text: string, req: SmtpRequest): string {
  const secrets = req.password ? [b64(`\0${req.username}\0${req.password}`), b64(req.password), req.password] : [];
  return secrets.reduce((t, s) => t.split(s).join('***'), text).slice(0, 500);
}

function ehloName(): string {
  const name = hostname();
  return isValidHostname(name) ? name : 'localhost';
}

/** Tek bir test e-postası gönderir. Tüm deneme `timeoutMs` içinde bitmezse "timeout" döner. */
export async function sendTestMail(req: SmtpRequest, timeoutMs = SMTP_TIMEOUT_MS): Promise<SmtpOutcome> {
  const started = Date.now();
  const servername = isValidIP(req.host) ? undefined : req.host;
  const sockets: Socket[] = [];
  const reader = new ReplyReader();
  let kind: SmtpErrorKind = 'connect';
  let sock: Socket;

  const command = async (line: string | null, ...codes: number[]) => {
    if (line !== null) sock.write(`${line}\r\n`);
    const reply = await reader.read();
    if (!codes.includes(reply.code)) throw new SmtpReplyError(reply.code, reply.text || reply.lines.join('\n'));
    return reply;
  };
  const ehlo = async () => (await command(`EHLO ${ehloName()}`, 250)).lines.slice(1).map((l) => l.slice(4).toUpperCase());

  const run = async () => {
    if (req.security === 'tls') {
      sock = tlsConnect({ host: req.host, port: req.port, servername });
      sock.once('connect', () => (kind = 'tls')).once('secureConnect', () => (kind = 'connect'));
    } else {
      sock = netConnect({ host: req.host, port: req.port });
    }
    sockets.push(sock);
    reader.attach(sock);
    await command(null, 220);
    let ext = await ehlo();

    if (req.security === 'starttls') {
      kind = 'tls';
      await command('STARTTLS', 220);
      sock = tlsConnect({ socket: sock, servername });
      sockets.push(sock);
      reader.attach(sock);
      await once(sock, 'secureConnect');
      kind = 'connect';
      ext = await ehlo();
    }

    if (req.username) {
      kind = 'auth';
      const mechs = (ext.find((l) => /^AUTH[ =]/.test(l)) ?? '').split(/[ =]/);
      if (!mechs.includes('PLAIN') && mechs.includes('LOGIN')) {
        await command('AUTH LOGIN', 334);
        await command(b64(req.username), 334);
        await command(b64(req.password), 235);
      } else {
        await command(`AUTH PLAIN ${b64(`\0${req.username}\0${req.password}`)}`, 235);
      }
    }

    kind = 'send';
    await command(`MAIL FROM:<${req.from}>`, 250);
    await command(`RCPT TO:<${req.to}>`, 250, 251);
    await command('DATA', 354);
    await command(message(req, new Date()), 250);
    sock.write('QUIT\r\n');
  };

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new TimeoutError()), timeoutMs)));
  try {
    await Promise.race([run(), timeout]);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof TimeoutError) return { ok: false, ms, errorKind: 'timeout' };
    const code = err instanceof SmtpReplyError && err.code > 0 ? err.code : undefined;
    return { ok: false, ms, errorKind: kind, code, error: scrub(err instanceof Error ? err.message : String(err), req) };
  } finally {
    clearTimeout(timer);
    sockets.forEach((s) => s.destroy());
  }
}
