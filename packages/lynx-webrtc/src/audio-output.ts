/**
 * Non-W3C extras: audio output routing and the repo-idiomatic permission
 * API (mirrors `Camera` / `Audio` so apps can show a pre-prompt explainer
 * before the first `getUserMedia` call).
 */
import { callAsync, guardModule, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';
import { MODULE, unwrap } from './events.js';
import type { AudioOutputRoute } from './types.js';

export const WebRTC = {
    /**
     * Route call audio to the loudspeaker or the earpiece. The default
     * route while a peer connection is live is the speaker.
     */
    async setAudioOutput(route: AudioOutputRoute): Promise<void> {
        guardModule(MODULE);
        unwrap(await callAsync(MODULE, 'setAudioOutput', route));
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

/** Whether the native WebRTC module is registered in this build. */
export function isWebRTCAvailable(): boolean {
    return isModuleAvailable(MODULE);
}
