/**
 * The `safeAreaChanged` subscription (CONVENTIONS.md C7).
 *
 * Three of these fail against the pre-migration hand-rolled listener:
 *
 *  - a JSON-string payload was silently ignored, freezing insets forever;
 *  - a throwing BG consumer unwound out of the listener into the emitter's
 *    dispatch loop, cancelling delivery to every other listener on the channel;
 *  - a non-object payload was "normalised" into the current insets and written
 *    straight back, so a malformed event looked like a successful update.
 *
 * The fourth — disposer idempotency — is the C7 contract test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitForUpdate } from '@sigx/lynx-testing';
import { component } from '@sigx/lynx';
import { effect } from '@sigx/reactivity';

import { SAFE_AREA_EVENT, subscribeSafeArea } from '../src/events';
import { SafeAreaProvider } from '../src/provider';
import { useSafeAreaInsets } from '../src/hooks';
import { GLOBAL_PROPS_KEY } from '../src/globals';

/**
 * Fake GlobalEventEmitter that counts registrations, so "was the listener
 * really removed" is observable rather than inferred.
 *
 * `emit` iterates and calls without a try/catch on purpose: that is what both
 * native dispatch loops do (`SafeAreaPublisher.kt` → `sendGlobalEvent`,
 * `SafeAreaPublisher.swift` → `sendGlobalEvent(_:withParams:)`), so a listener
 * that throws really does cancel delivery to the listeners behind it.
 */
function fakeEmitter() {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    const self = {
        /** How many times the code under test called into `removeListener`. */
        removeCalls: 0,
        count: (c: string) => listeners.get(c)?.size ?? 0,
        emit: (c: string, p: unknown) => {
            for (const fn of listeners.get(c) ?? []) fn(p);
        },
        addListener(name: string, fn: (...a: unknown[]) => void) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)!.add(fn);
        },
        removeListener(name: string, fn: (...a: unknown[]) => void) {
            self.removeCalls++;
            listeners.get(name)?.delete(fn);
        },
    };
    return self;
}

let emitter: ReturnType<typeof fakeEmitter>;

function installLynx(initial: Record<string, number> = {}) {
    vi.stubGlobal('lynx', {
        __globalProps: { [GLOBAL_PROPS_KEY]: initial },
        getJSModule: (n: string) => (n === 'GlobalEventEmitter' ? emitter : undefined),
    });
}

beforeEach(() => {
    emitter = fakeEmitter();
});

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// C7: the disposer is a plain function and calling it twice is a no-op
// ---------------------------------------------------------------------------

