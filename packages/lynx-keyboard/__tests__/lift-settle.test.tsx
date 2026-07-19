/**
 * useKeyboardLiftSV post-mount SETTLE (#677 first-entry bug):
 *
 * The lift seed is read at setup and the inset watcher dedupes against it, so
 * a keyboard change landing in the gap between those two moments is invisible:
 * BG believes the lift is current while the MT holds the stale seed (the
 * composer's bar stranded keyboard-height off the bottom on first entry). The
 * hook closes it with ONE deferred idempotent sync — a `setTimeout(0)` that
 * re-reads the lift at fire time and writes it outright at duration 0. Ordering
 * against the SV's own registration ops is the runtime's job (#691), so a
 * single unconditional pass suffices; no re-dispatch loop.
 *
 * These tests assert that single settle dispatches exactly once (a stale/
 * unchanged seed would otherwise produce ZERO dispatches) with the correct
 * target, by recording every (target, seconds) pair pushed through
 * runOnMainThread.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@sigx/lynx-testing';
import { SafeAreaProvider, GLOBAL_PROPS_KEY } from '@sigx/lynx-safe-area';

// Wrap runOnMainThread so every dispatched (target, seconds) pair is
// recorded; the wrapped fn still runs locally (the test-env fallback), so
// the SharedValue's .value observably settles too.
const dispatches: Array<[number, number]> = [];
vi.mock('@sigx/lynx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx')>();
    return {
        ...actual,
        runOnMainThread: (fn: (...args: never[]) => unknown) =>
            (...args: never[]) => {
                dispatches.push(args as unknown as [number, number]);
                return Promise.resolve((fn as (...a: never[]) => unknown)(...args));
            },
    };
});

import { component } from '@sigx/lynx';
import { useKeyboardLiftSV } from '../src/use-keyboard';

type SafeAreaListener = (raw: unknown) => void;
const emitterListeners: SafeAreaListener[] = [];
function installMockLynx(initial: Record<string, number>): void {
    emitterListeners.length = 0;
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: { [GLOBAL_PROPS_KEY]: initial },
        getJSModule: (name: string) => name === 'GlobalEventEmitter'
            ? {
                addListener: (_ev: string, l: SafeAreaListener) => { emitterListeners.push(l); },
                removeListener: (_ev: string, l: SafeAreaListener) => {
                    const i = emitterListeners.indexOf(l);
                    if (i !== -1) emitterListeners.splice(i, 1);
                },
            }
            : undefined,
        getElementById: () => ({ setProperty: () => undefined }),
    };
}

beforeEach(() => {
    dispatches.length = 0;
    delete (globalThis as { lynx?: unknown }).lynx;
});
afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

async function mountWithKeyboard(insets: Record<string, number>): Promise<{ value: number }> {
    installMockLynx(insets);
    const box: { sv: { value: number } | null } = { sv: null };
    const Probe = component(() => {
        box.sv = useKeyboardLiftSV() as unknown as { value: number };
        return () => <view />;
    });
    render(
        <SafeAreaProvider>
            <Probe />
        </SafeAreaProvider>,
    );
    // The settle is deliberately DEFERRED (a mount-frame dispatch can outrun
    // SV registration) — flush the macrotask.
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    return box.sv!;
}

describe('useKeyboardLiftSV settle (#677)', () => {
    it('mounting under an open keyboard re-syncs the current lift once, instantly', async () => {
        const sv = await mountWithKeyboard({ bottom: 34, keyboard: 280 });
        // Exactly one deferred settle dispatch: current lift, duration 0 —
        // no inset change occurred, so without the unconditional settle
        // there would be ZERO dispatches (the stale-seed/missed-event trap).
        const settles = dispatches.filter(([, secs]) => secs === 0);
        expect(settles).toEqual([[280 - 34, 0]]);
        expect(sv.value).toBe(280 - 34);
    });

    it('mounting with the keyboard closed settles at 0 (untranslated)', async () => {
        const sv = await mountWithKeyboard({ bottom: 34, keyboard: 0 });
        const settles = dispatches.filter(([, secs]) => secs === 0);
        expect(settles).toEqual([[0, 0]]);
        expect(sv.value).toBe(0);
    });

});