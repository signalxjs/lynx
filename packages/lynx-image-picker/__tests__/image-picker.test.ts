/**
 * Native image-picker surface — the path that ships on iOS and Android.
 *
 * Only the web shim was covered before. The point of these is the C4/C5 split
 * the native side gets wrong on its own: the launcher reports a failure as
 * `{ error, cancelled: true }`, which used to be indistinguishable from the
 * user tapping Cancel. A failure has to throw; a real dismiss has to keep
 * resolving `{ cancelled: true, assets: [] }`.
 *
 * These drive the real `@sigx/lynx-core` bridge against a faked
 * `NativeModules` global, so the callback convention is exercised rather than
 * mocked away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSigxError } from '@sigx/lynx-core';

import { ImagePicker } from '../src/image-picker';

/** Records what crossed the bridge, so call shape is asserted, not assumed. */
let calls: Array<{ method: string; args: unknown[] }>;

/**
 * Install a fake `ImagePicker` native module whose methods all resolve the
 * same payload — every method here takes `(…args, callback)`.
 */
function installNativeModules(replies: Record<string, unknown>) {
    const impl: Record<string, (...a: never[]) => unknown> = {};
    for (const [method, reply] of Object.entries(replies)) {
        impl[method] = (...args: never[]) => {
            const cb = args[args.length - 1] as unknown as (r: unknown) => void;
            calls.push({ method, args: args.slice(0, -1) });
            cb(reply);
        };
    }
    vi.stubGlobal('NativeModules', { ImagePicker: impl });
}

beforeEach(() => {
    calls = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('ImagePicker.pickImage', () => {
    it('resolves picked assets, prefixing iOS bare paths with file://', async () => {
        installNativeModules({
            pickImage: {
                cancelled: false,
                assets: [
                    { uri: '/var/mobile/picked/a.jpg', width: 4, height: 3, type: 'image' },
                    { uri: 'content://media/42', width: 1, height: 1, type: 'image' },
                ],
            },
        });
        const r = await ImagePicker.pickImage({ multiple: true, maxItems: 5 });
        expect(r).toEqual({
            cancelled: false,
            assets: [
                { uri: 'file:///var/mobile/picked/a.jpg', width: 4, height: 3, type: 'image' },
                { uri: 'content://media/42', width: 1, height: 1, type: 'image' },
            ],
        });
        expect(calls).toEqual([
            { method: 'pickImage', args: [{ multiple: true, maxItems: 5, selectionLimit: 5 }] },
        ]);
    });

    it('resolves cancelled when the user dismisses the picker (C5)', async () => {
        // The real dismiss: no `error` key. This must stay a value, not a
        // throw — it is the most common outcome in the app.
        installNativeModules({ pickImage: { cancelled: true, assets: [] } });
        await expect(ImagePicker.pickImage()).resolves.toEqual({ cancelled: true, assets: [] });
    });

    it('resolves cancelled for the legacy `canceled` spelling too', async () => {
        installNativeModules({ pickImage: { canceled: true } });
        await expect(ImagePicker.pickImage()).resolves.toEqual({ cancelled: true, assets: [] });
    });

    it.each([
        ['cancelled by new pickImage', 'a pick superseded by a newer one'],
        ['cancelled by new pickImages', 'a multi-pick superseded by a newer one'],
        ['activity destroyed', 'the host Activity going away underneath it'],
    ])('resolves cancelled for MediaCapture\'s %s sentinel', async (error) => {
        // Android tags these non-failure terminations with an `error` string
        // (`android/…/MediaCapture.kt` pickImage / pickImages / onDestroy)
        // while iOS resolves a plain `{ cancelled: true }`. Unwrapping first
        // would throw on Android for an outcome iOS calls a dismiss — the
        // exact per-platform divergence C5 exists to prevent.
        installNativeModules({ pickImage: { cancelled: true, assets: [], error } });
        await expect(ImagePicker.pickImage()).resolves.toEqual({ cancelled: true, assets: [] });
    });

    it('throws when the launcher is not registered', async () => {
        // MediaCapture's unregistered-launcher payload, verbatim: it sets
        // `cancelled: true` alongside `error`, which is exactly why reading
        // `cancelled` alone lost the failure — and why the sentinel check
        // above must not swallow it. The picker never opened.
        installNativeModules({
            pickImage: {
                cancelled: true,
                assets: [],
                error: 'MediaCapture not registered — @sigx/lynx-permissions normally wires this automatically',
            },
        });
        await expect(ImagePicker.pickImage()).rejects.toThrow(
            '[@sigx/lynx-image-picker] pickImage failed: MediaCapture not registered',
        );
    });

    it('throws a SigxError carrying code and the raw payload as cause', async () => {
        const payload = { cancelled: true, assets: [], error: 'launcher.launch failed' };
        installNativeModules({ pickImage: payload });
        const err = await ImagePicker.pickImage().catch((e: unknown) => e);
        expect(isSigxError(err)).toBe(true);
        expect(err).toMatchObject({ code: 'native_error', package: 'lynx-image-picker', cause: payload });
    });
});

describe('ImagePicker.pickVideo', () => {
    it('resolves cancelled when the user dismisses the picker (C5)', async () => {
        installNativeModules({ pickVideo: { cancelled: true, assets: [] } });
        await expect(ImagePicker.pickVideo()).resolves.toEqual({ cancelled: true, assets: [] });
    });

    it('throws on a native failure', async () => {
        installNativeModules({
            pickVideo: { cancelled: true, assets: [], error: 'no view controller available to present the picker' },
        });
        await expect(ImagePicker.pickVideo()).rejects.toThrow(
            '[@sigx/lynx-image-picker] pickVideo failed: no view controller available to present the picker',
        );
    });
});

describe('ImagePicker permissions', () => {
    it('resolves a denied status — a refusal is not a failure', async () => {
        installNativeModules({
            requestPermission: { status: 'denied', canAskAgain: false },
            getPermissionStatus: { status: 'denied', canAskAgain: false },
        });
        await expect(ImagePicker.requestPermission()).resolves.toEqual({
            status: 'denied',
            canAskAgain: false,
        });
        await expect(ImagePicker.getPermissionStatus()).resolves.toEqual({
            status: 'denied',
            canAskAgain: false,
        });
    });

    it('throws when the permission check itself fails', async () => {
        installNativeModules({
            requestPermission: { error: 'no activity attached' },
            getPermissionStatus: { error: 'no activity attached' },
        });
        await expect(ImagePicker.requestPermission()).rejects.toThrow(
            '[@sigx/lynx-image-picker] requestPermission failed: no activity attached',
        );
        await expect(ImagePicker.getPermissionStatus()).rejects.toThrow(
            '[@sigx/lynx-image-picker] getPermissionStatus failed: no activity attached',
        );
    });
});

describe('ImagePicker.isAvailable', () => {
    it('is false when the module is not linked', () => {
        vi.stubGlobal('NativeModules', {});
        expect(ImagePicker.isAvailable()).toBe(false);
    });
});
