// M1 — Ağ bilgi paneli.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NetInterface, NetworkSnapshot } from '../../../shared/types';
import { iconEthernet, iconInfo, iconLan, iconPublic, iconRefresh, iconVpn, iconWifi } from '../components/icons';
import { Alert, Card, Chip, Field, Icon, IconButton, InfoTip, Switch } from '../components/ui';
import { errorMessage, formatDateTime, formatDuration } from '../lib/format';

const KIND_ICON = { vpn: iconVpn, wifi: iconWifi, ethernet: iconEthernet, loopback: iconLan, other: iconLan };

function InterfaceCard({ iface }: { iface: NetInterface }) {
  const { t } = useTranslation();
  return (
    <Card
      className={iface.kind === 'vpn' ? 'border-l-4 !border-l-blue-500' : ''}
      title={
        <span className="flex items-center gap-2">
          <Icon icon={KIND_ICON[iface.kind]} />
          {iface.name}
        </span>
      }
      actions={
        <>
          <Chip value={t(`kind.${iface.kind}`)} color={iface.kind === 'vpn' ? 'blue' : 'gray'} variant={iface.kind === 'vpn' ? 'filled' : 'ghost'} />
          <Chip value={iface.up ? t('dashboard.up') : t('dashboard.down')} color={iface.up ? 'green' : 'red'} />
        </>
      }
    >
      {iface.description && <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{iface.description}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="IPv4">{iface.ipv4.length > 0 ? iface.ipv4.map((a) => a.cidr ?? a.address).join(', ') : '—'}</Field>
        <Field label={t('dashboard.mask')} info={<InfoTip icon={iconInfo} text={t('help.mask')} />}>
          {iface.ipv4[0]?.netmask ?? '—'}
        </Field>
        <Field label={t('dashboard.gateway')} info={<InfoTip icon={iconInfo} text={t('help.gateway')} />}>
          {iface.gateway ?? '—'}
        </Field>
        <Field label="DNS" info={<InfoTip icon={iconInfo} text={t('help.dns')} />}>
          {iface.dns.length > 0 ? iface.dns.join(', ') : '—'}
        </Field>
        <Field label={t('dashboard.addressing')} info={<InfoTip icon={iconInfo} text={t('help.dhcp')} />}>
          {iface.dhcp === undefined ? '—' : iface.dhcp ? 'DHCP' : t('dashboard.static')}
          {iface.leaseSeconds !== undefined && ` · ${t('dashboard.lease')} ${formatDuration(iface.leaseSeconds)}`}
        </Field>
        <Field label="MAC">{iface.mac ?? '—'}</Field>
        {iface.ipv6.length > 0 && (
          <div className="col-span-2">
            <Field label="IPv6">{iface.ipv6.map((a) => a.cidr ?? a.address).join(', ')}</Field>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function Dashboard({ snapshot, onSnapshot }: { snapshot?: NetworkSnapshot; onSnapshot: (s: NetworkSnapshot) => void }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    setRefreshing(true);
    setError(undefined);
    try {
      onSnapshot(await window.netkit.network.refreshPublicIp());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  if (!snapshot) return <p className="text-sm text-gray-500">{t('common.loading')}</p>;
  // Varsayılan görünüm: VPN'ler ve kullanılabilir IPv4'ü olan arayüzler (loopback ve yalnızca 169.254.x gizli).
  const visible = snapshot.interfaces.filter(
    (i) => showAll || i.kind === 'vpn' || (i.kind !== 'loopback' && i.ipv4.some((a) => !a.address.startsWith('169.254.'))),
  );
  const p = snapshot.publicIp;

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={
          <span className="flex items-center gap-2">
            <Icon icon={iconPublic} />
            {t('dashboard.publicIp')}
          </span>
        }
        actions={<IconButton icon={iconRefresh} label={t('common.refresh')} onClick={refresh} disabled={refreshing || snapshot.publicIpDisabled} />}
      >
        {snapshot.publicIpDisabled ? (
          <p className="text-sm text-gray-500">{t('dashboard.publicIpDisabled')}</p>
        ) : p ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="IP">{p.ip}</Field>
            <Field label={t('dashboard.source')}>{p.serviceHost}</Field>
            <Field label={t('dashboard.queriedAt')}>{formatDateTime(p.queriedAt)}</Field>
            <Field label={t('dashboard.exitInterface')}>{p.interfaceName ?? '—'}</Field>
          </div>
        ) : (
          <Alert color="amber">{t('dashboard.publicIpError', { error: snapshot.publicIpError ?? '' })}</Alert>
        )}
        {error && <Alert color="red" className="mt-2">{error}</Alert>}
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm text-gray-600 dark:text-gray-400">
          {t('dashboard.hostname')}: <span className="font-mono">{snapshot.hostname}</span> · {t('dashboard.updated')} {formatDateTime(snapshot.updatedAt)}
        </h2>
        <Switch checked={showAll} onChange={setShowAll} label={t('dashboard.showAll')} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {visible.map((i) => (
          <InterfaceCard key={i.name} iface={i} />
        ))}
      </div>
    </div>
  );
}
