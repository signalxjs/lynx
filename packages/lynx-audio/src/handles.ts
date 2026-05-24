import { callAsync } from '@sigx/lynx-core';
import { PLAYER_END_CHANNEL, RECORDER_METER_CHANNEL, subscribe } from './events.js';

const MODULE = 'Audio';

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

function unwrapVoid(result: { error?: string } | undefined): void {
    if (result && typeof result === 'object' && 'error' in result && result.error) {
        throw new Error(`[lynx-audio] ${result.error}`);
    }
}

export function makeAudioHandle(id: number): AudioHandle {
    return {
        get id() { return id; },
        pause: () => callAsync<{ error?: string }>(MODULE, 'pausePlayer', id).then(unwrapVoid),
        resume: () => callAsync<{ error?: string }>(MODULE, 'resumePlayer', id).then(unwrapVoid),
        stop: () => callAsync<{ error?: string }>(MODULE, 'stopPlayer', id).then(unwrapVoid),
        seek: (seconds: number) =>
            callAsync<{ error?: string }>(MODULE, 'seekPlayer', id, seconds).then(unwrapVoid),
        setVolume: (volume: number) =>
            callAsync<{ error?: string }>(MODULE, 'setPlayerVolume', id, volume).then(unwrapVoid),
        getStatus: () => callAsync<PlayerStatus>(MODULE, 'getPlayerStatus', id),
        onEnd: (cb: () => void) => subscribe<unknown>(PLAYER_END_CHANNEL(id), () => cb()),
    };
}

export function makeRecordingHandle(id: number): RecordingHandle {
    let meterListeners = 0;
    return {
        get id() { return id; },
        pause: () => callAsync<{ error?: string }>(MODULE, 'pauseRecording', id).then(unwrapVoid),
        resume: () => callAsync<{ error?: string }>(MODULE, 'resumeRecording', id).then(unwrapVoid),
        stop: async () => {
            const r = await callAsync<RecordingResult & { error?: string }>(
                MODULE,
                'stopRecording',
                id,
            );
            if (r && (r as { error?: string }).error) {
                throw new Error(`[lynx-audio] ${(r as { error: string }).error}`);
            }
            return { uri: r.uri, durationMs: r.durationMs, sizeBytes: r.sizeBytes };
        },
        onMeter: (cb: (m: MeterSample) => void) => {
            const unsub = subscribe<MeterSample>(RECORDER_METER_CHANNEL(id), (e) => {
                if (e) cb(e);
            });
            meterListeners += 1;
            if (meterListeners === 1) {
                void callAsync(MODULE, 'setMeterSubscribed', id, true);
            }
            return () => {
                meterListeners = Math.max(0, meterListeners - 1);
                if (meterListeners === 0) {
                    void callAsync(MODULE, 'setMeterSubscribed', id, false);
                }
                unsub();
            };
        },
    };
}
