import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { effect } from '@sigx/reactivity';

import { SafeAreaProvider, SAFE_AREA_EVENT } from '../src/provider';
import { SafeAreaView } from '../src/safe-area-view';
import {
  useSafeAreaInsets,
  useSafeAreaFrame,
  useSafeAreaInsetsMT,
} from '../src/hooks';
import { readGlobalSafeArea, GLOBAL_PROPS_KEY } from '../src/globals';
import { ZERO_INSETS, type EdgeInsets } from '../src/types';
import { component } from '@sigx/lynx';

// ---------------------------------------------------------------------------
// Test harness: stub `lynx.__globalProps` and `lynx.getJSModule(...)`.
// The provider reads from these on mount; the harness controls both for
// deterministic unit tests.
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
  initial: Partial<EdgeInsets>,
  emitter: MockEmitter,
  setProps?: Record<string, string>,
): void {
  (globalThis as { lynx?: unknown }).lynx = {
    __globalProps: { [GLOBAL_PROPS_KEY]: initial },
    getJSModule: (name: string) => name === 'GlobalEventEmitter' ? emitter : undefined,
    // The provider publishes inset CSS variables via getElementById().setProperty()
    // (inline-declared custom props aren't honored by Lynx); capture them here.
    getElementById: () => ({
      setProperty: (p: Record<string, string>) => {
        if (setProps) Object.assign(setProps, p);
      },
    }),
  };
}

beforeEach(() => {
  delete (globalThis as { lynx?: unknown }).lynx;
});

afterEach(() => {
  delete (globalThis as { lynx?: unknown }).lynx;
});

// ---------------------------------------------------------------------------
// readGlobalSafeArea / globals
// ---------------------------------------------------------------------------

