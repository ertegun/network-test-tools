// M2 — Port testi ve bağlam şeridi.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContextStrip, PortPresetId, PortResult, PortState } from '../../../shared/types';
import { iconCopy, iconDownload, iconInfo, iconPlay, iconStop, iconWarning } from '../components/icons';
import { Alert, Button, Card, Chip, Field, Icon, IconButton, InfoTip, Input, Progress, Select } from '../components/ui';
import { downloadText, errorMessage, formatDateTime, formatDuration, toCsv } from '../lib/format';

const STATE_COLOR: Record<PortState, 'green' | 'red' | 'amber'> = { open: 'green', closed: 'red', filtered: 'amber' };
type PortSource = 'custom' | PortPresetId;
// Ghost uyarının renkli metni koyu temada kendi zemininde AA kontrastı sağlamıyor (amber ≈2.4:1).
const ALERT_DARK = 'dark:!text-gray-100';

export function ContextBar({ ctx }: { ctx: ContextStrip }) {
  const { t } = useTranslation();
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50/95 p-3 backdrop-blur dark:border-blue-900 dark:bg-gray-800/95">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Field label={t('context.time')}>
          {formatDateTime(ctx.timestamp, ctx.timeZone)} ({ctx.timeZone})
        </Field>
        <Field label={t('context.hostname')}>{ctx.hostname}</Field>
        <Field label={t('context.interface')} info={<InfoTip icon={iconInfo} text={t('help.sourceIp')} />}>
          {ctx.interfaceName ?? '—'}
        </Field>
        <Field label={t('context.sourceIp')}>{ctx.sourceIp}</Field>
        <Field label={t('context.publicIp')}>{ctx.publicIp ? `${ctx.publicIp} (${ctx.publicIpService})` : '—'}</Field>
        <Field label={t('context.target')}>
          {ctx.target}
          {ctx.target !== ctx.resolvedIp && ` → ${ctx.resolvedIp}`}
        </Field>
      </div>
      {ctx.splitTunnel && (
        <Alert color="amber" icon={iconWarning} className={ALERT_DARK}>
          {t('context.splitTunnel', { target: ctx.interfaceName, publicIface: ctx.publicIpInterface })}
        </Alert>
      )}
    </div>
  );
}

