import { useTranslation } from 'react-i18next';
import type { LanguagePref, Settings, ThemePref } from '../../../shared/types';
import { Card, Select, Switch } from '../components/ui';

const SERVICES = ['ipify', 'icanhazip', 'ifconfig.me'];

export default function SettingsPage({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Card title={t('settings.appearance')}>
        <div className="grid grid-cols-2 gap-3">
          <Select<LanguagePref>
            label={t('settings.language')}
            value={settings.language}
            onChange={(language) => onChange({ language })}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'tr', label: 'Türkçe' },
              { value: 'en', label: 'English' },
            ]}
          />
          <Select<ThemePref>
            label={t('settings.theme')}
            value={settings.theme}
            onChange={(theme) => onChange({ theme })}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'light', label: t('settings.light') },
              { value: 'dark', label: t('settings.dark') },
            ]}
          />
        </div>
      </Card>
      <Card title={t('settings.privacy')}>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('settings.publicIpHelp')}</p>
        <div className="flex flex-col gap-3">
          <Switch checked={settings.publicIpEnabled} onChange={(publicIpEnabled) => onChange({ publicIpEnabled })} label={t('settings.publicIpEnabled')} />
          <Select
            label={t('settings.publicIpService')}
            value={settings.publicIpService}
            disabled={!settings.publicIpEnabled}
            onChange={(publicIpService) => onChange({ publicIpService })}
            options={SERVICES.map((s) => ({ value: s, label: s }))}
          />
        </div>
      </Card>
    </div>
  );
}
