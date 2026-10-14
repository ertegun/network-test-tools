// M7 — Ağ yapılandırması: DHCP/statik, DNS, otomatik geri alma ve profiller.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeStatus, Ipv4Config, NetProfile, NetworkSnapshot } from '../../../shared/types';
import { iconDelete, iconLock, iconPlay, iconWarning } from '../components/icons';
import { KeepChangeDialog } from '../components/KeepChangeDialog';
import { Alert, Button, Card, Dialog, Field, Icon, IconButton, Input, Select } from '../components/ui';
import { errorMessage } from '../lib/format';

interface FormState {
  mode: 'dhcp' | 'static';
  ip: string;
  mask: string;
  gateway: string;
  dns: string;
}

const toConfig = (f: FormState): Ipv4Config => {
  const dns = f.dns.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean);
  return f.mode === 'dhcp' ? { mode: 'dhcp', dns } : { mode: 'static', ip: f.ip.trim(), mask: f.mask.trim(), gateway: f.gateway.trim() || undefined, dns };
};

const toForm = (c: Ipv4Config): FormState => ({ mode: c.mode, ip: c.ip ?? '', mask: c.mask ?? '', gateway: c.gateway ?? '', dns: c.dns.join(', ') });

function describe(c: Ipv4Config, t: (k: string) => string): string {
  const dns = c.dns.length > 0 ? c.dns.join(', ') : t('config.dnsAuto');
  return c.mode === 'dhcp' ? `DHCP · DNS: ${dns}` : `${c.ip} / ${c.mask}${c.gateway ? ` · GW ${c.gateway}` : ''} · DNS: ${dns}`;
}

