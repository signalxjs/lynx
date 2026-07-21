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
import { component, signal, useSharedValue, type SharedValue } from '@sigx/lynx';
import { render, waitForUpdate } from '@sigx/lynx-testing';
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

    // Regression (#743): geometry used to be snapshotted at setup, so a sheet
    // whose content changed height at runtime — the composer case: an
    // attachment chip row appears, the input grows to a second line — kept its
    // mount-time slice and pushed its own pinned top content out of view.
    it('tracks maxHeight / detents changes after mount', async () => {
        const geom = signal({ max: 800, detents: [64, 400, 800] as number[] });
        const Host = component(() => () => (
            <BottomSheet
                maxHeight={geom.max}
                detents={geom.detents}
                slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
            />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const panelHeight = (): unknown =>
            find(root, (n) => n.props?.style?.position === 'absolute'
                && n.props?.style?.bottom === 0)?.props?.style?.height;

        expect(panelHeight()).toBe('800px');

        // The composer floor grew (chip row added) and the top detent with it.
        geom.max = 920;
        geom.detents = [128, 460, 920];
        await waitForUpdate();

        expect(panelHeight()).toBe('920px');
    });
});
