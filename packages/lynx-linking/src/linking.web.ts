/**
 * Web implementation: outbound calls route through the `@sigx/lynx-web-host`
 * page bridge (`sigx.linking.*` — `window.open` + browser-openable scheme
 * allowlist); inbound URL delivery reuses `inbound.ts` unchanged — the host's
 * linking publisher feeds the exact channels the native `LinkingPublisher`
 * does. Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable, SigxError } from '@sigx/lynx-core';

import { readInitialURL, subscribeUrl } from './inbound.js';
import type { URLListener, URLSubscription } from './inbound.js';

export type { URLEvent, URLListener, URLSubscription } from './inbound.js';

const PKG = 'lynx-linking';

export const Linking: typeof import('./linking.js').Linking = {
  openURL(url: string): Promise<void> {
    return webHostCall<void>('linking.openURL', { url });
  },

  canOpenURL(url: string): Promise<boolean> {
    return webHostCall<boolean>('linking.canOpenURL', { url });
  },

  getInitialURL(): string | null {
    return readInitialURL();
  },

  addEventListener(type: 'url', listener: URLListener): URLSubscription {
    if (type !== 'url') {
      // Same error, same code as the native path — a consumer branching on
      // `code` shouldn't have to know which build it's running in.
      throw new SigxError(
        PKG,
        'unsupported_event',
        `[@sigx/${PKG}] addEventListener failed: unknown event type "${String(type)}"`,
      );
    }
    return subscribeUrl(listener);
  },

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;