export default function NetConfig({ snapshot }: { snapshot?: NetworkSnapshot }) {
  const { t } = useTranslation();
  const [support, setSupport] = useState<{ supported: boolean; reason?: string }>();
  const ifaces = (snapshot?.interfaces ?? []).filter((i) => i.kind !== 'loopback' && i.kind !== 'vpn');
  const [iface, setIface] = useState('');
  const [current, setCurrent] = useState<Ipv4Config>();
  const [form, setForm] = useState<FormState>({ mode: 'dhcp', ip: '', mask: '255.255.255.0', gateway: '', dns: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<ChangeStatus>();
  const [profiles, setProfiles] = useState<NetProfile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    void window.netkit.config.support().then(setSupport);
    void window.netkit.config.profiles().then(setProfiles);
    return window.netkit.config.onStatus((s) => {
      setStatus(s);
      if (s.phase === 'confirmed' || s.phase === 'rolledBack') void window.netkit.config.profiles().then(setProfiles);
    });
  }, []);

  useEffect(() => {
    if (!iface && ifaces.length > 0) setIface(ifaces[0].name);
  }, [iface, ifaces]);

  useEffect(() => {
    if (!iface) return;
    setCurrent(undefined);
    window.netkit.config
      .read(iface)
      .then((c) => {
        setCurrent(c);
        setForm(toForm(c));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [iface, status?.phase]);

  const validate = async (cfg = toConfig(form)) => {
    setError(undefined);
    const v = await window.netkit.config.validate(iface, cfg);
    setErrors(v.errors);
    setConflict(v.conflict);
    return v.errors.length === 0;
  };

  const review = async (cfg = toConfig(form)) => {
    setForm(toForm(cfg));
    if (await validate(cfg)) setConfirmOpen(true);
  };

  const apply = async () => {
    setConfirmOpen(false);
    try {
      await window.netkit.config.apply(iface, toConfig(form));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saveProfile = async () => {
    try {
      setProfiles(await window.netkit.config.saveProfile({ name: profileName, config: toConfig(form) }));
      setProfileName('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (support && !support.supported) {
    return <Alert color="amber" icon={iconWarning}>{t(`config.unsupported.${support.reason ?? 'generic'}`)}</Alert>;
  }

  const busy = status?.phase === 'applying' || status?.phase === 'awaitingConfirm' || status?.phase === 'rollingBack';

  return (
    <div className="flex flex-col gap-4">
      <Alert color="blue" icon={iconLock}>
        {t('config.privilegeNote')}
      </Alert>
      <Card title={t('config.title')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Select label={t('config.interface')} value={iface} onChange={setIface} options={ifaces.map((i) => ({ value: i.name, label: i.name }))} />
          <div className="md:col-span-2">
            <Field label={t('config.current')}>{current ? describe(current, t) : '—'}</Field>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
          <Select<'dhcp' | 'static'>
            label={t('config.mode')}
            value={form.mode}
            onChange={(mode) => setForm({ ...form, mode })}
            options={[
              { value: 'dhcp', label: 'DHCP' },
              { value: 'static', label: t('config.static') },
            ]}
          />
          <Input label="IP" value={form.ip} onChange={(ip) => setForm({ ...form, ip })} disabled={form.mode === 'dhcp'} error={errors.includes('invalidIp')} />
          <Input label={t('config.mask')} value={form.mask} onChange={(mask) => setForm({ ...form, mask })} disabled={form.mode === 'dhcp'} error={errors.includes('invalidMask')} />
          <Input label={t('config.gateway')} value={form.gateway} onChange={(gateway) => setForm({ ...form, gateway })} disabled={form.mode === 'dhcp'} error={errors.some((e) => e.startsWith('gateway') || e === 'invalidGateway')} />
          <Input label={t('config.dns')} value={form.dns} onChange={(dns) => setForm({ ...form, dns })} error={errors.includes('invalidDns')} />
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('config.dnsHint')}</p>
        {errors.length > 0 && (
          <Alert color="red" className="mt-3">
            {errors.map((e) => t(`config.errors.${e}`, { defaultValue: e })).join(' · ')}
          </Alert>
        )}
        {conflict && (
          <Alert color="amber" icon={iconWarning} className="mt-3">
            {t('config.conflict', { ip: form.ip })}
          </Alert>
        )}
        {error && <Alert color="red" className="mt-3">{error}</Alert>}
        <div className="mt-3 flex gap-2">
          <Button variant="outlined" onClick={() => void validate()} disabled={!iface || busy}>
            {t('config.validate')}
          </Button>
          <Button onClick={() => void review()} disabled={!iface || busy}>
            <Icon icon={iconPlay} className="h-4 w-4" /> {t('config.apply')}
          </Button>
        </div>
      </Card>

      {status && status.phase !== 'awaitingConfirm' && (
        <Alert color={status.phase === 'confirmed' ? 'green' : status.phase === 'failed' ? 'red' : status.phase === 'rolledBack' ? 'amber' : 'blue'}>
          {t(`config.phase.${status.phase}`)} {status.error ? `(${status.error})` : ''}
        </Alert>
      )}

      <Card title={t('config.profiles')}>
        <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
          {profiles.length === 0 && <p className="text-sm text-gray-500">{t('config.noProfiles')}</p>}
          {profiles.map((p) => (
            <div key={p.name} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">{describe(p.config, t)}</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outlined" onClick={() => void review(p.config)} disabled={!iface || busy}>
                  {t('config.applyProfile')}
                </Button>
                <IconButton icon={iconDelete} label={t('common.delete')} onClick={() => void window.netkit.config.deleteProfile(p.name).then(setProfiles)} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Input label={t('config.profileName')} value={profileName} onChange={setProfileName} />
          </div>
          <Button variant="outlined" onClick={() => void saveProfile()} disabled={!profileName.trim()}>
            {t('config.saveProfile')}
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('config.reviewTitle')}
        footer={
          <>
            <Button variant="text" color="gray" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void apply()}>{t('config.applyWithPrivilege')}</Button>
          </>
        }
      >
        <p className="mb-2">{t('config.reviewBody', { iface })}</p>
        <Field label={t('config.before')}>{current ? describe(current, t) : '—'}</Field>
        <div className="mt-2">
          <Field label={t('config.after')}>{describe(toConfig(form), t)}</Field>
        </div>
        <p className="mt-3">{t('config.rollbackNote')}</p>
      </Dialog>

      <KeepChangeDialog status={status} />
    </div>
  );
}
