import { describe, expect, it } from 'vitest';
import { DNS_PRESETS, saveDnsEntry, validateDnsEntry } from '../src/core/dnsServers';
import { isValidIPv4 } from '../src/core/validate';
import type { DnsEntry } from '../src/shared/types';

let n = 0;
const newId = () => `id-${++n}`;

describe('DNS değiştirici kayıtları', () => {
  it('hazır listede en az 5 sağlayıcı var, adresler geçerli ve hepsi hazır işaretli', () => {
    expect(DNS_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of DNS_PRESETS) {
      expect(isValidIPv4(p.primary), p.name).toBe(true);
      expect(isValidIPv4(p.secondary ?? ''), p.name).toBe(true);
      expect(p.builtin).toBe(true);
    }
    expect(DNS_PRESETS.find((p) => p.id === 'cloudflare')).toMatchObject({ primary: '1.1.1.1', secondary: '1.0.0.1' });
  });

  it('kabul kriteri: "1.2.3" birincil olarak reddedilir ve kayıt yapılmaz', () => {
    expect(validateDnsEntry({ name: 'Ev', primary: '1.2.3' }, [])).toEqual({ errors: ['invalidPrimary'] });
    expect(() => saveDnsEntry([], { name: 'Ev', primary: '1.2.3' }, newId)).toThrow('invalidPrimary');
  });

  it('ad zorunlu; ikincil geçersiz ya da birincille aynıysa reddedilir', () => {
    expect(validateDnsEntry({ name: ' ', primary: '10.0.0.1', secondary: 'x' }, []).errors).toEqual(['invalidName', 'invalidSecondary']);
    expect(validateDnsEntry({ name: 'Ev', primary: '10.0.0.1', secondary: '10.0.0.1' }, []).errors).toEqual(['invalidSecondary']);
  });

  it('aynı birincil/ikincil çifti hazır listede ya da kullanıcı kayıtlarında varsa eklenemez', () => {
    expect(validateDnsEntry({ name: 'Kopya', primary: '1.1.1.1', secondary: '1.0.0.1' }, []).errors).toEqual(['duplicate']);
    const list = saveDnsEntry([], { name: 'Ev', primary: '192.168.1.1' }, newId);
    expect(() => saveDnsEntry(list, { name: 'Ev 2', primary: ' 192.168.1.1 ' }, newId)).toThrow('duplicate');
    // Yalnızca birincili aynı olan farklı bir çift eklenebilir.
    expect(saveDnsEntry(list, { name: 'Ev 2', primary: '192.168.1.1', secondary: '192.168.1.2' }, newId)).toHaveLength(2);
  });

  it('ekler, kimlikle günceller; boş ikincil saklanmaz', () => {
    const added = saveDnsEntry([], { name: ' Ofis ', primary: '10.1.1.1', secondary: '' }, () => 'a');
    expect(added).toEqual([{ id: 'a', name: 'Ofis', primary: '10.1.1.1' }]);
    // Kendi çiftiyle güncellemek "duplicate" sayılmaz.
    const edited = saveDnsEntry(added, { id: 'a', name: 'Ofis 2', primary: '10.1.1.1', secondary: '10.1.1.2' }, newId);
    expect(edited).toEqual([{ id: 'a', name: 'Ofis 2', primary: '10.1.1.1', secondary: '10.1.1.2' }]);
  });

  it('hazır kayıt düzenlenemez', () => {
    const custom: DnsEntry[] = [];
    expect(() => saveDnsEntry(custom, { id: 'cloudflare', name: 'X', primary: '10.9.9.9' }, newId)).toThrow('notFound');
  });
});
