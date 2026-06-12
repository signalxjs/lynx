/**
 * Unit tests for `mediaDevices.getUserMedia`, `MediaStreamTrack`,
 * `MediaStream`, and the `WebRTC` extras namespace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', async importOriginal => {
    const actual = await importOriginal<typeof import('@sigx/lynx-core')>();
    return {
        ...actual,
        callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
        guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
        isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
    };
});

(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: () => undefined,
};

const { MediaStream, MediaStreamTrack, mediaDevices } = await import('../src/media.js');
const { WebRTC, isWebRTCAvailable } = await import('../src/audio-output.js');
const { __internal } = await import('../src/events.js');

function callOf(method: string): unknown[] | undefined {
    return bridge.callAsync.mock.calls.find(c => c[1] === method);
}

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.guardModule.mockClear();
    bridge.isModuleAvailable.mockClear();
    bridge.isModuleAvailable.mockImplementation(() => true);
});

afterEach(() => {
    __internal.reset();
});

describe('mediaDevices.getUserMedia', () => {
    it('resolves a stream with one live audio track', async () => {
        bridge.callAsync.mockImplementationOnce(async () => ({ label: 'Built-in Microphone' }));
        const stream = await mediaDevices.getUserMedia({ audio: true });
        expect(stream.getAudioTracks()).toHaveLength(1);
        const track = stream.getAudioTracks()[0]!;
        expect(track.kind).toBe('audio');
        expect(track.label).toBe('Built-in Microphone');
        expect(track.readyState).toBe('live');
        expect(track.enabled).toBe(true);
        expect(track.remote).toBe(false);

        const call = callOf('getUserMedia')!;
        expect(typeof call[2]).toBe('number');
        expect(call[3]).toEqual({ audio: true });
    });

    it('maps a denied prompt to NotAllowedError, like browsers', async () => {
        bridge.callAsync.mockImplementationOnce(async () => ({
            error: 'Microphone permission not granted',
            errorName: 'NotAllowedError',
        }));
        await expect(mediaDevices.getUserMedia({ audio: true })).rejects.toMatchObject({
            name: 'NotAllowedError',
        });
    });

    it('rejects video constraints with NotSupportedError (v1 is audio-only)', async () => {
        await expect(mediaDevices.getUserMedia({ audio: true, video: true })).rejects.toMatchObject({
            name: 'NotSupportedError',
        });
        expect(callOf('getUserMedia')).toBeUndefined();
    });

    it('rejects empty constraints with TypeError', async () => {
        await expect(mediaDevices.getUserMedia({})).rejects.toThrow(TypeError);
    });
});

describe('MediaStreamTrack', () => {
    it('enabled setter bridges to setTrackEnabled and skips no-ops', () => {
        const track = new MediaStreamTrack(11, 'audio', 'mic', { remote: false });
        track.enabled = true; // already true — no bridge call
        expect(callOf('setTrackEnabled')).toBeUndefined();

        track.enabled = false;
        const call = callOf('setTrackEnabled')!;
        expect(call[2]).toBe(11);
        expect(call[3]).toBe(false);
        expect(track.enabled).toBe(false);
    });

    it('stop() ends the track once and releases the native capturer', () => {
        const track = new MediaStreamTrack(12, 'audio', 'mic', { remote: false });
        track.stop();
        expect(track.readyState).toBe('ended');
        expect(callOf('stopTrack')![2]).toBe(12);

        bridge.callAsync.mockClear();
        track.stop(); // idempotent
        expect(callOf('stopTrack')).toBeUndefined();
    });

    it('stop() does not fire ended (per W3C)', () => {
        const track = new MediaStreamTrack(13, 'audio', 'mic', { remote: false });
        const onended = vi.fn();
        track.onended = onended;
        track.stop();
        expect(onended).not.toHaveBeenCalled();
    });
});

describe('MediaStream', () => {
    it('groups tracks and filters by kind', () => {
        const a = new MediaStreamTrack(21, 'audio', 'mic', { remote: false });
        const stream = new MediaStream([a]);
        expect(stream.id).toMatch(/^stream-\d+$/);
        expect(stream.getTracks()).toEqual([a]);
        expect(stream.getAudioTracks()).toEqual([a]);
        expect(stream.getVideoTracks()).toEqual([]);

        stream.removeTrack(a);
        expect(stream.getTracks()).toEqual([]);

        stream.addTrack(a);
        stream.addTrack(a); // de-duped
        expect(stream.getTracks()).toHaveLength(1);
    });
});

describe('WebRTC extras', () => {
    it('setAudioOutput bridges the route and unwraps errors', async () => {
        await WebRTC.setAudioOutput('earpiece');
        expect(callOf('setAudioOutput')![2]).toBe('earpiece');

        bridge.callAsync.mockImplementationOnce(async () => ({ error: 'no audio device' }));
        await expect(WebRTC.setAudioOutput('speaker')).rejects.toThrow('no audio device');
    });

    it('exposes the camera/audio-style permission API', async () => {
        bridge.callAsync.mockImplementation(async () => ({ status: 'granted', canAskAgain: true }));
        const res = await WebRTC.requestPermission();
        expect(res.status).toBe('granted');
        expect(callOf('requestPermission')).toBeDefined();

        await WebRTC.getPermissionStatus();
        expect(callOf('getPermissionStatus')).toBeDefined();
    });

    it('reports module availability', () => {
        expect(isWebRTCAvailable()).toBe(true);
        expect(WebRTC.isAvailable()).toBe(true);
        bridge.isModuleAvailable.mockImplementation(() => false);
        expect(isWebRTCAvailable()).toBe(false);
    });
});
