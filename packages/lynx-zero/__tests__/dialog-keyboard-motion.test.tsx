/**
 * Dialog on iOS, found in the fix-wave-5 QA sweep (#1140):
 *
 * - #1232: the soft keyboard covered the focused textarea and the footer —
 *   the panel stayed centred in the full window. The backdrop now pads its
 *   bottom by the keyboard's overlap (never twice on an Android window that
 *   resized for it), the panel is capped at what is left, and its body
 *   scrolls.
 * - #1233: a Select opened inside an OPENING dialog anchored ~8pt right of
 *   its trigger — measured under the panel's open scale (0.95) and never
 *   again. The panel's animation/transition end now bumps an ancestor-motion
 *   counter, and anchored popups under it re-measure (a bounded kick).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementLayout } from '@sigx/lynx';
import { component } from '@sigx/lynx';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { Dialog, OverlayHost, Select, clearDismissLayers, provideOverlayOrigin } from '../src/index';
import { acquireKeyboard, keyboardHeight, keyboardOverlap } from '../src/behaviors/keyboard';
import { pendingSettleTicks, tallestAtWidth } from '../src/behaviors/position';
import { dialogLayout } from '../src/components/dialog/Dialog';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

function fakeEmitter() {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    return {
        count: (c: string) => listeners.get(c)?.size ?? 0,
        emit: (c: string, p: unknown) => {
            for (const fn of listeners.get(c) ?? []) fn(p);
        },
        addListener(name: string, fn: (...a: unknown[]) => void) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)!.add(fn);
        },
        removeListener(name: string, fn: (...a: unknown[]) => void) {
            listeners.get(name)?.delete(fn);
        },
    };
}

describe('keyboardOverlap — never lift twice (#1232)', () => {
    it('iOS: the window never moves, the keyboard covers its bottom', () => {
        expect(keyboardOverlap(336, 874, 874)).toBe(336);
    });

    it('Android adjustResize: the outlet already shrank above the keyboard', () => {
        expect(keyboardOverlap(300, 574, 874)).toBe(0);
    });

    it('a partial resize leaves only the remainder', () => {
        expect(keyboardOverlap(300, 774, 874)).toBe(200);
    });

    it('no keyboard, or no outlet yet, is no overlap', () => {
        expect(keyboardOverlap(0, 874, 874)).toBe(0);
        expect(keyboardOverlap(300, 0, 874)).toBe(0);
    });

    it('an unknown full height counts as unresized', () => {
        expect(keyboardOverlap(336, 874, 0)).toBe(336);
    });
});

describe('tallestAtWidth — the outlet height with no keyboard', () => {
    it('keeps the tallest height at one width, and starts over when the width changes', () => {
        const tallest = tallestAtWidth();
        expect(tallest({ width: 402, height: 874 })).toBe(874);
        expect(tallest({ width: 402, height: 574 })).toBe(874); // resized for a keyboard
        expect(tallest(null)).toBe(874);
        expect(tallest({ width: 874, height: 402 })).toBe(402); // rotated
    });
});

describe('dialogLayout — the panel’s box (#1232)', () => {
    it('without a keyboard: the safe frame, the panel capped inside it', () => {
        expect(dialogLayout({ top: 62, bottom: 34 }, 874, 874, 0)).toEqual({ top: 62, bottom: 34, maxHeight: 874 - 62 - 34 - 32 });
    });

    it('with the keyboard up: the backdrop pads by the keyboard, not by both', () => {
        expect(dialogLayout({ top: 62, bottom: 34 }, 874, 874, 336)).toEqual({ top: 62, bottom: 336, maxHeight: 874 - 62 - 336 - 32 });
    });

    it('on a resized Android window the safe frame wins', () => {
        expect(dialogLayout({ top: 24, bottom: 0 }, 574, 874, 300)).toEqual({ top: 24, bottom: 0, maxHeight: 574 - 24 - 32 });
    });

    it('no cap until the outlet is known', () => {
        expect(dialogLayout({ top: 0, bottom: 0 }, 0, 0, 0).maxHeight).toBeNull();
    });
});

describe('acquireKeyboard — one provider-free subscription while held', () => {
    let emitter: ReturnType<typeof fakeEmitter>;
    beforeEach(() => {
        emitter = fakeEmitter();
        vi.stubGlobal('lynx', {
            __globalProps: { safeArea: { top: 62, bottom: 34, keyboard: 120 } },
            getJSModule: (n: string) => (n === 'GlobalEventEmitter' ? emitter : undefined),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('seeds from __globalProps, follows safeAreaChanged, and unsubscribes with the last holder', () => {
        const a = acquireKeyboard();
        const b = acquireKeyboard();
        expect(emitter.count('safeAreaChanged')).toBe(1);
        expect(keyboardHeight()).toBe(120); // already raised when the dialog opened
        emitter.emit('safeAreaChanged', { top: 62, bottom: 34, keyboard: 336 });
        expect(keyboardHeight()).toBe(336);
        // A republish without the key keeps the height.
        emitter.emit('safeAreaChanged', { top: 62 });
        expect(keyboardHeight()).toBe(336);
        a();
        a(); // idempotent
        expect(emitter.count('safeAreaChanged')).toBe(1);
        b();
        expect(emitter.count('safeAreaChanged')).toBe(0);
        expect(keyboardHeight()).toBe(0);
    });
});

const FakeOrigin = component<{ outlet: ElementLayout | null; frame: ElementLayout | null; probe?: () => void }>(({ props, slots }) => {
    provideOverlayOrigin(() => props.outlet, () => props.probe?.(), () => props.frame);
    return () => slots.default?.() as never;
});

describe('Dialog.Popup with the keyboard up (#1232)', () => {
    let emitter: ReturnType<typeof fakeEmitter>;
    beforeEach(() => {
        emitter = fakeEmitter();
        vi.stubGlobal('lynx', {
            __globalProps: { safeArea: { keyboard: 0 } },
            getJSModule: (n: string) => (n === 'GlobalEventEmitter' ? emitter : undefined),
        });
    });
    afterEach(() => {
        clearDismissLayers();
        vi.unstubAllGlobals();
    });

    it('lifts the panel above the keyboard, caps it, and scrolls its body', async () => {
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
        const popup = byPart(container, 'dialog', 'popup')!;
        // SAFE sits 62 below the top and 34 above the bottom.
        expect([backdrop._style.paddingTop, backdrop._style.paddingBottom]).toEqual(['62px', '34px']);
        expect(popup._style.maxHeight).toBe(`${874 - 62 - 34 - 32}px`);
        expect(popup._style.display).toBe('flex');
        // The body is ALWAYS a scroll-view, so the keyboard rising never
        // remounts the focused field.
        const body = popup.children[0]!;
        expect(body.type).toBe('scroll-view');
        expect(body.props['scroll-y']).toBe(true);
        expect(emitter.count('safeAreaChanged')).toBe(1);

        await act(() => emitter.emit('safeAreaChanged', { keyboard: 336 }));
        expect(backdrop._style.paddingBottom).toBe('336px');
        expect(popup._style.maxHeight).toBe(`${874 - 62 - 336 - 32}px`);
        expect(popup.children[0]).toBe(body);

        await act(() => emitter.emit('safeAreaChanged', { keyboard: 0 }));
        expect(backdrop._style.paddingBottom).toBe('34px');
    });

    it('a closed dialog holds no subscription', async () => {
        render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Dialog.Root>
                        <Dialog.Trigger><text>Open</text></Dialog.Trigger>
                        <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                    </Dialog.Root>
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => {});
        expect(emitter.count('safeAreaChanged')).toBe(0);
    });
});

/** Whether any settle tick is pending at some point in the next `ms`. */
async function ticksWithin(ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (pendingSettleTicks() > 0) return true;
        await sleep(5);
    }
    return pendingSettleTicks() > 0;
}

