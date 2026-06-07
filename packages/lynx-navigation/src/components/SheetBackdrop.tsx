/**
 * `<SheetBackdrop>` — built-in dimmed backdrop behind a `presentation:
 * 'sheet'` entry. Unlike `modal` (where the screen owns its backdrop),
 * sheets always render this: the dim is intrinsic to the bottom-sheet
 * pattern, and the navigator owning it avoids every sheet screen
 * re-implementing overlay + tap-to-dismiss (the duplication previously
 * seen in `lynx-emoji`'s SheetPicker).
 *
 * Rendered by `<Stack>` immediately before the sheet's `<Layer>` in the
 * same slot — Lynx has no z-index, so document order places it above all
 * lower layers and beneath the sheet surface. Tap routing works because
 * the sheet's host view is translated down to the sheet's top edge: taps
 * on the dimmed region above land here.
 *
 * Opacity binds the dedicated sheet SharedValue, so the dim tracks the
 * sheet position exactly — proportional at partial snap points, fading in
 * lockstep during drag-to-dismiss. With animations disabled (no SV) the
 * backdrop renders at full dim statically.
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
        if (!sv) return null;
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
            bindtap={() => {
                if (props.dismissable) nav.pop();
            }}
            style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                bottom: '0',
                display: props.hidden ? 'none' : 'flex',
                backgroundColor: '#000',
                // With an SV the binding drives opacity; statically,
                // render the resting-progress-proportional dim.
                opacity: props.sheetProgress ? 0 : props.staticOpacity,
            }}
        />
    );
});
