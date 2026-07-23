/**
 * `<SheetDragAdapter>` — renderless adapter that drives `@sigx/lynx-sheet`'s
 * shared engine + surface pan for a `presentation: 'sheet'` route entry.
 * Successor to the bespoke `<SheetDragController>` (#774): the drag↔scroll
 * arbitration, reveal clamping and release (snap/dismiss) math all live in
 * the shared package now; this adapter only wires the navigator's state
 * into it —
 *
 *  - the navigator's dedicated `sheetReveal` SV is INJECTED as the engine's
 *    reveal (the layer/backdrop/`useSheetHeight` bindings already target it);
 *  - the resolved detents (px) become the engine geometry, pushed through
 *    `syncGeom` (a BG-side SV write never reaches a worklet — #758);
 *  - `onClaim` stamps `<SheetSlot>`'s gen signal + takes the gesture
 *    scroll-lock; `onRelease` gen-guards the deferred settle/dismiss.
 *
 * Mounted by `<SheetSlot>` for the top *resting* sheet only, keyed by
 * detent signature + drag mode — worklet captures are static at register
 * time, so a config change must remount for fresh captures. Entry identity
 * is already pinned by the slot's own key.
 *
 * **Settle-order invariant** (ported verbatim from SheetDragController):
 * a snap release records the settled detent FIRST and releases the gesture
 * lock SECOND, in ONE BG tick — so `enable-scroll` recomputes exactly once
 * with consistent rest state (a sub-max settle hands over to the rest-lock
 * with no unlock gap). Both release paths are gen-guarded against
 * `genSignal`, so a re-grab during the settle tween supersedes them and a
 * stale `commitSheetDismiss` can't pop the sheet under the new finger.
 */
import {
    component,
    useGestureDetector,
    useSharedValue,
    type Define,
    type MainThread,
    type MainThreadRef,
    type PrimitiveSignal,
    type ScrollDragHost,
} from '@sigx/lynx';
import {
    createSheetPan,
    GRABBER_HEIGHT,
    RELEASE_DISMISS,
    SNAP_MS,
    useSheetEngine,
} from '@sigx/lynx-sheet';
import { useNavInternals } from '../hooks/use-nav-internal.js';
import { SCREEN_HEIGHT } from '../internal/screen-width.js';

type SheetDragAdapterProps =
    /** Entry key of the sheet this adapter drives — pins the dismiss commit. */
    & Define.Prop<'entryKey', string, true>
    /** Resolved detents (px, ascending) for the active sheet. */
    & Define.Prop<'detentsPx', readonly number[], true>
    /** Resting reveal (px) — the engine's `open` detent (unused by surface drags). */
    & Define.Prop<'restPx', number, true>
    /** `'surface'`: body drags; `'grabber'`: only the top strip zone claims. */
    & Define.Prop<'dragMode', 'surface' | 'grabber', true>
    /** The sheet Layer's host element ref — the pan attaches here. */
    & Define.Prop<'hostRef', MainThreadRef<MainThread.Element | null>, true>
    /** Scroll-coordination host the `<SheetSlot>` allocated + provided. */
    & Define.Prop<'dragHost', ScrollDragHost, true>
    /** BG generation signal — stale settle/dismiss timeouts compare-and-bail. */
    & Define.Prop<'genSignal', PrimitiveSignal<number>, true>
    /** BG callback: a sheet-owned gesture began/ended (gates content scroll). */
    & Define.Prop<'onGestureLock', (locked: boolean) => void, true>
    /** BG callback: the sheet settled at a (non-dismiss) detent reveal px. */
    & Define.Prop<'onSettle', (revealPx: number) => void, true>;

export const SheetDragAdapter = component<SheetDragAdapterProps>(({ props }) => {
    // Snapshot config at setup — `<SheetSlot>` keys this component by
    // detent signature + drag mode, so a config change remounts it with
    // fresh worklet captures. Plain arrays/numbers/strings capture cleanly.
    const entryKey = props.entryKey;
    const detentsPx = [...props.detentsPx];
    const floorPx = detentsPx[0] ?? 0;
    const topPx = detentsPx[detentsPx.length - 1] ?? 0;
    const restPx = props.restPx;
    const onSettle = props.onSettle;
    const onGestureLock = props.onGestureLock;
    const genSignal = props.genSignal;

    const internals = useNavInternals();
    const commitSheetDismiss = internals.commitSheetDismiss;
    // Non-null by the mount gate: `<SheetSlot>` only mounts this adapter
    // when the navigator is animated (`internals.sheetReveal` exists).
    const sheetReveal = internals.sheetReveal!;

    const engine = useSheetEngine({
        // Route-sheet geometry is remount-static (the detent signature is in
        // this component's key), so the live accessor returns the setup
        // snapshot. `open` is only meaningful for `openToLift` engines —
        // supplied as the current rest detent for completeness.
        geometry: () => ({ floor: floorPx, open: restPx, top: topPx, detents: detentsPx }),
        panelHeight: () => topPx,
        // Inject the navigator's dedicated sheet SV — the layer, backdrop
        // and `useSheetHeight` bindings already target it.
        reveal: sheetReveal,
    });
    // Push geometry + flags to the worklets. Route sheets are always
    // dismissible (dismissible=1); the drag gate is open (gate=1) because
    // mounting IS the gate here — `<SheetSlot>` unmounts the adapter when
    // drag turns off. Must travel via syncGeom: a render/BG-side SV write
    // is a read-only no-op and would never arrive on the MT (#758).
    void engine.syncGeom(floorPx, topPx, detentsPx, 1, 1);

    // Route sheets are screen-anchored: the sheet's bottom edge is the
    // screen bottom, so the pan's grabber-zone test uses SCREEN_HEIGHT.
    const bottomEdgeSV = useSharedValue(SCREEN_HEIGHT);

    const pan = createSheetPan(engine, {
        surface: true,
        grabberOnly: props.dragMode === 'grabber',
        grabberPx: GRABBER_HEIGHT,
        minDistance: 8,
        scrollOffsetY: props.dragHost.scrollOffsetY,
        hasVerticalScroll: props.dragHost.hasVerticalScroll,
        bottomEdgeSV,
        onClaim: (gen: number) => {
            genSignal.value = gen; // invalidates stale settle timeouts
            onGestureLock(true);
        },
        onRelease: (kind: number, index: number, gen: number) => {
            // Deferred until the release tween lands (SNAP_MS), gen-guarded:
            // a re-grab during the settle supersedes this timeout.
            setTimeout(() => {
                if (genSignal.value !== gen) return;
                if (kind === RELEASE_DISMISS) {
                    // The pan already animated the reveal to 0 — only the
                    // stack mutation remains. The gesture lock is dropped by
                    // `<SheetSlot>`'s drag-disabled effect when the pop
                    // unmounts this adapter (mirrors SheetDragController).
                    commitSheetDismiss(entryKey);
                    return;
                }
                // Record the detent FIRST, release the scroll lock SECOND,
                // in one BG tick — see the settle-order invariant above.
                onSettle(detentsPx[index] ?? floorPx);
                onGestureLock(false);
            }, SNAP_MS);
        },
    });
    useGestureDetector(props.hostRef, pan);

    return () => null;
});
