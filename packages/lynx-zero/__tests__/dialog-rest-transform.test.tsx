/**
 * #1320 (fix-10 sweep, Android): a dialog open at mount could stop part-way
 * through its open scale. `animationend` fires, but the view keeps a
 * mid-flight transform and the static `transform: none` is never
 * re-applied. The panel now re-states its resting transform inline, as a
 * NEW value each time, when the open animation ends and at the last
 * fallback timer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { Dialog, OverlayHost, clearDismissLayers } from '../src/index';
import { DIALOG_REST_TRANSFORMS, dialogRestTransform } from '../src/components/dialog/Dialog';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const byPart = (root: TestNode, scope: string, part: string): TestNode | null => {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) return root;
    for (const child of root.children) {
        const hit = byPart(child, scope, part);
        if (hit) return hit;
    }
    return null;
};

describe('dialogRestTransform (#1320)', () => {
    it('states nothing before the first pin, then alternates two identity spellings', () => {
        expect(dialogRestTransform(0)).toBeUndefined();
        expect(dialogRestTransform(1)).toBe('scale(1)');
        expect(dialogRestTransform(2)).toBe('translateX(0px)');
        expect(dialogRestTransform(3)).toBe('scale(1)');
    });

    it('every spelling is the identity', () => {
        for (const t of DIALOG_REST_TRANSFORMS) {
            expect(t).toMatch(/^(scale\(1\)|translate[XY]?\(0(px)?(, ?0(px)?)?\))$/);
        }
    });
});

describe('Dialog.Popup pins its resting transform (#1320)', () => {
    afterEach(() => clearDismissLayers());

    it('leaves the transform to the open animation until it ends, then pins a new value per end', async () => {
        const { container, unmount } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const popup = () => byPart(container, 'dialog', 'popup')!;
        expect(popup()._style.transform).toBeUndefined();

        await act(() => (popup().props['bindanimationend'] as () => void)());
        expect(popup()._style.transform).toBe('scale(1)');

        // A transition end (the pin itself can start one) does not pin again.
        await act(() => (popup().props['bindtransitionend'] as () => void)());
        expect(popup()._style.transform).toBe('scale(1)');

        // A later animation end still changes the value, so the engine
        // applies it.
        await act(() => (popup().props['bindanimationend'] as () => void)());
        expect(popup()._style.transform).toBe('translateX(0px)');
        unmount();
    });

    it('the last fallback timer pins it when no animation event arrives, and a reopen starts over', async () => {
        const open = signal({ value: true });
        const Harness = component(() => () => (
            <OverlayHost>
                <Dialog.Root model={() => open.value}>
                    <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>
        ));
        const { container, unmount } = render(<Harness />);
        await act(() => {});
        const popup = () => byPart(container, 'dialog', 'popup');
        await sleep(500);
        // The first fallback (300ms) only re-measures.
        expect(popup()!._style.transform).toBeUndefined();
        await sleep(700);
        expect(popup()!._style.transform).toBe('scale(1)');

        await act(() => { open.value = false; });
        expect(popup()).toBeNull();
        await act(() => { open.value = true; });
        expect(popup()!._style.transform).toBeUndefined();
        unmount();
    });
});
