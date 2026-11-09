// Onaylı değişiklikten sonraki "yeni ayar korunsun mu?" penceresi; Ağ yapılandırması ve DNS sayfaları ortak kullanır.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeStatus } from '../../../shared/types';
import { Button, Dialog } from './ui';
import { errorMessage } from '../lib/format';

export function KeepChangeDialog({ status, onStatus }: { status?: ChangeStatus; onStatus: (status: ChangeStatus) => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<'confirm' | 'revert'>();
  const [actionError, setActionError] = useState<string>();
  const waiting = status?.phase === 'awaitingConfirm';

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      setNow(Date.now());
      void window.netkit.config.currentStatus().then((current) => {
        if (
          current &&
          (current.phase !== status?.phase || current.deadline !== status?.deadline || current.connectivityOk !== status?.connectivityOk || current.error !== status?.error)
        ) {
          onStatus(current);
        }
      });
    }, 500);
    return () => clearInterval(id);
  }, [waiting, status, onStatus]);

  const runAction = async (action: 'confirm' | 'revert') => {
    setPending(action);
    setActionError(undefined);
    try {
      const succeeded = action === 'confirm' ? await window.netkit.config.confirm() : await window.netkit.config.revert();
      if (!succeeded) setActionError(t('config.actionUnavailable'));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(undefined);
    }
  };

  const remaining = status?.deadline ? Math.max(0, Math.ceil((status.deadline - now) / 1000)) : 0;

  return (
    <Dialog
      open={waiting}
      onClose={() => undefined}
      dismissible={false}
      title={t('config.keepTitle')}
      footer={
        <>
          <Button variant="outlined" color="red" onClick={() => void runAction('revert')} disabled={pending !== undefined} loading={pending === 'revert'}>
            {t('config.revertNow')}
          </Button>
          <Button color="green" onClick={() => void runAction('confirm')} disabled={pending !== undefined} loading={pending === 'confirm'}>
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
      {actionError && <p role="alert" className="mt-2 text-red-600 dark:text-red-400">{actionError}</p>}
    </Dialog>
  );
}
