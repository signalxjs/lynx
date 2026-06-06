/**
 * Thin persistence seam over `@sigx/lynx-storage` (an *optional* peer — the
 * picker works without it, recents/skin-tone just reset per session).
 *
 * Follows the daisyui optional-peer convention: static import, runtime
 * `isAvailable()` guard. The import resolves in any workspace/dev setup (the
 * package is a devDependency); external consumers who skip the peer simply
 * tree-shake or stub it. Every call is additionally try/caught so a missing
 * or failing native module can never take the picker down — persistence is
 * strictly best-effort.
 */

import { Storage } from '@sigx/lynx-storage';

export function loadString(key: string): Promise<string | null> {
    try {
        if (!Storage.isAvailable()) return Promise.resolve(null);
        return Storage.getItem(key).catch(() => null);
    } catch {
        return Promise.resolve(null);
    }
}

export function saveString(key: string, value: string): void {
    try {
        if (Storage.isAvailable()) Storage.setItem(key, value);
    } catch {
        // best-effort — never propagate storage failures into picker UX
    }
}
