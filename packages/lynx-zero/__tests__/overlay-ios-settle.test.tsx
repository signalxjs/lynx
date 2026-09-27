/**
 * The iOS overlay-outlet fixes (#1181, #1182, #1190), device-measured on the
 * iPhone 17 Pro simulator:
 *
 * - A cold deep link lands on a screen that is still sliding in. The anchor
 *   and the safe frame measured at mount sat a screen width to the right
 *   (anchor left 413, frame left 401), and a transform fires no layout
 *   event, so nothing measured again: popups stayed clamped to the right
 *   edge and the frame (poking out of the outlet) was dropped, so toasts
 *   lost their insets. `settleRect` keeps measuring until things hold still.
 * - A full-window outlet layer was the deepest UIKit view under every point,
 *   so the page's scroll view never saw a pan while an overlay was open. The
 *   layer is 0×0 now; the light-dismiss surfaces are out of native
 *   hit-testing and the popup is their sibling, not their child.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementLayout } from '@sigx/lynx';
import { component, signal } from '@sigx/lynx';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { Dialog, OverlayHost, Popover, Select, clearDismissLayers, provideOverlayOrigin } from '../src/index';
import type { SettleHandle } from '../src/behaviors/position';
import { computeFramedPosition, outletFill, pendingSettleTicks, sameRect, settleRect } from '../src/behaviors/position';

const rect = (top: number, left: number, width: number, height: number): ElementLayout => ({
    top, left, width, height, right: left + width, bottom: top + height,
});

const WINDOW = rect(0, 0, 402, 874);
const SAFE = rect(62, 0, 402, 778);

const byPart = (root: TestNode, scope: string, part: string): TestNode | null => {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) return root;
    for (const child of root.children) {
        const hit = byPart(child, scope, part);
        if (hit) return hit;
    }
    return null;
};

const contains = (root: TestNode, target: TestNode): boolean =>
    root === target || root.children.some((c) => contains(c, target));

describe('the #1181 geometry, from the device', () => {
    const floating = { width: 208, height: 170 };
    const screen = { width: 402, height: 874 };

    it('rects measured mid slide-in clamp the popup to the right edge (the bug)', () => {
        const anchor = rect(98, 413, 320, 48);
        const sliding = rect(62, 401, 402, 778);
        const p = computeFramedPosition(anchor, floating, WINDOW, sliding, screen, { placement: 'bottom-start' });
        expect(p.left).toBe(402 - 208 - 8);
    });

    it('the settled rects put it at the trigger’s start edge', () => {
        const anchor = rect(98, 12, 320, 48);
        const p = computeFramedPosition(anchor, floating, WINDOW, SAFE, screen, { placement: 'bottom-start' });
        expect(p.left).toBe(12);
        expect(p.top).toBe(98 + 48 + 4);
    });
});

describe('sameRect', () => {
    it('tolerates sub-pixel rounding, not movement', () => {
        expect(sameRect(rect(0, 0, 10, 10), rect(0.5, -0.5, 10.4, 9.8))).toBe(true);
        expect(sameRect(rect(0, 0, 10, 10), rect(0, 3, 10, 10))).toBe(false);
        expect(sameRect(rect(0, 0, 10, 10), rect(0, 0, 12, 10))).toBe(false);
    });
});

describe('settleRect — measure until it holds still', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * A fake element whose successive measurements come from `frames`: each
     * `measure()` publishes the next one (the last repeats).
     */
    function harness(frames: ElementLayout[], options: Parameters<typeof settleRect>[2] = {}, extra?: () => ElementLayout | null) {
        const current = signal<{ value: ElementLayout | null }>({ value: null });
        let i = 0;
        const measure = vi.fn(() => {
            current.value = frames[Math.min(i++, frames.length - 1)]!;
        });
        let handle: SettleHandle | null = null;
        const Probe = component(() => {
            handle = settleRect(() => (extra ? [current.value, extra()] : current.value), measure, options);
            return () => <text>probe</text>;
        });
        const view = render(<Probe />);
        return { current, measure, handle: () => handle!, view };
    }

    it('does nothing until a first measurement lands', () => {
        const h = harness([rect(0, 0, 10, 10)]);
        vi.advanceTimersByTime(1000);
        expect(h.measure).not.toHaveBeenCalled();
    });

    it('re-measures while the rect moves and stops once two measurements agree', () => {
        const slide = [rect(98, 300, 320, 48), rect(98, 150, 320, 48), rect(98, 12, 320, 48), rect(98, 12, 320, 48)];
        const h = harness(slide, { interval: 100 });
        h.current.value = rect(98, 413, 320, 48); // the mount-time measurement
        vi.advanceTimersByTime(100);
        expect(h.current.value!.left).toBe(300);
        vi.advanceTimersByTime(100);
        expect(h.current.value!.left).toBe(150);
        vi.advanceTimersByTime(100);
        expect(h.current.value!.left).toBe(12);
        vi.advanceTimersByTime(100); // measures 12 again: agreed
        expect(h.measure).toHaveBeenCalledTimes(4);
        vi.advanceTimersByTime(2000);
        expect(h.measure).toHaveBeenCalledTimes(4);
    });

    it('keeps going while `unsettled()` holds, even when measurements agree', () => {
        const stuck = signal({ value: true });
        const h = harness([rect(62, 401, 402, 778)], { interval: 100, unsettled: () => stuck.value });
        h.current.value = rect(62, 401, 402, 778);
        vi.advanceTimersByTime(500);
        expect(h.measure).toHaveBeenCalledTimes(5);
        stuck.value = false;
        vi.advanceTimersByTime(100); // one in flight lands, agrees, stops
        const calls = h.measure.mock.calls.length;
        vi.advanceTimersByTime(1000);
        expect(h.measure).toHaveBeenCalledTimes(calls);
    });

    it('gives up after its budget', () => {
        const h = harness([rect(0, 0, 10, 10)], { interval: 10, budget: 3, unsettled: () => true });
        h.current.value = rect(0, 0, 10, 10);
        vi.advanceTimersByTime(1000);
        expect(h.measure).toHaveBeenCalledTimes(3);
    });

    it('any watched rect moving counts: a frame still sliding keeps the anchor loop alive', () => {
        const frame = signal<{ value: ElementLayout | null }>({ value: rect(62, 401, 402, 778) });
        const h = harness([rect(98, 413, 320, 48)], { interval: 100 }, () => frame.value);
        h.current.value = rect(98, 413, 320, 48);
        vi.advanceTimersByTime(100); // anchor agrees, frame unchanged: stop
        expect(h.measure).toHaveBeenCalledTimes(1);
        frame.value = rect(62, 200, 402, 778); // the slide starts
        vi.advanceTimersByTime(100);
        expect(h.measure).toHaveBeenCalledTimes(2);
    });

    it('kick() measures on the next frame and forces ticks through agreeing measurements (a fling after the finger lifts)', () => {
        const h = harness([rect(0, 0, 10, 10)], { interval: 32, kickTicks: 5 });
        h.current.value = rect(0, 0, 10, 10);
        vi.advanceTimersByTime(32);
        vi.advanceTimersByTime(1000);
        const settled = h.measure.mock.calls.length;
        // A touch stream kicks on every move: kicks within a frame coalesce.
        h.handle().kick();
        h.handle().kick();
        h.handle().kick();
        expect(h.measure).toHaveBeenCalledTimes(settled);
        vi.advanceTimersByTime(0);
        expect(h.measure).toHaveBeenCalledTimes(settled + 1);
        vi.advanceTimersByTime(32 * 10);
        // The kick's own measurement plus the forced ticks, then it settles.
        expect(h.measure.mock.calls.length).toBeGreaterThanOrEqual(settled + 5);
        const after = h.measure.mock.calls.length;
        vi.advanceTimersByTime(1000);
        expect(h.measure).toHaveBeenCalledTimes(after);
    });

    it('is off while `read` returns null (a closed popup), and a reactivation counts as a change', () => {
        const open = signal({ value: true });
        const current = signal<{ value: ElementLayout | null }>({ value: null });
        const measure = vi.fn(() => {
            current.value = rect(0, 0, 10, 10);
        });
        const Probe = component(() => {
            settleRect(() => (open.value ? current.value : null), measure, { interval: 100 });
            return () => <text>probe</text>;
        });
        render(<Probe />);
        current.value = rect(0, 50, 10, 10); // moving
        open.value = false; // closes before the tick
        vi.advanceTimersByTime(1000);
        expect(measure).not.toHaveBeenCalled();
        expect(pendingSettleTicks()).toBe(0);
        open.value = true; // reopens: one verifying measurement, then it agrees
        vi.advanceTimersByTime(1000);
        expect(measure).toHaveBeenCalledTimes(2);
    });

    it('clears the pending re-measure on unmount', () => {
        const h = harness([rect(0, 5, 10, 10)], { interval: 100 });
        h.current.value = rect(0, 0, 10, 10);
        h.view.unmount();
        vi.advanceTimersByTime(1000);
        expect(h.measure).not.toHaveBeenCalled();
    });
});

