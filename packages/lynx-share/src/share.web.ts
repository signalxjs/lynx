/**
 * Web implementation: routes through the `@sigx/lynx-web-host` page bridge
 * (`sigx.share.share` → `navigator.share`). `share()` keeps the native
 * sync-void shape by firing-and-forgetting the RPC; user dismissal
 * (AbortError) is silent, other failures (e.g. unsupported browser) are
 * logged — never thrown. Caveat (documented in the README): the user-activation
 * gesture must survive the worker→page RPC hop — call `share()` directly
 * from a tap handler (which is the natural usage anyway).
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';

import type { ShareOptions } from './share.js';

export type { ShareOptions } from './share.js';

export const Share: typeof import('./share.js').Share = {
  share(options: ShareOptions): void {
    webHostCall<void>('share.share', {
      title: options.title,
      message: options.message,
      url: options.url,
    }).catch((e) => {
      // AbortError = user dismissed the sheet — not a failure worth logging.
      if (!String(e).includes('AbortError')) {
        console.warn('[@sigx/lynx-share] share failed:', e);
      }
    });
  },

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;
