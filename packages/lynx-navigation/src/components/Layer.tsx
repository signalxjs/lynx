/**
 * `<Layer>` — one row in `<Stack>`'s layered render. Absolutely-
 * positioned host view that fills the Stack's relative wrapper, with
 * an optional MT-bound `translateX` / `translateY` animation driven
 * by a `SharedValue<number>` from the navigator's transition state.
 *
 * `<Stack>` emits one `<Layer>` per entry returned by
 * `computeLayers(...)`. Layer.key in the parent is `layer-${entry.key}` —
 * stable for the entry's whole life. The host view, `<EntryScope>`, and the
 * screen component therefore stay mounted across every animation phase
 * (animated → static, push/pop transitions), so a screen's `onMounted` /
 * data fetches fire exactly once per navigation and no state is lost.
 *
 * The transform binding is the only thing that changes as the layer animates
 * vs rests: it's driven by the *reactive* form of `useAnimatedStyle`, which
 * (re)registers/unregisters the MT style binding on this same element as
 * `props.animation` flips between a spec and `null`. No remount needed.
 *
 * Layouts:
 *  - Host view is `position: absolute; top/right/bottom/left: 0;
 *    display: flex; flexDirection: column` so descendants that
 *    flex-fill (SafeAreaView, daisyui screens) get a sized parent.
 *  - No background. Screens own their own surface colour (typically
 *    via a daisy `bg-base-*` class on the screen body).
 */
import {
    component,
    useMainThreadRef,
    useAnimatedStyle,
    type ComponentFactory,
    type Define,
    type MainThread,
} from '@sigx/lynx';
import { Suspense, isLazyComponent } from '@sigx/lynx';
import type { LayerAnimation } from '../internal/layer-plan.js';
import type { RouteMap, StackEntry } from '../types.js';
import { EntryScope } from './EntryScope.js';

export type LayerProps =
    & Define.Prop<'entry', StackEntry, true>
    & Define.Prop<'routes', RouteMap, true>
    /** When set, the host view animates per the transform spec. */
    & Define.Prop<'animation', LayerAnimation | null, false>
    /**
     * Retained-but-covered layer: render with `display: none` so the
     * screen subtree stays mounted (state/scroll preserved) without
     * costing paint/layout while a higher opaque card covers it.
     * Toggling this is a style change on the stable host view — never a
     * remount. Mirrors how `<Tabs>` hides inactive tab bodies.
     */
    & Define.Prop<'hidden', boolean, false>;

export const Layer = component<LayerProps>(({ props }) => {
    const ref = useMainThreadRef<MainThread.Element | null>(null);
    // Reactive binding: the Layer's key is stable for the entry's life, so
    // `props.animation` changes (spec ↔ null) at runtime as the layer
    // animates and then settles. The reactive `useAnimatedStyle` re-binds the
    // MT transform on this same element each time, leaving the host view and
    // the screen subtree mounted throughout. Going static returns `null`,
    // which unregisters the binding (required: the navigator reuses one
    // shared progress SharedValue that resets to 0 on the next transition, so
    // a resting layer must not stay bound).
    useAnimatedStyle(ref, () => {
        const a = props.animation;
        if (!a) return null;
        return {
            sv: a.progress,
            mapperName: a.axis,
            params: {
                inputRange: [a.inputRange[0], a.inputRange[1]],
                outputRange: [a.outputRange[0], a.outputRange[1]],
            },
        };
    });

    return () => {
        const route = props.routes[props.entry.route];
        if (!route) return null;
        const Comp = route.component as unknown as ComponentFactory<
            Record<string, unknown>,
            unknown,
            unknown
        >;
        if (typeof Comp !== 'function') return null;
        const entryParams = props.entry.params as Record<string, unknown>;
        const body = isLazyComponent(Comp) && route.fallback
            ? (
                <Suspense fallback={route.fallback as never}>
                    <Comp {...entryParams} />
                </Suspense>
            )
            : <Comp {...entryParams} />;
        return (
            <view
                main-thread:ref={ref}
                style={{
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    right: '0',
                    bottom: '0',
                    // `none` keeps a covered card mounted but unpainted;
                    // reading `props.hidden` here re-renders (no remount)
                    // when the layer is covered/revealed.
                    display: props.hidden ? 'none' : 'flex',
                    flexDirection: 'column',
                }}
            >
                <EntryScope key={props.entry.key} entry={props.entry}>
                    {body}
                </EntryScope>
            </view>
        );
    };
});
