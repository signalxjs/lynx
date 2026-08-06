/**
 * Web implementation of the runtime orientation lock (#856).
 *
 * The Screen Orientation API's `lock()` only works while the document is
 * fullscreen, and only on browsers that ship it (no Safari on desktop, none on
 * iOS at all). Rather than pretend, we surface the same rejection the native
 * side uses for "this can't take effect", so a caller sees one consistent
 * failure mode across platforms — and `useOrientationLock()` logs it once
 * instead of silently doing nothing.
 *
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import type { OrientationLock } from './orientation.js';

export type { OrientationLock } from './orientation.js';

/** The subset of `ScreenOrientation` we use, typed defensively. */
interface ScreenOrientationLike {
    lock?: (orientation: string) => Promise<void>;
    unlock?: () => void;
}

const screenOrientation = (): ScreenOrientationLike | undefined =>
    (globalThis as { screen?: { orientation?: ScreenOrientationLike } }).screen?.orientation;

/** JS `OrientationLock` → the Screen Orientation API's `OrientationLockType`. */
const WEB_LOCK: Record<OrientationLock, string> = {
    'portrait': 'portrait',
    'portrait-upside-down': 'portrait-secondary',
    'landscape': 'landscape',
    'landscape-left': 'landscape-primary',
    'landscape-right': 'landscape-secondary',
    'all': 'any',
    'default': 'natural',
};

const unsupported = (action: string): Error => new Error(
    `[@sigx/lynx-core] ${action} failed: orientation locking needs the Screen `
    + 'Orientation API and a fullscreen document; this browser or context '
    + 'provides neither.',
);

// Type-pinned against the native module so the two surfaces can't drift.
export const Orientation: typeof import('./orientation.js').Orientation = {
    async lock(to: OrientationLock): Promise<void> {
        const api = screenOrientation();
        if (!api?.lock) throw unsupported(`lock('${to}')`);
        // Browsers reject with a bare NotSupportedError/SecurityError when the
        // document isn't fullscreen — restate it so the message is actionable.
        try {
            await api.lock(WEB_LOCK[to] ?? 'any');
        } catch {
            throw unsupported(`lock('${to}')`);
        }
    },

    async unlock(): Promise<void> {
        screenOrientation()?.unlock?.();
    },

    isAvailable(): boolean {
        return typeof screenOrientation()?.lock === 'function';
    },
} as const;
