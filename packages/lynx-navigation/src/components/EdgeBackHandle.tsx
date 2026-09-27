import {
    component,
    Gesture,
    runOnBackground,
    useGestureDetector,
    useMainThreadRef,
    type Define,
    type MainThread,
    type MainThreadRef,
} from '@sigx/lynx';
import { withTiming } from '@sigx/lynx-motion';
import { useNavInternals } from '../hooks/use-nav-internal.js';
import { screenWidthMT } from '../internal/screen-width.js';

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

/** Per-gesture MT state, held in a `MainThreadRef` the owning `<Stack>` creates. */
export interface EdgeBackState {
    startPageX: number;
    prevPageX: number;
    prevTime: number;
    velocity: number;
}

/** Initial {@link EdgeBackState} — `onStart` resets every field anyway. */
export function createEdgeBackState(): EdgeBackState {
    return { startPageX: 0, prevPageX: 0, prevTime: 0, velocity: 0 };
}

export type EdgeBackHandleProps = Define.Prop<'state', MainThreadRef<EdgeBackState>, true>;

export const EdgeBackHandle = component<EdgeBackHandleProps>(({ props }) => {
    const ref = useMainThreadRef<MainThread.Element | null>(null);
    // Per-gesture transient state, shared by reference across the handlers.
    // Each `Gesture.Pan()` callback is its OWN worklet with its own `_c`
    // capture, so a plain closure object would be copied into each one:
    // onStart's `startPageX` never reached onUpdate/onEnd (drag distance
    // was measured from x=0), and onUpdate's velocity never reached onEnd
    // (a fast flick could not commit). A `MainThreadRef` crosses as a ref
    // the worklet runtime resolves to one MT object — the Draggable pattern.
    //
    // The ref comes from the owning <Stack>, not from a `useMainThreadRef`
    // here: `beginBackGesture()` (onStart) opens a transition, and the Stack
    // unmounts this handle as soon as `nav.transition` is set. A ref this
    // component owned would be released with it while the native pan keeps
    // firing onUpdate/onEnd — `cannot read property 'current' of undefined`
    // on iOS (#1201).
    const state = props.state;

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
            state.current.startPageX = pageX;
            state.current.prevPageX = pageX;
            state.current.prevTime = Date.now();
            state.current.velocity = 0;
            runOnBackground(() => {
                beginBackGesture();
            })();
        })
        .onUpdate((e: any) => {
            'main thread';
            if (!progress) return;
            const p = e && e.params;
            const pageX = (p && p.pageX) || 0;
            const dx = pageX - state.current.startPageX;
            const prog = Math.max(0, Math.min(1, dx / screenWidthMT()));
            progress.current.value = prog;

            const now = Date.now();
            const dt = now - state.current.prevTime;
            if (dt > 0) {
                state.current.velocity =
                    ((pageX - state.current.prevPageX) / dt) * 1000;
            }
            state.current.prevPageX = pageX;
            state.current.prevTime = now;
        })
        .onEnd((e: any) => {
            'main thread';
            if (!progress) return;
            const p = e && e.params;
            const pageX = (p && p.pageX) || 0;
            const dx = pageX - state.current.startPageX;
            const fraction = dx / screenWidthMT();
            const commit =
                fraction > COMMIT_TRANSLATION ||
                state.current.velocity > COMMIT_VELOCITY;

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
