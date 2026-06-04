import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { effect } from '@sigx/reactivity';
import { component } from '@sigx/lynx';
import { SafeAreaProvider, GLOBAL_PROPS_KEY } from '@sigx/lynx-safe-area';

import { useKeyboard, useKeyboardLift } from '../src/use-keyboard';
import { KeyboardAvoidingView } from '../src/keyboard-avoiding-view';
import { KeyboardStickyView } from '../src/keyboard-sticky-view';
import type { KeyboardState } from '../src/types';

// ---------------------------------------------------------------------------
// Test harness: stub `lynx.__globalProps` so SafeAreaProvider seeds the
// insets (incl. keyboard) synchronously on mount — same approach as
// lynx-safe-area's insets.test.tsx. Live `safeAreaChanged` updates of the
// keyboard inset don't propagate synchronously in the harness (see the
// skipped extras test there), so these tests exercise the seeded paths.
// ---------------------------------------------------------------------------

function installMockLynx(initial: Record<string, number>): void {
  (globalThis as { lynx?: unknown }).lynx = {
    __globalProps: { [GLOBAL_PROPS_KEY]: initial },
    getJSModule: () => undefined,
    // Return a setProperty stub (not null): SafeAreaProvider treats a null
    // host as "not yet queryable" and schedules ~30 setTimeout retries per
    // render to push its CSS variables — needless timer churn in tests.
    getElementById: () => ({ setProperty: () => undefined }),
  };
}

beforeEach(() => {
  delete (globalThis as { lynx?: unknown }).lynx;
});

afterEach(() => {
  delete (globalThis as { lynx?: unknown }).lynx;
});

// ---------------------------------------------------------------------------
// useKeyboard
// ---------------------------------------------------------------------------

