import {
  component,
  defineProvide,
  signal,
  onMounted,
  onUnmounted,
  type Define,
} from '@sigx/lynx';
import { useAppearanceContext, type AppearanceContextValue } from './injectable.js';
import { readGlobalColorScheme, readGlobalFontScale } from './globals.js';
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

/**
 * Global event fired by the Lynx ENGINE itself (not a sigx publisher)
 * whenever the host calls `LynxView.updateFontScale()` — the native
 * `FontScalePublisher` in `@sigx/lynx-core` does so on every OS text-size
 * change. Payload: `{ scale: number }` (the new effective scale).
 *
 * The name is engine-owned (`core/renderer/template_assembler.cc` upstream);
 * kept as a constant so the listener and tests agree on a single string.
 */
export const FONT_SCALE_EVENT = 'onFontScaleChanged';

interface GlobalEventEmitterLike {
  addListener: (name: string, fn: (...a: unknown[]) => void) => void;
  removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
  getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

declare const lynx: unknown | undefined;

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
 * default. Consumers can detect the unwired case via the live-update
 * subscription never firing.
 */
export const AppearanceProvider = component<AppearanceProviderProps>(({ props, slots }) => {
  const initial: ColorScheme = readGlobalColorScheme() ?? 'light';
  const colorScheme = signal<ColorScheme>(initial);
  const fontScale = signal<number>(readGlobalFontScale()?.scale ?? 1);

  const ctx: AppearanceContextValue = { colorScheme, fontScale };
  defineProvide(useAppearanceContext, () => ctx);

  let listener: ((...a: unknown[]) => void) | undefined;
  let scaleListener: ((...a: unknown[]) => void) | undefined;
  let emitter: GlobalEventEmitterLike | undefined;

  onMounted(() => {
    const lynxObj: LynxLike | undefined = typeof lynx !== 'undefined'
      ? (lynx as unknown as LynxLike)
      : undefined;
    emitter = lynxObj?.getJSModule?.('GlobalEventEmitter');
    if (!emitter) return;
    listener = (raw: unknown) => {
      const next = normaliseScheme(raw);
      if (next && next !== colorScheme.value) colorScheme.value = next;
    };
    emitter.addListener(APPEARANCE_EVENT, listener);
    scaleListener = (raw: unknown) => {
      const next = normaliseFontScale(raw);
      if (next !== null && next !== fontScale.value) fontScale.value = next;
    };
    emitter.addListener(FONT_SCALE_EVENT, scaleListener);
  });

  onUnmounted(() => {
    if (emitter && listener) emitter.removeListener(APPEARANCE_EVENT, listener);
    if (emitter && scaleListener) emitter.removeListener(FONT_SCALE_EVENT, scaleListener);
  });

  return () => (
    <view class={props.class} style={props.style}>
      {slots.default?.()}
    </view>
  );
});

function normaliseScheme(raw: unknown): ColorScheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as Record<string, unknown>)['colorScheme'];
  return v === 'dark' ? 'dark' : v === 'light' ? 'light' : null;
}

/**
 * Engine payload is `{ scale }`; accept a bare number defensively. Rounded
 * to 3 decimals — Android's Float-backed scale widens with binary noise
 * (1.15f arrives as 1.14999997…), and the publishers publish 3-decimal
 * values, so this keeps the event path consistent with `__globalProps`.
 */
function normaliseFontScale(raw: unknown): number | null {
  const v = typeof raw === 'number' ? raw : (raw as Record<string, unknown> | null)?.['scale'];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 1000) / 1000;
}
