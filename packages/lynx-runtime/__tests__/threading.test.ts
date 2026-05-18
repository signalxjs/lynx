/**
 * runOnMainThread bridge payload shape — regression test for the bug where
 * `_c` was dropped on the BG side, so worklet bodies that destructured
 * captured worklet/SV placeholders saw `undefined` and silently no-op'd.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runOnMainThread } from '../src/threading';
import { useSharedValue } from '../src/animated/shared-value';
import { resetOpQueue } from '../src/op-queue';

describe('runOnMainThread bridge payload', () => {
  let received: unknown[] = [];

  beforeEach(() => {
    received = [];
    resetOpQueue();
    // Same-thread fallback path: install sigxRunOnMT on globalThis.
    (globalThis as Record<string, unknown>)['sigxRunOnMT'] = (
      payload: unknown,
      callback?: (r: unknown) => void,
    ) => {
      received.push(payload);
      if (callback) callback(undefined);
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['sigxRunOnMT'];
  });

  it('ships wkltId + args + sanitized captured map', async () => {
    const sv = useSharedValue(7);
    // Simulate the post-SWC placeholder shape — `_c` references a nested
    // worklet placeholder for `withSpring` and the live SharedValue for `sv`.
    const placeholder = {
      _wkltId: 'test:wklt:1',
      _c: {
        sv,
        withSpring: { _wkltId: 'motion:withSpring:1', _c: {} },
      },
    };

    const handle = runOnMainThread(placeholder as unknown as Parameters<typeof runOnMainThread>[0]);
    await handle();

    expect(received).toHaveLength(1);
    const payload = received[0] as { wkltId: string; args: unknown[]; captured?: Record<string, unknown> };
    expect(payload.wkltId).toBe('test:wklt:1');
    expect(payload.args).toEqual([]);
    expect(payload.captured).toBeDefined();
    // SharedValue (a MainThreadRef) is converted to its plain placeholder
    // so it survives JSON.stringify across the Lynx host bridge.
    expect(payload.captured!['sv']).toEqual({ _wvid: sv._wvid, _initValue: { value: 7 } });
    // Nested worklet placeholders pass through unchanged — they're already
    // plain JSON-serializable objects.
    expect(payload.captured!['withSpring']).toEqual({
      _wkltId: 'motion:withSpring:1',
      _c: {},
    });
  });

  it('forwards args to the bridge call', async () => {
    const placeholder = { _wkltId: 'noargs:1', _c: undefined };
    const handle = runOnMainThread(placeholder as unknown as Parameters<typeof runOnMainThread>[0]);
    await handle(1, 'two', { three: 3 });

    const payload = received[0] as { wkltId: string; args: unknown[] };
    expect(payload.args).toEqual([1, 'two', { three: 3 }]);
  });

  it('omits captured when the placeholder has no _c', async () => {
    const placeholder = { _wkltId: 'noargs:2' };
    const handle = runOnMainThread(placeholder as unknown as Parameters<typeof runOnMainThread>[0]);
    await handle();

    const payload = received[0] as { captured?: Record<string, unknown> };
    expect(payload.captured).toBeUndefined();
  });

  it('falls back to local execution when given a raw function (no transform)', async () => {
    const fn = vi.fn((n: number) => n * 2);
    const handle = runOnMainThread(fn);
    const result = await handle(21);
    expect(fn).toHaveBeenCalledWith(21);
    expect(result).toBe(42);
    // Did NOT route through the bridge.
    expect(received).toHaveLength(0);
  });
});
