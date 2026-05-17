import {
    component,
    useMainThreadRef,
    useAnimatedStyle,
    type ComponentFactory,
    type Define,
    type MainThread,
    type SharedValue,
} from '@sigx/lynx';
import { Suspense, isLazyComponent } from '@sigx/lynx';
import type { MapperParams } from '@sigx/lynx';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../internal/screen-width.js';
import type {
    Presentation,
    RouteMap,
    StackEntry,
    TransitionKind,
    TransitionRole,
} from '../types.js';
import { EntryScope } from './EntryScope.js';

/**
 * Transition geometry. `SCREEN_WIDTH` / `SCREEN_HEIGHT` are read from
 * `lynx.SystemInfo` at module load so the animation lands the screen at
 * exactly translate=0 (centered) at progress=1, rather than overshooting
 * into the parent's clip region. `<EdgeBackHandle>` reads `SCREEN_WIDTH`
 * for the gesture commit threshold — they have to agree, otherwise the
 * commit threshold and the animation geometry don't line up.
 */
const PARALLAX_FACTOR = 0.3;

type Axis = 'translateX' | 'translateY';

/**
 * Resolve (axis, range) for a given (role, kind, presentation) triple.
 *
 * Presentation switches the axis:
 *  - `'card'` (default): horizontal slide-from-right; underneath
 *    parallaxes left to feel like a card stack.
 *  - `'modal'` / `'fullScreen'`: vertical slide-from-bottom; underneath
 *    stays put (no parallax) — a modal overlays without re-arranging the
 *    background.
 *  - `'transparent-modal'`: same axis as modal but the framework leaves
 *    the underneath fully visible; we still emit a translateY range so the
 *    sheet body animates in.
 */
function getAnimationParams(
    role: TransitionRole,
    kind: TransitionKind,
    presentation: Presentation,
): { axis: Axis; params: MapperParams['translateX'] | MapperParams['translateY'] } {
    if (presentation === 'card') {
        if (kind === 'push') {
            if (role === 'top') {
                return { axis: 'translateX', params: { inputRange: [0, 1], outputRange: [SCREEN_WIDTH, 0] } };
            }
            return { axis: 'translateX', params: { inputRange: [0, 1], outputRange: [0, -PARALLAX_FACTOR * SCREEN_WIDTH] } };
        }
        if (role === 'top') {
            return { axis: 'translateX', params: { inputRange: [0, 1], outputRange: [0, SCREEN_WIDTH] } };
        }
        return { axis: 'translateX', params: { inputRange: [0, 1], outputRange: [-PARALLAX_FACTOR * SCREEN_WIDTH, 0] } };
    }
    // modal / fullScreen / transparent-modal — vertical slide, no parallax.
    if (kind === 'push') {
        if (role === 'top') {
            return { axis: 'translateY', params: { inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0] } };
        }
        return { axis: 'translateY', params: { inputRange: [0, 1], outputRange: [0, 0] } };
    }
    if (role === 'top') {
        return { axis: 'translateY', params: { inputRange: [0, 1], outputRange: [0, SCREEN_HEIGHT] } };
    }
    return { axis: 'translateY', params: { inputRange: [0, 1], outputRange: [0, 0] } };
}

type ScreenContainerProps =
    & Define.Prop<'entry', StackEntry, true>
    & Define.Prop<'routes', RouteMap, true>
    & Define.Prop<'role', TransitionRole, true>
    & Define.Prop<'kind', TransitionKind, true>
    /** The TOP entry's presentation — decides whether this is a card or modal animation. */
    & Define.Prop<'presentation', Presentation, true>
    & Define.Prop<'progress', SharedValue<number>, true>;

/**
 * Animated screen slot — absolutely positioned, MT-bound translateX driven by
 * the navigator's progress SharedValue. Used during transitions to render the
 * top + underneath entries together.
 *
 * Each instance is keyed by `${entry.key}-${role}-${kind}` in the parent so a
 * role/kind change forces a fresh mount with a fresh `useAnimatedStyle`
 * binding (the binding is set at setup and can't be re-keyed mid-life). State
 * loss across transition boundaries is accepted in v0.2; persistent screen
 * state (scroll position, input fields surviving navigations) is a polish
 * item for Phase 0.5+.
 */
export const ScreenContainer = component<ScreenContainerProps>(({ props }) => {
    const ref = useMainThreadRef<MainThread.Element | null>(null);
    const { axis, params } = getAnimationParams(
        props.role,
        props.kind,
        props.presentation,
    );
    // `useAnimatedStyle` is set once at setup; consumers shouldn't switch
    // mappers at runtime. The parent (`<Stack>`) re-keys ScreenContainer
    // by role/kind/presentation so we get a fresh mount when any of
    // those change.
    useAnimatedStyle(ref, props.progress, axis, params);

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
        // Wrap lazy screens that declare a fallback in Suspense — see Stack.tsx
        // for rationale.
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
                    // Explicit flex-column. Without this, screens whose
                    // root relies on `flex-fill` (e.g. RootTabs with
                    // `<Tabs.Screen>` + `<NavTabBar />`) silently break
                    // inside the transitioning container: the NavTabBar
                    // jumps to the top, the Tabs.Screen body collapses.
                    // `<view>` should default to flex column in Lynx but
                    // we don't trust the implicit default through an
                    // `position: absolute` wrapper.
                    display: 'flex',
                    flexDirection: 'column',
                    // No hardcoded background — was a dark `#0f172a` slate
                    // that flashed through every transition regardless of
                    // theme. Screens own their own background (typically
                    // via a daisy `bg-base-100` class on their root).
                }}
            >
                <EntryScope key={props.entry.key} entry={props.entry}>
                    {body}
                </EntryScope>
            </view>
        );
    };
});
