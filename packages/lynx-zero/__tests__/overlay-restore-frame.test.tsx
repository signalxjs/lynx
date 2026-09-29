/**
 * A restored overlay keeps the safe frame (#1318).
 *
 * #1308 takes a covered screen's overlays out of the outlet and renders them
 * again, as on a fresh open, once the screen is uncovered. The host of a
 * per-screen `ZeroRoot` measured its safe frame while the push slid the
 * screen away (the parallax: the frame pokes out of the outlet on the left)
 * and then sat `display: none`. An interactive pop re-measures that same
 * rect at the drag's start, which publishes nothing, so no settle loop ran
 * once the pop settled (iOS sim: every slow edge swipe). The restored
 * drawer's title sat under the status bar and the dialog centred in the
 * whole window: `containedFrame` dropped the stale rect and every inset
 * fell to 0.
 *
 * `useViewportRect` is the one seam faked here: the real one measures on the
 * main thread, which the test renderer does not run. `measure()` publishes
 * whatever the test says the element measures right now.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Define, ElementLayout } from '@sigx/lynx';
import { component, provideScreenActive, signal } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { Dialog, Drawer, OverlayHost, clearDismissLayers } from '../src/index';
import { holdContainedFrame } from '../src/behaviors/position';

const fakes = vi.hoisted(() => ({
    rects: [] as { rect: { value: unknown }; measure: () => void; measured: number; now: unknown }[],
}));

vi.mock('@sigx/lynx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx')>();
    return {
        ...actual,
        useViewportRect: () => {
            const entry = {
                ref: actual.useMainThreadRef(null),
                rect: actual.signal<{ value: unknown }>({ value: null }),
                measured: 0,
                // What the element would measure right now (null: nothing lands).
                now: null as unknown,
                measure: () => {
                    entry.measured++;
                    if (entry.now) entry.rect.value = entry.now;
                },
            };
            fakes.rects.push(entry as never);
            return entry;
        },
    };
});

const rect = (top: number, left: number, width: number, height: number): ElementLayout => ({
    top, left, width, height, right: left + width, bottom: top + height,
});

/** iPhone 17 Pro, points: the window, and the host's box below the status bar. */
const WINDOW = { width: 402, height: 874 };
const OUTLET = rect(0, 0, 402, 874);
const SAFE = rect(62, 0, 402, 778);
/** The covered screen mid push: the parallax slid it a third of a width left. */
const SLID_AWAY = rect(62, -121, 402, 778);

const walk = (node: TestNode, out: TestNode[] = []): TestNode[] => {
    out.push(node);
    for (const child of node.children) walk(child, out);
    return out;
};

const byPart = (root: TestNode, scope: string, part: string): TestNode | null =>
    walk(root).find((n) => n.props['data-scope'] === scope && n.props['data-part'] === part) ?? null;

/** The window-sized sizer: the one fixed node pinned on all four edges. */
const sizerOf = (root: TestNode): TestNode =>
    walk(root).find((n) => n._style?.position === 'fixed' && n._style?.right === 0 && n._style?.bottom === 0)!;

const fireLayout = (node: TestNode, size: { width: number; height: number }): void => {
    const handlers = (node as unknown as { _handlers: Map<string, (e: unknown) => void> })._handlers;
    handlers.get('bindlayoutchange')?.({ detail: { left: 0, top: 0, ...size } });
};

/** The drawer content box: the first node under the panel that pads itself. */
const drawerContentTop = (root: TestNode): string | undefined => {
    const panel = byPart(root, 'drawer', 'panel');
    if (!panel) return undefined;
    return walk(panel).find((n) => n !== panel && n._style?.paddingTop !== undefined)?._style.paddingTop as string | undefined;
};

/**
 * `act` for fake timers: run `fn`, then let microtasks (the registry's
 * deferred show/hide, effects) and timers due within `ms` run. `act` itself
 * waits on a real macrotask, which fake timers never deliver.
 */
const act = async (fn: () => void = () => {}, ms = 0): Promise<void> => {
    fn();
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
};

type ScreenProps = Define.Prop<'state', { active: boolean }, true> & Define.Slot<'default'>;
/** A navigator screen (what `<EntryScope>` provides), wrapping its own host like the gallery's per-screen ZeroRoot. */
const Screen = component<ScreenProps>(({ props, slots }) => {
    provideScreenActive(() => props.state.active);
    return () => <view>{slots.default?.()}</view>;
});

beforeEach(() => {
    fakes.rects.length = 0;
    vi.useFakeTimers();
});
afterEach(() => {
    clearDismissLayers();
    vi.useRealTimers();
});

/**
 * Mount `overlay` under a per-screen host with its safe frame measured, then
 * cover the screen while the frame slides away and let the settle loop run
 * out. Returns the handles the assertions need.
 */
