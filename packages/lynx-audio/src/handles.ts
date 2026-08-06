import { callAsync, createLogger, SigxError, unwrapNative, unwrapNativeVoid } from '@sigx/lynx-core';
import { PLAYER_END_CHANNEL, RECORDER_METER_CHANNEL, subscribe } from './events.js';

const MODULE = 'Audio';
const PKG = 'lynx-audio';
const log = createLogger(PKG);

export interface PlayerStatus {
    /** Current playback position in milliseconds. */
    positionMs: number;
    /** Total duration in milliseconds. 0 until the asset is loaded. */
    durationMs: number;
    /** True while actively playing (not paused/stopped). */
    playing: boolean;
}

export interface RecordingResult {
    /** File URI of the recorded audio. */
    uri: string;
    /** Total recorded duration in milliseconds. */
    durationMs: number;
    /** File size on disk in bytes. */
    sizeBytes: number;
}

export interface MeterSample {
    /** Peak power in linear scale 0..1. */
    peak: number;
    /** Average power in linear scale 0..1. */
    avg: number;
}

export interface AudioHandle {
    /** Native registry id. Exposed for debugging — don't pass between handles. */
    readonly id: number;
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<void>;
    seek(seconds: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    getStatus(): Promise<PlayerStatus>;
    /** Subscribe to playback completion. Returns an unsubscribe function. */
    onEnd(cb: () => void): () => void;
}

export interface RecordingHandle {
    readonly id: number;
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<RecordingResult>;
    /**
     * Subscribe to amplitude samples (peak/avg, linear 0..1) emitted ~10x/sec
     * by the native side while recording. Opt-in — metering only runs while
     * at least one listener is attached. Returns an unsubscribe function.
     */
    onMeter(cb: (m: MeterSample) => void): () => void;
}

/**
 * Unwrap a void native reply for `action`.
 *
 * The method name stays a literal at every `callAsync` site rather than being
 * threaded through a helper: `scripts/check-module-manifests.mjs` cross-checks
 * JS call sites against the manifest, Swift and Kotlin, and it can only see
 * literals. A tidier `voidCall(action, …)` wrapper hid all nine names and made
 * the gate report them as declared-but-uncalled — the drift it exists to catch.
 */
const voidReply = (action: string) => (r: { error?: string } | undefined) =>
    unwrapNativeVoid(PKG, action, r);

/**
 * Toggle native metering. Genuinely fire-and-forget — it's driven by listener
 * bookkeeping, not by a caller who could act on the result — but the rejection
 * still has to be swallowed explicitly.
 *
 * `callAsync` rejects when the module isn't linked, and an unhandled rejection
 * on this engine is a fatal main-thread exception, not a warning (see #863).
 * Metering is a nicety; failing to toggle it must never take the app down.
 */
function setMeterSubscribed(id: number, subscribed: boolean): void {
    callAsync(MODULE, 'setMeterSubscribed', id, subscribed).catch((err: unknown) => {
        log.warn(`setMeterSubscribed(${id}, ${subscribed}) failed`, err);
    });
}

export function makeAudioHandle(id: number): AudioHandle {
    return {
        get id() { return id; },
        pause: () =>
            callAsync<{ error?: string }>(MODULE, 'pausePlayer', id).then(voidReply('pausePlayer')),
        resume: () =>
            callAsync<{ error?: string }>(MODULE, 'resumePlayer', id).then(voidReply('resumePlayer')),
        stop: () =>
            callAsync<{ error?: string }>(MODULE, 'stopPlayer', id).then(voidReply('stopPlayer')),
        seek: (seconds: number) =>
            callAsync<{ error?: string }>(MODULE, 'seekPlayer', id, seconds).then(
                voidReply('seekPlayer'),
            ),
        setVolume: (volume: number) =>
            callAsync<{ error?: string }>(MODULE, 'setPlayerVolume', id, volume).then(
                voidReply('setPlayerVolume'),
            ),
        getStatus: async () => {
            const r = unwrapNative(
                PKG,
                'getPlayerStatus',
                await callAsync<Partial<PlayerStatus> & { error?: string }>(
                    MODULE,
                    'getPlayerStatus',
                    id,
                ),
            );
            // Normalize rather than assert: `callAsync<PlayerStatus>` only
            // declared the shape, so a malformed payload used to reach callers
            // as a PlayerStatus with `undefined` numbers in it.
            return {
                positionMs: typeof r?.positionMs === 'number' ? r.positionMs : 0,
                durationMs: typeof r?.durationMs === 'number' ? r.durationMs : 0,
                playing: r?.playing === true,
            };
        },
        onEnd: (cb: () => void) => subscribe<unknown>(PLAYER_END_CHANNEL(id), () => cb()),
    };
}

export function makeRecordingHandle(id: number): RecordingHandle {
    let meterListeners = 0;
    return {
        get id() { return id; },
        pause: () =>
            callAsync<{ error?: string }>(MODULE, 'pauseRecording', id).then(
                voidReply('pauseRecording'),
            ),
        resume: () =>
            callAsync<{ error?: string }>(MODULE, 'resumeRecording', id).then(
                voidReply('resumeRecording'),
            ),
        stop: async () => {
            const r = unwrapNative(
                PKG,
                'stopRecording',
                await callAsync<Partial<RecordingResult> & { error?: string }>(
                    MODULE,
                    'stopRecording',
                    id,
                ),
            );
            if (typeof r?.uri !== 'string') {
                // Previously this read `r.uri` straight off a payload only
                // checked for `.error`, so a malformed or absent result
                // surfaced as a TypeError on `undefined` instead of saying
                // what went wrong.
                throw new SigxError(
                    PKG,
                    'malformed_result',
                    `[@sigx/${PKG}] stopRecording returned no file URI`,
                    { cause: r },
                );
            }
            return {
                uri: r.uri,
                durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
                sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : 0,
            };
        },
        onMeter: (cb: (m: MeterSample) => void) => {
            const unsub = subscribe<MeterSample>(RECORDER_METER_CHANNEL(id), (e) => {
                if (e) cb(e);
            });
            meterListeners += 1;
            if (meterListeners === 1) {
                setMeterSubscribed(id, true);
            }
            // Each disposer decrements at most once (C7). Without this guard,
            // calling one listener's disposer twice — an ordinary double
            // effect-cleanup — drove the shared count to zero and switched
            // native metering off while other listeners were still subscribed,
            // silently starving them of samples.
            let released = false;
            return () => {
                if (released) return;
                released = true;
                meterListeners -= 1;
                if (meterListeners === 0) {
                    setMeterSubscribed(id, false);
                }
                unsub();
            };
        },
    };
}
