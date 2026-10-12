import i18n from '../i18n';

const locale = () => (i18n.language === 'tr' ? 'tr-TR' : 'en-US');

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'medium', timeZone }).format(new Date(iso));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(locale()).format(n);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Hata nesnesinden IPC önekini temizlenmiş mesaj çıkarır. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n;]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
