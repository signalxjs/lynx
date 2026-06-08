/**
 * Haptics is best-effort feedback: the three feedback methods must NEVER throw
 * when the host has no `Haptics` native module (notably web / @lynx-js/web-core,
 * but also device builds that didn't bundle it). Callers routinely fire haptics
 * as the first line of an event handler (`Haptics.selection(); nav.push(...)`),
 * so a throw here would abort the rest of the handler — swallowing navigation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { Haptics } from '../src/haptics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Haptics graceful degradation', () => {
  it('no-ops (does not throw) when NativeModules is absent (e.g. web)', () => {
    // Explicitly force the web/unsupported case so the test never depends on
    // ambient global state another test file might leave behind.
    vi.stubGlobal('NativeModules', undefined);
    expect(() => Haptics.selection()).not.toThrow();
    expect(() => Haptics.impact('medium')).not.toThrow();
    expect(() => Haptics.notification('success')).not.toThrow();
    expect(Haptics.isAvailable()).toBe(false);
  });

  it('calls through to the native module when it is available', () => {
    const selection = vi.fn();
    const impact = vi.fn();
    const notification = vi.fn();
    vi.stubGlobal('NativeModules', {
      Haptics: { selection, impact, notification },
    });

    Haptics.selection();
    Haptics.impact('heavy');
    Haptics.notification('error');

    expect(selection).toHaveBeenCalledOnce();
    expect(impact).toHaveBeenCalledWith('heavy');
    expect(notification).toHaveBeenCalledWith('error');
    expect(Haptics.isAvailable()).toBe(true);
  });
});
