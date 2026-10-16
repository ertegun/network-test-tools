import { describe, expect, it } from 'vitest';
import { portsFor } from '../src/main/scan';

describe('portsFor', () => {
  it('top100 → 100 port, all → 1-65535 benzersiz ve sıralı', () => {
    expect(portsFor({ target: 'x', preset: 'top100' })).toHaveLength(100);
    const all = portsFor({ target: 'x', preset: 'all' });
    expect(all).toHaveLength(65535);
    expect(new Set(all).size).toBe(65535);
    expect(all[0]).toBe(1);
    expect(all[65534]).toBe(65535);
  });

  it('hazır listede metin girişi doğrulanmaz, özel listede geçersiz giriş reddedilir', () => {
    expect(portsFor({ target: 'x', preset: 'all', ports: 'abc' })).toHaveLength(65535);
    expect(portsFor({ target: 'x', preset: 'top100', ports: '70000' })).toHaveLength(100);
    expect(() => portsFor({ target: 'x', ports: 'abc' })).toThrow();
    expect(() => portsFor({ target: 'x', ports: '70000' })).toThrow();
  });
});