export default function PortTest() {
  const { t } = useTranslation();
  const [target, setTarget] = useState('');
  const [source, setSource] = useState<PortSource>('top100');
  const [ports, setPorts] = useState('1-1024');
  const [timeoutMs, setTimeoutMs] = useState('2000');
  const [concurrency, setConcurrency] = useState('200');
  const [scanId, setScanId] = useState<string>();
  const [ctx, setCtx] = useState<ContextStrip>();
  const [results, setResults] = useState<PortResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [duration, setDuration] = useState<number>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<PortState | 'all'>('all');
  const scanRef = useRef<string>();
  // Tüm portlar taramasında yalnız açık portlar tutulur (65535 satır listelenmez).
  const [openOnly, setOpenOnly] = useState(false);
  const openOnlyRef = useRef(false);

  useEffect(() => {
    const offProgress = window.netkit.scan.onProgress((batch) => {
      const mine = batch.filter((b) => b.scanId === scanRef.current);
      if (mine.length === 0) return;
      const kept = mine.map((b) => b.result).filter((r) => !openOnlyRef.current || r.state === 'open');
      if (kept.length > 0) setResults((prev) => [...prev, ...kept]);
      setProgress({ done: mine[mine.length - 1].done, total: mine[mine.length - 1].total });
    });
    const offFinished = window.netkit.scan.onFinished((f) => {
      if (f.scanId !== scanRef.current) return;
      setResults(openOnlyRef.current ? f.results.filter((r) => r.state === 'open') : f.results);
      setDuration(f.durationMs);
      setScanId(undefined);
    });
    return () => {
      offProgress();
      offFinished();
    };
  }, []);

  const start = async () => {
    setError(undefined);
    setResults([]);
    setDuration(undefined);
    openOnlyRef.current = source === 'all';
    setOpenOnly(openOnlyRef.current);
    if (openOnlyRef.current) setFilter('all');
    try {
      const r = await window.netkit.scan.start({
        target: target.trim(),
        ports: source === 'custom' ? ports : undefined,
        preset: source === 'custom' ? undefined : source,
        timeoutMs: Number(timeoutMs) || undefined,
        concurrency: Number(concurrency) || undefined,
      });
      scanRef.current = r.scanId;
      setScanId(r.scanId);
      setCtx(r.context);
      setProgress({ done: 0, total: r.total });
    } catch (err) {
      const code = errorMessage(err);
      setError(t(`portTest.errors.${code}`, { defaultValue: code }));
    }
  };

  const stop = () => {
    if (scanId) void window.netkit.scan.stop(scanId);
  };

  const sorted = useMemo(() => [...results].sort((a, b) => a.port - b.port), [results]);
  const counts = useMemo(() => {
    const c = { open: 0, closed: 0, filtered: 0 };
    results.forEach((r) => c[r.state]++);
    return c;
  }, [results]);
  const shown = filter === 'all' ? sorted : sorted.filter((r) => r.state === filter);
  // En kötü durum: her port zaman aşımına düşer (varsayılanlar ve üst sınır portScan.ts ile aynı).
  const allEstimateSec = Math.ceil(65535 / Math.min(Number(concurrency) || 200, 1000)) * ((Number(timeoutMs) || 2000) / 1000);

  const rows = (): (string | number)[][] => [
    [t('portTest.port'), t('portTest.state'), 'ms', t('portTest.service')],
    ...sorted.map((r) => [r.port, t(`state.${r.state}`), r.ms, r.service ?? '']),
  ];
  const contextRows = (): (string | number)[][] =>
    ctx
      ? [
          [t('context.time'), `${ctx.timestamp} (${ctx.timeZone})`],
          [t('context.hostname'), ctx.hostname],
          [t('context.interface'), ctx.interfaceName ?? ''],
          [t('context.sourceIp'), ctx.sourceIp],
          [t('context.publicIp'), ctx.publicIp ?? ''],
          [t('context.target'), `${ctx.target} (${ctx.resolvedIp})`],
          [],
        ]
      : [];

  return (
    <div className="flex flex-col gap-4">
      <Alert color="amber" icon={iconWarning} className={ALERT_DARK}>
        {t('common.authorizedOnly')}
      </Alert>
      {ctx && <ContextBar ctx={ctx} />}
      <Card title={t('portTest.title')}>
        {/* Alanlar kutularının alt kenarına hizalanır; pencere daralınca taşmadan alt satıra kayar. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-[2_1_14rem]">
            <Input label={t('portTest.target')} value={target} onChange={setTarget} />
          </div>
          <div className="min-w-0 flex-[1_1_13rem]">
            <Select<PortSource>
              label={t('portTest.portSource')}
              value={source}
              onChange={setSource}
              options={(['custom', 'top100', 'all', 'web', 'mail', 'remote', 'database'] as PortSource[]).map((v) => ({ value: v, label: t(`presets.${v}`) }))}
            />
          </div>
          <div className="min-w-0 flex-[1_1_9rem]">
            <Input label={t('portTest.ports')} value={ports} onChange={setPorts} disabled={source !== 'custom'} />
          </div>
          <div className="min-w-0 flex-[1_1_8rem]">
            <Input label={t('portTest.timeout')} value={timeoutMs} onChange={setTimeoutMs} type="number" />
          </div>
          <div className="min-w-0 flex-[1_1_12rem]">
            <Input label={t('portTest.concurrency')} value={concurrency} onChange={setConcurrency} type="number" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {scanId ? (
            <Button color="red" onClick={stop}>
              <Icon icon={iconStop} className="h-4 w-4" /> {t('portTest.stop')}
            </Button>
          ) : (
            <Button onClick={start} disabled={!target.trim()}>
              <Icon icon={iconPlay} className="h-4 w-4" /> {t('portTest.start')}
            </Button>
          )}
          {progress.total > 0 && (
            <div className="flex flex-1 items-center gap-2">
              <div className="flex-1">
                <Progress value={(progress.done / progress.total) * 100} />
              </div>
              <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
                {progress.done}/{progress.total}
                {openOnly && ` · ${t('portTest.openFound', { count: counts.open })}`}
                {duration !== undefined && ` · ${(duration / 1000).toFixed(1)} s`}
              </span>
            </div>
          )}
        </div>
        {source === 'all' && !scanId && (
          <Alert color="amber" icon={iconWarning} className={`mt-3 ${ALERT_DARK}`}>
            {t('portTest.allWarning', { duration: formatDuration(allEstimateSec) })}
          </Alert>
        )}
        {error && <Alert color="red" className={`mt-3 ${ALERT_DARK}`}>{error}</Alert>}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          <b>{t('state.open')}</b>: {t('state.openHelp')} · <b>{t('state.closed')}</b>: {t('state.closedHelp')} · <b>{t('state.filtered')}</b>: {t('state.filteredHelp')}
        </p>
      </Card>

      {results.length > 0 && (
        <Card
          title={t('portTest.results')}
          actions={
            <>
              <IconButton icon={iconCopy} label={t('common.copy')} onClick={() => void navigator.clipboard.writeText(toCsv([...contextRows(), ...rows()]))} />
              <IconButton icon={iconDownload} label={t('common.exportCsv')} onClick={() => downloadText(`netkit-ports-${Date.now()}.csv`, toCsv([...contextRows(), ...rows()]))} />
            </>
          }
        >
          {!openOnly && (
            <div className="mb-2 flex flex-wrap gap-2">
              {(['all', 'open', 'closed', 'filtered'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={filter === f ? 'opacity-100' : 'opacity-60'}>
                  <Chip
                    value={`${f === 'all' ? t('portTest.all') : t(`state.${f}`)} (${f === 'all' ? results.length : counts[f]})`}
                    color={f === 'all' ? 'blue-gray' : STATE_COLOR[f]}
                    variant={filter === f ? 'filled' : 'ghost'}
                  />
                </button>
              ))}
            </div>
          )}
          <div className="max-h-[45vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="py-1 pr-4">{t('portTest.port')}</th>
                  <th className="py-1 pr-4">{t('portTest.state')}</th>
                  <th className="py-1 pr-4">ms</th>
                  <th className="py-1">{t('portTest.service')}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {shown.map((r) => (
                  <tr key={r.port} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="py-1 pr-4">{r.port}</td>
                    <td className="py-1 pr-4">
                      <Chip value={t(`state.${r.state}`)} color={STATE_COLOR[r.state]} />
                    </td>
                    <td className="py-1 pr-4 tabular-nums">{r.ms}</td>
                    <td className="py-1">{r.service ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

