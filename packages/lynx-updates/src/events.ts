/**
 * Native → JS event channel for the Updates module (same GlobalEventEmitter
 * pattern as `@sigx/lynx-background`'s `__sigxBackgroundFire`).
 *
 * Wire shape:
 *   { kind: 'progress', receivedBytes: number, totalBytes: number | null }
 *   { kind: 'foreground' }
 */

const EVENT_CHANNEL = '__sigxUpdatesEvent';

export type NativeUpdatesEvent =
    | { kind: 'progress'; receivedBytes: number; totalBytes: number | null }
    | { kind: 'foreground' };

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
    return (lynx as LynxLike).getJSModule?.('GlobalEventEmitter');
}

function safeParse(s: string): unknown {
    try { return JSON.parse(s); } catch { return undefined; }
}

function normalize(raw: unknown): NativeUpdatesEvent | undefined {
    const event = (typeof raw === 'string' ? safeParse(raw) : raw) as
        | Record<string, unknown>
        | undefined;
    if (!event || typeof event !== 'object') return undefined;
    if (event.kind === 'foreground') return { kind: 'foreground' };
    if (event.kind === 'progress' && typeof event.receivedBytes === 'number') {
        return {
            kind: 'progress',
            receivedBytes: event.receivedBytes,
            totalBytes: typeof event.totalBytes === 'number' && event.totalBytes >= 0
                ? event.totalBytes
                : null,
        };
    }
    return undefined;
}

export function addNativeUpdatesListener(
    cb: (event: NativeUpdatesEvent) => void,
): () => void {
    const e = emitter();
    if (!e) {
        // Web / test fallback — no native bridge; real delivery is on-device.
        return () => {};
    }
    const wrapped = (raw: unknown) => {
        const event = normalize(raw);
        if (!event) return;
        try {
            cb(event);
        } catch (err) {
            console.warn(`[updates] listener for ${EVENT_CHANNEL} threw:`, err);
        }
    };
    e.addListener(EVENT_CHANNEL, wrapped);
    return () => e.removeListener(EVENT_CHANNEL, wrapped);
}

export const __EVENT_CHANNEL_FOR_TESTS = EVENT_CHANNEL;
