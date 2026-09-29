/**
 * The shared settle behavior (#1320, #1324, #1325): a part whose entry
 * motion rests at the identity states that rest inline once the motion is
 * over, as a NEW value each time, because Lynx can keep a mid-flight
 * transform after the motion ends (Android: a frozen dialog or drawer; iOS:
 * a restored drawer 2pt short of its edge).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Define } from '@sigx/lynx';
import { component, provideScreenActive, signal } from '@sigx/lynx';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { Dialog, Drawer, OverlayHost, Toast, clearDismissLayers, createToaster } from '../src/index';
import { SETTLE_TRANSFORMS, createSettleTransform, settleTransform } from '../src/behaviors/settle-transform';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const byPart = (root: TestNode, scope: string, part: string): TestNode | null => {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) return root;
    for (const child of root.children) {
        const hit = byPart(child, scope, part);
        if (hit) return hit;
    }
    return null;
};

const fire = (node: TestNode, name: string): void => (node.props[name] as () => void)();

afterEach(() => {
    clearDismissLayers();
    vi.useRealTimers();
});

describe('settleTransform', () => {
    it('states nothing before the first pin, then alternates two identity spellings', () => {
        expect(settleTransform(0)).toBeUndefined();
        expect(settleTransform(1)).toBe('scale(1)');
        expect(settleTransform(2)).toBe('translateX(0px)');
        expect(settleTransform(3)).toBe('scale(1)');
    });

    it('every spelling is the identity', () => {
        for (const t of SETTLE_TRANSFORMS) {
            expect(t).toMatch(/^(scale\(1\)|translate[XY]?\(0(px)?(, ?0(px)?)?\))$/);
        }
    });
});

describe('createSettleTransform', () => {
    it('pins on every animation end, reports every motion, and only a transition end never pins by default', () => {
        const onMotion = vi.fn();
        const s = createSettleTransform({ onMotion });
        s.arm();
        expect(s.transform()).toBeUndefined();
        s.onTransitionEnd();
        expect(s.transform()).toBeUndefined();
        s.onAnimationEnd();
        expect(s.transform()).toBe('scale(1)');
        s.onAnimationEnd();
        expect(s.transform()).toBe('translateX(0px)');
        expect(onMotion).toHaveBeenCalledTimes(3);
        s.disarm();
    });

    it('pinOnTransition pins the first transition end only — the pin\'s own transition must not loop', () => {
        const s = createSettleTransform({ pinOnTransition: true });
        s.arm();
        s.onTransitionEnd();
        expect(s.transform()).toBe('scale(1)');
        s.onTransitionEnd();
        s.onTransitionEnd();
        expect(s.transform()).toBe('scale(1)');
        s.disarm();
    });

    it('the last fallback timer pins, the earlier ones only report motion; arm() starts over and disarm() drops the pin', () => {
        vi.useFakeTimers();
        const onMotion = vi.fn();
        const s = createSettleTransform({ fallbackMs: [300, 1000], onMotion });
        s.arm();
        vi.advanceTimersByTime(300);
        expect(onMotion).toHaveBeenCalledTimes(1);
        expect(s.transform()).toBeUndefined();
        vi.advanceTimersByTime(700);
        expect(s.transform()).toBe('scale(1)');
        s.arm();
        expect(s.transform()).toBeUndefined();
        s.disarm();
        vi.advanceTimersByTime(2000);
        // Disarmed: the timers are gone.
        expect(s.transform()).toBeUndefined();
        expect(onMotion).toHaveBeenCalledTimes(2);
    });
});

describe('Drawer.Panel pins its resting transform (#1324, #1325)', () => {
    it('leaves the transform to the slide-in until it ends, then pins a new value per end', async () => {
        const { container, unmount } = render(
            <OverlayHost>
                <Drawer.Root defaultOpen>
                    <Drawer.Panel><Drawer.Title>T</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const panel = () => byPart(container, 'drawer', 'panel')!;
        expect(panel()._style.transform).toBeUndefined();
        // The geometry is still stated alongside.
        expect(panel()._style.flexShrink).toBe(0);

        await act(() => fire(panel(), 'bindanimationend'));
        expect(panel()._style.transform).toBe('scale(1)');
        expect(panel()._style.flexShrink).toBe(0);

        // A transition end (the pin can start one) does not pin again.
        await act(() => fire(panel(), 'bindtransitionend'));
        expect(panel()._style.transform).toBe('scale(1)');

        await act(() => fire(panel(), 'bindanimationend'));
        expect(panel()._style.transform).toBe('translateX(0px)');
        unmount();
    });

    it('the last fallback timer pins it when no animation event arrives, and a reopen starts over', async () => {
        const open = signal({ value: true });
        const Harness = component(() => () => (
            <OverlayHost>
                <Drawer.Root model={() => open.value} placement="end">
                    <Drawer.Panel><Drawer.Title>T</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>
        ));
        const { container, unmount } = render(<Harness />);
        await act(() => {});
        const panel = () => byPart(container, 'drawer', 'panel');
        await sleep(600);
        // The first fallback (400ms) only re-measures.
        expect(panel()!._style.transform).toBeUndefined();
        await sleep(600);
        expect(panel()!._style.transform).toBe('scale(1)');

        await act(() => { open.value = false; });
        expect(panel()).toBeNull();
        await act(() => { open.value = true; });
        expect(panel()!._style.transform).toBeUndefined();
        unmount();
    });
});

type ScreenProps = Define.Prop<'state', { active: boolean }, true> & Define.Slot<'default'>;
const Screen = component<ScreenProps>(({ props, slots }) => {
    provideScreenActive(() => props.state.active);
    return () => <view>{slots.default?.()}</view>;
});

describe('a restored overlay settles again, as on a fresh open (#1325)', () => {
    it('a drawer uncovered after a pop drops its pin (the new panel replays the slide-in) and pins at its end', async () => {
        const screen = signal({ active: true });
        const { container, unmount } = render(
            <OverlayHost>
                <Screen state={screen}>
                    <Drawer.Root defaultOpen>
                        <Drawer.Panel><Drawer.Title>T</Drawer.Title></Drawer.Panel>
                    </Drawer.Root>
                </Screen>
            </OverlayHost>,
        );
        await act(() => {});
        const panel = () => byPart(container, 'drawer', 'panel');
        await act(() => fire(panel()!, 'bindanimationend'));
        expect(panel()!._style.transform).toBe('scale(1)');

        await act(() => { screen.active = false; });
        await act(() => { screen.active = true; });
        await act(() => {});
        expect(panel()!._style.transform).toBeUndefined();
        await act(() => fire(panel()!, 'bindanimationend'));
        expect(panel()!._style.transform).toBe('scale(1)');
        unmount();
    });

    it('a restored dialog does the same, and re-arms its fallback timer', async () => {
        const screen = signal({ active: true });
        const { container, unmount } = render(
            <OverlayHost>
                <Screen state={screen}>
                    <Dialog.Root defaultOpen>
                        <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                    </Dialog.Root>
                </Screen>
            </OverlayHost>,
        );
        await act(() => {});
        const popup = () => byPart(container, 'dialog', 'popup');
        await act(() => fire(popup()!, 'bindanimationend'));
        expect(popup()!._style.transform).toBe('scale(1)');

        await act(() => { screen.active = false; });
        await act(() => { screen.active = true; });
        await act(() => {});
        expect(popup()!._style.transform).toBeUndefined();
        await sleep(1100);
        expect(popup()!._style.transform).toBe('scale(1)');
        unmount();
    });
});

describe('Toast.Root pins its resting transform (#1324 sweep)', () => {
    it('a store toast pins on its entry transition\'s end, once, and drops the pin as it exits', async () => {
        const toaster = createToaster({ exitDuration: 200 });
        const { container, unmount } = render(
            <OverlayHost>
                <Toast.Viewport toaster={toaster} />
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Saved', duration: 0 }); });
        await act(() => sleep(40));
        const root = () => byPart(container, 'toast', 'root');
        expect(root()!.props['data-state']).toBe('open');
        expect(root()!._style?.transform).toBeUndefined();

        await act(() => fire(root()!, 'bindtransitionend'));
        expect(root()!._style.transform).toBe('scale(1)');
        await act(() => fire(root()!, 'bindtransitionend'));
        expect(root()!._style.transform).toBe('scale(1)');

        await act(() => { toaster.dismiss(toaster.toasts()[0]!.id); });
        expect(root()!.props['data-state']).toBe('closed');
        expect(root()!._style?.transform).toBeUndefined();
        unmount();
    });

    it('the fallback timer pins it when no transition event arrives', async () => {
        const toaster = createToaster({ exitDuration: 0 });
        const { container, unmount } = render(
            <OverlayHost>
                <Toast.Viewport toaster={toaster} />
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Saved', duration: 0 }); });
        await act(() => sleep(700));
        expect(byPart(container, 'toast', 'root')!._style.transform).toBe('scale(1)');
        unmount();
    });

    it('a toast rendered in place (no store) never pins', async () => {
        const { container, unmount } = render(<Toast.Root><Toast.Title>T</Toast.Title></Toast.Root>);
        await act(() => sleep(700));
        expect(byPart(container, 'toast', 'root')!._style?.transform).toBeUndefined();
        unmount();
    });
});