async function coverAndRestore(overlay: () => unknown) {
    const screen = signal({ active: true });
    const { container } = render(
        <Screen state={screen}>
            <OverlayHost>{overlay() as never}</OverlayHost>
        </Screen>,
    );
    // The host's rect is the first useViewportRect created (the host's setup
    // runs before any overlay's).
    const host = fakes.rects[0]!;
    fireLayout(sizerOf(container), WINDOW);
    host.now = SAFE;
    await act(() => { host.measure(); });
    await act();
    await act(() => {}, 1000);

    // Push: the screen goes inactive at once, slides away, then hides. Every
    // measurement from here on lands the slid-away rect.
    await act(() => { screen.active = false; });
    host.now = SLID_AWAY;
    await act(() => { host.measure(); });
    // The loop keeps measuring (the frame pokes out) until its budget ends.
    await act(() => {}, 10_000);
    const measuredWhileCovered = host.measured;

    // Pop settled: the screen is back on top, at rest. Nothing fires a layout
    // event; only a new measurement can see the frame is back.
    // Only microtasks here, no timers: what the restored overlay renders
    // with BEFORE any new measurement can land.
    host.now = SAFE;
    screen.active = true;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return { container, host, measuredWhileCovered };
}

describe('holdContainedFrame', () => {
    it('passes a contained frame through and holds it while the next one pokes out', () => {
        const hold = holdContainedFrame();
        expect(hold(OUTLET, SAFE)).toEqual(SAFE);
        expect(hold(OUTLET, SLID_AWAY)).toEqual(SAFE);
        const lower = rect(100, 0, 402, 700);
        expect(hold(OUTLET, lower)).toEqual(lower);
        expect(hold(OUTLET, SLID_AWAY)).toEqual(lower);
    });

    it('passes the raw frame through when nothing contained was ever measured (a screen still sliding in)', () => {
        const hold = holdContainedFrame();
        const slidingIn = rect(62, 401, 402, 778);
        expect(hold(OUTLET, slidingIn)).toBe(slidingIn);
        expect(hold(OUTLET, null)).toBeNull();
    });

    it('drops a held frame the current outlet no longer contains (rotated while covered)', () => {
        const hold = holdContainedFrame();
        hold(OUTLET, SAFE);
        const landscape = rect(0, 0, 874, 402);
        expect(hold(landscape, SLID_AWAY)).toBe(SLID_AWAY);
    });
});

describe('a restored overlay settles to its first-open geometry (#1318)', () => {
    it('the drawer\'s content is padded below the status bar again, before any new measurement', async () => {
        const { container } = await coverAndRestore(() => (
            <Drawer.Root defaultOpen dismissible={false}>
                <Drawer.Panel><Drawer.Title>Drawer · start</Drawer.Title></Drawer.Panel>
            </Drawer.Root>
        ));
        // The gutter adds 4px to the inset.
        expect(drawerContentTop(container)).toBe('66px');
    });

    it('the dialog backdrop pads by the safe frame again, so the panel centres in it', async () => {
        const { container } = await coverAndRestore(() => (
            <Dialog.Root defaultOpen dismissible={false}>
                <Dialog.Popup><Dialog.Title>Dialog</Dialog.Title></Dialog.Popup>
            </Dialog.Root>
        ));
        const backdrop = byPart(container, 'dialog', 'backdrop')!;
        expect(backdrop._style.paddingTop).toBe('62px');
        expect(backdrop._style.paddingBottom).toBe('34px');
    });

    it('uncovering the host\'s screen measures the frame again (its settle loop had run out)', async () => {
        const { host, measuredWhileCovered } = await coverAndRestore(() => (
            <Dialog.Root defaultOpen dismissible={false}>
                <Dialog.Popup><Dialog.Title>Dialog</Dialog.Title></Dialog.Popup>
            </Dialog.Root>
        ));
        // Covered long enough that the loop gave up: only the kick measures.
        await act(() => {}, 0);
        expect(host.measured).toBeGreaterThan(measuredWhileCovered);
        expect(host.rect.value).toEqual(SAFE);
    });

    it('the loop really had run out while covered (the precondition the kick fixes)', async () => {
        const screen = signal({ active: true });
        const { container } = render(
            <Screen state={screen}>
                <OverlayHost><text>page</text></OverlayHost>
            </Screen>,
        );
        const host = fakes.rects[0]!;
        fireLayout(sizerOf(container), WINDOW);
        host.now = SLID_AWAY;
        await act(() => { host.measure(); });
        await act(() => {}, 10_000);
        const spent = host.measured;
        await act(() => {}, 10_000);
        expect(host.measured).toBe(spent);
    });
});
