import {
    component,
    Gesture,
    runOnBackground,
    useGestureDetector,
    useMainThreadRef,
    type MainThread,
} from '@sigx/lynx';
import { withTiming } from '@sigx/lynx-motion';
import { useNavInternals } from '../hooks/use-nav-internal.js';
import { SCREEN_WIDTH } from '../internal/screen-width.js';

/**
 * Edge-pan recognizer for iOS-style swipe-back. Mounts as an absolutely-
 * positioned 20px-wide strip on the left edge of the active screen; only
 * exists when `nav.canGoBack && !transition`.
 *
 * `Gesture.Pan().minDistance(MIN_DISTANCE)` lets quick taps pass through to
 * whatever's behind the strip (back button, screen header, etc.). Only
 * horizontal drags past the threshold activate the gesture.
 *
 * MT/BG split:
 *   - All gesture handlers run on MT. They write `progress.current.value`
 *     directly per frame (no per-frame bridge crossing) and dispatch
 *     `runOnBackground(...)` only at start/commit/cancel — three BG hops
 *     per gesture max.
 *   - The transition state machine on BG mounts the underneath
 *     `<ScreenContainer>` once `beginBackGesture` lands; the gesture's
 *     in-flight progress writes are picked up the moment the binding
 *     registers (Phase 0.5 polish: pre-mount underneath when canGoBack to
 *     eliminate the brief pre-mount latency).
 *
 * Implementation notes (matching `<Draggable>`):
 *   - Single `useMainThreadRef` holding an object — primitive refs don't
 *     survive worklet capture cleanly in some Lynx versions, while object
 *     refs do (the worklet runtime resolves the ref via the
 *     `_workletRefMap`).
 *   - `e: any` rather than `e: unknown` — type annotations are erased, but
 *     SWC's worklet transform has been observed to behave better with the
 *     looser annotation. Keeps us aligned with Draggable verbatim.
 *   - Empty `onBegin`: load-bearing on iOS — without a registered onBegin
 *     callback, `LynxPanGestureHandler` skips the begin path and onStart/
 *     onEnd never fire (per Draggable's notes).
 */

/** Fraction of screen width past which a release commits the back nav. */
const COMMIT_TRANSLATION = 0.33;
/** px/sec horizontal speed past which a release commits, regardless of distance. */
const COMMIT_VELOCITY = 300;
/** Width of the touchable strip on the left edge of every screen. */
const EDGE_ZONE_WIDTH = 20;
/** Minimum movement before the gesture activates (lets taps pass through). */
const MIN_DISTANCE = 8;
const SNAP_DURATION_SEC = 0.18;
/**
 * Pre-computed milliseconds for the BG-side `setTimeout`. Module-level so
 * it's in scope for both the MT worklet (`withTiming` argument) and the BG
 * callback wrapped by `runOnBackground` (`setTimeout` argument). Locals
 * declared inside an MT worklet body are MT-only — the BG callback's
 * closure can't see them, hence "ReferenceError: snapMs is not defined".
 */
const SNAP_DURATION_MS = Math.round(SNAP_DURATION_SEC * 1000);

export const EdgeBackHandle = component(() => {
    const ref = useMainThreadRef<MainThread.Element | null>(null);
    // Per-gesture transient state — captured as a plain closure object
    // rather than a `useMainThreadRef`. Lynx's SWC worklet transform deep-
    // copies plain objects into `_c` once at register time; mutations on MT
    // persist across calls because the same `_c` is bound for the lifetime
    // of the gesture registration. Using a `useMainThreadRef` here was
    // crashing on iOS with `cannot read property 'current' of undefined`
    // — the resolved-ref capture path looked up an empty
    // `_workletRefMap` entry under a race I haven't fully tracked down.
    // Plain object avoids that path entirely.
    const state = {
        startPageX: 0,
        prevPageX: 0,
        prevTime: 0,
        velocity: 0,
    };

    const internals = useNavInternals();
    const progress = internals.progress;
    const beginBackGesture = internals.beginBackGesture;
    const commitBackGesture = internals.commitBackGesture;
    const cancelBackGesture = internals.cancelBackGesture;

    const pan = Gesture.Pan()
        .minDistance(MIN_DISTANCE)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: any) => {
            'main thread';
            const p = e && e.params;
            const pageX = (p && p.pageX) || 0;
            state.startPageX = pageX;
            state.prevPageX = pageX;
            state.prevTime = Date.now();
            state.velocity = 0;
            runOnBackground(() => {
                beginBackGesture();
            })();
        })
        .onUpdate((e: any) => {
            'main thread';
            if (!progress) return;
            const p = e && e.params;
            const pageX = (p && p.pageX) || 0;
            const dx = pageX - state.startPageX;
            const prog = Math.max(0, Math.min(1, dx / SCREEN_WIDTH));
            progress.current.value = prog;

            const now = Date.now();
            const dt = now - state.prevTime;
            if (dt > 0) {
                state.velocity =
                    ((pageX - state.prevPageX) / dt) * 1000;
            }
            state.prevPageX = pageX;
            state.prevTime = now;
        })
        .onEnd((e: any) => {
            'main thread';
            if (!progress) return;
            const p = e && e.params;
            const pageX = (p && p.pageX) || 0;
            const dx = pageX - state.startPageX;
            const fraction = dx / SCREEN_WIDTH;
            const commit =
                fraction > COMMIT_TRANSLATION ||
                state.velocity > COMMIT_VELOCITY;

            if (commit) {
                withTiming(progress, 1, { duration: SNAP_DURATION_SEC });
                runOnBackground(() => {
                    setTimeout(() => commitBackGesture(), SNAP_DURATION_MS);
                })();
            } else {
                withTiming(progress, 0, { duration: SNAP_DURATION_SEC });
                runOnBackground(() => {
                    setTimeout(() => cancelBackGesture(), SNAP_DURATION_MS);
                })();
            }
        });

    useGestureDetector(ref, pan);

    return () => (
        <view
            main-thread:ref={ref}
            style={{
                position: 'absolute',
                top: '0',
                left: '0',
                width: `${EDGE_ZONE_WIDTH}px`,
                bottom: '0',
            }}
        />
    );
});
