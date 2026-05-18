/**
 * `<Layer>` — one row in `<Stack>`'s layered render. Absolutely-
 * positioned host view that fills the Stack's relative wrapper, with
 * an optional MT-bound `translateX` / `translateY` animation driven
 * by a `SharedValue<number>` from the navigator's transition state.
 *
 * `<Stack>` emits one `<Layer>` per entry returned by
 * `computeLayers(...)`. Layer.key in the parent is
 * `layer-${entry.key}-${animationVariant(animation)}` so that:
 *
 *  - The same entry under the same animation state is preserved across
 *    renders (modal underneath stays mounted through the modal
 *    lifecycle; per-tab Stack state survives).
 *  - An entry transitioning between animated and static (e.g. a card
 *    top after its push transition completes) remounts so the
 *    `useAnimatedStyle` binding can be rebound — the underlying
 *    `useAnimatedStyle` is set-once at setup and can't switch its
 *    mapper at runtime.
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
import type { LayerAnimation } from '../internal/layer-plan';
import type { RouteMap, StackEntry } from '../types';
import { EntryScope } from './EntryScope';

export type LayerProps =
    & Define.Prop<'entry', StackEntry, true>
    & Define.Prop<'routes', RouteMap, true>
    /** When set, the host view animates per the transform spec. */
    & Define.Prop<'animation', LayerAnimation | null, false>;

export const Layer = component<LayerProps>(({ props }) => {
    const ref = useMainThreadRef<MainThread.Element | null>(null);
    // `useAnimatedStyle` binds once at setup. Calling it conditionally
    // is safe because setup runs once per mount and props.animation
    // never changes for a given Layer instance — animation changes
    // re-key the Layer at the parent, forcing a fresh mount.
    if (props.animation) {
        const a = props.animation;
        useAnimatedStyle(ref, a.progress, a.axis, {
            inputRange: [a.inputRange[0], a.inputRange[1]],
            outputRange: [a.outputRange[0], a.outputRange[1]],
        });
    }

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
                    display: 'flex',
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
