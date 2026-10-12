import { createDarwin } from './darwin';
import { createLinux } from './linux';
import type { Platform } from './types';
import { createWin32 } from './win32';

export type { Platform, PlatformId, Support } from './types';

let current: Platform | undefined;

export function getPlatform(): Platform {
  if (!current) {
    if (process.platform === 'win32') current = createWin32();
    else if (process.platform === 'darwin') current = createDarwin();
    else current = createLinux();
  }
  return current;
}
