// Renderer'a yalnızca dar, tipli bir API açılır (contextBridge). ipcRenderer'ın kendisi
// ve Node.js nesneleri renderer'a sızdırılmaz.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { NetkitApi } from '../shared/api';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: NetkitApi = {
  platform: process.platform as NetkitApi['platform'],
  network: {
    snapshot: () => invoke('network:snapshot'),
    refreshPublicIp: () => invoke('network:refreshPublicIp'),
    onChange: (cb) => subscribe('network:change', cb),
  },
  scan: {
    start: (req) => invoke('scan:start', req),
    stop: (id) => invoke('scan:stop', id),
    onProgress: (cb) => subscribe('scan:progress', cb),
    onFinished: (cb) => subscribe('scan:finished', cb),
  },
  config: {
    support: () => invoke('config:support'),
    read: (iface) => invoke('config:read', iface),
    validate: (iface, cfg) => invoke('config:validate', iface, cfg),
    apply: (iface, cfg) => invoke('config:apply', iface, cfg),
    confirm: () => invoke('config:confirm'),
    revert: () => invoke('config:revert'),
    onStatus: (cb) => subscribe('config:status', cb),
    pendingRecovery: () => invoke('config:pendingRecovery'),
    recover: () => invoke('config:recover'),
    dismissRecovery: () => invoke('config:dismissRecovery'),
    profiles: () => invoke('config:profiles'),
    saveProfile: (p) => invoke('config:saveProfile', p),
    deleteProfile: (name) => invoke('config:deleteProfile', name),
  },
  hosts: {
    view: () => invoke('hosts:view'),
    saveGroups: (g) => invoke('hosts:saveGroups', g),
    apply: () => invoke('hosts:apply'),
    removeAll: () => invoke('hosts:removeAll'),
    restore: (id) => invoke('hosts:restore', id),
  },
  smtp: {
    records: () => invoke('smtp:records'),
    test: (req) => invoke('smtp:test', req),
    clear: () => invoke('smtp:clear'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
    systemLocale: () => invoke('settings:systemLocale'),
  },
};

contextBridge.exposeInMainWorld('netkit', api);
