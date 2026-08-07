/**
 * Web implementation: routes through the `@sigx/lynx-web-host` page bridge
 * (`sigx.clipboard.*` → `navigator.clipboard`, which doesn't exist in
 * web-core's Worker). Read denial resolves to `''` / `false` — never throws
 * out of a permissions prompt. `setString` **rejects** on failure, matching
 * the native surface: browsers reject a write when clipboard permission is
 * denied, and that is worth surfacing rather than swallowing.
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';

export const Clipboard: typeof import('./clipboard.js').Clipboard = {
  async setString(text: string): Promise<void> {
    // Returned rather than logged-and-swallowed now: the caller can see the
    // failure themselves, so eating it here would hide a rejection the native
    // path surfaces. Browsers reject this on a denied clipboard-write
    // permission, which is a real case worth handling.
    await webHostCall<void>('clipboard.setString', { value: text });
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
