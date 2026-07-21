/**
 * `<SheetBackdrop>` — built-in dimmed backdrop behind a `presentation:
 * 'sheet'` entry. Unlike `modal` (where the screen owns its backdrop),
 * the navigator owns the sheet's dim so every sheet screen needn't
 * re-implement overlay + tap-to-dismiss (the duplication previously
 * seen in `lynx-emoji`'s SheetPicker). It is always PRESENT (constant
 * child shape for `<SheetSlot>`), but a `backdrop: false` sheet renders
 * it INERT — `display: none`, no dim, no tap capture — for a non-modal
 * inline sheet whose screen below stays interactive (`enabled` prop).
 *
 * Rendered by `<Stack>` immediately before the sheet's `<Layer>` in the
 * same slot — Lynx has no z-index, so document order places it above all
 * lower layers and beneath the sheet surface. Tap routing works because
 * the sheet's host view is translated down to the sheet's top edge: taps
 * on the dimmed region above land here.
 *
 * Opacity binds the dedicated sheet SharedValue, so the dim tracks the
 * sheet position exactly — proportional at partial snap points, fading in
 * lockstep during drag-to-dismiss. Without an SV (covered sheet, or
 * animations disabled) it renders `staticOpacity` — the resting-progress
 * proportional dim — statically.
 */
import {
    component,
    useAnimatedStyle,
    useMainThreadRef,
    type Define,
    type MainThread,
    type SharedValue,
} from '@sigx/lynx';
import { useNav } from '../hooks/use-nav.js';
import { backdropAnimation } from '../internal/layer-plan.js';

type SheetBackdropProps =
    /**
     * Sheet progress SV — only the *active* sheet (top/transitioning)
     * binds it; null for covered-but-visible sheets and when animations
     * are disabled, in which case `staticOpacity` renders instead.
     */
    & Define.Prop<'sheetProgress', SharedValue<number> | null, true>
    /**
     * Dim to render when no SV is bound: the sheet's resting progress
     * mapped onto the backdrop range, so a sheet sitting under a modal
     * (or with animations disabled) keeps its proportional dim instead
     * of snapping to full.
     */
    & Define.Prop<'staticOpacity', number, true>
    /** When true, tapping the backdrop pops the sheet. */
    & Define.Prop<'dismissable', boolean, true>
    /**
     * When false (a `backdrop: false` sheet), render the backdrop inert:
     * `display: none` so it neither dims nor intercepts taps — the region
     * above the sheet surface passes touches straight through to the
     * screen below. Kept in the tree (not conditionally removed) so
     * `<SheetSlot>`'s fragment keeps its constant 3-child shape.
     */
    & Define.Prop<'enabled', boolean, true>
    /**
     * Mirror of the sheet layer's retained-covered state: render with
     * `display: none` (stays mounted, keeps `<SheetSlot>`'s child shape
     * stable) while the sheet itself is hidden.
     */
    & Define.Prop<'hidden', boolean, true>;

export const SheetBackdrop = component<SheetBackdropProps>(({ props }) => {
    const nav = useNav();
    const ref = useMainThreadRef<MainThread.Element | null>(null);

    // Same reactive binding shape as `<Layer>`: flips between a spec and
    // null without remounting the element.
    useAnimatedStyle(ref, () => {
        const sv = props.sheetProgress;
        // Disabled backdrop: no dim binding — the element is display:none.
        if (!props.enabled || !sv) return null;
        const a = backdropAnimation(sv);
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
            // `catch*` (vs `bind*`) consumes the event — the backdrop
            // covers the underlying screen, so a tap on the dim must never
            // reach interactive elements behind it, dismissable or not.
            catchtap={() => {
                if (props.enabled && props.dismissable) nav.pop();
            }}
            style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                bottom: '0',
                // `enabled: false` → display:none, matching a `hidden`
                // (covered) backdrop: not laid out, so it catches no taps —
                // touches above the sheet reach the screen below.
                display: (!props.enabled || props.hidden) ? 'none' : 'flex',
                backgroundColor: '#000',
                // With an SV the binding drives opacity; statically,
                // render the resting-progress-proportional dim.
                opacity: props.sheetProgress ? 0 : props.staticOpacity,
            }}
        />
    );
});
