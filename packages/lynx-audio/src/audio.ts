import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';
import {
    type AudioHandle,
    type RecordingHandle,
    makeAudioHandle,
    makeRecordingHandle,
} from './handles.js';

const MODULE = 'Audio';

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
            throw new Error(`[lynx-audio] play failed: ${r?.error ?? 'no id returned'}`);
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
            throw new Error(`[lynx-audio] preload failed: ${r?.error ?? 'unknown'}`);
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
            throw new Error(`[lynx-audio] startRecording failed: ${r?.error ?? 'no id returned'}`);
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

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
