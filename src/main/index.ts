import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme, session, type IpcMainInvokeEvent } from 'electron';
import { PUBLIC_IP_SERVICES } from '../core/publicIp';
import { runHelper } from '../helper';
import { getPlatform } from '../platform';
import type { ChangeStatus, HostsGroup, Ipv4Config, NetProfile, PendingChangeJournal, ScanRequest, Settings } from '../shared/types';
import { AuditLog } from './audit';
import { ConfigService } from './config';
import { HostsService } from './hosts';
import { NetworkMonitor } from './network';
import { createElevator, HELPER_FLAG, PrivilegedRunner } from './privileged';
import { ScanManager } from './scan';
import { JsonFile } from './store';

// --- Yetkili yardımcı modu: pencere açılmaz, istek işlenip çıkılır. ---
const helperIdx = process.argv.indexOf(HELPER_FLAG);
if (helperIdx !== -1) {
  const [endpoint, token, requestHash] = process.argv.slice(helperIdx + 1, helperIdx + 4);
  void runHelper({ endpoint, token, requestHash }, getPlatform()).then((code) => app.exit(code), () => app.exit(1));
} else {
  startApp();
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'system',
  publicIpEnabled: true,
  publicIpService: 'ipify',
  warningAccepted: false,
};

/** Renderer'dan gelen ayarlar yalnızca bilinen alan ve değerlerle kabul edilir. */
function sanitizeSettings(patch: unknown): Partial<Settings> {
  const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (p.theme === 'system' || p.theme === 'light' || p.theme === 'dark') out.theme = p.theme;
  if (p.language === 'system' || p.language === 'tr' || p.language === 'en') out.language = p.language;
  if (typeof p.publicIpEnabled === 'boolean') out.publicIpEnabled = p.publicIpEnabled;
  if (typeof p.publicIpService === 'string' && PUBLIC_IP_SERVICES.some((s) => s.id === p.publicIpService)) out.publicIpService = p.publicIpService;
  if (typeof p.warningAccepted === 'boolean') out.warningAccepted = p.warningAccepted;
  return out;
}

function startApp() {
  const platform = getPlatform();
  const data = (name: string) => join(app.getPath('userData'), name);
  const settingsFile = new JsonFile<Settings>(data('settings.json'), () => DEFAULT_SETTINGS);
  const getSettings = async (): Promise<Settings> => ({ ...DEFAULT_SETTINGS, ...(await settingsFile.read()) });

  const audit = new AuditLog(data('audit.log'));
  const elevator = createElevator({ exe: process.execPath, prefixArgs: app.isPackaged ? [] : [app.getAppPath()] });
  const privileged = new PrivilegedRunner(elevator, audit);
  const monitor = new NetworkMonitor(platform, async () => {
    const s = await getSettings();
    return { enabled: s.publicIpEnabled, serviceId: s.publicIpService };
  });

  let win: BrowserWindow | undefined;
  const send = (channel: string, payload: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const scans = new ScanManager({ progress: (b) => send('scan:progress', b), finished: (f) => send('scan:finished', f) });
  const config = new ConfigService(
    platform,
    privileged,
    new JsonFile<PendingChangeJournal | null>(data('pending-change.json'), () => null),
    new JsonFile<NetProfile[]>(data('profiles.json'), () => []),
    (s: ChangeStatus) => send('config:status', s),
  );
  const hosts = new HostsService(platform, privileged, new JsonFile<HostsGroup[]>(data('hosts-groups.json'), () => []), data('hosts-backups'));
  monitor.on('change', (s) => send('network:change', s));

  // Yalnızca uygulamanın kendi penceresinden gelen IPC kabul edilir.
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!win || event.sender !== win.webContents) throw new Error('unauthorized');
      return fn(...(args as A));
    });

  handle('network:snapshot', () => monitor.snapshot());
  handle('network:refreshPublicIp', async () => {
    await monitor.refreshPublicIp();
    return monitor.snapshot();
  });
  handle('scan:start', async (req: ScanRequest) => scans.start(req, await monitor.snapshot()));
  handle('scan:stop', (id: string) => scans.stop(id));
  handle('config:support', () => platform.configSupport());
  handle('config:read', (iface: string) => platform.readIpv4Config(iface));
  handle('config:validate', (iface: string, cfg: Ipv4Config) => config.validate(iface, cfg));
  handle('config:apply', (iface: string, cfg: Ipv4Config) => config.apply(iface, cfg));
  handle('config:confirm', () => config.confirm());
  handle('config:revert', () => config.revert());
  handle('config:pendingRecovery', () => config.pendingRecovery());
  handle('config:recover', () => config.recover());
  handle('config:dismissRecovery', () => config.dismissRecovery());
  handle('config:profiles', () => config.profiles());
  handle('config:saveProfile', (p: NetProfile) => config.saveProfile(p));
  handle('config:deleteProfile', (name: string) => config.deleteProfile(name));
  handle('hosts:view', () => hosts.view());
  handle('hosts:saveGroups', (g: HostsGroup[]) => hosts.saveGroups(g));
  handle('hosts:apply', () => hosts.apply());
  handle('hosts:removeAll', () => hosts.removeAll());
  handle('hosts:restore', (id: string) => hosts.restore(id));
  handle('settings:get', () => getSettings());
  handle('settings:set', async (patch: Partial<Settings>) => {
    const next = { ...(await getSettings()), ...sanitizeSettings(patch) };
    await settingsFile.write(next);
    nativeTheme.themeSource = next.theme;
    if (patch && ('publicIpEnabled' in patch || 'publicIpService' in patch)) {
      await monitor.refreshPublicIp();
      send('network:change', await monitor.snapshot());
    }
    return next;
  });
  handle('settings:systemLocale', () => app.getLocale());

  const createWindow = async () => {
    nativeTheme.themeSource = (await getSettings()).theme;
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      title: 'NetKit',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // Gereksinim 8: renderer Node.js'e erişemez.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    win.once('ready-to-show', () => win?.show());
    // Uygulama içinde gezinme ve yeni pencere engellenir; renderer dış bağlantı açtıramaz (Gereksinim 9).
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
    else await win.loadFile(join(__dirname, '../renderer/index.html'));
  };

  app.whenReady().then(async () => {
    // Renderer için izin istekleri (kamera, konum vb.) reddedilir.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    monitor.start();
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    scans.stopAll();
    monitor.stop();
    if (process.platform !== 'darwin') app.quit();
  });
}
