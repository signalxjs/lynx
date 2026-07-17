/** Web image-picker shim — maps sigx.picker.pick host files to picker assets. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ImagePicker } from '../src/image-picker.web';

let calls: Array<{ name: string; data: unknown }>;
let files: unknown[];

beforeEach(() => {
  calls = [];
  files = [];
  vi.stubGlobal('NativeModules', {
    bridge: {
      call: (name: string, data: unknown, cb: (r: unknown) => void) => {
        calls.push({ name, data });
        cb({ ok: true, value: files });
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('ImagePicker (web)', () => {
  it('pickImage maps host files to assets with dimensions and type', async () => {
    files = [
      { uri: 'blob:a', name: 'cat.png', size: 123, mimeType: 'image/png', width: 640, height: 480 },
      { uri: 'blob:b', name: 'clip.mp4', size: 999, mimeType: 'video/mp4' },
    ];
    const r = await ImagePicker.pickImage({ multiple: true });
    expect(r.cancelled).toBe(false);
    expect(r.assets).toEqual([
      { uri: 'blob:a', width: 640, height: 480, type: 'image', fileSize: 123, fileName: 'cat.png' },
      { uri: 'blob:b', width: 0, height: 0, type: 'video', fileSize: 999, fileName: 'clip.mp4' },
    ]);
    expect(calls[0]).toEqual({
      name: 'sigx.picker.pick',
      data: { accept: 'image/*', multiple: true },
    });
  });

  it('mediaType steers the accept filter; pickVideo forces video/*', async () => {
    await ImagePicker.pickImage({ mediaType: 'mixed' });
    await ImagePicker.pickVideo();
    expect(calls.map((c) => (c.data as { accept: string }).accept)).toEqual([
      'image/*,video/*',
      'video/*',
    ]);
  });

  it('an empty selection reports cancelled', async () => {
    const r = await ImagePicker.pickImage();
    expect(r).toEqual({ cancelled: true, assets: [] });
  });

  it('permissions resolve granted (browser picker grants per-pick)', async () => {
    await expect(ImagePicker.requestPermission()).resolves.toEqual({
      status: 'granted',
      canAskAgain: true,
    });
    await expect(ImagePicker.getPermissionStatus()).resolves.toMatchObject({ status: 'granted' });
  });
});