describe('the shared settle clock (#1200)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('loops due in the same frame measure in ONE batch, and a shared measure runs once per batch', () => {
        const frameMeasure = vi.fn();
        const anchors = Array.from({ length: 24 }, () => ({
            rect: signal<{ value: ElementLayout | null }>({ value: null }),
            measure: vi.fn(),
        }));
        const Probe = component(() => {
            for (const a of anchors) settleRect(() => a.rect.value, [a.measure, frameMeasure], { interval: 32 });
            return () => <text>probe</text>;
        });
        const view = render(<Probe />);
        // Two dozen anchors land their first rects within a few ms of each
        // other (a heavy screen mounting).
        anchors.forEach((a, i) => {
            if (i === 12) vi.advanceTimersByTime(5);
            a.rect.value = rect(0, 400, 100, 40);
        });
        const timers = vi.getTimerCount();
        expect(timers).toBe(1); // one clock, not one timer per loop
        vi.advanceTimersByTime(40);
        for (const a of anchors) expect(a.measure).toHaveBeenCalledTimes(1);
        expect(frameMeasure).toHaveBeenCalledTimes(1);
        view.unmount();
        expect(pendingSettleTicks()).toBe(0);
    });

});

describe('closed popups are inert (#1200)', () => {
    it('closed popups under a host measure nothing: no layout-event measurement, no settle loop', async () => {
        const measured: string[] = [];
        const FakeOrigin = component(({ slots }) => {
            provideOverlayOrigin(() => WINDOW, () => measured.push('frame'), () => SAFE);
            return () => slots.default?.() as never;
        });
        const { container } = render(
            <OverlayHost>
                <FakeOrigin>
                    {Array.from({ length: 8 }, (_, i) => (
                        <Popover.Root key={i}>
                            <Popover.Trigger><text>{`T${i}`}</text></Popover.Trigger>
                            <Popover.Popup><Popover.Title>P</Popover.Title></Popover.Popup>
                        </Popover.Root>
                    ))}
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => {});
        // Layout events on every closed trigger measure nothing.
        const triggers: TestNode[] = [];
        const walk = (n: TestNode): void => {
            if (n.props['data-scope'] === 'popover' && n.props['data-part'] === 'trigger') triggers.push(n);
            n.children.forEach(walk);
        };
        walk(container);
        expect(triggers).toHaveLength(8);
        for (const t of triggers) (t.props['bindlayoutchange'] as (e: unknown) => void)({});
        await new Promise((r) => setTimeout(r, 150));
        expect(measured).toEqual([]);
        expect(pendingSettleTicks()).toBe(0);
        clearDismissLayers();
    });
});

