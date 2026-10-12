import { describe, expect, it } from 'vitest';
import { parsePortList, PORT_PRESETS, serviceName } from '../src/core/ports';

describe('port listesi', () => {
  it('tekil, aralık ve virgül', () => {
    expect(parsePortList('22, 80-82,443,80')).toEqual([22, 80, 81, 82, 443]);
    expect(parsePortList('1-1024')).toHaveLength(1024);
  });

  it('geçersiz girdiler', () => {
    expect(() => parsePortList('')).toThrow();
    expect(() => parsePortList('0')).toThrow();
    expect(() => parsePortList('65536')).toThrow();
    expect(() => parsePortList('90-80')).toThrow();
    expect(() => parsePortList('80;calc')).toThrow();
  });

  it('hazır listeler geçerli; sık kullanılan liste 100 benzersiz port', () => {
    expect(new Set(PORT_PRESETS.top100).size).toBe(100);
    for (const list of Object.values(PORT_PRESETS)) {
      expect(list.every((p) => Number.isInteger(p) && p >= 1 && p <= 65535)).toBe(true);
    }
  });

  it('servis adları', () => {
    expect(serviceName(443)).toBe('HTTPS');
    expect(serviceName(3389)).toBe('RDP');
    expect(serviceName(1)).toBeUndefined();
  });
});
