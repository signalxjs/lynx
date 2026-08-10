import {
  component,
  defineProvide,
  computed,
  signal,
  onMounted,
  onUnmounted,
  useSharedValue,
  useMainThreadRef,
  runOnMainThread,
  type Define,
  type MainThread,
  type SharedValue,
} from '@sigx/lynx';
import { useSafeAreaContext } from './injectable.js';
import { readGlobalSafeArea } from './globals.js';
import { normaliseInsets, subscribeSafeArea } from './events.js';
import type { EdgeInsets, SafeAreaContextValue } from './types.js';

// The channel name is public API and has always been importable from here.
export { SAFE_AREA_EVENT } from './events.js';

export type SafeAreaProviderProps =
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>;

/**
 * Mount once at the root of an app. Responsibilities:
 *
 * 1. **Seed insets synchronously** from `lynx.__globalProps[safeArea]`. The
 *    native side populates this *before* the MT bundle evaluates, so the
 *    seed is correct on first render — no flash of unsafe content.
 *
 * 2. **Provide a DI context** (`useSafeAreaContext`) holding:
 *    - four per-edge `SharedValue<number>`s — the single source of truth,
 *      writable on MT, observable from both threads.
 *    - a derived BG `computed<EdgeInsets>` for re-render-driven consumers
 *      (`useSafeAreaInsets()`).
 *
 * 3. **Subscribe to live updates** via core's `subscribeNative` (C7). The native
 *    publisher emits `'safeAreaChanged'` after each `updateGlobalProps`,
 *    carrying the new inset map. We dispatch a `runOnMainThread` worklet
 *    that writes the per-edge SVs on MT — the SharedValue diff/publish
 *    bridge then propagates the new values back to the BG signal mirror,
 *    which re-fires the `computed` and re-renders consumers.
 *
 * 4. **Declare CSS variables** (`--sat`, `--sar`, `--sab`, `--sal`,
 *    `--safe-area-keyboard`) inline on the root `<view>` so utility-class
 *    consumers can write `class="pt-[var(--sat)]"` and have it work
 *    uniformly across iOS and Android (upstream's
 *    `env(safe-area-inset-*)` is iOS-only). Inline custom properties
 *    register from first paint via `enableCSSInlineVariables` (#116).
 */
export const SafeAreaProvider = component<SafeAreaProviderProps>(({ props, slots }) => {
  const initial = readGlobalSafeArea();

  const svTop = useSharedValue(initial.top);
  const svRight = useSharedValue(initial.right);
  const svBottom = useSharedValue(initial.bottom);
  const svLeft = useSharedValue(initial.left);

  // Reactive object signal for the non-SV extras (BG-only — keyboard,
  // statusBar, navigationBar don't drive MT-bound layout, so SV plumbing
  // isn't worth the cost). `signal({...})` returns a deeply reactive proxy;
  // access via `extras.keyboard` etc., replace via `extras.$set({...})`.
  const extras = signal<Extras>({
    keyboard: initial.keyboard,
    statusBar: initial.statusBar,
    navigationBar: initial.navigationBar,
  });

  // Single source of truth for BG consumers — derived reactively from the
  // four edge SVs (which live on MT) and the extras signal (which lives on
  // BG). Re-runs when MT publishes new SV values via the AvBridge OR when
  // the safeAreaChanged listener writes to `extras`.
  const insets = computed<EdgeInsets>(() => ({
    top: svTop.value,
    right: svRight.value,
    bottom: svBottom.value,
    left: svLeft.value,
    keyboard: extras.keyboard,
    statusBar: extras.statusBar,
    navigationBar: extras.navigationBar,
  }));

  const ctx: SafeAreaContextValue = {
    insets,
    sv: { top: svTop, right: svRight, bottom: svBottom, left: svLeft },
  };
  defineProvide(useSafeAreaContext, () => ctx);

  // Worklet that writes the four per-edge SVs on MT. Captured by `_c` at
  // build time — runOnMainThread ships the SV refs as `{_wvid, _initValue}`
  // placeholders that the MT runtime resolves to the live envelope.
  const writeOnMT = runOnMainThread((t: number, r: number, b: number, l: number) => {
    'main thread';
    svTop.current.value = t;
    svRight.current.value = r;
    svBottom.current.value = b;
    svLeft.current.value = l;
  });

  // Hold the elRef purely so consumers can extend the provider's host view
  // via the published CSS variables. Not used internally for any MT writes.
  const elRef = useMainThreadRef<MainThread.Element | null>(null);

  // Idempotent unsubscribe (C7), or `undefined` before mount. `subscribeNative`
  // owns the emitter lookup, the JSON-string payload parse, and the
  // listener-throws guard — all three used to be missing or hand-rolled here.
  let dispose: (() => void) | undefined;

  onMounted(() => {
    dispose = subscribeSafeArea((raw) => {
      const next = normaliseInsets(raw, insets.value);
      // `$set` runs every BG consumer of `insets` SYNCHRONOUSLY. A throwing
      // consumer effect used to unwind straight out of this listener into the
      // native GlobalEventEmitter dispatch loop, silently killing
      // `safeAreaChanged` delivery for every other listener on the channel.
      // `subscribeSafeArea` contains it and logs under our namespace (C10).
      extras.$set({
        keyboard: next.keyboard,
        statusBar: next.statusBar,
        navigationBar: next.navigationBar,
      });
      void writeOnMT(next.top, next.right, next.bottom, next.left);
    });
  });

  onUnmounted(() => {
    dispose?.();
    dispose = undefined;
  });

  return () => (
    <view
      class={props.class}
      main-thread:ref={elRef}
      style={rootStyle(props.style, insets.value)}
    >
      {slots.default?.()}
    </view>
  );
});

interface Extras {
  keyboard: number;
  statusBar: number;
  navigationBar: number;
}

function rootStyle(
  user: Record<string, string | number> | undefined,
  insets: EdgeInsets,
): Record<string, string | number> {
  // Defaults make the provider fill the device viewport and act as a
  // flex-column ancestor. Without these, every Lynx app re-rolls inline
  // `style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}`
  // because `<view>` defaults to auto height and the lynx-tailwind
  // preset (as of 0.4.0) doesn't ship an `h-screen` rule. Consumers can
  // override any of these via `props.style`.
  //
  // The safe-area CSS variables are declared inline: the seed insets come
  // synchronously from `__globalProps`, so they're correct on first paint
  // (native Lynx ≥ 3.6), and re-rendering with new insets re-resolves every
  // descendant `var()` on native Lynx ≥ 3.9 (the CLI's host templates pin
  // 4.0.1; older hosts keep the first-paint values).
  const base: Record<string, string | number> = {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    '--sat': `${insets.top}px`,
    '--sar': `${insets.right}px`,
    '--sab': `${insets.bottom}px`,
    '--sal': `${insets.left}px`,
    '--safe-area-keyboard': `${insets.keyboard}px`,
  };
  return user ? { ...base, ...user } : base;
}

// re-export so users only need `@sigx/lynx-safe-area`
export type { SharedValue };
