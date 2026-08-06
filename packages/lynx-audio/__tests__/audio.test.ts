import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Audio } from '../src/audio';
import { INTERRUPTION_CHANNEL } from '../src/events';

let calls: Array<{ method: string; args: unknown[] }>;
let results: Record<string, unknown>;

function installAudio(present = true) {
    vi.stubGlobal(
        'NativeModules',
        present
            ? {
                  Audio: new Proxy(
                      {},
                      {
                          get: (_t, method: string) => (...args: unknown[]) => {
                              const cb = args[args.length - 1];
                              const rest = typeof cb === 'function' ? args.slice(0, -1) : args;
                              calls.push({ method, args: rest });
                              if (typeof cb === 'function') (cb as (r: unknown) => void)(results[method] ?? {});
                          },
                      },
                  ),
              }
            : {},
    );
}

beforeEach(() => {
    calls = [];
    results = {};
    installAudio();
});

afterEach(() => vi.unstubAllGlobals());

describe('Audio.play', () => {
    it('passes source and options, and hands back a handle for the native id', async () => {
        results['play'] = { id: 11, durationMs: 3000 };
        const player = await Audio.play('file:///clip.m4a', { volume: 0.5, loop: true });

        expect(calls[0]).toEqual({
            method: 'play',
            args: ['file:///clip.m4a', { volume: 0.5, loop: true }],
        });
        expect(player.id).toBe(11);
    });

    it('defaults options to an empty object (C9)', async () => {
        results['play'] = { id: 1 };
        await Audio.play('file:///clip.m4a');
        expect(calls[0]!.args).toEqual(['file:///clip.m4a', {}]);
    });

    it('throws with the scoped prefix and a branchable code when native fails', async () => {
        results['play'] = { error: 'decode failed' };
        await expect(Audio.play('file:///bad.m4a')).rejects.toMatchObject({
            code: 'play_failed',
            package: 'lynx-audio',
            message: '[@sigx/lynx-audio] play failed: decode failed',
        });
    });

    it('throws rather than returning a broken handle when no id comes back', async () => {
        // An id-less success would produce a handle addressing native player
        // `undefined`, and every later call on it would fail obscurely.
        results['play'] = { durationMs: 100 };
        await expect(Audio.play('file:///clip.m4a')).rejects.toThrow('no id returned');
    });
});

describe('Audio.preload', () => {
    it('returns the duration', async () => {
        results['preload'] = { durationMs: 2500 };
        await expect(Audio.preload('file:///clip.m4a')).resolves.toEqual({ durationMs: 2500 });
    });

    it('throws when the duration is missing', async () => {
        results['preload'] = {};
        await expect(Audio.preload('file:///clip.m4a')).rejects.toMatchObject({
            code: 'preload_failed',
        });
    });
});

describe('Audio.startRecording', () => {
    it('passes options and returns a recording handle', async () => {
        results['startRecording'] = { id: 4 };
        const rec = await Audio.startRecording({ format: 'wav', sampleRate: 48000 });

        expect(calls[0]).toEqual({
            method: 'startRecording',
            args: [{ format: 'wav', sampleRate: 48000 }],
        });
        expect(rec.id).toBe(4);
    });

    it('surfaces the native reason when a recording is already live', async () => {
        // One active recording per process — documented, and the only way a
        // caller learns which of the two attempts lost.
        results['startRecording'] = { error: 'recording already in progress' };
        await expect(Audio.startRecording()).rejects.toThrow(
            '[@sigx/lynx-audio] startRecording failed: recording already in progress',
        );
    });
});

describe('permissions (C6)', () => {
    it('passes the PermissionResponse through unchanged', async () => {
        results['requestPermission'] = { status: 'granted', canAskAgain: false };
        results['getPermissionStatus'] = { status: 'denied', canAskAgain: true };

        await expect(Audio.requestPermission()).resolves.toEqual({
            status: 'granted',
            canAskAgain: false,
        });
        await expect(Audio.getPermissionStatus()).resolves.toEqual({
            status: 'denied',
            canAskAgain: true,
        });
    });
});

describe('Audio.isAvailable (C2)', () => {
    it('is true when linked, false when not, and always synchronous', () => {
        expect(Audio.isAvailable()).toBe(true);
        installAudio(false);
        expect(Audio.isAvailable()).toBe(false);
        expect(typeof Audio.isAvailable()).toBe('boolean');
    });

    it('is false rather than throwing with no NativeModules at all', () => {
        vi.unstubAllGlobals();
        expect(Audio.isAvailable()).toBe(false);
    });
});

describe('when the native module is not linked (C3)', () => {
    beforeEach(() => installAudio(false));

    it('play rejects rather than hanging', async () => {
        await expect(Audio.play('file:///clip.m4a')).rejects.toThrow(
            /Module "Audio" is not available/,
        );
    });

    it('startRecording rejects', async () => {
        await expect(Audio.startRecording()).rejects.toThrow(/Module "Audio" is not available/);
    });
});

describe('Audio.subscribeInterruptions', () => {
    /** Fake GlobalEventEmitter so subscribeNative has something to attach to. */
    function installEmitter() {
        const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
        const emitter = {
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
        vi.stubGlobal('lynx', {
            getJSModule: (n: string) => (n === 'GlobalEventEmitter' ? emitter : undefined),
        });
        return emitter;
    }

    it('delivers began and ended', () => {
        const emitter = installEmitter();
        const cb = vi.fn();
        Audio.subscribeInterruptions(cb);

        emitter.emit(INTERRUPTION_CHANNEL, { type: 'began', shouldResume: false });
        emitter.emit(INTERRUPTION_CHANNEL, { type: 'ended', shouldResume: true });

        expect(cb).toHaveBeenNthCalledWith(1, { type: 'began', shouldResume: false });
        expect(cb).toHaveBeenNthCalledWith(2, { type: 'ended', shouldResume: true });
    });

    it('subscribes to the session-wide channel, not a per-id one', () => {
        // A recorder torn down *by* the interruption would miss a per-id event.
        const emitter = installEmitter();
        Audio.subscribeInterruptions(vi.fn());
        expect(emitter.count(INTERRUPTION_CHANNEL)).toBe(1);
    });

    it('drops a malformed payload rather than handing it to the listener', () => {
        const emitter = installEmitter();
        const cb = vi.fn();
        Audio.subscribeInterruptions(cb);

        emitter.emit(INTERRUPTION_CHANNEL, { type: 'sideways' });
        emitter.emit(INTERRUPTION_CHANNEL, {});
        expect(cb).not.toHaveBeenCalled();
    });

    it('parses a payload delivered as a JSON string', () => {
        const emitter = installEmitter();
        const cb = vi.fn();
        Audio.subscribeInterruptions(cb);

        emitter.emit(INTERRUPTION_CHANNEL, JSON.stringify({ type: 'began', shouldResume: false }));
        expect(cb).toHaveBeenCalledWith({ type: 'began', shouldResume: false });
    });

    it('unsubscribes, and is a no-op on a second call (C7)', () => {
        const emitter = installEmitter();
        const cb = vi.fn();
        const off = Audio.subscribeInterruptions(cb);

        off();
        expect(() => off()).not.toThrow();
        expect(emitter.count(INTERRUPTION_CHANNEL)).toBe(0);

        emitter.emit(INTERRUPTION_CHANNEL, { type: 'began', shouldResume: false });
        expect(cb).not.toHaveBeenCalled();
    });

    it('is a safe no-op off-device', () => {
        vi.unstubAllGlobals();
        expect(() => Audio.subscribeInterruptions(vi.fn())()).not.toThrow();
    });
});
