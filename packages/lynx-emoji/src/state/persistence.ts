/**
 * Thin persistence seam over `@sigx/lynx-storage` (an *optional* peer — the
 * picker works without it, recents/skin-tone just reset per session).
 *
 * The peer is loaded via a guarded dynamic `import()` so the optional
 * contract holds for real: the core picker path never hard-requires the
 * module (a static import would fail resolution for consumers who skipped
 * the peer before `isAvailable()` could ever run). Every call is
 * additionally try/caught so a missing or failing native module can never
 * take the picker down — persistence is strictly best-effort.
 *
 * Best-effort still has to be *diagnosable*: every swallow logs through the
 * namespaced logger (C10), so "my recents don't stick" shows up in the
 * `sigx dev` terminal instead of being invisible.
 */

import { createLogger } from '@sigx/lynx-core';

const PKG = 'lynx-emoji';
const log = createLogger(PKG);

interface StorageLike {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): void;
    isAvailable(): boolean;
}

let storagePromise: Promise<StorageLike | null> | undefined;

function getStorage(): Promise<StorageLike | null> {
    storagePromise ??= import('@sigx/lynx-storage').then(
        (m) => {
            try {
                if (m.Storage.isAvailable()) return m.Storage;
                log.debug('storage unavailable — recents/skin tone are session-only');
                return null;
            } catch (e) {
                log.warn('storage availability check failed', e);
                return null;
            }
        },
        (e) => {
            // Usually the peer simply isn't installed — in-memory only, and a
            // supported setup. It can also be a genuine load failure in an
            // installed peer, which is why the message doesn't claim to know which.
            log.debug('@sigx/lynx-storage unavailable — recents/skin tone are session-only', e);
            return null;
        },
    );
    return storagePromise;
}

export function loadString(key: string): Promise<string | null> {
    return getStorage().then((s) => (s
        ? s.getItem(key).catch((e: unknown) => {
            log.warn(`reading ${key} failed`, e);
            return null;
        })
        : null));
}

export function saveString(key: string, value: string): void {
    void getStorage().then((s) => {
        try {
            s?.setItem(key, value);
        } catch (e) {
            // best-effort — never propagate storage failures into picker UX
            log.warn(`writing ${key} failed`, e);
        }
    });
}
