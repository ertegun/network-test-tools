// SMTP test: girilen ayarla test e-postası gönderir; her deneme tabloda ve kalıcı logda tutulur.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SmtpField, SmtpSecurity, SmtpTestRecord } from '../../../shared/types';
import { iconCheck, iconDelete, iconSend, iconWarning } from '../components/icons';
import { Alert, Button, Card, Chip, Dialog, Icon, IconButton, Input, Select } from '../components/ui';
import { errorMessage, formatDateTime } from '../lib/format';

type Filter = 'all' | 'ok' | 'failed';

export default function Smtp() {
  const { t } = useTranslation();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [security, setSecurity] = useState<SmtpSecurity>('starttls');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [errors, setErrors] = useState<Partial<Record<SmtpField, string>>>({});
  const [records, setRecords] = useState<SmtpTestRecord[]>([]);
  const [last, setLast] = useState<SmtpTestRecord>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void window.netkit.smtp.records().then(setRecords);
  }, []);

  const send = async () => {
    setError(undefined);
    setLast(undefined);
    setSending(true);
    try {
      const r = await window.netkit.smtp.test({ host, port: Number(port), security, username, password, from, to });
      setErrors(r.errors);
      setRecords(r.records);
      if (Object.keys(r.errors).length === 0) setLast(r.records[0]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    setRecords(await window.netkit.smtp.clear());
    setLast(undefined);
  };

  const fieldError = (f: SmtpField) =>
    errors[f] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t(`smtp.fieldErrors.${f}.${errors[f]}`)}</p>;
  const summary = (r: SmtpTestRecord) => (r.errorKind ? `${t(`smtp.errorKind.${r.errorKind}`)}${r.code ? ` (${r.code})` : ''}` : '');
  const shown = filter === 'all' ? records : records.filter((r) => r.ok === (filter === 'ok'));
  const count = (f: Filter) => (f === 'all' ? records.length : records.filter((r) => r.ok === (f === 'ok')).length);

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('smtp.title')}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-[3_1_14rem]">
            <Input label={t('smtp.host')} value={host} onChange={setHost} error={!!errors.host} />
            {fieldError('host')}
          </div>
          <div className="min-w-0 flex-[1_1_7rem]">
            <Input label={t('smtp.port')} value={port} onChange={setPort} type="number" error={!!errors.port} />
            {fieldError('port')}
          </div>
          <div className="min-w-0 flex-[1_1_10rem]">
            <Select<SmtpSecurity>
              label={t('smtp.security')}
              value={security}
              onChange={setSecurity}
              options={(['none', 'starttls', 'tls'] as SmtpSecurity[]).map((v) => ({ value: v, label: t(`smtp.securityOptions.${v}`) }))}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-[1_1_12rem]">
            <Input label={t('smtp.username')} value={username} onChange={setUsername} />
          </div>
          <div className="min-w-0 flex-[1_1_12rem]">
            <Input label={t('smtp.password')} value={password} onChange={setPassword} type="password" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-[1_1_14rem]">
            <Input label={t('smtp.from')} value={from} onChange={setFrom} error={!!errors.from} />
            {fieldError('from')}
          </div>
          <div className="min-w-0 flex-[1_1_14rem]">
            <Input label={t('smtp.to')} value={to} onChange={setTo} error={!!errors.to} />
            {fieldError('to')}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => void send()} disabled={sending} loading={sending}>
            {!sending && <Icon icon={iconSend} className="h-4 w-4" />} {t('smtp.send')}
          </Button>
          {sending && <span className="text-sm text-gray-600 dark:text-gray-400">{t('smtp.sending')}</span>}
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{t('smtp.help')}</p>
        {last && (
          <Alert color={last.ok ? 'green' : 'red'} icon={last.ok ? iconCheck : iconWarning} className="mt-3">
            {last.ok ? t('smtp.sent', { to: last.to }) : summary(last)}
            {last.error && <div className="mt-1 break-all font-mono text-xs">{last.error}</div>}
          </Alert>
        )}
        {error && <Alert color="red" className="mt-3">{error}</Alert>}
      </Card>

      <Card title={t('smtp.results')} actions={<IconButton icon={iconDelete} label={t('smtp.clear')} onClick={() => setConfirmClear(true)} disabled={records.length === 0} />}>
        <div className="mb-2 flex flex-wrap gap-2">
          {(['all', 'ok', 'failed'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={filter === f ? 'opacity-100' : 'opacity-60'}>
              <Chip value={`${t(`smtp.filter.${f}`)} (${count(f)})`} color={f === 'all' ? 'blue-gray' : f === 'ok' ? 'green' : 'red'} variant={filter === f ? 'filled' : 'ghost'} />
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('smtp.empty')}</p>
        ) : (
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="py-1 pr-3">{t('smtp.col.time')}</th>
                  <th className="py-1 pr-3">{t('smtp.col.server')}</th>
                  <th className="py-1 pr-3">{t('smtp.col.addresses')}</th>
                  <th className="py-1 pr-3">{t('smtp.col.status')}</th>
                  <th className="py-1 pr-3">ms</th>
                  <th className="min-w-[14rem] py-1">{t('smtp.col.error')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top dark:border-gray-700">
                    <td className="py-1 pr-3">{formatDateTime(r.time)}</td>
                    {/* Dar pencerede sığsın diye sunucu+güvenlik ve kullanıcı+alıcı tek sütunda alt alta. */}
                    <td className="py-1 pr-3">
                      <div className="font-mono [overflow-wrap:anywhere]">
                        {r.host}:{r.port}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t(`smtp.securityOptions.${r.security}`)}</div>
                    </td>
                    <td className="py-1 pr-3 [overflow-wrap:anywhere]">
                      {r.username && <div className="text-xs text-gray-500 dark:text-gray-400">{r.username}</div>}
                      <div>{r.to}</div>
                    </td>
                    <td className="py-1 pr-3">
                      <Chip value={t(r.ok ? 'smtp.filter.ok' : 'smtp.filter.failed')} color={r.ok ? 'green' : 'red'} />
                    </td>
                    <td className="py-1 pr-3 tabular-nums">{r.ms}</td>
                    <td className="py-1">
                      {summary(r)}
                      {r.error && <div className="break-all font-mono text-xs text-gray-500 dark:text-gray-400">{r.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('smtp.clear')}
        footer={
          <>
            <Button variant="text" color="gray" onClick={() => setConfirmClear(false)}>
              {t('common.cancel')}
            </Button>
            <Button color="red" onClick={() => void clear()}>
              {t('smtp.clear')}
            </Button>
          </>
        }
      >
        {t('smtp.clearConfirm', { count: records.length })}
      </Dialog>
    </div>
  );
}
