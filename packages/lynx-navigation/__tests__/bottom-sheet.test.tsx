/**
 * Runtime tests for `<BottomSheet>` — the inline (non-route) drag-to-resize
 * bottom panel.
 *
 * Verifies (BG-observable shape; the drag itself is a main-thread gesture
 * exercised on-device):
 *  - Renders the `handle` and `default` slots inside a bottom-anchored,
 *    absolutely-positioned, fixed-`maxHeight` container.
 *  - Hands back the combined reveal SharedValue via `onReveal`.
 */
import { describe, expect, it } from 'vitest';
import { component, useSharedValue, type SharedValue } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { BottomSheet } from '../src/components/BottomSheet';

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

describe('<BottomSheet>', () => {
    it('renders both slots in a bottom-anchored fixed-height panel', () => {
        const Host = component(() => () => (
            <BottomSheet
                maxHeight={800}
                detents={[64, 400, 800]}
                slots={{
                    handle: () => <text>HANDLE</text>,
                    default: () => <text>BODY</text>,
                }}
            />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const panel = find(root, (n) =>
            n.props?.style?.position === 'absolute'
            && n.props?.style?.bottom === 0
            && n.props?.style?.height === '800px');
        expect(panel).toBeTruthy();
        expect(find(root, (n) => n.textContent?.() === 'HANDLE' || n.props?.children === 'HANDLE')).toBeTruthy();
        expect(find(root, (n) => n.textContent?.() === 'BODY' || n.props?.children === 'BODY')).toBeTruthy();
    });

    it('hands back the combined reveal SharedValue via onReveal', () => {
        let sv: SharedValue<number> | null = null;
        const Host = component(() => () => (
            <BottomSheet
                maxHeight={800}
                detents={[64, 400, 800]}
                onReveal={(s) => { sv = s; }}
                slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
            />
        ));
        render(<Host />);
        expect(sv).not.toBeNull();
        expect(typeof (sv as unknown as { value: number }).value).toBe('number');
    });

    it('accepts openToLift + liftSV and still renders / hands back onReveal', () => {
        // The capture-on-open + lifted-rest snap logic is main-thread (exercised
        // on-device); here we assert the prop is accepted and the sheet renders
        // its slots and combined reveal SV as usual.
        let sv: SharedValue<number> | null = null;
        const Host = component(() => {
            const lift = useSharedValue(0);
            return () => (
                <BottomSheet
                    maxHeight={800}
                    detents={[64, 400, 800]}
                    open
                    openToLift
                    liftSV={lift}
                    onReveal={(s) => { sv = s; }}
                    slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
                />
            );
        });
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        expect(find(root, (n) => n.textContent?.() === 'H' || n.props?.children === 'H')).toBeTruthy();
        expect(sv).not.toBeNull();
    });
});