describe('outletFill — the 0×0 layer’s window-sized fill (#1190)', () => {
    it('states the outlet size once it is known', () => {
        expect(outletFill(WINDOW)).toEqual({ position: 'absolute', top: 0, left: 0, width: '402px', height: '874px' });
    });

    it('falls back to the four-edge spelling while unknown', () => {
        expect(outletFill(null)).toEqual({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
        expect(outletFill(rect(0, 0, 0, 0))).toEqual({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
    });
});

describe('native pan pass-through (#1190)', () => {
    afterEach(() => clearDismissLayers());

    const FakeOrigin = component<{ outlet: ElementLayout | null; frame: ElementLayout | null }>(({ props, slots }) => {
        provideOverlayOrigin(() => props.outlet, () => {}, () => props.frame);
        return () => slots.default?.() as never;
    });

    /** The popup's root (0×0), its surface sibling, and the popup. */
    const anatomyOf = (container: TestNode, scope: string) => {
        const popup = byPart(container, scope, 'popup')!;
        const root = popup.parent!;
        const surface = root.children.find((n) => n.props['native-interaction-enabled'] === false)!;
        return { popup, root, surface };
    };

    const expectPassThrough = (container: TestNode, scope: string): void => {
        const { popup, root, surface } = anatomyOf(container, scope);
        // The root covers nothing natively and takes lynx touches.
        expect(root._style.pointerEvents).toBe('auto');
        expect([root._style.width, root._style.height, root._style.overflow]).toEqual([0, 0, 'visible']);
        // The surface fills the window, catches lynx taps (light dismiss),
        // and is out of native hit-testing so a pan reaches the scroll view.
        expect(surface).toBeDefined();
        expect([surface._style.width, surface._style.height]).toEqual(['402px', '874px']);
        expect(typeof surface.props['bindtap']).toBe('function');
        // Its touch stream follows the anchor through a scroll.
        for (const ev of ['bindtouchstart', 'bindtouchmove', 'bindtouchend', 'bindtouchcancel']) {
            expect(typeof surface.props[ev]).toBe('function');
        }
        // The popup is a SIBLING: a native-disabled ancestor would switch off
        // native interaction for everything inside it.
        expect(contains(surface, popup)).toBe(false);
        expect(popup.props['native-interaction-enabled']).toBeUndefined();
        // Content-sized, not bounded by the 0×0 root.
        expect(popup._style.height).toBe('max-content');
    };

    it('popover', async () => {
        const { container } = render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Popover.Root defaultOpen>
                        <Popover.Trigger><text>Open</text></Popover.Trigger>
                        <Popover.Popup><Popover.Title>T</Popover.Title></Popover.Popup>
                    </Popover.Root>
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => {});
        expectPassThrough(container, 'popover');
    });

    it('select', async () => {
        const { container } = render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Select items={['Apple', 'Banana']} defaultOpen />
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => {});
        expectPassThrough(container, 'select');
    });

    it('a pan on the surface does not dismiss; a tap does', async () => {
        const { container } = render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Popover.Root defaultOpen>
                        <Popover.Trigger><text>Open</text></Popover.Trigger>
                        <Popover.Popup><Popover.Title>T</Popover.Title></Popover.Popup>
                    </Popover.Root>
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => {});
        const { surface } = anatomyOf(container, 'popover');
        await act(() => {
            (surface.props['bindtouchstart'] as () => void)();
            (surface.props['bindtouchmove'] as () => void)();
            (surface.props['bindtouchend'] as () => void)();
        });
        await act(() => {});
        expect(byPart(container, 'popover', 'popup')).not.toBeNull();
        await act(() => (surface.props['bindtap'] as () => void)());
        await act(() => {});
        expect(byPart(container, 'popover', 'popup')).toBeNull();
    });

    it('a modal dialog backdrop KEEPS native hit-testing: the page must not scroll under it', async () => {
        const { container } = render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Dialog.Root defaultOpen>
                        <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                    </Dialog.Root>
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => {});
        const backdrop = byPart(container, 'dialog', 'backdrop')!;
        expect(backdrop.props['native-interaction-enabled']).toBeUndefined();
        expect([backdrop._style.width, backdrop._style.height]).toEqual(['402px', '874px']);
    });
});

describe('Popover.Description — zero 0.6 anatomy part', () => {
    afterEach(() => clearDismissLayers());

    it('renders the description part in the portal, carrying the root axes', async () => {
        const { container } = render(
            <OverlayHost>
                <Popover.Root defaultOpen color="accent" size="lg">
                    <Popover.Trigger><text>Open</text></Popover.Trigger>
                    <Popover.Popup>
                        <Popover.Title>T</Popover.Title>
                        <Popover.Description>Body line</Popover.Description>
                    </Popover.Popup>
                </Popover.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const description = byPart(container, 'popover', 'description')!;
        expect(description).not.toBeNull();
        expect(description.type).toBe('text');
        expect(description.textContent()).toBe('Body line');
        const title = byPart(container, 'popover', 'title')!;
        // Same axis classes as its sibling title (the portal bridge carries them).
        const axisClasses = (n: TestNode): string[] => String(n.props['class'] ?? '').split(/\s+/).filter((c) => /accent|lg/.test(c));
        expect(axisClasses(description).length).toBeGreaterThan(0);
        expect(axisClasses(description).map((c) => c.replace('description', 'x'))).toEqual(axisClasses(title).map((c) => c.replace('title', 'x')));
    });
});
