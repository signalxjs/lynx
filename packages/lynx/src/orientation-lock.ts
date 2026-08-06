import { onMounted, onUnmounted } from '@sigx/runtime-core';
import { createLogger, Orientation, type OrientationLock } from '@sigx/lynx-core';

const log = createLogger('orientation');

/**
 * Hold an orientation lock for exactly as long as the calling component is
 * mounted, then restore the app's configured set (#856).
 *
 * This is the shape almost every real use wants — "this one screen is
 * landscape" — and it's easy to get wrong by hand, because the release has to
 * survive an unmount triggered by a back gesture, a deep link, or an error.
 *
 * Lives in the umbrella rather than `@sigx/lynx-core` because it needs the
 * component lifecycle; core stays dependency-light (`@sigx/reactivity` only)
 * and exposes the imperative {@link Orientation} service the hook drives.
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
    onMounted(() => {
        void Orientation.lock(to).catch((e: unknown) => {
            log.warn(`lock('${to}') failed`, e);
        });
    });
    onUnmounted(() => {
        void Orientation.unlock().catch((e: unknown) => {
            log.warn('unlock failed', e);
        });
    });
}
