import { describe, expect, it } from 'vitest';
import {
  isValidHostname,
  isValidInterfaceName,
  isValidIPv4,
  isValidIPv6,
  maskToPrefix,
  normalizeMask,
  prefixToMask,
  validateStaticConfig,
} from '../src/core/validate';

describe('IP doğrulama', () => {
  it('geçerli ve geçersiz IPv4', () => {
    expect(isValidIPv4('192.168.1.10')).toBe(true);
    expect(isValidIPv4('0.0.0.0')).toBe(true);
    expect(isValidIPv4('999.1.1.1')).toBe(false);
    expect(isValidIPv4('1.2.3')).toBe(false);
    expect(isValidIPv4('01.2.3.4')).toBe(false);
    expect(isValidIPv4('1.2.3.4 ')).toBe(false);
    expect(isValidIPv4('1.2.3.4;calc')).toBe(false);
  });

  it('IPv6', () => {
    expect(isValidIPv6('::1')).toBe(true);
    expect(isValidIPv6('fe80::1')).toBe(true);
    expect(isValidIPv6('fe80::1%eth0')).toBe(false);
    expect(isValidIPv6('1.2.3.4')).toBe(false);
  });
});

describe('maske', () => {
  it('maske ↔ önek', () => {
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(prefixToMask(24)).toBe('255.255.255.0');
    expect(prefixToMask(32)).toBe('255.255.255.255');
    expect(prefixToMask(1)).toBe('128.0.0.0');
  });

  it('normalizeMask "/24", "24" ve noktalı biçimi kabul eder', () => {
    expect(normalizeMask('/24')).toBe('255.255.255.0');
    expect(normalizeMask('16')).toBe('255.255.0.0');
    expect(normalizeMask('255.255.255.128')).toBe('255.255.255.128');
    expect(normalizeMask('255.0.255.0')).toBeNull();
    expect(normalizeMask('/33')).toBeNull();
    expect(normalizeMask('0.0.0.0')).toBeNull();
  });
});

describe('statik yapılandırma (M7)', () => {
  const ok = { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1', dns: ['1.1.1.1'] };

  it('geçerli yapılandırma', () => {
    expect(validateStaticConfig(ok)).toEqual([]);
    expect(validateStaticConfig({ ...ok, mask: '/24' })).toEqual([]);
  });

  it('kabul kriteri: 999.1.1.1 reddedilir', () => {
    expect(validateStaticConfig({ ...ok, ip: '999.1.1.1' })).toContain('invalidIp');
  });

  it('maskeyle uyumsuz ağ geçidi', () => {
    expect(validateStaticConfig({ ...ok, gateway: '192.168.2.1' })).toContain('gatewayOutsideSubnet');
  });

  it('ağ/yayın adresi ve geçersiz DNS', () => {
    expect(validateStaticConfig({ ...ok, ip: '192.168.1.0' })).toContain('networkOrBroadcast');
    expect(validateStaticConfig({ ...ok, ip: '192.168.1.255' })).toContain('networkOrBroadcast');
    expect(validateStaticConfig({ ...ok, dns: ['8.8.8'] })).toContain('invalidDns');
    expect(validateStaticConfig({ ...ok, dns: ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9'] })).toContain('tooManyDns');
  });
});

describe('adlar', () => {
  it('ana bilgisayar adı', () => {
    expect(isValidHostname('proje.local')).toBe(true);
    expect(isValidHostname('a-b.example.com.')).toBe(true);
    expect(isValidHostname('-bad.com')).toBe(false);
    expect(isValidHostname('bad host')).toBe(false);
    expect(isValidHostname('a'.repeat(64) + '.com')).toBe(false);
  });

  it('arayüz adı: boşluklu Windows adları kabul, seçenek/kabuk karakterleri red', () => {
    expect(isValidInterfaceName('Ethernet 2')).toBe(true);
    expect(isValidInterfaceName('Yerel Ağ Bağlantısı')).toBe(true);
    expect(isValidInterfaceName('vEthernet (WSL)')).toBe(true);
    expect(isValidInterfaceName('en0')).toBe(true);
    expect(isValidInterfaceName('-rf')).toBe(false);
    expect(isValidInterfaceName('eth0; rm -rf /')).toBe(false);
    expect(isValidInterfaceName('a"b')).toBe(false);
    expect(isValidInterfaceName('a\nb')).toBe(false);
    expect(isValidInterfaceName('')).toBe(false);
  });
});
