// SMTP test sayfası: denemeyi yapar, sonucu userData/smtp-log.json'a yazar (yeni→eski, en fazla 500).
// Kayıt alanları tek tek seçilir; parola kayda girmez.

import { randomUUID } from 'node:crypto';
import { parseSmtpRequest, sendTestMail } from '../core/smtp';
import type { SmtpTestRecord, SmtpTestResult } from '../shared/types';
import type { JsonFile } from './store';

export const SMTP_LOG_LIMIT = 500;

export class SmtpService {
  // Yazmalar sıraya alınır; üst üste gelen denemeler birbirinin kaydını ezmesin.
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: JsonFile<SmtpTestRecord[]>,
    private readonly send = sendTestMail,
  ) {}

  async records(): Promise<SmtpTestRecord[]> {
    const list = await this.file.read();
    return Array.isArray(list) ? list : [];
  }

  async test(raw: unknown): Promise<SmtpTestResult> {
    const { req, errors } = parseSmtpRequest(raw);
    if (Object.keys(errors).length > 0) return { errors, records: await this.records() };
    const time = new Date().toISOString();
    const outcome = await this.send(req);
    const record: SmtpTestRecord = {
      id: randomUUID(),
      time,
      host: req.host,
      port: req.port,
      security: req.security,
      username: req.username,
      from: req.from,
      to: req.to,
      ...outcome,
    };
    return { errors: {}, records: await this.update((list) => [record, ...list].slice(0, SMTP_LOG_LIMIT)) };
  }

  clear(): Promise<SmtpTestRecord[]> {
    return this.update(() => []);
  }

  private update(fn: (list: SmtpTestRecord[]) => SmtpTestRecord[]): Promise<SmtpTestRecord[]> {
    const next = this.writes.then(async () => {
      const list = fn(await this.records());
      await this.file.write(list);
      return list;
    });
    this.writes = next.catch(() => undefined);
    return next;
  }
}