describe('useKeyboard', () => {
  it('reports hidden when the keyboard inset is 0', () => {
    installMockLynx({ top: 47, bottom: 34, keyboard: 0 });

    let captured: KeyboardState = { height: -1, visible: true };
    const Probe = component(() => {
      const kb = useKeyboard();
      effect(() => { captured = kb.value; });
      return () => <view />;
    });
    render(<SafeAreaProvider><Probe /></SafeAreaProvider>);
    expect(captured.height).toBe(0);
    expect(captured.visible).toBe(false);
  });

  it('reports height + visible when the keyboard inset is set', () => {
    installMockLynx({ top: 47, bottom: 34, keyboard: 280 });

    let captured: KeyboardState = { height: -1, visible: false };
    const Probe = component(() => {
      const kb = useKeyboard();
      effect(() => { captured = kb.value; });
      return () => <view />;
    });
    render(<SafeAreaProvider><Probe /></SafeAreaProvider>);
    expect(captured.height).toBe(280);
    expect(captured.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useKeyboardLift — the max(0, keyboard - bottom + offset) math
// ---------------------------------------------------------------------------

describe('useKeyboardLift', () => {
  function liftWith(
    insets: Record<string, number>,
    discountBottomInset?: boolean,
    offset?: number,
  ): number {
    installMockLynx(insets);
    let captured = -1;
    const Probe = component(() => {
      const lift = useKeyboardLift(discountBottomInset, offset);
      effect(() => { captured = lift.value; });
      return () => <view />;
    });
    render(<SafeAreaProvider><Probe /></SafeAreaProvider>);
    return captured;
  }

  it('discounts the bottom inset by default', () => {
    expect(liftWith({ bottom: 34, keyboard: 280 })).toBe(280 - 34);
  });

  it('uses the full keyboard height with discountBottomInset=false', () => {
    expect(liftWith({ bottom: 34, keyboard: 280 }, false)).toBe(280);
  });

  it('adds the offset while the keyboard is visible', () => {
    expect(liftWith({ bottom: 34, keyboard: 280 }, true, 8)).toBe(280 - 34 + 8);
  });

  it('is 0 when the keyboard is hidden — even with an offset', () => {
    expect(liftWith({ bottom: 34, keyboard: 0 }, true, 8)).toBe(0);
  });

  it('clamps to 0 when the bottom inset exceeds the keyboard', () => {
    expect(liftWith({ bottom: 300, keyboard: 280 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// KeyboardAvoidingView — behaviors apply to the host view's inline style
// ---------------------------------------------------------------------------

describe('KeyboardAvoidingView', () => {
  it('behavior="padding" pads by the lift and renders children', () => {
    installMockLynx({ bottom: 34, keyboard: 280 });
    const { container, getByText } = render(
      <SafeAreaProvider>
        <KeyboardAvoidingView behavior="padding">
          <text>content</text>
        </KeyboardAvoidingView>
      </SafeAreaProvider>,
    );
    expect(getByText('content')).toBeTruthy();
    const host = container.children[0]!.children[0]!;
    expect(host._style.paddingBottom).toBe(`${280 - 34}px`);
  });

  it('behavior="padding" applies no padding while the keyboard is hidden', () => {
    installMockLynx({ bottom: 34, keyboard: 0 });
    const { container } = render(
      <SafeAreaProvider>
        <KeyboardAvoidingView behavior="padding" />
      </SafeAreaProvider>,
    );
    const host = container.children[0]!.children[0]!;
    expect(host._style.paddingBottom).toBe('0px');
  });

  it('behavior="translate" shifts via transform', () => {
    installMockLynx({ bottom: 34, keyboard: 280 });
    const { container } = render(
      <SafeAreaProvider>
        <KeyboardAvoidingView behavior="translate" />
      </SafeAreaProvider>,
    );
    const host = container.children[0]!.children[0]!;
    expect(host._style.transform).toBe(`translateY(-${280 - 34}px)`);
  });

  it('behavior="height" appends a spacer of the lift height', () => {
    installMockLynx({ bottom: 34, keyboard: 280 });
    const { container } = render(
      <SafeAreaProvider>
        <KeyboardAvoidingView behavior="height">
          <text>content</text>
        </KeyboardAvoidingView>
      </SafeAreaProvider>,
    );
    const host = container.children[0]!.children[0]!;
    const spacer = host.children[host.children.length - 1]!;
    expect(spacer._style.height).toBe(`${280 - 34}px`);
  });

  it('adds keyboardVerticalOffset to the lift', () => {
    installMockLynx({ bottom: 34, keyboard: 280 });
    const { container } = render(
      <SafeAreaProvider>
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={10} />
      </SafeAreaProvider>,
    );
    const host = container.children[0]!.children[0]!;
    expect(host._style.paddingBottom).toBe(`${280 - 34 + 10}px`);
  });

  it('discountBottomInset={false} lifts by the full keyboard height', () => {
    installMockLynx({ bottom: 34, keyboard: 280 });
    const { container } = render(
      <SafeAreaProvider>
        <KeyboardAvoidingView behavior="padding" discountBottomInset={false} />
      </SafeAreaProvider>,
    );
    const host = container.children[0]!.children[0]!;
    expect(host._style.paddingBottom).toBe('280px');
  });
});

// ---------------------------------------------------------------------------
// KeyboardStickyView — non-animated path (the MT SharedValue path needs the
// worklet bridge, which the unit harness doesn't run)
// ---------------------------------------------------------------------------

describe('KeyboardStickyView', () => {
  it('animated={false} translates by the lift', () => {
    installMockLynx({ bottom: 34, keyboard: 280 });
    const { container, getByText } = render(
      <SafeAreaProvider>
        <KeyboardStickyView animated={false}>
          <text>bar</text>
        </KeyboardStickyView>
      </SafeAreaProvider>,
    );
    expect(getByText('bar')).toBeTruthy();
    const host = container.children[0]!.children[0]!;
    expect(host._style.transform).toBe(`translateY(-${280 - 34}px)`);
  });

  it('animated={false} rests at translateY(0) while the keyboard is hidden', () => {
    installMockLynx({ bottom: 34, keyboard: 0 });
    const { container } = render(
      <SafeAreaProvider>
        <KeyboardStickyView animated={false} offset={8}>
          <text>bar</text>
        </KeyboardStickyView>
      </SafeAreaProvider>,
    );
    const host = container.children[0]!.children[0]!;
    expect(host._style.transform).toBe('translateY(-0px)');
  });
});
