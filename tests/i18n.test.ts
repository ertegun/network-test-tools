import { describe, expect, it } from 'vitest';
import en from '../src/renderer/src/locales/en.json';
import tr from '../src/renderer/src/locales/tr.json';
import { resolveLanguage } from '../src/renderer/src/i18n';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('çoklu dil (Gereksinim 11)', () => {
  it('TR ve EN dosyaları aynı anahtarlara sahip', () => {
    expect(keys(tr).sort()).toEqual(keys(en).sort());
  });

  it('boş çeviri yok', () => {
    const get = (obj: object, path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
    for (const lang of [tr, en]) {
      for (const k of keys(lang)) expect(String(get(lang, k)).trim(), k).not.toBe('');
    }
  });

  it('dil seçimi: sistem dili algılanır, bilinmeyen dil İngilizceye düşer', () => {
    expect(resolveLanguage('system', 'tr-TR')).toBe('tr');
    expect(resolveLanguage('system', 'en-US')).toBe('en');
    expect(resolveLanguage('system', 'de-DE')).toBe('en');
    expect(resolveLanguage('en', 'tr-TR')).toBe('en');
    expect(resolveLanguage('tr', 'en-US')).toBe('tr');
  });
});
