// M8 — Hosts yönetimi: yalnızca NetKit bloğu yazılır, blok dışı satırlar salt okunur.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HostsGroup, HostsView, PrivilegedResult } from '../../../shared/types';
import { iconAdd, iconDelete, iconHistory, iconLock, iconWarning } from '../components/icons';
import { Alert, Button, Card, Dialog, IconButton, Input, Switch } from '../components/ui';
import { errorMessage, formatDateTime } from '../lib/format';

interface EditableGroup {
  id: string;
  name: string;
  enabled: boolean;
  text: string;
}

const toEditable = (g: HostsGroup): EditableGroup => ({
  id: g.id,
  name: g.name,
  enabled: g.enabled,
  text: g.entries.map((e) => `${e.ip}  ${e.hostnames.join(' ')}`).join('\n'),
});

const toGroup = (g: EditableGroup): HostsGroup => ({
  id: g.id,
  name: g.name,
  enabled: g.enabled,
  entries: g.text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const [ip, ...hostnames] = l.split(/\s+/);
      return { ip, hostnames };
    }),
});

type PendingAction = { kind: 'apply' } | { kind: 'removeAll' } | { kind: 'restore'; id: string };

export default function Hosts() {
  const { t } = useTranslation();
  const [view, setView] = useState<HostsView>();
  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<PendingAction>();

  const load = async () => {
    try {
      const v = await window.netkit.hosts.view();
      setView(v);
      setGroups(v.groups.map(toEditable));
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const update = (id: string, patch: Partial<EditableGroup>) => {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    setError(undefined);
    try {
      const v = await window.netkit.hosts.saveGroups(groups.map(toGroup));
      setView(v);
      setGroups(v.groups.map(toEditable));
      setDirty(false);
      return true;
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg.startsWith('invalidEntry:') ? t('hosts.invalidEntry', { entry: msg.slice(13) }) : msg);
      return false;
    }
  };

  const runPending = async () => {
    const action = pending;
    setPending(undefined);
    if (!action) return;
    setMessage(undefined);
    setError(undefined);
    if (action.kind === 'apply' && dirty && !(await save())) return;
    let r: PrivilegedResult;
    try {
      r =
        action.kind === 'apply'
          ? await window.netkit.hosts.apply()
          : action.kind === 'removeAll'
            ? await window.netkit.hosts.removeAll()
            : await window.netkit.hosts.restore(action.id);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    if (r.ok) setMessage(t(`hosts.done.${action.kind}`));
    else setError(r.code === 'cancelled' ? t('common.cancelledByUser') : r.message);
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert color="blue" icon={iconLock}>
        {t('hosts.intro', { path: view?.path ?? '' })}
      </Alert>
      {error && <Alert color="red">{error}</Alert>}
      {message && <Alert color="green">{message}</Alert>}
      {view && view.conflicts.length > 0 && (
        <Alert color="amber" icon={iconWarning}>
          {view.conflicts.map((c) => t('hosts.conflict', { host: c.hostname, ips: c.ips.join(', '), groups: c.groups.join(', ') })).join(' · ')}
        </Alert>
      )}

      <Card
        title={t('hosts.groups')}
        actions={
          <IconButton
            icon={iconAdd}
            label={t('hosts.addGroup')}
            onClick={() => {
              setGroups((gs) => [...gs, { id: crypto.randomUUID(), name: t('hosts.newGroup'), enabled: true, text: '' }]);
              setDirty(true);
            }}
          />
        }
      >
        {groups.length === 0 && <p className="text-sm text-gray-500">{t('hosts.noGroups')}</p>}
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.id} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex-1">
                  <Input label={t('hosts.groupName')} value={g.name} onChange={(name) => update(g.id, { name })} />
                </div>
                <Switch checked={g.enabled} onChange={(enabled) => update(g.id, { enabled })} label={t('hosts.enabled')} />
                <IconButton
                  icon={iconDelete}
                  label={t('common.delete')}
                  onClick={() => {
                    setGroups((gs) => gs.filter((x) => x.id !== g.id));
                    setDirty(true);
                  }}
                />
              </div>
              <textarea
                className="h-28 w-full rounded-md border border-gray-300 bg-transparent p-2 font-mono text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600"
                placeholder="127.0.0.1  proje.local"
                value={g.text}
                spellCheck={false}
                onChange={(e) => update(g.id, { text: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outlined" onClick={() => void save()} disabled={!dirty}>
            {t('hosts.saveGroups')}
          </Button>
          <Button onClick={() => setPending({ kind: 'apply' })}>{t('hosts.apply')}</Button>
          <Button variant="outlined" color="red" onClick={() => setPending({ kind: 'removeAll' })}>
            {t('hosts.removeAll')}
          </Button>
        </div>
      </Card>

      <Card title={t('hosts.outside')}>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('hosts.outsideHelp')}</p>
        <pre className="max-h-64 overflow-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-900">{view?.outsideLines.join('\n')}</pre>
      </Card>

      <Card title={t('hosts.backups')}>
        {view?.backups.length === 0 && <p className="text-sm text-gray-500">{t('hosts.noBackups')}</p>}
        <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
          {view?.backups.map((b) => (
            <div key={b.id} className="flex items-center justify-between py-1 text-sm">
              <span>
                {formatDateTime(b.createdAt)} · {b.size} B
              </span>
              <IconButton icon={iconHistory} label={t('hosts.restore')} onClick={() => setPending({ kind: 'restore', id: b.id })} />
            </div>
          ))}
        </div>
      </Card>

      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(undefined)}
        title={t('hosts.reviewTitle')}
        footer={
          <>
            <Button variant="text" color="gray" onClick={() => setPending(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void runPending()}>{t('common.continueWithPrivilege')}</Button>
          </>
        }
      >
        {pending && t(`hosts.review.${pending.kind}`)}
      </Dialog>
    </div>
  );
}
