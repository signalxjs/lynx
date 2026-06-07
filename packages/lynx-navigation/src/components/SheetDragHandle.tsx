/**
 * `<SheetDragHandle>` — pan recognizer for `presentation: 'sheet'` entries.
 * Drags the sheet between its snap points and dismisses on a drag/fling
 * past the threshold. Mounted by `<Stack>` for the top resting sheet only
 * (never mid-transition), as a grabber strip aligned to the sheet's top
 * edge: the strip's own translateY binds the same sheet SharedValue with
 * the same mapper as the sheet's `<Layer>`, so it tracks the sheet
 * per-frame on MT with no extra wiring.
 *
 * **v1 scope:** the pan area is the grabber strip only, not the whole
 * sheet surface — there's no scroll/drag arbitration primitive here yet,
 * so content inside the sheet scrolls normally and sheet drags happen
 * from the strip.
 *
 * MT/BG split mirrors `<EdgeBackHandle>` (see its header for the
 * worklet-capture notes: plain closure `state` object, empty `onBegin`
 * load-bearing on iOS, `e: any`):
 *   - All gesture handlers run on MT and write the sheet SV directly per
 *     frame. The sheet rests *bound* to its dedicated SV (it's never reset
 *     by other transitions), so dragging needs no begin/transition setup.
 *   - BG hops: at most one per gesture — `commitSheetDismiss` after the
 *     dismiss settle, or `onSettle(target)` after a snap settle (records
 *     the new resting progress so a covered sheet keeps its position).
 */
import {
    component,
    Gesture,
    runOnBackground,
    useAnimatedStyle,
    useGestureDetector,
    useMainThreadRef,
    type Define,
    type MainThread,
} from '@sigx/lynx';
import { withTiming } from '@sigx/lynx-motion';
import { useNavInternals } from '../hooks/use-nav-internal.js';
import { sheetAnimation } from '../internal/layer-plan.js';
import { nearestSnap, shouldDismiss } from '../internal/sheet-math.js';
import { SCREEN_HEIGHT } from '../internal/screen-width.js';

/** Height of the grabber strip at the sheet's top edge. */
const GRABBER_HEIGHT = 28;
/** Minimum movement before the gesture activates (lets taps pass through). */
const MIN_DISTANCE = 8;
const SNAP_DURATION_SEC = 0.18;
/**
 * Pre-computed ms for the BG-side `setTimeout` — module-level so both the
 * MT worklet and the BG callback closure can see it (locals inside an MT
 * worklet body are MT-only; see EdgeBackHandle).
 */
const SNAP_DURATION_MS = Math.round(SNAP_DURATION_SEC * 1000);

type SheetDragHandleProps =
    /** Entry key of the sheet this handle drives — pins the dismiss commit. */
    & Define.Prop<'entryKey', string, true>
    /** Snap progress values (ascending) for the active sheet. */
    & Define.Prop<'snapProgresses', readonly number[], true>
    /** Largest snap fraction — fixes the strip's translateY range. */
    & Define.Prop<'maxSnapFraction', number, true>
    /** BG callback: the sheet settled at a (non-dismiss) snap progress. */
    & Define.Prop<'onSettle', (progress: number) => void, true>;

export const SheetDragHandle = component<SheetDragHandleProps>(({ props }) => {
    const ref = useMainThreadRef<MainThread.Element | null>(null);

    // Snapshot config at setup — the Stack keys this component by entry
    // AND snap-config signature, so both a different sheet and a reactive
    // snapPoints change remount it with fresh values. Plain arrays/
    // numbers worklet-capture cleanly (deep-copied into `_c` at register).
    const entryKey = props.entryKey;
    const snapProgresses = [...props.snapProgresses];
    const minSnapProgress = snapProgresses[0] ?? 0;
    const maxSnapFraction = props.maxSnapFraction;
    /** px of travel for the full progress range [0, 1]. */
    const travelPx = Math.max(1, maxSnapFraction * SCREEN_HEIGHT);
    const onSettle = props.onSettle;

    const internals = useNavInternals();
    const sheetProgress = internals.sheetProgress;
    const commitSheetDismiss = internals.commitSheetDismiss;

    // Per-gesture transient state — plain closure object, not a
    // `useMainThreadRef` (see EdgeBackHandle's capture notes).
    const state = {
        startPageY: 0,
        startProgress: 0,
        prevPageY: 0,
        prevTime: 0,
        velocity: 0, // px/sec, positive = downward
    };

    const pan = Gesture.Pan()
        .minDistance(MIN_DISTANCE)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: any) => {
            'main thread';
            if (!sheetProgress) return;
            const p = e && e.params;
            const pageY = (p && p.pageY) || 0;
            state.startPageY = pageY;
            state.startProgress = sheetProgress.current.value;
            state.prevPageY = pageY;
            state.prevTime = Date.now();
            state.velocity = 0;
        })
        .onUpdate((e: any) => {
            'main thread';
            if (!sheetProgress) return;
            const p = e && e.params;
            const pageY = (p && p.pageY) || 0;
            // Drag down (dy > 0) closes: progress decreases.
            const dy = pageY - state.startPageY;
            const prog = Math.max(
                0,
                Math.min(1, state.startProgress - dy / travelPx),
            );
            sheetProgress.current.value = prog;

            const now = Date.now();
            const dt = now - state.prevTime;
            if (dt > 0) {
                state.velocity = ((pageY - state.prevPageY) / dt) * 1000;
            }
            state.prevPageY = pageY;
            state.prevTime = now;
        })
        .onEnd(() => {
            'main thread';
            if (!sheetProgress) return;
            const prog = sheetProgress.current.value;
            if (shouldDismiss(prog, state.velocity, minSnapProgress)) {
                withTiming(sheetProgress, 0, { duration: SNAP_DURATION_SEC });
                runOnBackground(() => {
                    setTimeout(() => commitSheetDismiss(entryKey), SNAP_DURATION_MS);
                })();
            } else {
                const target = nearestSnap(prog, state.velocity, snapProgresses);
                withTiming(sheetProgress, target, { duration: SNAP_DURATION_SEC });
                // Record the new resting progress on BG so a later covered-
                // sheet render places it statically at the right offset.
                // Deferred until the snap animation lands (mirroring the
                // dismiss path) so a navigation racing the settle doesn't
                // read the final detent while the sheet is still mid-snap.
                runOnBackground(() => {
                    setTimeout(() => onSettle(target), SNAP_DURATION_MS);
                })();
            }
        });

    useGestureDetector(ref, pan);

    // Track the sheet's top edge: identical SV + mapper as the sheet's
    // `<Layer>`, so the strip rides the sheet during drags and snaps.
    useAnimatedStyle(ref, () => {
        if (!sheetProgress) return null;
        const a = sheetAnimation(sheetProgress, maxSnapFraction);
        return {
            sv: a.progress,
            mapperName: a.mapperName,
            params: {
                inputRange: [a.inputRange[0], a.inputRange[1]],
                outputRange: [a.outputRange[0], a.outputRange[1]],
            },
        };
    });

    return () => (
        <view
            main-thread:ref={ref}
            style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                height: `${GRABBER_HEIGHT}px`,
            }}
        />
    );
});
