import {
  component,
  effect,
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
import type { EdgeInsets, SafeAreaContextValue } from './types.js';

/**
 * The native publisher (iOS `SafeAreaPublisher.swift`, Android
 * `SafeAreaPublisher.kt`) emits this event via `GlobalEventEmitter` every
 * time it republishes insets. Payload mirrors the same `RawSafeAreaProps`
 * shape stored under `lynx.__globalProps[GLOBAL_PROPS_KEY]`.
 *
 * We use a custom event rather than upstream's `onGlobalPropsChanged` so
 * the contract stays in our hands (upstream's event-name conventions have
 * churned across Lynx releases).
 */
export const SAFE_AREA_EVENT = 'safeAreaChanged';

interface GlobalEventEmitterLike {
  addListener: (name: string, fn: (...a: unknown[]) => void) => void;
  removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
  getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
  getElementById?: (
    id: string,
  ) => { setProperty(props: Record<string, string>): void } | null;
}

// Closure-injected identifier provided by
// `@lynx-js/runtime-wrapper-webpack-plugin`. Same pattern as
// `lynx-runtime/src/shims.d.ts`. Declared locally so this package doesn't
// have to depend on lynx-runtime-internal just for the ambient.
declare const lynx: unknown | undefined;

// Unique host id per provider instance so the runtime `setProperty` call can
// target this provider's own view.
let safeAreaIdSeq = 0;

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
 * 3. **Subscribe to live updates** via `GlobalEventEmitter`. The native
 *    publisher emits `'safeAreaChanged'` after each `updateGlobalProps`,
 *    carrying the new inset map. We dispatch a `runOnMainThread` worklet
 *    that writes the per-edge SVs on MT — the SharedValue diff/publish
 *    bridge then propagates the new values back to the BG signal mirror,
 *    which re-fires the `computed` and re-renders consumers.
 *
 * 4. **Apply CSS variables** (`--sat`, `--sar`, `--sab`, `--sal`,
 *    `--safe-area-keyboard`) on the root `<view>` so utility-class
 *    consumers can write `class="pt-[var(--sat)]"` and have it work
 *    uniformly across iOS and Android (upstream's
 *    `env(safe-area-inset-*)` is iOS-only).
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

  // Host id for the runtime `setProperty` CSS-variable application (below).
  const hostId = `safe-area-${++safeAreaIdSeq}`;

  let listener: ((...a: unknown[]) => void) | undefined;
  let emitter: GlobalEventEmitterLike | undefined;
  let varsEffect: { stop: () => void } | undefined;
  let insetsGen = 0;

  onMounted(() => {
    // `lynx` is a closure-injected identifier (provided by
    // `@lynx-js/runtime-wrapper-webpack-plugin`'s `__init_card_bundle__`
    // wrapper), NOT a property of `globalThis`. Access as a bare identifier
    // with `typeof` guard — same pattern as `lynx-runtime/src/bg-bridge.ts`.
    const lynxObj: LynxLike | undefined = typeof lynx !== 'undefined'
      ? (lynx as unknown as LynxLike)
      : undefined;

    // Publish insets as real, inheritable CSS custom properties via the runtime
    // `setProperty` API. Lynx does NOT honor custom properties declared through
    // the inline `style` attribute, so `class="pt-[var(--sat)]"` consumers rely
    // on this. On cold start the host view isn't queryable from the background
    // thread the instant this runs, so retry on a short timer until it resolves
    // (`insetsGen` drops a superseded retry). Reactive on `insets.value`.
    const pushInsets = (): void => {
      const i = insets.value;
      if (!lynxObj?.getElementById) return;
      const vars: Record<string, string> = {
        '--sat': `${i.top}px`,
        '--sar': `${i.right}px`,
        '--sab': `${i.bottom}px`,
        '--sal': `${i.left}px`,
        '--safe-area-keyboard': `${i.keyboard}px`,
      };
      const gen = ++insetsGen;
      let tries = 0;
      const attempt = (): void => {
        if (gen !== insetsGen) return;
        const el = lynxObj!.getElementById!(hostId);
        if (el) { el.setProperty(vars); return; }
        if (tries++ < 30) setTimeout(attempt, 16);
      };
      attempt();
    };
    varsEffect = effect(() => { pushInsets(); });

    emitter = lynxObj?.getJSModule?.('GlobalEventEmitter');
    if (!emitter) return;
    listener = (raw: unknown) => {
      const next = normaliseInsets(raw, insets.value);
      extras.$set({
        keyboard: next.keyboard,
        statusBar: next.statusBar,
        navigationBar: next.navigationBar,
      });
      void writeOnMT(next.top, next.right, next.bottom, next.left);
    };
    emitter.addListener(SAFE_AREA_EVENT, listener);
  });

  onUnmounted(() => {
    if (emitter && listener) emitter.removeListener(SAFE_AREA_EVENT, listener);
    varsEffect?.stop();
    varsEffect = undefined;
    ++insetsGen; // cancel any pending setProperty retry
  });

  return () => (
    <view
      id={hostId}
      class={props.class}
      main-thread:ref={elRef}
      style={rootStyle(props.style)}
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

function normaliseInsets(raw: unknown, fallback: EdgeInsets): EdgeInsets {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  return {
    top: numOr(o['top'], fallback.top),
    right: numOr(o['right'], fallback.right),
    bottom: numOr(o['bottom'], fallback.bottom),
    left: numOr(o['left'], fallback.left),
    keyboard: numOr(o['keyboard'], fallback.keyboard),
    statusBar: numOr(o['statusBar'], fallback.statusBar),
    navigationBar: numOr(o['navigationBar'], fallback.navigationBar),
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function rootStyle(
  user: Record<string, string | number> | undefined,
): Record<string, string | number> {
  // Defaults make the provider fill the device viewport and act as a
  // flex-column ancestor. Without these, every Lynx app re-rolls inline
  // `style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}`
  // because `<view>` defaults to auto height and the lynx-tailwind
  // preset (as of 0.4.0) doesn't ship an `h-screen` rule. Consumers can
  // override any of these via `props.style`.
  //
  // The safe-area CSS variables (`--sat`/`--sar`/`--sab`/`--sal`/
  // `--safe-area-keyboard`) are NOT set here: Lynx ignores custom properties
  // declared via inline `style`. They're published via the runtime
  // `setProperty` API in the provider's mount effect instead.
  const base: Record<string, string | number> = {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
  };
  return user ? { ...base, ...user } : base;
}

// re-export so users only need `@sigx/lynx-safe-area`
export type { SharedValue };
