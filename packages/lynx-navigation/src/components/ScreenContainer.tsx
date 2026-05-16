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
import { SCREEN_WIDTH } from '../internal/screen-width.js';
import type { RouteMap, StackEntry, TransitionKind, TransitionRole } from '../types.js';
import { EntryScope } from './EntryScope.js';

/**
 * Slide-from-right transition geometry. `SCREEN_WIDTH` is read from
 * `lynx.SystemInfo` at module load so the animation lands the screen at
 * exactly translateX=0 (centered) at progress=1, rather than overshooting
 * into the parent's clip region. `<EdgeBackHandle>` reads the same
 * constant — they have to agree, otherwise the gesture commit threshold
 * and the animation geometry don't line up.
 */
const PARALLAX_FACTOR = 0.3;

/**
 * Compute the `translateX` range for a given (role, kind) pair. Progress
 * always runs 0 → 1; the role and kind decide what visual state each end of
 * the progress represents.
 *
 * Slide-from-right semantics:
 *  - PUSH: new top slides in from the right; old top parallaxes left.
 *  - POP:  current top slides out to the right; underneath returns from the
 *    parallax-left position.
 */
function getRangeParams(
    role: TransitionRole,
    kind: TransitionKind,
): MapperParams['translateX'] {
    if (kind === 'push') {
        if (role === 'top') {
            return { inputRange: [0, 1], outputRange: [SCREEN_WIDTH, 0] };
        }
        return { inputRange: [0, 1], outputRange: [0, -PARALLAX_FACTOR * SCREEN_WIDTH] };
    }
    // pop
    if (role === 'top') {
        return { inputRange: [0, 1], outputRange: [0, SCREEN_WIDTH] };
    }
    return { inputRange: [0, 1], outputRange: [-PARALLAX_FACTOR * SCREEN_WIDTH, 0] };
}

type ScreenContainerProps =
    & Define.Prop<'entry', StackEntry, true>
    & Define.Prop<'routes', RouteMap, true>
    & Define.Prop<'role', TransitionRole, true>
    & Define.Prop<'kind', TransitionKind, true>
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
    const params = getRangeParams(props.role, props.kind);
    useAnimatedStyle(ref, props.progress, 'translateX', params);

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
                    backgroundColor: '#0f172a',
                }}
            >
                <EntryScope key={props.entry.key} entry={props.entry}>
                    {body}
                </EntryScope>
            </view>
        );
    };
});
