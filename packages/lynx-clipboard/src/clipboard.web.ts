/**
 * Web implementation: routes through the `@sigx/lynx-web-host` page bridge
 * (`sigx.clipboard.*` → `navigator.clipboard`, which doesn't exist in
 * web-core's Worker). Read denial resolves to `''` / `false` — never throws
 * out of a permissions prompt. `setString` keeps the native sync-void shape
 * by firing-and-forgetting the RPC (failures are logged, matching how the
 * native `callSync` surface behaves for callers).
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable, createLogger } from '@sigx/lynx-core';

const log = createLogger('lynx-clipboard');

export const Clipboard: typeof import('./clipboard.js').Clipboard = {
  setString(text: string): void {
    webHostCall<void>('clipboard.setString', { value: text }).catch((e) => {
      // Through the logger, not console: this is the only signal a caller
      // gets that a write failed (the signature is sync void), so it has to
      // reach the `sigx dev` dashboard. CONVENTIONS.md C10.
      log.warn('setString failed', e);
    });
  },

  getString(): Promise<string> {
    // The host resolves whatever `navigator.clipboard.readText()` gave it —
    // `undefined` on a denied permission in some browsers. Coalesce, so the
    // declared `Promise<string>` is true rather than an assertion.
    return webHostCall<string>('clipboard.getString').then((v) => (typeof v === 'string' ? v : ''));
  },

  hasString(): Promise<boolean> {
    return webHostCall<boolean>('clipboard.hasString').then((v) => v === true);
  },

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;
