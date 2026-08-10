/**
 * The package's two native-event subscriptions (`urlReceived`,
 * `hardwareBackPress`) against the C7 contract: a `() => void` disposer that
 * is idempotent, a listener throw that cannot cost siblings their event, and a
 * safe no-op wherever there is no emitter.
 *
 * The fake emitter models the real one faithfully — a Set of handlers per
 * channel, dispatched with `forEach`, so an exception escaping one handler
 * really does stop the ones behind it. That is what makes the containment
 * assertions about the code under test rather than about the fake.
 */
import { addTransport, clearTransports, setLogLevel, type LogRecord } from '@sigx/lynx-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackHandler } from '../src/back-handler';
import { Linking } from '../src/linking';

/** GlobalEventEmitter stand-in that counts registrations *and* removals. */
function fakeEmitter() {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    /** Every removeListener call, so "the disposer is a no-op twice" is observable. */
    const removeCalls: string[] = [];
    return {
        listeners,
        removeCalls,
        count: (channel: string) => listeners.get(channel)?.size ?? 0,
        /** Dispatch like the real emitter: spread params, no per-handler try. */
        emit(channel: string, ...params: unknown[]) {
            for (const fn of [...(listeners.get(channel) ?? [])]) fn(...params);
        },
        addListener(name: string, fn: (...a: unknown[]) => void) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)!.add(fn);
        },
        removeListener(name: string, fn: (...a: unknown[]) => void) {
            removeCalls.push(name);
            listeners.get(name)?.delete(fn);
        },
    };
}

type Fake = ReturnType<typeof fakeEmitter>;

let emitter: Fake;
let records: LogRecord[];

function installLynx(e: Fake | undefined, opts: { throwOnGet?: boolean } = {}) {
    vi.stubGlobal('lynx', {
        getJSModule(name: string) {
            if (opts.throwOnGet) throw new Error('host is half-initialised');
            return name === 'GlobalEventEmitter' ? e : undefined;
        },
    });
}

beforeEach(() => {
    emitter = fakeEmitter();
    installLynx(emitter);
    // Own the transport list so the log assertions are about this file's
    // subscriptions and not about whatever else the run has going on.
    records = [];
    clearTransports();
    setLogLevel('trace');
    addTransport((r) => records.push(r));
});

afterEach(() => {
    vi.unstubAllGlobals();
    clearTransports();
});

describe('Linking.addEventListener("url")', () => {
    it('hands back a bare unsubscribe function, not a { remove() } object (C7)', () => {
        const off = Linking.addEventListener('url', vi.fn());
        expect(off).toBeTypeOf('function');
        expect((off as unknown as { remove?: unknown }).remove).toBeUndefined();
    });

    it('delivers the URL the publisher sent as a bare string', () => {
        // `sendGlobalEvent('urlReceived', [url])` reaches JS as the string
        // itself — not as JSON, which is why this channel cannot go through
        // core's subscribeNative today (see src/native-event.ts).
        const seen: string[] = [];
        Linking.addEventListener('url', ({ url }) => seen.push(url));

        emitter.emit('urlReceived', 'myapp://deep/link?a=1');

        expect(seen).toEqual(['myapp://deep/link?a=1']);
    });

    it('drops a payload that is not a usable URL instead of dispatching url: ""', () => {
        const cb = vi.fn();
        Linking.addEventListener('url', cb);

        emitter.emit('urlReceived', '');
        emitter.emit('urlReceived', undefined);
        emitter.emit('urlReceived', { url: 'myapp://obj' });
        emitter.emit('urlReceived', 42);

        expect(cb).not.toHaveBeenCalled();
    });

    it('does not starve the other listener when one disposer is called twice', () => {
        // An effect cleanup firing twice (unmount plus an explicit teardown)
        // is ordinary; C7 requires the second call to do nothing at all.
        const offA = Linking.addEventListener('url', vi.fn());
        const b = vi.fn();
        Linking.addEventListener('url', b);

        offA();
        offA();

        // The second call must not reach the emitter again — that is the
        // guard under test, and it is what a shared-resource teardown
        // (a reference count, a native "stop publishing" call) would ride on.
        expect(emitter.removeCalls).toEqual(['urlReceived']);
        expect(emitter.count('urlReceived')).toBe(1);
        emitter.emit('urlReceived', 'myapp://still-here');
        expect(b).toHaveBeenCalledWith({ url: 'myapp://still-here' });
    });

    it('stops delivering after unsubscribe', () => {
        const cb = vi.fn();
        const off = Linking.addEventListener('url', cb);

        emitter.emit('urlReceived', 'myapp://one');
        off();
        emitter.emit('urlReceived', 'myapp://two');

        expect(cb).toHaveBeenCalledTimes(1);
        expect(emitter.count('urlReceived')).toBe(0);
    });

    it('contains a throwing url listener instead of losing the deep link for its siblings', () => {
        // The regression. The url listener used to be invoked unguarded, so a
        // consumer that threw propagated out through the emitter's dispatch
        // loop and every subscriber registered behind it never saw the URL —
        // a deep link silently dropped by an unrelated component's bug.
        const other = vi.fn();
        Linking.addEventListener('url', () => {
            throw new Error('consumer bug');
        });
        Linking.addEventListener('url', other);

        expect(() => emitter.emit('urlReceived', 'myapp://deep')).not.toThrow();

        expect(other).toHaveBeenCalledWith({ url: 'myapp://deep' });
    });

    it('reports the throwing listener through the package logger, not console (C10)', () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        Linking.addEventListener('url', () => {
            throw new Error('consumer bug');
        });

        emitter.emit('urlReceived', 'myapp://deep');

        expect(records).toHaveLength(1);
        expect(records[0]!.namespace).toBe('lynx-linking');
        expect(records[0]!.level.name).toBe('warn');
        expect(records[0]!.msg).toBe('listener for urlReceived threw');
        expect(records[0]!.fields[0]).toBeInstanceOf(Error);
        expect(consoleWarn).not.toHaveBeenCalled();
        consoleWarn.mockRestore();
    });
});

