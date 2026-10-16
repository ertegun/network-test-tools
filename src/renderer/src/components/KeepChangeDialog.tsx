// Onaylı değişiklikten sonraki "yeni ayar korunsun mu?" penceresi; Ağ yapılandırması ve DNS sayfaları ortak kullanır.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeStatus } from '../../../shared/types';
import { Button, Dialog } from './ui';

export function KeepChangeDialog({ status }: { status?: ChangeStatus }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  const waiting = status?.phase === 'awaitingConfirm';

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [waiting]);

  const remaining = status?.deadline ? Math.max(0, Math.ceil((status.deadline - now) / 1000)) : 0;

  return (
    <Dialog
      open={waiting}
      onClose={() => undefined}
      dismissible={false}
      title={t('config.keepTitle')}
      footer={
        <>
          <Button variant="outlined" color="red" onClick={() => void window.netkit.config.revert()}>
            {t('config.revertNow')}
          </Button>
          <Button color="green" onClick={() => void window.netkit.config.confirm()}>
            {t('config.keep')}
          </Button>
        </>
      }
    >
      <p className="text-base">{t('config.keepBody', { seconds: remaining })}</p>
      <p className="mt-2">
        {status?.connectivityOk === undefined
          ? t('config.connectivityTesting')
          : status.connectivityOk
            ? t('config.connectivityOk')
            : t('config.connectivityFail')}
      </p>
    </Dialog>
  );
}
