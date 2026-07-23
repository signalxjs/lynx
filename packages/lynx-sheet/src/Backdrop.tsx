/**
 * `<Backdrop>` — generic dimmed backdrop behind a sheet, bound to a
 * reveal SharedValue. Ported from lynx-navigation's `SheetBackdrop`
 * minus the navigator wiring (that package's wrapper adds `nav.pop()`
 * and covered-sheet statics); this one just dims and reports taps.
 *
 * It is meant to be ALWAYS PRESENT in its parent's tree (constant child
 * shape — flipping children remounts siblings), rendered `display: none`
 * while disabled/hidden so it neither dims nor intercepts taps.
 *
 * Lynx has no z-index and no portal, so stacking is document order: the
 * backdrop must be rendered immediately BEFORE the sheet panel in the
 * same positioned container, and it covers that container — a full-screen
 * dim therefore needs a full-surface positioned ancestor, with the sheet
 * (+ backdrop) as its LAST children so nothing else paints above them.
 *
 * Opacity binds the reveal SV over `[inputRange[0], inputRange[1]] →
 * [0, maxOpacity]` px, so the dim tracks the sheet position exactly —
 * proportional at partial detents, fading in lockstep during a
 * drag-to-dismiss. Without an SV it renders `staticOpacity`.
 */
import {
    component,
    useAnimatedStyle,
    useMainThreadRef,
    type Define,
    type MainThread,
    type SharedValue,
} from '@sigx/lynx';

/** Default fully-open dim (matches the route sheet's backdrop). */
export const SHEET_BACKDROP_MAX_OPACITY = 0.4;

export type BackdropProps =
    /** Reveal SV to bind the dim to; null → render `staticOpacity`. */
    & Define.Prop<'revealSV', SharedValue<number> | null, true>
    /** Reveal px range `[start, end]` mapped onto `[0, maxOpacity]`. */
    & Define.Prop<'inputRange', readonly [number, number], true>
    & Define.Prop<'maxOpacity', number, false>
    /** Dim to render when no SV is bound. Default 0. */
    & Define.Prop<'staticOpacity', number, false>
    /**
     * When false, render inert: `display: none` — no dim, no tap capture,
     * touches pass through to the content below. Kept in the tree so the
     * parent keeps a constant child shape.
     */
    & Define.Prop<'enabled', boolean, true>
    /** Extra hide flag (e.g. covered-by-another-layer) — also display:none. */
    & Define.Prop<'hidden', boolean, false>
    /**
     * Tap on the dim (fires on BG). The backdrop always CONSUMES the tap
     * (`catchtap` — it covers content, so a tap must never reach
     * interactive elements behind it); the caller decides whether that
     * means dismiss.
     */
    & Define.Prop<'onPress', () => void, false>;

export const Backdrop = component<BackdropProps>(({ props }) => {
    const ref = useMainThreadRef<MainThread.Element | null>(null);

    // Same reactive binding shape as the navigator's layers: flips between
    // a spec and null without remounting the element.
    useAnimatedStyle(ref, () => {
        const sv = props.revealSV;
        if (!props.enabled || !sv) return null;
        return {
            sv,
            mapperName: 'opacity' as const,
            params: {
                inputRange: [props.inputRange[0], props.inputRange[1]],
                outputRange: [0, props.maxOpacity ?? SHEET_BACKDROP_MAX_OPACITY],
            },
        };
    });

    return () => (
        <view
            main-thread:ref={ref}
            // `catch*` (vs `bind*`) consumes the event — see `onPress` doc.
            catchtap={() => {
                if (props.enabled) props.onPress?.();
            }}
            style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                bottom: '0',
                display: (!props.enabled || props.hidden === true) ? 'none' : 'flex',
                backgroundColor: '#000',
                // With an SV the binding drives opacity; statically, render
                // the caller's resting dim.
                opacity: props.revealSV ? 0 : (props.staticOpacity ?? 0),
            }}
        />
    );
});