describe('subscribeSafeArea disposer (C7)', () => {
    it('is a function, not a { remove() } handle', () => {
        installLynx();
        const off = subscribeSafeArea(() => {});
        expect(typeof off).toBe('function');
        expect(off).not.toHaveProperty('remove');
        off();
    });

    it('leaves the other subscriber alone when one disposer runs twice', () => {
        installLynx();
        const a = vi.fn();
        const b = vi.fn();
        const offA = subscribeSafeArea(a);
        subscribeSafeArea(b);
        expect(emitter.count(SAFE_AREA_EVENT)).toBe(2);

        // An effect cleanup firing twice (unmount plus an explicit teardown) is
        // ordinary. The second call must not reach the emitter at all — that is
        // what took `@sigx/lynx-audio`'s metering reference count to zero while
        // a listener was still subscribed.
        offA();
        offA();

        // The assertion that discriminates: the second call must not reach the
        // emitter at all. A tolerant emitter (this fake, and Lynx's own
        // Set/array-backed one) hides a double *removeListener*; it does not
        // hide a double *teardown*, which is what a shared reference count or
        // a `switchKeyBoardDetect`-style side effect sits behind.
        expect(emitter.removeCalls).toBe(1);
        expect(emitter.count(SAFE_AREA_EVENT)).toBe(1);
        emitter.emit(SAFE_AREA_EVENT, { top: 44 });
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('is a safe no-op off-device, where there is no emitter', () => {
        // No `lynx` global at all: subscribing must not throw, and the disposer
        // it hands back must still be callable (twice).
        const off = subscribeSafeArea(() => {});
        expect(() => {
            off();
            off();
        }).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Payload handling
// ---------------------------------------------------------------------------

describe('safeAreaChanged payload handling', () => {
    it('applies a JSON-string payload (hosts that serialise bridge params)', async () => {
        installLynx({ top: 50, keyboard: 0 });
        const { container } = render(<SafeAreaProvider />);

        emitter.emit(SAFE_AREA_EVENT, JSON.stringify({ top: 50, bottom: 34, keyboard: 280 }));
        await waitForUpdate();

        // The keyboard extra is the BG-signal half of the update, so it is
        // observable without emulating the MT SharedValue bridge.
        expect(container.children[0]!._style['--safe-area-keyboard']).toBe('280px');
    });

    it('drops a payload with no usable inset rather than rewriting the current one', async () => {
        installLynx({ top: 50, keyboard: 120 });
        const { container } = render(<SafeAreaProvider />);
        const seen: unknown[] = [];
        const off = subscribeSafeArea((raw) => seen.push(raw));

        emitter.emit(SAFE_AREA_EVENT, 'not json at all');
        emitter.emit(SAFE_AREA_EVENT, null);
        emitter.emit(SAFE_AREA_EVENT, 42);
        emitter.emit(SAFE_AREA_EVENT, { top: 'oops', keyboard: NaN });
        await waitForUpdate();

        expect(seen).toEqual([]);
        // Cold-start seed survives untouched.
        expect(container.children[0]!._style['--safe-area-keyboard']).toBe('120px');
        off();
    });

    it('keeps the current value for edges the platform omits', async () => {
        installLynx({ top: 47, keyboard: 0, statusBar: 47, navigationBar: 24 });
        const { container } = render(<SafeAreaProvider />);

        // Android pre-31 publishes no navigationBar; the previous value must
        // survive rather than collapsing to 0.
        emitter.emit(SAFE_AREA_EVENT, { top: 47, keyboard: 300 });
        await waitForUpdate();

        let captured = { keyboard: 0, navigationBar: 0 };
        const Probe = component(() => {
            const i = useSafeAreaInsets();
            effect(() => {
                captured = { keyboard: i.value.keyboard, navigationBar: i.value.navigationBar };
            });
            return () => <view />;
        });
        render(<SafeAreaProvider><Probe /></SafeAreaProvider>);
        expect(container.children[0]!._style['--safe-area-keyboard']).toBe('300px');
        expect(captured.navigationBar).toBe(24);
    });
});

// ---------------------------------------------------------------------------
// A throwing consumer must not take the channel down
// ---------------------------------------------------------------------------

describe('a throwing consumer', () => {
    it('does not cancel safeAreaChanged delivery for the other listeners', () => {
        installLynx({ top: 50, keyboard: 0 });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        // A consumer of useSafeAreaInsets() whose effect throws. sigx runs
        // effects SYNCHRONOUSLY on write, so this throw happens inside
        // `extras.$set(...)` — i.e. inside the provider's own listener.
        let armed = false;
        const Buggy = component(() => {
            const i = useSafeAreaInsets();
            effect(() => {
                void i.value.keyboard;
                if (armed) throw new Error('consumer effect blew up');
            });
            return () => <view />;
        });
        render(<SafeAreaProvider><Buggy /></SafeAreaProvider>);

        // An unrelated listener registered behind the provider on the same
        // channel — an app tracking insets itself, say.
        const other = vi.fn();
        const off = subscribeSafeArea(other);
        expect(emitter.count(SAFE_AREA_EVENT)).toBe(2);

        armed = true;
        expect(() => emitter.emit(SAFE_AREA_EVENT, { top: 50, keyboard: 280 })).not.toThrow();
        expect(other).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();

        off();
        warn.mockRestore();
    });
});
