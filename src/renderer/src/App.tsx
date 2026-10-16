import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NetworkSnapshot, PendingChangeJournal, Settings } from '../../shared/types';
import { iconDashboard, iconDescription, iconDns, iconNetworkCheck, iconRouter, iconSettings, iconWarning } from './components/icons';
import { Alert, Button, Dialog, Icon } from './components/ui';
import i18n, { resolveLanguage } from './i18n';
import { errorMessage } from './lib/format';
import Dashboard from './pages/Dashboard';
import Dns from './pages/Dns';
import Hosts from './pages/Hosts';
import NetConfig from './pages/NetConfig';
import PortTest from './pages/PortTest';
import SettingsPage from './pages/SettingsPage';

const PAGES = [
  { id: 'dashboard', icon: iconDashboard },
  { id: 'portTest', icon: iconNetworkCheck },
  { id: 'config', icon: iconRouter },
  { id: 'dns', icon: iconDns },
  { id: 'hosts', icon: iconDescription },
  { id: 'settings', icon: iconSettings },
] as const;
type PageId = (typeof PAGES)[number]['id'];

function applyTheme(theme: Settings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export default function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageId>('dashboard');
  const [settings, setSettings] = useState<Settings>();
  const [systemLocale, setSystemLocale] = useState('en');
  const [snapshot, setSnapshot] = useState<NetworkSnapshot>();
  const [recovery, setRecovery] = useState<PendingChangeJournal | null>(null);
  const [recoveryError, setRecoveryError] = useState<string>();

  useEffect(() => {
    void Promise.all([window.netkit.settings.get(), window.netkit.settings.systemLocale()]).then(([s, loc]) => {
      setSystemLocale(loc);
      setSettings(s);
    });
    void window.netkit.network.snapshot().then(setSnapshot);
    void window.netkit.config.pendingRecovery().then(setRecovery);
    return window.netkit.network.onChange(setSnapshot);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const lang = resolveLanguage(settings.language, systemLocale);
    void i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    applyTheme(settings.theme);
    // Sistem teması değişirse izlenir.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(settings.theme);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings, systemLocale]);

  const changeSettings = async (patch: Partial<Settings>) => setSettings(await window.netkit.settings.set(patch));

  const recover = async () => {
    setRecoveryError(undefined);
    try {
      const r = await window.netkit.config.recover();
      if (r.ok) setRecovery(null);
      else setRecoveryError(r.message);
    } catch (err) {
      setRecoveryError(errorMessage(err));
    }
  };

  if (!settings) return null;

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 px-2 text-lg font-bold text-blue-600 dark:text-blue-400">NetKit</div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPage(p.id)}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
              page === p.id ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-200' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            <Icon icon={p.icon} />
            {t(`nav.${p.id}`)}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        {recovery && (
          <Alert color="amber" icon={iconWarning} className="mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <span>{t('recovery.message', { iface: recovery.interfaceName })}</span>
              <Button size="sm" color="amber" onClick={() => void recover()}>
                {t('recovery.revert')}
              </Button>
              <Button size="sm" variant="text" color="gray" onClick={() => void window.netkit.config.dismissRecovery().then(() => setRecovery(null))}>
                {t('recovery.dismiss')}
              </Button>
            </div>
            {recoveryError && <div className="mt-1">{recoveryError}</div>}
          </Alert>
        )}
        <h1 className="mb-4 text-xl font-semibold">{t(`nav.${page}`)}</h1>
        {page === 'dashboard' && <Dashboard snapshot={snapshot} onSnapshot={setSnapshot} />}
        {page === 'portTest' && <PortTest snapshot={snapshot} />}
        {page === 'config' && <NetConfig snapshot={snapshot} />}
        {page === 'dns' && <Dns snapshot={snapshot} />}
        {page === 'hosts' && <Hosts />}
        {page === 'settings' && <SettingsPage settings={settings} onChange={(p) => void changeSettings(p)} />}
      </main>
      <Dialog
        open={!settings.warningAccepted}
        onClose={() => undefined}
        dismissible={false}
        title={t('firstRun.title')}
        footer={<Button onClick={() => void changeSettings({ warningAccepted: true })}>{t('firstRun.accept')}</Button>}
      >
        {t('firstRun.body')}
      </Dialog>
    </div>
  );
}
