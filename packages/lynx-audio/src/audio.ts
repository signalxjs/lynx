import { callAsync, isModuleAvailable, SigxError } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';
import {
    type AudioHandle,
    type RecordingHandle,
    makeAudioHandle,
    makeRecordingHandle,
} from './handles.js';
import { INTERRUPTION_CHANNEL, subscribe } from './events.js';

const MODULE = 'Audio';
const PKG = 'lynx-audio';

export interface PlayOptions {
    /** Initial volume 0..1. Default: 1. */
    volume?: number;
    /** Loop indefinitely. Default: false. */
    loop?: boolean;
    /** Playback rate (1 = normal). Default: 1. */
    rate?: number;
}

export interface RecordOptions {
    /** Absolute file path to write to. Default: temp dir + uuid. */
    outputPath?: string;
    /** Container format. Default: 'm4a'. */
    format?: 'm4a' | 'wav';
    /** Sample rate in Hz. Default: 44100. */
    sampleRate?: number;
    /** Channel count. Default: 1 (mono). */
    channels?: 1 | 2;
}

/**
 * A session interruption — a call, an alarm, or another app taking the audio
 * session.
 */
export interface AudioInterruption {
    /** `'began'` when audio was taken away, `'ended'` when it came back. */
    type: 'began' | 'ended';
    /**
     * Whether the system considers it appropriate to start again. Only
     * meaningful on `'ended'`, and it is advice rather than permission — the
     * app still decides.
     */
    shouldResume: boolean;
}

export type AudioInterruptionListener = (event: AudioInterruption) => void;

function isInterruption(raw: unknown): raw is AudioInterruption {
    const e = raw as AudioInterruption | undefined;
    // `shouldResume` is checked too: a listener typed `(e: AudioInterruption)`
    // must be able to read `e.shouldResume` as a boolean, and a payload with
    // only `type` would hand it `undefined`.
    return (e?.type === 'began' || e?.type === 'ended') && typeof e.shouldResume === 'boolean';
}

interface PlayResult {
    id?: number;
    durationMs?: number;
    error?: string;
}

interface RecordStartResult {
    id?: number;
    error?: string;
}

interface PreloadResult {
    durationMs?: number;
    error?: string;
}

/**
 * Audio recording & playback APIs.
 *
 * @example
 * ```ts
 * import { Audio } from '@sigx/lynx-audio';
 *
 * const player = await Audio.play('file:///tmp/clip.m4a');
 * player.onEnd(() => console.log('done'));
 *
 * const rec = await Audio.startRecording();
 * // ...later
 * const { uri } = await rec.stop();
 * ```
 */
export const Audio = {
    /**
     * Start playing the audio at `source`. Each call allocates a fresh
     * native player so multiple handles can play concurrently.
     *
     * @param source File URI (`file://...`) or remote URL.
     */
    async play(source: string, options: PlayOptions = {}): Promise<AudioHandle> {
        const r = await callAsync<PlayResult>(MODULE, 'play', source, options);
        if (r?.error || typeof r?.id !== 'number') {
            throw new SigxError(PKG, 'play_failed',
                `[@sigx/${PKG}] play failed: ${r?.error ?? 'no id returned'}`, { cause: r });
        }
        return makeAudioHandle(r.id);
    },

    /**
     * Decode the asset at `source` and return its duration without playing.
     * Useful to avoid first-play latency on UI sound effects.
     */
    async preload(source: string): Promise<{ durationMs: number }> {
        const r = await callAsync<PreloadResult>(MODULE, 'preload', source);
        if (r?.error || typeof r?.durationMs !== 'number') {
            throw new SigxError(PKG, 'preload_failed',
                `[@sigx/${PKG}] preload failed: ${r?.error ?? 'unknown'}`, { cause: r });
        }
        return { durationMs: r.durationMs };
    },

    /**
     * Begin a new recording. One active recording per process; calling this
     * while another is live rejects with an error.
     */
    async startRecording(options: RecordOptions = {}): Promise<RecordingHandle> {
        const r = await callAsync<RecordStartResult>(MODULE, 'startRecording', options);
        if (r?.error || typeof r?.id !== 'number') {
            throw new SigxError(PKG, 'record_start_failed',
                `[@sigx/${PKG}] startRecording failed: ${r?.error ?? 'no id returned'}`, { cause: r });
        }
        return makeRecordingHandle(r.id);
    },

    /** Request microphone permission, showing the OS dialog if needed. */
    requestPermission(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'requestPermission');
    },

    /** Check current microphone permission status without prompting. */
    getPermissionStatus(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'getPermissionStatus');
    },

    /**
     * Subscribe to audio-session interruptions — a phone call, an alarm, or
     * another app taking the session. Returns an unsubscribe function (C7);
     * calling it twice is a no-op.
     *
     * Session-wide rather than per handle: the interruption is a fact about
     * the session, and a recorder torn down *by* the interruption would
     * otherwise miss its own notification.
     *
     * A permanent loss reports `'began'` with no matching `'ended'` — accurate,
     * because the session isn't coming back on its own. Don't block on
     * `'ended'` arriving.
     *
     * Off-device this is a safe no-op, so it can be called unconditionally.
     *
     * @example
     * ```ts
     * const off = Audio.subscribeInterruptions(async (e) => {
     *     if (e.type === 'began') {
     *         const { uri } = await rec.stop();   // salvage what was recorded
     *     } else if (e.shouldResume) {
     *         player.resume();
     *     }
     * });
     * ```
     */
    subscribeInterruptions(cb: AudioInterruptionListener): () => void {
        return subscribe<AudioInterruption>(INTERRUPTION_CHANNEL, (e) => {
            // Guarded: a malformed payload would otherwise reach a listener
            // typed `(e: AudioInterruption) => void` as something else.
            if (isInterruption(e)) cb(e);
        });
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
