/**
 * Runtime tests for `<Backdrop>` — BG-observable shape (the opacity
 * binding itself is a main-thread animated style, exercised on-device).
 */
import { describe, expect, it } from 'vitest';
import { component, useSharedValue } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { Backdrop } from '../src/Backdrop';

function find(root: any, pred: (n: any) => boolean): any {
    const stack = [root];
    while (stack.length) {
        const n = stack.pop();
        if (!n) continue;
        if (pred(n)) return n;
        for (const k of n.children ?? []) stack.push(k);
    }
    return null;
}

const isBackdrop = (n: any): boolean =>
    n.props?.style?.position === 'absolute'
    && n.props?.style?.backgroundColor === '#000';

describe('<Backdrop>', () => {
    it('renders a full-surface dim bound to the reveal SV', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop revealSV={sv} inputRange={[64, 720]} enabled />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        expect(dim).toBeTruthy();
        expect(dim.props.style.display).toBe('flex');
        // With an SV bound, the MT binding drives opacity — static is 0.
        expect(dim.props.style.opacity).toBe(0);
    });

    it('disabled → inert display:none, but still in the tree (constant shape)', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop revealSV={sv} inputRange={[64, 720]} enabled={false} />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        expect(dim).toBeTruthy();
        expect(dim.props.style.display).toBe('none');
    });

    it('hidden → display:none even while enabled', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop revealSV={sv} inputRange={[64, 720]} enabled hidden />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        expect(find(root, isBackdrop).props.style.display).toBe('none');
    });

    it('renders staticOpacity when no SV is bound', () => {
        const Host = component(() => () => (
            <Backdrop revealSV={null} inputRange={[64, 720]} enabled staticOpacity={0.25} />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        expect(find(root, isBackdrop).props.style.opacity).toBe(0.25);
    });

    it('consumes taps via catchtap and reports through onPress', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop revealSV={sv} inputRange={[64, 720]} enabled onPress={() => {}} />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        // catch (not bind): the dim covers content, taps must never pass.
        expect(typeof dim.props.catchtap).toBe('function');
    });
});

describe('<Backdrop> guardTag (#787)', () => {
    it('without guardTag the root stays a plain <view> with no guard-enabled', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop revealSV={sv} inputRange={[64, 720]} enabled />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        expect(dim.type).toBe('view');
        expect(dim.props['guard-enabled']).toBeUndefined();
    });

    it('with guardTag the root renders as that tag, keeping catchtap + geometry', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop
                    revealSV={sv}
                    inputRange={[64, 720]}
                    enabled
                    guardTag="sigx-touch-guard"
                    onPress={() => {}}
                />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        expect(dim.type).toBe('sigx-touch-guard');
        // The ONE root element keeps the full overlay attr set.
        expect(typeof dim.props.catchtap).toBe('function');
        expect(dim.props.style.position).toBe('absolute');
        expect(dim.props['ignore-focus']).toBe(true);
        expect(dim.props.flatten).toBe(false);
        // Enabled + not hidden → the native view consumes platform touches.
        expect(dim.props['guard-enabled']).toBe(true);
    });

    it('guard-enabled goes false while hidden (inert dim must not eat touches)', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop
                    revealSV={sv}
                    inputRange={[64, 720]}
                    enabled
                    hidden
                    guardTag="sigx-touch-guard"
                />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        expect(dim.type).toBe('sigx-touch-guard');
        expect(dim.props['guard-enabled']).toBe(false);
        expect(dim.props.style.display).toBe('none');
    });

    it('guard-enabled goes false while disabled', () => {
        const Host = component(() => {
            const sv = useSharedValue(64);
            return () => (
                <Backdrop
                    revealSV={sv}
                    inputRange={[64, 720]}
                    enabled={false}
                    guardTag="sigx-touch-guard"
                />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        expect(dim.props['guard-enabled']).toBe(false);
    });
});
