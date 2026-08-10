import {
  component,
  defineProvide,
  signal,
  onMounted,
  onUnmounted,
  type Define,
} from '@sigx/lynx';
import { subscribeNative } from '@sigx/lynx-core';
import { useAppearanceContext, type AppearanceContextValue } from './injectable.js';
import { readGlobalColorScheme } from './globals.js';
import { getColorScheme } from './setters.js';
import { log } from './log.js';
import type { ColorScheme } from './types.js';

/**
 * Event name fired by the native publisher (iOS `AppearancePublisher.swift`,
 * Android `AppearancePublisher.kt`) via `GlobalEventEmitter` every time the
 * host's system color scheme flips. Payload mirrors the same map stored under
 * `lynx.__globalProps.appearance`.
 *
 * Kept as a constant so iOS/Android publishers and the JS listener agree on
 * a single string.
 */
export const APPEARANCE_EVENT = 'appearanceChanged';

/** Payload shape of {@link APPEARANCE_EVENT}, as both native publishers send it. */
interface AppearanceEvent {
  colorScheme: ColorScheme;
}

/**
 * Payload guard for {@link APPEARANCE_EVENT}.
 *
 * iOS reports `unspecified` and Android `UI_MODE_NIGHT_UNDEFINED`; both are
 * meant to collapse to `'light'` at the publisher boundary, so anything that
 * still isn't `'light' | 'dark'` here means the payload drifted — drop it
 * rather than push a bogus scheme into every themed component.
 */
function isAppearanceEvent(raw: unknown): raw is AppearanceEvent {
  if (!raw || typeof raw !== 'object') return false;
  const v = (raw as Record<string, unknown>)['colorScheme'];
  return v === 'light' || v === 'dark';
}

/**
 * Subscribe to system color-scheme flips.
 *
 * `@internal` — the supported way to observe the scheme is
 * `<AppearanceProvider>` + `useSystemColorScheme()`; this is the provider's own
 * subscription, factored out so the C7 disposer contract is directly testable.
 *
 * @returns unsubscribe — a plain function per C7, idempotent, safe off-device.
 */
export function subscribeAppearance(cb: (scheme: ColorScheme) => void): () => void {
  return subscribeNative<AppearanceEvent>(
    APPEARANCE_EVENT,
    (event) => cb(event.colorScheme),
    { validate: isAppearanceEvent, namespace: 'lynx-appearance' },
  );
}

export type AppearanceProviderProps =
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>;

/**
 * Mount near the root of an app (above any consumer of `useSystemColorScheme`).
 * Cheap — just one BG signal + one GlobalEventEmitter subscription. The
 * native publisher writes `lynx.__globalProps.appearance` before MT first
 * paint, so the initial value is correct on cold start with no flash.
 *
 * On platforms where the publisher isn't wired (web preview, tests),
 * `readGlobalColorScheme()` returns `null` and we seed `'light'` as a safe
 * default — then, if the *module* is linked, ask it for the real value rather
 * than sitting on the seed until the user flips the system setting.
 */
export const AppearanceProvider = component<AppearanceProviderProps>(({ props, slots }) => {
  const initial: ColorScheme | null = readGlobalColorScheme();
  const colorScheme = signal<ColorScheme>(initial ?? 'light');

  const ctx: AppearanceContextValue = { colorScheme };
  defineProvide(useAppearanceContext, () => ctx);

  let dispose: (() => void) | undefined;
  /** False once unmounted — a late native reply must not touch the signal. */
  let live = true;
  /** True once the event stream has spoken; it outranks the cold-start probe. */
  let published = false;

  onMounted(() => {
    dispose = subscribeAppearance((next) => {
      published = true;
      if (next !== colorScheme.value) colorScheme.value = next;
    });

    // Cold-start recovery. `initial === null` means nothing wrote
    // `lynx.__globalProps.appearance` — the publisher isn't wired, or hasn't
    // run yet. `getColorScheme()` resolves `null` when the native module is
    // absent too (web preview, tests), so this costs one bridge call only on
    // a host that can actually answer, and nothing at all in the normal path.
    if (initial === null) {
      void getColorScheme().then(
        (scheme) => {
          if (!live || published || scheme === null) return;
          if (scheme !== colorScheme.value) colorScheme.value = scheme;
        },
        (err: unknown) => {
          log.warn('cold-start getColorScheme failed; keeping the light seed', err);
        },
      );
    }
  });

  onUnmounted(() => {
    live = false;
    dispose?.();
    dispose = undefined;
  });

  return () => (
    <view class={props.class} style={props.style}>
      {slots.default?.()}
    </view>
  );
});