const nestedSelect = (open: boolean) => (
    <OverlayHost>
        <Dialog.Root defaultOpen>
            <Dialog.Popup>
                <Select.Root defaultOpen={open} items={['a', 'b']} placeholder="Pick" />
            </Dialog.Popup>
        </Dialog.Root>
    </OverlayHost>
);

describe('a Select in an opening Dialog re-measures when the panel settles (#1233)', () => {
    afterEach(() => clearDismissLayers());

    it('the panel’s animationend kicks the open anchor into a bounded burst', async () => {
        const { container, unmount } = render(nestedSelect(true));
        await act(() => {});
        await sleep(1300); // past the fallback bumps and any mount-time loop
        expect(pendingSettleTicks()).toBe(0);
        const popup = byPart(container, 'dialog', 'popup')!;
        expect(typeof popup.props['bindanimationend']).toBe('function');
        expect(typeof popup.props['bindtransitionend']).toBe('function');
        await act(() => (popup.props['bindanimationend'] as () => void)());
        // Kicked: the anchor re-measures now…
        expect(pendingSettleTicks()).toBeGreaterThan(0);
        // …and stops on its own (a kick is a handful of ticks, #1200).
        await sleep(600);
        expect(pendingSettleTicks()).toBe(0);
        unmount();
    });

    it('the fallback timers kick the anchor even when no animation event arrives', async () => {
        const { unmount } = render(nestedSelect(true));
        await act(() => {});
        await sleep(1300);
        expect(pendingSettleTicks()).toBe(0);
        // Reopen: the fallback bumps are per open.
        unmount();
        const again = render(nestedSelect(true));
        await act(() => {});
        await sleep(250);
        expect(await ticksWithin(300)).toBe(true);
        again.unmount();
    });

    it('a bump with the select closed measures nothing', async () => {
        const { container, unmount } = render(nestedSelect(false));
        await act(() => {});
        await sleep(1300);
        const popup = byPart(container, 'dialog', 'popup')!;
        await act(() => (popup.props['bindanimationend'] as () => void)());
        expect(await ticksWithin(200)).toBe(false);
        unmount();
    });
});
