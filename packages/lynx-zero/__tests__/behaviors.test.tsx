/**
 * The lynx behavior adapters (#1038): press flag lifecycle, innermost-first
 * dismissal, the placement math over fake rects, and the overlay portal's
 * registration-order stacking.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import { component, effect, signal } from '@sigx/lynx';
import {
    OverlayHost,
    clearDismissLayers,
    computeAnchorPosition,
    createPressFeedback,
    dismissTopLayer,
    registerDismissLayer,
    useOverlayPortal,
} from '../src/index';
import type { ElementLayout } from '@sigx/lynx';

describe('createPressFeedback', () => {
    it('touch lifecycle drives the pressed flag; disabled suppresses it', () => {
        const press = createPressFeedback();
        expect(press.pressed()).toBe(false);
        press.handlers.bindtouchstart();
        expect(press.pressed()).toBe(true);
        press.handlers.bindtouchend();
        expect(press.pressed()).toBe(false);
        press.handlers.bindtouchstart();
        press.handlers.bindtouchcancel();
        expect(press.pressed()).toBe(false);

        let disabled = true;
        const gated = createPressFeedback({ isDisabled: () => disabled });
        gated.handlers.bindtouchstart();
        expect(gated.pressed()).toBe(false);
        disabled = false;
        gated.handlers.bindtouchstart();
        expect(gated.pressed()).toBe(true);
    });
});

describe('dismiss layers', () => {
    afterEach(() => clearDismissLayers());

    it('dismisses innermost first, and layers can leave out of order', () => {
        // A real layer's dismiss() closes the overlay, whose close path
        // unregisters it — the callbacks model that.
        const order: string[] = [];
        const un1 = registerDismissLayer({ dismiss: () => { order.push('dialog'); un1(); } });
        const un2 = registerDismissLayer({ dismiss: () => { order.push('popover'); un2(); } });
        expect(dismissTopLayer()).toBe(true);
        expect(order).toEqual(['popover']);
        // The dialog closes for its own reasons (its Close button) — it
        // removes ITSELF wherever it sits; the stack is then empty.
        un1();
        expect(dismissTopLayer()).toBe(false);
        expect(order).toEqual(['popover']);
    });
});

describe('computeAnchorPosition', () => {
    const anchor: ElementLayout = { top: 100, left: 100, right: 160, bottom: 130, width: 60, height: 30 };
    const floating = { width: 100, height: 50 };
    const viewport = { width: 400, height: 400 };

    it('places below, centered, by default', () => {
        const p = computeAnchorPosition(anchor, floating, viewport);
        expect(p).toEqual({ top: 134, left: 80, placement: 'bottom' });
    });

    it('honors alignment and side', () => {
        expect(computeAnchorPosition(anchor, floating, viewport, { placement: 'bottom-start' }).left).toBe(100);
        expect(computeAnchorPosition(anchor, floating, viewport, { placement: 'bottom-end' }).left).toBe(60);
        expect(computeAnchorPosition(anchor, floating, viewport, { placement: 'top' }).top).toBe(100 - 50 - 4);
        expect(computeAnchorPosition(anchor, floating, viewport, { placement: 'right' })).toMatchObject({ left: 164, placement: 'right' });
    });

    it('flips when the preferred side overflows and the opposite fits', () => {
        const nearBottom: ElementLayout = { ...anchor, top: 360, bottom: 390 };
        const p = computeAnchorPosition(nearBottom, floating, viewport);
        expect(p.placement).toBe('top');
        expect(p.top).toBe(360 - 50 - 4);
        // No room on EITHER side → stays on the preferred side (clamped
        // world, not an exception).
        const tiny = { width: 400, height: 60 };
        const cramped: ElementLayout = { ...anchor, top: 20, bottom: 50 };
        expect(computeAnchorPosition(cramped, floating, tiny).placement).toBe('bottom');
    });

    it('clamps the cross axis into the viewport', () => {
        const nearEdge: ElementLayout = { ...anchor, left: 2, right: 62 };
        expect(computeAnchorPosition(nearEdge, floating, viewport).left).toBe(8);
    });
});

describe('overlay portal', () => {
    it('renders registered overlays after content, in registration order', async () => {
        const open = signal({ a: false, b: false });
        const Overlayer = component(() => {
            const portalA = useOverlayPortal();
            const portalB = useOverlayPortal();
            effect(() => {
                if (open.a) portalA.show(() => <text>overlay-a</text>);
                else portalA.hide();
            });
            effect(() => {
                if (open.b) portalB.show(() => <text>overlay-b</text>);
                else portalB.hide();
            });
            return () => <text>content</text>;
        });
        const { container } = render(
            <OverlayHost>
                <Overlayer />
            </OverlayHost>,
        );
        const texts = (): string => container.textContent();
        expect(texts()).toContain('content');
        expect(texts()).not.toContain('overlay-a');

        // Separate flushes: stacking is show()-CALL order, and real overlays
        // open in separate frames (a dialog, then a popover inside it) —
        // effect re-run order within one flush is not part of the contract.
        await act(() => { open.a = true; });
        await act(() => { open.b = true; });
        const snapshot = texts();
        expect(snapshot.indexOf('content')).toBeLessThan(snapshot.indexOf('overlay-a'));
        expect(snapshot.indexOf('overlay-a')).toBeLessThan(snapshot.indexOf('overlay-b'));

        await act(() => { open.a = false; });
        expect(texts()).not.toContain('overlay-a');
        expect(texts()).toContain('overlay-b');
    });

    it('an owner unmounting while open removes its overlay (no leak)', async () => {
        const mounted = signal({ owner: true });
        const Owner = component(() => {
            const portal = useOverlayPortal();
            // In an effect, per the documented usage: a show() during the
            // render pass itself is a lost write in sigx.
            effect(() => portal.show(() => <text>owned-overlay</text>));
            return () => <text>owner</text>;
        });
        const Gate = component(() => () => (mounted.owner ? <Owner /> : <text>gone</text>));
        const { container } = render(
            <OverlayHost>
                <Gate />
            </OverlayHost>,
        );
        await act(() => {});
        expect(container.textContent()).toContain('owned-overlay');
        await act(() => { mounted.owner = false; });
        expect(container.textContent()).not.toContain('owned-overlay');
        expect(container.textContent()).toContain('gone');
    });
});
