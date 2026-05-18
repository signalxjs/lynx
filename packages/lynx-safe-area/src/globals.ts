import { type EdgeInsets, ZERO_INSETS } from './types';

/**
 * The key under `lynx.__globalProps` where the native publisher writes the
 * inset map. Kept as a constant so iOS/Android publishers, the JS reader, and
 * tests all agree on a single string.
 */
export const GLOBAL_PROPS_KEY = 'safeArea';

/**
 * Shape of the safe-area sub-object the native publishers write to
 * `lynx.__globalProps[GLOBAL_PROPS_KEY]`. Some fields may be absent on
 * platforms that don't expose them (e.g. Android pre-31 navigation-bar API);
 * the reader fills missing keys with 0.
 */
export interface RawSafeAreaProps {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  keyboard?: number;
  statusBar?: number;
  navigationBar?: number;
}

interface LynxGlobalLike {
  __globalProps?: { [k: string]: unknown };
}

// Closure-injected identifier — see provider.tsx for context.
declare const lynx: unknown | undefined;

/**
 * Synchronously read the current safe-area insets from `lynx.__globalProps`.
 *
 * Returns `ZERO_INSETS` when the publisher hasn't populated yet, when the
 * package is bundled into a non-Lynx host (web preview, SSR), or when the
 * host runtime omits the global. All callers must be prepared for the
 * zero-fallback — it's the natural state during cold start before the native
 * publisher has fired its first `updateGlobalProps`.
 *
 * Safe to call from both the Background Thread (BG) and the Main Thread
 * (MT), since `lynx.__globalProps` is mirrored across both. Sync read on MT
 * is what gives us inset-aware first paint.
 *
 * The `lynx` symbol is a closure-injected identifier (provided by
 * `@lynx-js/runtime-wrapper-webpack-plugin`'s `__init_card_bundle__`
 * wrapper), NOT a property of `globalThis`. Access it as a bare identifier
 * with a `typeof` guard — same pattern used by `lynx-runtime/src/bg-bridge.ts`.
 */
export function readGlobalSafeArea(): EdgeInsets {
  const lynxObj: LynxGlobalLike | undefined = typeof lynx !== 'undefined'
    ? (lynx as unknown as LynxGlobalLike)
    : undefined;
  const raw = lynxObj?.__globalProps?.[GLOBAL_PROPS_KEY] as RawSafeAreaProps | undefined;
  if (!raw || typeof raw !== 'object') return ZERO_INSETS;
  return {
    top: numOr0(raw.top),
    right: numOr0(raw.right),
    bottom: numOr0(raw.bottom),
    left: numOr0(raw.left),
    keyboard: numOr0(raw.keyboard),
    statusBar: numOr0(raw.statusBar),
    navigationBar: numOr0(raw.navigationBar),
  };
}

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
