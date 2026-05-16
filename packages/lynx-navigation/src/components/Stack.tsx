import { component, type ComponentFactory, type SharedValue } from '@sigx/lynx';
import { Suspense, isLazyComponent } from '@sigx/lynx';
import { useNav } from '../hooks/use-nav.js';
import { useNavInternals, useNavRoutes } from '../hooks/use-nav-internal.js';
import { ScreenContainer } from './ScreenContainer.js';
import { EdgeBackHandle } from './EdgeBackHandle.js';
import { EntryScope } from './EntryScope.js';

/**
 * Stack navigator — renders the topmost stack entry's component at rest, or
 * the top + underneath entries during a transition.
 *
 * **Idle**: just the top entry, full-bleed, no transform. The screen
 * component mounts directly so it can use its own layout (no extra absolute
 * positioning that would break percentage heights).
 *
 * **Transitioning**: two `<ScreenContainer>` instances stacked absolutely,
 * each with an MT-driven `translateX` that reads from the navigator's
 * progress `SharedValue`. The host's BG thread doesn't tick per frame —
 * `useAnimatedStyle` runs the interpolation entirely on MT.
 *
 * `key={top.key}` keeps the idle render's component instance stable across
 * unrelated re-renders. During transitions, composite keys
 * (`${entry.key}-${role}-${kind}`) ensure a fresh mount per role/kind pair so
 * the `useAnimatedStyle` binding is set with the right input/output ranges.
 */
export const Stack = component(() => {
    const nav = useNav();
    const routes = useNavRoutes();
    const internals = useNavInternals();

    return () => {
        const transition = nav.transition;
        const top = nav.current;

        if (!transition) {
            const route = routes[top.route];
            if (!route) return null;
            const Comp = route.component as unknown as ComponentFactory<
                Record<string, unknown>,
                unknown,
                unknown
            >;
            if (typeof Comp !== 'function') return null;
            const params = top.params as Record<string, unknown>;
            // Wrap lazy routes that declare a `fallback` in <Suspense> so the
            // chunk-load shows the user-provided spinner instead of throwing
            // up to the nearest outer boundary (which may be wrong layer or
            // missing entirely).
            const body = isLazyComponent(Comp) && route.fallback
                ? (
                    <Suspense fallback={route.fallback as never}>
                        <Comp {...params} />
                    </Suspense>
                )
                : <Comp {...params} />;
            // When canGoBack and edge-swipe is enabled, overlay the gesture
            // handle so the user can pan from the left edge to start a back
            // transition. `position: absolute` doesn't disturb the screen's
            // own layout — the handle only intercepts touches in the leftmost
            // 20px, and only when they pan rightward past `MIN_DISTANCE`.
            if (nav.canGoBack && internals.edgeSwipeEnabled) {
                return (
                    <view
                        style={{
                            position: 'relative',
                            width: '100%',
                            height: '100%',
                        }}
                    >
                        <EntryScope key={top.key} entry={top}>
                            {body}
                        </EntryScope>
                        <EdgeBackHandle key="edge-back" />
                    </view>
                );
            }
            return (
                <EntryScope key={top.key} entry={top}>
                    {body}
                </EntryScope>
            );
        }

        // Cast progress: TransitionState carries it as `unknown` to avoid
        // pinning the contract to `@sigx/lynx`'s SharedValue at the type
        // level; here at the runtime boundary we know it's a SharedValue<number>.
        const progress = transition.progress as SharedValue<number>;

        return (
            <view
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                }}
            >
                <ScreenContainer
                    key={`${transition.underneathEntry.key}-underneath-${transition.kind}`}
                    entry={transition.underneathEntry}
                    routes={routes}
                    role="underneath"
                    kind={transition.kind}
                    progress={progress}
                />
                <ScreenContainer
                    key={`${transition.topEntry.key}-top-${transition.kind}`}
                    entry={transition.topEntry}
                    routes={routes}
                    role="top"
                    kind={transition.kind}
                    progress={progress}
                />
            </view>
        );
    };
});
