/**
 * Web implementation: routes through the `@sigx/lynx-web-host` page bridge
 * (`sigx.location.*` → `navigator.geolocation` + the Permissions API — the
 * app worker has neither). Notes: geolocation needs a secure context
 * (localhost/HTTPS — the same constraint web-core already carries), and a
 * browser denial maps to `'blocked'` (`canAskAgain: false`) because the user
 * must flip the site setting — there is no re-prompt. `requestPermission`
 * surfaces the browser prompt by issuing a cheap position request (the
 * browser has no standalone geolocation prompt).
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

import type { LocationOptions, LocationResult } from './location.js';

export type { LocationOptions, LocationResult } from './location.js';

export const Location: typeof import('./location.js').Location = {
  getCurrentPosition(options: LocationOptions = {}): Promise<LocationResult> {
    return webHostCall<LocationResult>('location.getCurrent', {
      accuracy: options.accuracy,
      timeout: options.timeout,
    });
  },

  requestPermission(): Promise<PermissionResponse> {
    return webHostCall<PermissionResponse>('location.requestPermission');
  },

  getPermissionStatus(): Promise<PermissionResponse> {
    return webHostCall<PermissionResponse>('location.permissionStatus');
  },

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;