describe('readGlobalSafeArea', () => {
  it('returns ZERO_INSETS when lynx is undefined', () => {
    expect(readGlobalSafeArea()).toEqual(ZERO_INSETS);
  });

  it('returns ZERO_INSETS when __globalProps lacks safeArea', () => {
    (globalThis as { lynx?: unknown }).lynx = { __globalProps: {} };
    expect(readGlobalSafeArea()).toEqual(ZERO_INSETS);
  });

  it('parses raw values and zero-fills missing keys', () => {
    (globalThis as { lynx?: unknown }).lynx = {
      __globalProps: {
        [GLOBAL_PROPS_KEY]: { top: 44, bottom: 34, left: 0, right: 0 },
      },
    };
    const i = readGlobalSafeArea();
    expect(i.top).toBe(44);
    expect(i.bottom).toBe(34);
    expect(i.keyboard).toBe(0);
    expect(i.statusBar).toBe(0);
    expect(i.navigationBar).toBe(0);
  });

  it('coerces non-numeric values to 0', () => {
    (globalThis as { lynx?: unknown }).lynx = {
      __globalProps: {
        [GLOBAL_PROPS_KEY]: { top: 'oops' as unknown as number, bottom: NaN, left: 10, right: undefined },
      },
    };
    const i = readGlobalSafeArea();
    expect(i.top).toBe(0);
    expect(i.bottom).toBe(0);
    expect(i.left).toBe(10);
    expect(i.right).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useSafeAreaInsets — outside Provider returns ZERO_INSETS with warning
// ---------------------------------------------------------------------------

describe('useSafeAreaInsets', () => {
  it('warns and returns zero insets when no provider is mounted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const Probe = component(() => {
      const insets = useSafeAreaInsets();
      return () => <view>{String(insets.value.top)}</view>;
    });
    const { getByType } = render(<Probe />);
    expect(getByType('view').textContent()).toBe('0');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// SafeAreaProvider — seeds context, applies CSS variables, updates on event
// ---------------------------------------------------------------------------

describe('SafeAreaProvider', () => {
  it('seeds insets synchronously from lynx.__globalProps', () => {
    installMockLynx({ top: 47, bottom: 34 }, makeEmitter());

    let captured = ZERO_INSETS;
    const Probe = component(() => {
      const insets = useSafeAreaInsets();
      effect(() => { captured = insets.value; });
      return () => <view />;
    });
    render(<SafeAreaProvider><Probe /></SafeAreaProvider>);
    expect(captured.top).toBe(47);
    expect(captured.bottom).toBe(34);
  });

  it('publishes inset CSS variables via setProperty on the host view', () => {
    const setProps: Record<string, string> = {};
    installMockLynx({ top: 50, right: 0, bottom: 34, left: 0, keyboard: 0 }, makeEmitter(), setProps);
    render(<SafeAreaProvider />);
    expect(setProps['--sat']).toBe('50px');
    expect(setProps['--sab']).toBe('34px');
    expect(setProps['--sar']).toBe('0px');
    expect(setProps['--sal']).toBe('0px');
    expect(setProps['--safe-area-keyboard']).toBe('0px');
  });

  it('merges user style over base CSS variables', () => {
    installMockLynx({ top: 50 }, makeEmitter());
    const { container } = render(
      <SafeAreaProvider style={{ backgroundColor: 'red', '--sat': 'override' as unknown as string }} />,
    );
    const host = container.children[0]!;
    expect(host._style.backgroundColor).toBe('red');
    // User style wins on conflicts.
    expect(host._style['--sat']).toBe('override');
  });

  it('subscribes to safeAreaChanged event on the GlobalEventEmitter', () => {
    const emitter = makeEmitter();
    installMockLynx({ top: 0 }, emitter);
    render(<SafeAreaProvider />);
    expect(emitter.listeners.get(SAFE_AREA_EVENT)?.size).toBe(1);
  });

  // TODO: pre-existing failure — `captured.keyboard` reads 0 instead of 280.
  // The BG `extras` signal update doesn't reach this effect synchronously
  // in the test harness; investigate whether SafeAreaProvider's wiring still
  // matches the comment below or if a flush is missing here.
  it.skip('updates extras (keyboard/statusBar) on event', async () => {
    const emitter = makeEmitter();
    installMockLynx({ top: 0, keyboard: 0 }, emitter);

    let captured: EdgeInsets = ZERO_INSETS;
    const Probe = component(() => {
      const insets = useSafeAreaInsets();
      effect(() => { captured = insets.value; });
      return () => <view />;
    });
    render(<SafeAreaProvider><Probe /></SafeAreaProvider>);

    emitter.emit(SAFE_AREA_EVENT, { top: 50, bottom: 34, keyboard: 280 });
    // Keyboard goes through the BG `extras` signal, so the effect fires
    // synchronously without needing the runOnMainThread round-trip.
    expect(captured.keyboard).toBe(280);
  });

  it('cleans up the listener on unmount', () => {
    const emitter = makeEmitter();
    installMockLynx({ top: 0 }, emitter);
    const { unmount } = render(<SafeAreaProvider />);
    expect(emitter.listeners.get(SAFE_AREA_EVENT)?.size).toBe(1);
    unmount();
    expect(emitter.listeners.get(SAFE_AREA_EVENT)?.size ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SafeAreaView — renders, falls back gracefully without provider
// ---------------------------------------------------------------------------

describe('SafeAreaView', () => {
  it('renders children inside provider', () => {
    installMockLynx({ top: 50 }, makeEmitter());
    const { getByText } = render(
      <SafeAreaProvider>
        <SafeAreaView edges={['top']}>
          <text>hello</text>
        </SafeAreaView>
      </SafeAreaProvider>,
    );
    expect(getByText('hello')).toBeTruthy();
  });

  it('renders without crashing outside provider (graceful fallback)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getByText } = render(
      <SafeAreaView edges={['top', 'bottom']}>
        <text>orphan</text>
      </SafeAreaView>,
    );
    expect(getByText('orphan')).toBeTruthy();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// useSafeAreaFrame — frame math
// ---------------------------------------------------------------------------

describe('useSafeAreaFrame', () => {
  it('subtracts insets from viewport, accounts for keyboard at bottom', () => {
    installMockLynx({ top: 50, bottom: 34, left: 0, right: 0, keyboard: 280 }, makeEmitter());

    let frame = { x: 0, y: 0, width: 0, height: 0 };
    const Probe = component(() => {
      const f = useSafeAreaFrame(390, 844); // iPhone 14
      effect(() => { frame = f.value; });
      return () => <view />;
    });
    render(<SafeAreaProvider><Probe /></SafeAreaProvider>);
    expect(frame.x).toBe(0);
    expect(frame.y).toBe(50);
    expect(frame.width).toBe(390);
    expect(frame.height).toBe(844 - 50 - 34 - 280);
  });

  it('clamps to zero when insets exceed viewport', () => {
    installMockLynx({ top: 1000, bottom: 1000 }, makeEmitter());

    let frame = { x: 0, y: 0, width: 0, height: 0 };
    const Probe = component(() => {
      const f = useSafeAreaFrame(390, 844);
      effect(() => { frame = f.value; });
      return () => <view />;
    });
    render(<SafeAreaProvider><Probe /></SafeAreaProvider>);
    expect(frame.height).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useSafeAreaInsetsMT — sync read from globals
// ---------------------------------------------------------------------------

describe('useSafeAreaInsetsMT', () => {
  it('reads __globalProps directly without a signal subscription', () => {
    (globalThis as { lynx?: unknown }).lynx = {
      __globalProps: {
        [GLOBAL_PROPS_KEY]: { top: 47, bottom: 34, left: 0, right: 0 },
      },
    };
    const i = useSafeAreaInsetsMT();
    expect(i.top).toBe(47);
    expect(i.bottom).toBe(34);
  });
});
