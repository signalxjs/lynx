/** Web file-picker shim — maps sigx.picker.pick host files to picker assets. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FilePicker } from '../src/file-picker.web';

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

describe('FilePicker (web)', () => {
  it('pick maps host files and preserves the FormData asset contract', async () => {
    files = [
      { uri: 'blob:doc', name: 'report.pdf', size: 4321, mimeType: 'application/pdf' },
      { uri: 'blob:x', name: '', size: -1, mimeType: '' },
    ];
    const r = await FilePicker.pick({ types: ['application/pdf', ''], multiple: true });
    expect(r.cancelled).toBe(false);
    expect(r.assets).toEqual([
      { uri: 'blob:doc', name: 'report.pdf', mimeType: 'application/pdf', size: 4321 },
      { uri: 'blob:x', name: 'file', mimeType: 'application/octet-stream', size: 0 },
    ]);
    // empty type strings are filtered before reaching the host
    expect(calls[0]).toEqual({
      name: 'sigx.picker.pick',
      data: { accept: 'application/pdf', multiple: true },
    });
  });

  it('an empty selection reports cancelled', async () => {
    await expect(FilePicker.pick()).resolves.toEqual({ cancelled: true, assets: [] });
  });
});
