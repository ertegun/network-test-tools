// Port listesi ayrıştırma, hazır listeler ve bilinen servis adları (M2).

export const SERVICE_NAMES: Readonly<Record<number, string>> = {
  20: 'FTP-DATA', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 69: 'TFTP',
  80: 'HTTP', 88: 'Kerberos', 110: 'POP3', 111: 'RPCbind', 119: 'NNTP', 123: 'NTP', 135: 'MS-RPC',
  137: 'NetBIOS-NS', 139: 'NetBIOS-SSN', 143: 'IMAP', 161: 'SNMP', 179: 'BGP', 389: 'LDAP',
  443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 500: 'IKE', 514: 'Syslog', 515: 'LPD', 548: 'AFP',
  554: 'RTSP', 587: 'SMTP-Submission', 631: 'IPP', 636: 'LDAPS', 873: 'rsync', 902: 'VMware',
  989: 'FTPS-DATA', 990: 'FTPS', 993: 'IMAPS', 995: 'POP3S', 1080: 'SOCKS', 1194: 'OpenVPN',
  1433: 'MSSQL', 1521: 'Oracle', 1701: 'L2TP', 1723: 'PPTP', 1883: 'MQTT', 1900: 'SSDP',
  2049: 'NFS', 2082: 'cPanel', 2083: 'cPanel-SSL', 2181: 'ZooKeeper', 2375: 'Docker', 2376: 'Docker-TLS',
  3000: 'HTTP-Dev', 3128: 'Squid', 3268: 'LDAP-GC', 3306: 'MySQL', 3389: 'RDP', 3690: 'SVN',
  4433: 'HTTPS-Alt', 4500: 'IPsec-NAT', 5000: 'UPnP', 5060: 'SIP', 5061: 'SIPS', 5222: 'XMPP',
  5353: 'mDNS', 5432: 'PostgreSQL', 5601: 'Kibana', 5672: 'AMQP', 5900: 'VNC', 5938: 'TeamViewer',
  5984: 'CouchDB', 6379: 'Redis', 6443: 'Kubernetes-API', 6667: 'IRC', 7001: 'WebLogic',
  8000: 'HTTP-Alt', 8008: 'HTTP-Alt', 8080: 'HTTP-Proxy', 8081: 'HTTP-Alt', 8443: 'HTTPS-Alt',
  8883: 'MQTT-TLS', 8888: 'HTTP-Alt', 9000: 'HTTP-Alt', 9090: 'HTTP-Alt', 9092: 'Kafka',
  9100: 'JetDirect', 9200: 'Elasticsearch', 9418: 'Git', 10000: 'Webmin', 11211: 'Memcached',
  27017: 'MongoDB', 51820: 'WireGuard',
};

export function serviceName(port: number): string | undefined {
  return SERVICE_NAMES[port];
}

// Nmap'in en sık görülen TCP portları listesinden derlenmiş 100 port.
const TOP_100 = [
  7, 9, 13, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88, 106, 110, 111, 113, 119, 135, 139, 143, 144,
  179, 199, 389, 427, 443, 444, 445, 465, 513, 514, 515, 543, 544, 548, 554, 587, 631, 646, 873, 990,
  993, 995, 1025, 1026, 1027, 1028, 1029, 1110, 1433, 1720, 1723, 1755, 1900, 2000, 2001, 2049, 2121,
  2717, 3000, 3128, 3306, 3389, 3986, 4899, 5000, 5009, 5051, 5060, 5101, 5190, 5357, 5432, 5631,
  5666, 5800, 5900, 6000, 6001, 6646, 7070, 8000, 8008, 8009, 8080, 8081, 8443, 8888, 9100, 9999,
  10000, 32768, 49152, 49153, 49154, 49155, 49156, 49157,
];

export const PORT_PRESETS = {
  top100: TOP_100,
  web: [80, 443, 8000, 8008, 8080, 8081, 8443, 8888, 3000, 9000],
  mail: [25, 110, 143, 465, 587, 993, 995],
  remote: [22, 23, 3389, 5900, 5938, 5800],
  database: [1433, 1521, 3306, 5432, 6379, 9200, 11211, 27017, 5984],
  all: Array.from({ length: 65535 }, (_, i) => i + 1),
} as const satisfies Record<string, readonly number[]>;

export type PortPreset = keyof typeof PORT_PRESETS;

export const MAX_PORTS_PER_SCAN = 65535;

/**
 * "22, 80-90,443" biçimindeki listeyi sıralı, tekrarsız port dizisine çevirir.
 * Geçersiz parça varsa Error fırlatır (mesaj parçayı içerir).
 */
export function parsePortList(input: string): number[] {
  const result = new Set<number>();
  const parts = input.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error('empty');
  for (const part of parts) {
    const range = /^(\d{1,5})\s*-\s*(\d{1,5})$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (!isPort(from) || !isPort(to) || from > to) throw new Error(part);
      for (let p = from; p <= to; p++) result.add(p);
      continue;
    }
    if (!/^\d{1,5}$/.test(part) || !isPort(Number(part))) throw new Error(part);
    result.add(Number(part));
  }
  return [...result].sort((a, b) => a - b);
}

export function isPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}
