import { onMounted, onUnmounted } from '@sigx/runtime-core';
import { createLogger, Orientation, type OrientationLock } from '@sigx/lynx-core';

const log = createLogger('orientation');

/**
 * Active mount-scoped locks, innermost last.
 *
 * A stack rather than a single value because screens overlap:
 * `@sigx/lynx-navigation` keeps a covered screen MOUNTED under a card, modal
 * or sheet, so two holders can be alive at once. Unlocking unconditionally on
 * unmount would drop a still-mounted screen's lock the moment something
 * presented above it went away.
 */
const holders: Array<{ id: number; to: OrientationLock }> = [];
let nextId = 0;

/** Apply the innermost surviving lock, or release when none is left. */
function applyTop(action: string): void {
    const top = holders[holders.length - 1];
    const request = top ? Orientation.lock(top.to) : Orientation.unlock();
    void request.catch((e: unknown) => {
        log.warn(`${action} failed`, e);
    });
}

/**
 * Hold an orientation lock for exactly as long as the calling component is
 * mounted, then restore whatever was in force before it (#856).
 *
 * This is the shape almost every real use wants — "this one screen is
 * landscape" — and it's easy to get wrong by hand, because the release has to
 * survive an unmount triggered by a back gesture, a deep link, or an error,
 * *and* has to respect an outer screen that still wants its own lock.
 *
 * Lives in the umbrella rather than `@sigx/lynx-core` because it needs the
 * component lifecycle; core stays dependency-light (`@sigx/reactivity` only)
 * and exposes the imperative {@link Orientation} service the hook drives.
 *
 * The value is read once at mount — pass `'default'` for a screen that must
 * shed an ambient lock rather than inherit it.
 *
 * Rejections are logged rather than rethrown: the common failure is a build
 * misconfiguration (`signalx.config.ts`'s `orientation` doesn't allow the
 * requested value), and a mounting screen shouldn't produce an unhandled
 * rejection over it — the warning names the config change to make.
 *
 * @example
 * ```tsx
 * export const VideoScreen = component(() => {
 *     useOrientationLock('landscape');
 *     return () => <Player />;
 * });
 * ```
 */
export function useOrientationLock(to: OrientationLock): void {
    const id = nextId++;

    onMounted(() => {
        holders.push({ id, to });
        applyTop(`lock('${to}')`);
    });

    onUnmounted(() => {
        const index = holders.findIndex((h) => h.id === id);
        if (index === -1) return;
        holders.splice(index, 1);
        // Restores the next holder down, or unlocks when this was the last —
        // so popping a landscape screen off a landscape-locked one keeps the
        // lock rather than snapping back to the configured default.
        applyTop('unlock');
    });
}