describe('BackHandler.addEventListener', () => {
    it('hands back a bare unsubscribe function, not a { remove() } object (C7)', () => {
        const off = BackHandler.addEventListener(vi.fn());
        expect(off).toBeTypeOf('function');
        expect((off as unknown as { remove?: unknown }).remove).toBeUndefined();
    });

    it('fires on a press that carries no payload at all', () => {
        // Native sends `sendGlobalEvent(BACK_EVENT, JavaOnlyArray())`, so the
        // handler is called with zero arguments. Core's subscribeNative drops
        // an undefined payload before the callback, which is why this channel
        // stays on the local shim (see src/native-event.ts).
        const handled = vi.fn(() => true);
        BackHandler.addEventListener(handled);

        emitter.emit('hardwareBackPress');

        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('does not starve the other listener when one disposer is called twice', () => {
        const offA = BackHandler.addEventListener(vi.fn());
        const b = vi.fn();
        BackHandler.addEventListener(b);

        offA();
        offA();

        expect(emitter.removeCalls).toEqual(['hardwareBackPress']);
        expect(emitter.count('hardwareBackPress')).toBe(1);
        emitter.emit('hardwareBackPress');
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('contains a throwing back listener instead of taking down its siblings', () => {
        const other = vi.fn();
        BackHandler.addEventListener(() => {
            throw new Error('boom');
        });
        BackHandler.addEventListener(other);

        expect(() => emitter.emit('hardwareBackPress')).not.toThrow();

        expect(other).toHaveBeenCalledTimes(1);
    });
});

describe('no emitter', () => {
    it('is a safe no-op off-device, so callers never branch on availability', () => {
        vi.unstubAllGlobals();

        const offUrl = Linking.addEventListener('url', vi.fn());
        const offBack = BackHandler.addEventListener(vi.fn());

        expect(offUrl).toBeTypeOf('function');
        expect(() => {
            offUrl();
            offUrl();
            offBack();
        }).not.toThrow();
    });

    it('is a safe no-op when the host has no GlobalEventEmitter', () => {
        installLynx(undefined);

        expect(() => Linking.addEventListener('url', vi.fn())()).not.toThrow();
        expect(() => BackHandler.addEventListener(vi.fn())()).not.toThrow();
    });

    it('does not throw at the call site when getJSModule itself throws', () => {
        // A half-initialised host used to turn `addEventListener` into a throw
        // for the consumer: the emitter lookup was unguarded.
        installLynx(emitter, { throwOnGet: true });

        expect(() => Linking.addEventListener('url', vi.fn())()).not.toThrow();
        expect(() => BackHandler.addEventListener(vi.fn())()).not.toThrow();
    });

    it('survives a host whose removeListener throws', () => {
        const off = Linking.addEventListener('url', vi.fn());
        emitter.removeListener = () => {
            throw new Error('host teardown bug');
        };

        expect(() => off()).not.toThrow();
        expect(records.map((r) => r.msg)).toEqual(['removeListener for urlReceived threw']);
    });
});
