import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, waitForUpdate } from '@sigx/lynx-testing';
import { component } from '@sigx/lynx';

import { AppearanceProvider, FONT_SCALE_EVENT } from '../src/provider';
import { useFontScale, useFontScaleMT } from '../src/hooks';
import { readGlobalFontScale, FONT_SCALE_GLOBAL_KEY } from '../src/globals';

// ---------------------------------------------------------------------------
// Test harness: stub `lynx.__globalProps` and `lynx.getJSModule(...)` — same
// shape as lynx-safe-area's insets.test.tsx. The provider seeds from
// __globalProps on setup and subscribes to the (engine-fired)
// `onFontScaleChanged` event for live updates.
// ---------------------------------------------------------------------------

interface MockEmitter {
  listeners: Map<string, Set<(...a: unknown[]) => void>>;
  addListener: (name: string, fn: (...a: unknown[]) => void) => void;
  removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
  emit: (name: string, payload: unknown) => void;
}

function makeEmitter(): MockEmitter {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  return {
    listeners,
    addListener(name, fn) {
      let set = listeners.get(name);
      if (!set) { set = new Set(); listeners.set(name, set); }
      set.add(fn);
    },
    removeListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set) return;
      for (const fn of set) fn(payload);
    },
  };
}

function installMockLynx(
  fontScale: unknown,
  emitter: MockEmitter,
): void {
  (globalThis as { lynx?: unknown }).lynx = {
    __globalProps: fontScale === undefined ? {} : { [FONT_SCALE_GLOBAL_KEY]: fontScale },
    getJSModule: (name: string) => name === 'GlobalEventEmitter' ? emitter : undefined,
  };
}

beforeEach(() => {
  delete (globalThis as { lynx?: unknown }).lynx;
});

afterEach(() => {
  delete (globalThis as { lynx?: unknown }).lynx;
});

// ---------------------------------------------------------------------------
// readGlobalFontScale
// ---------------------------------------------------------------------------

describe('readGlobalFontScale', () => {
  it('returns null when lynx is undefined', () => {
    expect(readGlobalFontScale()).toBeNull();
  });

  it('returns null when __globalProps lacks fontScale', () => {
    (globalThis as { lynx?: unknown }).lynx = { __globalProps: {} };
    expect(readGlobalFontScale()).toBeNull();
  });

  it('parses { scale, os }', () => {
    (globalThis as { lynx?: unknown }).lynx = {
      __globalProps: { [FONT_SCALE_GLOBAL_KEY]: { scale: 1.5, os: 2.0 } },
    };
    expect(readGlobalFontScale()).toEqual({ scale: 1.5, os: 2.0 });
  });

  it('falls back os to scale when os is missing or bogus', () => {
    (globalThis as { lynx?: unknown }).lynx = {
      __globalProps: { [FONT_SCALE_GLOBAL_KEY]: { scale: 1.3 } },
    };
    expect(readGlobalFontScale()).toEqual({ scale: 1.3, os: 1.3 });

    (globalThis as { lynx?: unknown }).lynx = {
      __globalProps: { [FONT_SCALE_GLOBAL_KEY]: { scale: 1.3, os: 'huge' } },
    };
    expect(readGlobalFontScale()).toEqual({ scale: 1.3, os: 1.3 });
  });

  it('returns null for bogus scale values', () => {
    for (const scale of [0, -1, NaN, Infinity, 'big', null]) {
      (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: { [FONT_SCALE_GLOBAL_KEY]: { scale } },
      };
      expect(readGlobalFontScale()).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// useFontScaleMT — direct globalProps read
// ---------------------------------------------------------------------------

describe('useFontScaleMT', () => {
  it('returns 1 when unwired', () => {
    expect(useFontScaleMT()).toBe(1);
  });

  it('returns the published effective scale', () => {
    (globalThis as { lynx?: unknown }).lynx = {
      __globalProps: { [FONT_SCALE_GLOBAL_KEY]: { scale: 1.15, os: 1.15 } },
    };
    expect(useFontScaleMT()).toBe(1.15);
  });
});

// ---------------------------------------------------------------------------
// AppearanceProvider + useFontScale — seed + live updates
// ---------------------------------------------------------------------------

describe('useFontScale under AppearanceProvider', () => {
  function mountProbe() {
    let read: (() => number) | undefined;
    const Probe = component(() => {
      const scale = useFontScale();
      read = () => scale.value;
      return () => <view>{String(scale.value)}</view>;
    });
    render(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    return () => read!();
  }

  it('seeds from __globalProps and updates on onFontScaleChanged', async () => {
    const emitter = makeEmitter();
    installMockLynx({ scale: 1.3, os: 1.3 }, emitter);

    const read = mountProbe();
    await waitForUpdate();
    expect(read()).toBe(1.3);

    emitter.emit(FONT_SCALE_EVENT, { scale: 1.6 });
    await waitForUpdate();
    expect(read()).toBe(1.6);
  });

  it('defaults to 1 when the publisher is unwired', async () => {
    const emitter = makeEmitter();
    installMockLynx(undefined, emitter);

    const read = mountProbe();
    await waitForUpdate();
    expect(read()).toBe(1);
  });

  it('accepts a bare-number payload and ignores bogus payloads', async () => {
    const emitter = makeEmitter();
    installMockLynx({ scale: 1, os: 1 }, emitter);

    const read = mountProbe();
    await waitForUpdate();

    emitter.emit(FONT_SCALE_EVENT, 1.4);
    await waitForUpdate();
    expect(read()).toBe(1.4);

    for (const bogus of [{ scale: 0 }, { scale: -2 }, { scale: NaN }, 'wat', null, {}]) {
      emitter.emit(FONT_SCALE_EVENT, bogus);
    }
    await waitForUpdate();
    expect(read()).toBe(1.4);
  });

  it('rounds Float-widening noise to 3 decimals', async () => {
    const emitter = makeEmitter();
    installMockLynx({ scale: 1, os: 1 }, emitter);

    const read = mountProbe();
    await waitForUpdate();

    // Android's Configuration.fontScale is a Float; 1.15f widens to this.
    emitter.emit(FONT_SCALE_EVENT, { scale: 1.1499999761581421 });
    await waitForUpdate();
    expect(read()).toBe(1.15);
  });
});
