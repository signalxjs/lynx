/**
 * Runtime tests for `<Layer>` — the per-entry absolute-positioned host
 * view inside `<Stack>` that hosts the route component and optionally
 * binds a `useAnimatedStyle` transform for push/pop / modal transitions.
 *
 * The headline assertion is the inline `transform` seed: when a Layer
 * has an animation, the host view's inline style must include the
 * transform at `outputRange[0]` so the visual is already correct from
 * the moment the view commits — before the first
 * `flushAnimatedStyleBindings` pass writes the binding-driven style.
 *
 * Why this matters: on a card push the underneath layer parallaxes
 * from `translateX(0)` to `translateX(-0.3 * SCREEN_WIDTH)` (start
 * value 0 in this case), and the top slides from
 * `translateX(SCREEN_WIDTH)` to `translateX(0)` (start value
 * SCREEN_WIDTH). Without seeding the start transform, the top
 * briefly renders at `translateX(0)` for the frame between MT
 * element creation and the first AV-style flush — perceived as the
 * top layer "covering" the screen before sliding, while the
 * underneath appears not to move at all.
 */
import { describe, expect, it } from 'vitest';
import { useSharedValue } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { Layer } from '../src/components/Layer';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { routes } from './_fixtures';
import type { StackEntry } from '../src/types';
import type { LayerAnimation } from '../src/internal/layer-plan';

function homeEntry(): StackEntry {
    return {
        key: 'home-1',
        route: 'home',
        params: {},
        search: {},
        state: undefined,
        presentation: 'card',
    };
}

/** Walk the rendered tree and find the first node matching a predicate. */
function findNode(root: any, pred: (n: any) => boolean): any {
    const stack: any[] = [root];
    while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (pred(node)) return node;
        const kids = node.children ?? [];
        for (const k of kids) stack.push(k);
    }
    return null;
}

function findAbsoluteHost(root: any): any {
    return findNode(root, (n) => n.props?.style?.position === 'absolute');
}

describe('<Layer>', () => {
    it('renders without a transform style when no animation is set', () => {
        const entry = homeEntry();
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Layer entry={entry} routes={routes} animation={null} />
            </NavigationRoot>,
        );
        const host = findAbsoluteHost(result.container);
        expect(host).not.toBeNull();
        expect(host.props.style.transform).toBeUndefined();
        result.unmount();
    });

    it('seeds the inline transform to outputRange[0] when animation is set', () => {
        const entry = homeEntry();
        const progress = useSharedValue(0);
        const animation: LayerAnimation = {
            axis: 'translateX',
            inputRange: [0, 1],
            outputRange: [400, 0], // mimics top-card-push: start at SCREEN_WIDTH
            progress,
        };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Layer entry={entry} routes={routes} animation={animation} />
            </NavigationRoot>,
        );
        const host = findAbsoluteHost(result.container);
        expect(host).not.toBeNull();
        // Before the MT bridge applies its first flush, the inline style
        // alone must place the host at the binding's start value.
        expect(host.props.style.transform).toBe('translateX(400px)');
        result.unmount();
    });

    it('seeds translateY for vertical (modal) transitions', () => {
        const entry = homeEntry();
        const progress = useSharedValue(0);
        const animation: LayerAnimation = {
            axis: 'translateY',
            inputRange: [0, 1],
            outputRange: [800, 0],
            progress,
        };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Layer entry={entry} routes={routes} animation={animation} />
            </NavigationRoot>,
        );
        const host = findAbsoluteHost(result.container);
        expect(host.props.style.transform).toBe('translateY(800px)');
        result.unmount();
    });

    it('seeds a zero-translate when the underneath parallax starts at 0', () => {
        const entry = homeEntry();
        const progress = useSharedValue(0);
        // Mimics the underneath parallax on a card push: 0 → -0.3*W.
        const animation: LayerAnimation = {
            axis: 'translateX',
            inputRange: [0, 1],
            outputRange: [0, -120],
            progress,
        };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Layer entry={entry} routes={routes} animation={animation} />
            </NavigationRoot>,
        );
        const host = findAbsoluteHost(result.container);
        // Even though the visual is the same as "no transform", the
        // explicit seed prevents the MT bridge's first style flush from
        // briefly racing other inline-style writes on the element.
        expect(host.props.style.transform).toBe('translateX(0px)');
        result.unmount();
    });
});
