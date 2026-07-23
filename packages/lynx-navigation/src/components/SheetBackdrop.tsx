/**
 * `<SheetBackdrop>` — built-in dimmed backdrop behind a `presentation:
 * 'sheet'` entry: a thin navigator wrapper over `@sigx/lynx-sheet`'s
 * generic `<Backdrop>` (which owns the element, the reveal-bound opacity
 * binding, and the tap-consuming `catchtap`). This wrapper adds only the
 * navigator wiring: `nav.pop()` on a dismissable tap, and the resting-dim
 * `staticOpacity` for covered sheets / animations-disabled navigators.
 *
 * It is always PRESENT (constant child shape for `<SheetSlot>`), but a
 * `backdrop: false` sheet renders it INERT — `display: none`, no dim, no
 * tap capture — for a non-modal inline sheet whose screen below stays
 * interactive (`enabled` prop).
 *
 * Rendered by `<Stack>` immediately before the sheet's `<Layer>` in the
 * same slot — Lynx has no z-index, so document order places it above all
 * lower layers and beneath the sheet surface. Tap routing works because
 * the sheet's host view is translated down to the sheet's top edge: taps
 * on the dimmed region above land here.
 *
 * Opacity binds the dedicated sheet reveal SV over `[0, maxDetentPx]` px →
 * `[0, max]`, so the dim tracks the sheet position exactly — proportional
 * at partial detents, fading in lockstep during drag-to-dismiss (the same
 * contract `backdropAnimation` in layer-plan.ts states).
 */
import { component, type Define, type SharedValue } from '@sigx/lynx';
import { Backdrop } from '@sigx/lynx-sheet';
import { useNav } from '../hooks/use-nav.js';

type SheetBackdropProps =
    /**
     * Sheet reveal SV (px) — only the *active* sheet (top/transitioning)
     * binds it; null for covered-but-visible sheets and when animations
     * are disabled, in which case `staticOpacity` renders instead.
     */
    & Define.Prop<'sheetReveal', SharedValue<number> | null, true>
    /** Largest detent (px) — the reveal at which the dim reaches its max. */
    & Define.Prop<'maxDetentPx', number, true>
    /**
     * Dim to render when no SV is bound: the sheet's resting reveal mapped
     * onto the backdrop range, so a sheet sitting under a modal (or with
     * animations disabled) keeps its proportional dim instead of snapping
     * to full.
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

    return () => (
        <Backdrop
            revealSV={props.sheetReveal}
            inputRange={[0, props.maxDetentPx]}
            staticOpacity={props.staticOpacity}
            enabled={props.enabled}
            hidden={props.hidden}
            // `<Backdrop>` only fires this while enabled (its `catchtap`
            // gate), so `backdrop: false` sheets stay un-dismissable here.
            onPress={() => {
                if (props.dismissable) nav.pop();
            }}
        />
    );
});
