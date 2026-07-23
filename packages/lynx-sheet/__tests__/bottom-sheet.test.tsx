/**
 * Runtime tests for `<BottomSheet>` — BG-observable shape (drags, snaps,
 * and lift capture are main-thread worklets exercised on-device; their
 * decision logic is unit-tested in math.test.ts / decide-owner.test.ts).
 * Ports lynx-navigation's bottom-sheet.test.tsx scenarios onto the new
 * DetentSpec API and covers the new backdrop/dismissible/dragMode surface.
 */
import { describe, expect, it } from 'vitest';
import { component, signal, useSharedValue, type SharedValue } from '@sigx/lynx';
import { render, waitForUpdate } from '@sigx/lynx-testing';
import { BottomSheet } from '../src/BottomSheet';

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

const isPanel = (n: any): boolean =>
    n.props?.style?.position === 'absolute'
    && n.props?.style?.bottom === 0
    && typeof n.props?.style?.height === 'string';

const isBackdrop = (n: any): boolean =>
    n.props?.style?.position === 'absolute'
    && n.props?.style?.backgroundColor === '#000';

describe('<BottomSheet>', () => {
    it('renders both slots in a bottom-anchored panel as tall as the top detent', () => {
        const Host = component(() => () => (
            <BottomSheet
                detents={[64, 400, 800]}
                slots={{
                    handle: () => <text>HANDLE</text>,
                    default: () => <text>BODY</text>,
                }}
            />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const panel = find(root, isPanel);
        expect(panel).toBeTruthy();
        expect(panel.props.style.height).toBe('800px');
        expect(find(root, (n) => n.textContent?.() === 'HANDLE' || n.props?.children === 'HANDLE')).toBeTruthy();
        expect(find(root, (n) => n.textContent?.() === 'BODY' || n.props?.children === 'BODY')).toBeTruthy();
    });

    it('resolves DetentSpec fractions against the (fallback) screen height', () => {
        // Vitest has no lynx.SystemInfo — screenH falls back to 800.
        const Host = component(() => () => (
            <BottomSheet
                detents={[64, { fraction: 0.9 }]}
                slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
            />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        expect(find(root, isPanel).props.style.height).toBe('720px');
    });

    it('hands back the combined reveal SharedValue via onReveal', () => {
        let sv: SharedValue<number> | null = null;
        const Host = component(() => () => (
            <BottomSheet
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
        let sv: SharedValue<number> | null = null;
        const Host = component(() => {
            const lift = useSharedValue(0);
            return () => (
                <BottomSheet
                    detents={[64, { keyboard: true, fallbackPx: 336 }, 800]}
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

    // Regression (#743): geometry is re-resolved live — a sheet whose
    // content changes height at runtime must re-seat.
    it('tracks detent changes after mount', async () => {
        const geom = signal({ detents: [64, 400, 800] as number[] });
        const Host = component(() => () => (
            <BottomSheet
                detents={geom.detents}
                slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
            />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        expect(find(root, isPanel).props.style.height).toBe('800px');

        geom.detents = [128, 460, 920];
        await waitForUpdate();
        // 920 clamps to the 800 fallback screen height cap.
        expect(find(root, isPanel).props.style.height).toBe('800px');

        geom.detents = [64, 300];
        await waitForUpdate();
        expect(find(root, isPanel).props.style.height).toBe('300px');
    });

    it('renders no active backdrop by default (content above stays live)', () => {
        const Host = component(() => () => (
            <BottomSheet
                detents={[64, 400]}
                slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
            />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        // Constant child shape: the dim exists but is display:none.
        const dim = find(root, isBackdrop);
        expect(dim).toBeTruthy();
        expect(dim.props.style.display).toBe('none');
    });

    it('backdrop activates while open and renders before the panel (document order)', () => {
        const Host = component(() => () => (
            <BottomSheet
                detents={[64, 400]}
                open
                backdrop
                dismissible
                slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
            />
        ));
        const result: any = render(<Host />);
        const root = result.container ?? result.root ?? result;
        const dim = find(root, isBackdrop);
        expect(dim.props.style.display).toBe('flex');
        expect(typeof dim.props.catchtap).toBe('function');
        // Document order: dim paints beneath the later panel sibling.
        const flat: any[] = [];
        const walk = (n: any): void => {
            flat.push(n);
            for (const k of n.children ?? []) walk(k);
        };
        walk(root);
        expect(flat.findIndex(isBackdrop)).toBeLessThan(flat.findIndex(isPanel));
    });

    it('accepts every dragMode without rendering differences', () => {
        for (const dragMode of ['handle', 'surface', 'grabber', 'none'] as const) {
            const Host = component(() => () => (
                <BottomSheet
                    detents={[64, 400]}
                    dragMode={dragMode}
                    slots={{ handle: () => <text>H</text>, default: () => <text>B</text> }}
                />
            ));
            const result: any = render(<Host />);
            const root = result.container ?? result.root ?? result;
            expect(find(root, isPanel), dragMode).toBeTruthy();
        }
    });
});
