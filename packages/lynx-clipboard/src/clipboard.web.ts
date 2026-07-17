/**
 * Web implementation: routes through the `@sigx/lynx-web-host` page bridge
 * (`sigx.clipboard.*` → `navigator.clipboard`, which doesn't exist in
 * web-core's Worker). Read denial resolves to `''` / `false` — never throws
 * out of a permissions prompt. `setString` keeps the native sync-void shape
 * by firing-and-forgetting the RPC (failures are logged, matching how the
 * native `callSync` surface behaves for callers).
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';

export const Clipboard: typeof import('./clipboard.js').Clipboard = {
  setString(text: string): void {
    webHostCall<void>('clipboard.setString', { value: text }).catch((e) => {
      console.warn('[@sigx/lynx-clipboard] setString failed:', e);
    });
  },

  getString(): Promise<string> {
    return webHostCall<string>('clipboard.getString');
  },

  hasString(): Promise<boolean> {
    return webHostCall<boolean>('clipboard.hasString');
  },

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;
