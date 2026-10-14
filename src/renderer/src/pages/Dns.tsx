// DNS değiştirici: hazır ya da kullanıcı kaydından seçilen DNS, seçili arayüze onaylı akışla yazılır.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeStatus, DnsEntry, NetworkSnapshot } from '../../../shared/types';
import { iconDelete, iconEdit, iconLock, iconPlay, iconRefresh } from '../components/icons';
import { KeepChangeDialog } from '../components/KeepChangeDialog';
import { Alert, Button, Card, Chip, Field, Icon, IconButton, Input, Select } from '../components/ui';
import { errorMessage } from '../lib/format';

interface FormState {
  id?: string;
  name: string;
  primary: string;
  secondary: string;
}

const EMPTY_FORM: FormState = { name: '', primary: '', secondary: '' };
const serversOf = (e: DnsEntry) => (e.secondary ? [e.primary, e.secondary] : [e.primary]);

function FieldError({ text }: { text?: string }) {
  return text ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{text}</p> : null;
}

export default function Dns({ snapshot }: { snapshot?: NetworkSnapshot }) {
  const { t } = useTranslation();
  const ifaces = (snapshot?.interfaces ?? []).filter((i) => i.kind !== 'loopback' && i.kind !== 'vpn');
  const [support, setSupport] = useState<{ supported: boolean; reason?: string }>();
  const [iface, setIface] = useState('');
  const [current, setCurrent] = useState<string[]>();
  const [entries, setEntries] = useState<DnsEntry[]>([]);
  const [selected, setSelected] = useState<string>();
  const [target, setTarget] = useState<string[]>();
  const [status, setStatus] = useState<ChangeStatus>();
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  useEffect(() => {
    void window.netkit.config.support().then(setSupport);
    void window.netkit.dns.list().then(setEntries);
    return window.netkit.config.onStatus(setStatus);
  }, []);

  useEffect(() => {
    if (!iface && ifaces.length > 0) setIface(ifaces[0].name);
  }, [iface, ifaces]);

  // Arayüz değişince ve her değişiklik sonuçlanınca güncel DNS yeniden okunur (Gereksinim 5).
  useEffect(() => {
    if (!iface) return;
    setCurrent(undefined);
    window.netkit.config
      .read(iface)
      .then((c) => setCurrent(c.dns))
      .catch((err) => setError(errorMessage(err)));
  }, [iface, status?.phase]);

  const apply = async (dns: string[]) => {
    setError(undefined);
    setTarget(dns);
    try {
      await window.netkit.dns.apply(iface, dns);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const save = async () => {
    setFormErrors([]);
    try {
      setEntries(await window.netkit.dns.save({ id: form.id, name: form.name, primary: form.primary, secondary: form.secondary || undefined }));
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormErrors(errorMessage(err).split(','));
    }
  };

  const remove = async (id: string) => {
    setEntries(await window.netkit.dns.remove(id));
    if (selected === id) setSelected(undefined);
    if (form.id === id) setForm(EMPTY_FORM);
  };

  if (support && !support.supported) {
    return <Alert color="amber">{t(`config.unsupported.${support.reason ?? 'generic'}`)}</Alert>;
  }

  const busy = status?.phase === 'applying' || status?.phase === 'awaitingConfirm' || status?.phase === 'rollingBack';
  const chosen = entries.find((e) => e.id === selected);
  const show = (dns?: string[]) => (dns === undefined ? '—' : dns.length > 0 ? dns.join(', ') : t('dns.automatic'));
  const fieldError = (code: string) => (formErrors.includes(code) ? t(`dns.errors.${code}`) : undefined);
  const otherErrors = formErrors.filter((e) => !['invalidName', 'invalidPrimary', 'invalidSecondary'].includes(e));
  // Sonuç yalnızca bu sayfadan başlatılan değişiklik için gösterilir.
  const mismatch = status?.phase === 'confirmed' && target && current && current.join(',') !== target.join(',');

  return (
    <div className="flex flex-col gap-4">
      <Alert color="blue" icon={iconLock}>
        {t('dns.privilegeNote')}
      </Alert>

      <Card title={t('dns.title')}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-[1_1_14rem]">
            <Select label={t('config.interface')} value={iface} onChange={setIface} options={ifaces.map((i) => ({ value: i.name, label: i.name }))} />
          </div>
          <div className="min-w-0 flex-[2_1_14rem]">
            <Field label={t('dns.current')}>{show(current)}</Field>
          </div>
        </div>

        <div className="mt-4 flex flex-col divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {entries.map((e) => (
            <div key={e.id} className={`flex items-center gap-2 px-3 py-2 ${selected === e.id ? 'bg-blue-50 dark:bg-blue-500/20' : ''}`}>
              <button type="button" aria-pressed={selected === e.id} onClick={() => setSelected(e.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
                <span className="text-sm font-medium">{e.name}</span>
                <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{serversOf(e).join(', ')}</span>
                {e.builtin && <Chip value={t('dns.builtin')} />}
              </button>
              {!e.builtin && (
                <>
                  <IconButton icon={iconEdit} label={t('dns.edit')} onClick={() => setForm({ id: e.id, name: e.name, primary: e.primary, secondary: e.secondary ?? '' })} />
                  <IconButton icon={iconDelete} label={t('common.delete')} onClick={() => void remove(e.id)} />
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => chosen && void apply(serversOf(chosen))} disabled={!iface || !chosen || busy}>
            <Icon icon={iconPlay} className="h-4 w-4" /> {t('dns.apply')}
          </Button>
          <Button variant="outlined" onClick={() => void apply([])} disabled={!iface || busy}>
            <Icon icon={iconRefresh} className="h-4 w-4" /> {t('dns.automaticButton')}
          </Button>
          {chosen && iface && (
            <span className="text-xs text-gray-600 dark:text-gray-400">{t('dns.selection', { name: chosen.name, servers: serversOf(chosen).join(', '), iface })}</span>
          )}
        </div>

        {error && <Alert color="red" className="mt-3">{error}</Alert>}
        {status && target && status.phase !== 'awaitingConfirm' && (
          <Alert color={mismatch || status.phase === 'failed' ? 'red' : status.phase === 'confirmed' ? 'green' : status.phase === 'rolledBack' ? 'amber' : 'blue'} className="mt-3">
            {mismatch
              ? t('dns.mismatch', { expected: show(target), actual: show(current) })
              : status.phase === 'confirmed'
                ? t('dns.done', { servers: show(current) })
                : status.phase === 'rolledBack' && status.error
                  ? t('dns.rolledBackError')
                  : t(`dns.phase.${status.phase}`)}
            {status.error && <div className="mt-1 text-xs opacity-80">{status.error}</div>}
          </Alert>
        )}
      </Card>

      <Card title={form.id ? t('dns.editTitle') : t('dns.addTitle')}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-[2_1_12rem]">
            <Input label={t('dns.name')} value={form.name} onChange={(name) => setForm({ ...form, name })} error={Boolean(fieldError('invalidName'))} />
            <FieldError text={fieldError('invalidName')} />
          </div>
          <div className="min-w-0 flex-[1_1_10rem]">
            <Input label={t('dns.primary')} value={form.primary} onChange={(primary) => setForm({ ...form, primary })} error={Boolean(fieldError('invalidPrimary'))} />
            <FieldError text={fieldError('invalidPrimary')} />
          </div>
          <div className="min-w-0 flex-[1_1_10rem]">
            <Input label={t('dns.secondary')} value={form.secondary} onChange={(secondary) => setForm({ ...form, secondary })} error={Boolean(fieldError('invalidSecondary'))} />
            <FieldError text={fieldError('invalidSecondary')} />
          </div>
        </div>
        {otherErrors.length > 0 && (
          <Alert color="red" className="mt-3">
            {otherErrors.map((e) => t(`dns.errors.${e}`, { defaultValue: e })).join(' · ')}
          </Alert>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="outlined" onClick={() => void save()}>
            {t('dns.save')}
          </Button>
          {form.id && (
            <Button
              variant="text"
              color="gray"
              onClick={() => {
                setForm(EMPTY_FORM);
                setFormErrors([]);
              }}
            >
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </Card>

      <KeepChangeDialog status={status} />
    </div>
  );
}
