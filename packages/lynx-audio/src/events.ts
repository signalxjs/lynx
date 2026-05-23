/**
 * Bridge for native → JS audio events (`onEnd`, `onMeter`).
 *
 * Native side posts to `GlobalEventEmitter` on per-id channels like
 * `__sigxAudioEnd:<id>` and `__sigxAudioMeter:<id>`. This module is the
 * thin JS adapter — same shape as `@sigx/lynx-notifications/src/push.ts`.
 */

interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

declare const lynx: unknown | undefined;

function emitter(): GlobalEventEmitterLike | undefined {
    if (typeof lynx === 'undefined') return undefined;
    const obj = lynx as unknown as LynxLike;
    return obj.getJSModule?.('GlobalEventEmitter');
}

function safeParse(s: string): unknown {
    try { return JSON.parse(s); } catch { return undefined; }
}

export function subscribe<T>(channel: string, cb: (event: T) => void): () => void {
    const e = emitter();
    if (!e) return () => {};
    const wrapped = (raw: unknown) => {
        // `raw === undefined` here would mean the native side delivered an
        // empty payload or a string we couldn't JSON.parse — neither is a
        // real event. Drop it instead of forwarding `undefined` to the
        // listener: handlers like `onEnd` would otherwise fire spuriously,
        // and typed `onMeter` callbacks would see a value that violates the
        // declared signature. Mirrors the notifications shim
        // (`packages/lynx-notifications/src/push.ts:64-72`).
        const event = (typeof raw === 'string' ? safeParse(raw) : raw) as T | undefined;
        if (event === undefined) return;
        try {
            cb(event);
        } catch (err) {
            console.warn(`[lynx-audio] listener for ${channel} threw:`, err);
        }
    };
    e.addListener(channel, wrapped);
    return () => e.removeListener(channel, wrapped);
}

export const PLAYER_END_CHANNEL = (id: number) => `__sigxAudioEnd:${id}`;
export const RECORDER_METER_CHANNEL = (id: number) => `__sigxAudioMeter:${id}`;
