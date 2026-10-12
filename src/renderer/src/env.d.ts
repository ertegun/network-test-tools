import type { NetkitApi } from '../../shared/api';

declare global {
  interface Window {
    netkit: NetkitApi;
  }
}
