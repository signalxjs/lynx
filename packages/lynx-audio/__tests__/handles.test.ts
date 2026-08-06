/**
 * Player and recorder handles — the package had no tests at all, despite two
 * handle types that each own a native resource and a subscription.
 *
 * The metering reference-count test is the one that matters: it fails against
 * the previous implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeAudioHandle, makeRecordingHandle } from '../src/handles';
import { RECORDER_METER_CHANNEL } from '../src/events';

let calls: Array<{ method: string; args: unknown[] }>;
/** Per-method result the fake native module resolves. */
let results: Record<string, unknown>;

/** Fake GlobalEventEmitter so subscribeNative has something to attach to. */
function fakeEmitter() {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    return {
        count: (c: string) => listeners.get(c)?.size ?? 0,
        emit: (c: string, p: unknown) => [...(listeners.get(c) ?? [])].forEach((f) => f(p)),
        addListener(name: string, fn: (...a: unknown[]) => void) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)!.add(fn);
        },
        removeListener(name: string, fn: (...a: unknown[]) => void) {
            listeners.get(name)?.delete(fn);
        },
    };
}
let emitter: ReturnType<typeof fakeEmitter>;

beforeEach(() => {
    calls = [];
    results = {};
    emitter = fakeEmitter();
    vi.stubGlobal('lynx', { getJSModule: (n: string) => (n === 'GlobalEventEmitter' ? emitter : undefined) });
    vi.stubGlobal('NativeModules', {
        Audio: new Proxy(
            {},
            {
                get: (_t, method: string) => (...args: unknown[]) => {
                    const cb = args[args.length - 1];
                    const rest = typeof cb === 'function' ? args.slice(0, -1) : args;
                    calls.push({ method, args: rest });
                    if (typeof cb === 'function') {
                        (cb as (r: unknown) => void)(results[method] ?? {});
                    }
                },
            },
        ),
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('AudioHandle', () => {
    it('routes each control to its native method with the player id', async () => {
        const h = makeAudioHandle(7);
        await h.pause();
        await h.resume();
        await h.seek(1.5);
        await h.setVolume(0.25);
        await h.stop();

        expect(calls).toEqual([
            { method: 'pausePlayer', args: [7] },
            { method: 'resumePlayer', args: [7] },
            { method: 'seekPlayer', args: [7, 1.5] },
            { method: 'setPlayerVolume', args: [7, 0.25] },
            { method: 'stopPlayer', args: [7] },
        ]);
    });

    it('rejects with the scoped prefix when native reports an error', async () => {
        results['pausePlayer'] = { error: 'no such player' };
        await expect(makeAudioHandle(7).pause()).rejects.toThrow(
            '[@sigx/lynx-audio] pausePlayer failed: no such player',
        );
    });

    it('normalizes a malformed getStatus payload instead of passing it through', async () => {
        // `callAsync<PlayerStatus>` only declared the shape — callers used to
        // receive `undefined` where numbers were promised.
        results['getPlayerStatus'] = { positionMs: 'nope' };
        await expect(makeAudioHandle(1).getStatus()).resolves.toEqual({
            positionMs: 0,
            durationMs: 0,
            playing: false,
        });
    });

    it('reports a real status unchanged', async () => {
        results['getPlayerStatus'] = { positionMs: 120, durationMs: 5000, playing: true };
        await expect(makeAudioHandle(1).getStatus()).resolves.toEqual({
            positionMs: 120,
            durationMs: 5000,
            playing: true,
        });
    });

    it('fires onEnd and stops after unsubscribe', () => {
        const h = makeAudioHandle(3);
        const cb = vi.fn();
        const off = h.onEnd(cb);

        emitter.emit('__sigxAudioEnd:3', {});
        expect(cb).toHaveBeenCalledTimes(1);

        off();
        emitter.emit('__sigxAudioEnd:3', {});
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

describe('RecordingHandle.stop', () => {
    it('returns the recording result', async () => {
        results['stopRecording'] = { uri: 'file:///a.m4a', durationMs: 1200, sizeBytes: 4096 };
        await expect(makeRecordingHandle(2).stop()).resolves.toEqual({
            uri: 'file:///a.m4a',
            durationMs: 1200,
            sizeBytes: 4096,
        });
    });

    it('defaults missing numbers rather than reporting undefined', async () => {
        results['stopRecording'] = { uri: 'file:///a.m4a' };
        await expect(makeRecordingHandle(2).stop()).resolves.toEqual({
            uri: 'file:///a.m4a',
            durationMs: 0,
            sizeBytes: 0,
        });
    });

    it('says what went wrong when the payload has no URI', async () => {
        // Previously this read `.uri` off a payload checked only for `.error`,
        // so a malformed result surfaced as a TypeError on undefined.
        results['stopRecording'] = {};
        await expect(makeRecordingHandle(2).stop()).rejects.toThrow(
            '[@sigx/lynx-audio] stopRecording returned no file URI',
        );
    });

    it('propagates a native error with the scoped prefix', async () => {
        results['stopRecording'] = { error: 'disk full' };
        await expect(makeRecordingHandle(2).stop()).rejects.toThrow(
            '[@sigx/lynx-audio] stopRecording failed: disk full',
        );
    });
});

describe('RecordingHandle.onMeter', () => {
    const channel = RECORDER_METER_CHANNEL(5);
    const meterCalls = () => calls.filter((c) => c.method === 'setMeterSubscribed');

    it('turns native metering on for the first listener only', () => {
        const h = makeRecordingHandle(5);
        h.onMeter(vi.fn());
        h.onMeter(vi.fn());

        expect(meterCalls()).toEqual([{ method: 'setMeterSubscribed', args: [5, true] }]);
    });

    it('turns it off only when the last listener leaves', () => {
        const h = makeRecordingHandle(5);
        const offA = h.onMeter(vi.fn());
        const offB = h.onMeter(vi.fn());

        offA();
        expect(meterCalls()).toHaveLength(1); // still on — B is listening

        offB();
        expect(meterCalls()).toEqual([
            { method: 'setMeterSubscribed', args: [5, true] },
            { method: 'setMeterSubscribed', args: [5, false] },
        ]);
    });

    it('does not starve other listeners when one disposer is called twice', () => {
        // The regression. An effect cleanup firing twice is ordinary, and the
        // old disposer decremented the shared count each time — driving it to
        // zero and switching native metering off while B was still subscribed.
        const h = makeRecordingHandle(5);
        const offA = h.onMeter(vi.fn());
        const onMeterB = vi.fn();
        h.onMeter(onMeterB);

        offA();
        offA();

        expect(meterCalls()).toEqual([{ method: 'setMeterSubscribed', args: [5, true] }]);
        emitter.emit(channel, { peak: 0.5, avg: 0.2 });
        expect(onMeterB).toHaveBeenCalledWith({ peak: 0.5, avg: 0.2 });
    });

    it('delivers samples and stops after unsubscribe', () => {
        const h = makeRecordingHandle(5);
        const cb = vi.fn();
        const off = h.onMeter(cb);

        emitter.emit(channel, { peak: 0.9, avg: 0.4 });
        expect(cb).toHaveBeenCalledWith({ peak: 0.9, avg: 0.4 });

        off();
        expect(emitter.count(channel)).toBe(0);
        emitter.emit(channel, { peak: 0.1, avg: 0.1 });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('handles the metering toggle rejection instead of leaving it unhandled', async () => {
        // setMeterSubscribed is fire-and-forget, but callAsync rejects when the
        // module isn't linked — and on this engine an unhandled rejection is a
        // fatal main-thread exception rather than a warning (#863). Metering is
        // a nicety; failing to toggle it must not take the app down.
        //
        // Asserted through the logger rather than process.on('unhandledRejection'):
        // that listener is global, so in a parallel run another file's rejection
        // decides whether this passes. Observing the catch directly is both
        // deterministic and the stronger claim — it proves the failure is
        // reported (C10), not merely swallowed.
        const { addTransport, clearTransports, setLogLevel } = await import('@sigx/lynx-core');
        const records: string[] = [];
        clearTransports();
        setLogLevel('trace');
        addTransport((r) => records.push(`${r.namespace}:${r.msg}`));

        vi.stubGlobal('NativeModules', {}); // module gone — callAsync will reject
        const off = makeRecordingHandle(9).onMeter(vi.fn());
        off();
        await new Promise((r) => setTimeout(r, 0));

        clearTransports();

        expect(records).toEqual([
            'lynx-audio:setMeterSubscribed(9, true) failed',
            'lynx-audio:setMeterSubscribed(9, false) failed',
        ]);
    });

    it('parses a sample delivered as a JSON string', () => {
        // The native bridge sends either shape; core's subscribeNative handles
        // it, which is half the reason this package stopped hand-rolling one.
        const cb = vi.fn();
        makeRecordingHandle(5).onMeter(cb);

        emitter.emit(channel, JSON.stringify({ peak: 0.3, avg: 0.1 }));
        expect(cb).toHaveBeenCalledWith({ peak: 0.3, avg: 0.1 });
    });
});
