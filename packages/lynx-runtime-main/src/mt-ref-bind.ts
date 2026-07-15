/**
 * MainThreadRef → element binding, extracted from ops-apply's SET_MT_REF case
 * (#626) so the snapshot runtime can bind refs on template-built elements
 * through the exact same pathway as op-built ones.
 *
 * Owns the wvid → elementId map (SET_GESTURE_DETECTOR resolves raw
 * MainThreadElement handles through it — upstream's Element wrapper can't be
 * passed to `__SetAttribute` / `__SetGestureDetector`).
 */

import { MTElementWrapper } from './mt-element.js';

/** elementWvid → elementId, populated on every bind. */
const elementIdByWvid = new Map<number, number>();

export function resolveElementIdByWvid(wvid: number): number | undefined {
  return elementIdByWvid.get(wvid);
}

/**
 * Bind the worklet ref `wvid` to `el` (registered under `elementId`).
 * Delegates storage to upstream's worklet-runtime ref map; see the inline
 * notes for the web-core style fallback.
 */
export function bindMtRef(
  el: MainThreadElement,
  elementId: number,
  wvid: number,
): void {
  // Delegate to upstream's worklet-runtime. updateWorkletRef wraps the
  // element in its own Element class and stores it under _wvid.
  const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
    | {
      _refImpl: {
        _workletRefMap: Record<number, { current: unknown; _wvid: number }>;
        updateWorkletRef: (refImpl: unknown, el: unknown) => void;
      };
    }
    | undefined;
  if (impl?._refImpl) {
    const refMap = impl._refImpl._workletRefMap;
    if (!(wvid in refMap)) {
      refMap[wvid] = { current: null, _wvid: wvid };
    }
    impl._refImpl.updateWorkletRef({ _wvid: wvid }, el);

    // Web (`@lynx-js/web-core`): upstream's worklet element wrapper
    // applies styles via `setProperty`, which web-core's element
    // doesn't implement — it throws. Worklet callbacks (e.g.
    // `Pressable`'s press-down visual) call
    // `ref.current.setStyleProperties(...)` directly, so patch that one
    // method to fall back to a web-safe `MTElementWrapper` (raw
    // `__SetInlineStyles` + debounced flush). Native is untouched: the
    // original path succeeds there, so the fallback never runs.
    if (typeof __SetGestureDetector !== 'function') {
      const slot = refMap[wvid] as {
        current?: {
          __sigxWebSafe?: boolean;
          setStyleProperties?: (s: Record<string, string | number>) => void;
        };
      };
      const wrapper = slot?.current;
      if (wrapper && !wrapper.__sigxWebSafe) {
        const safe = new MTElementWrapper(el);
        const orig = typeof wrapper.setStyleProperties === 'function'
          ? wrapper.setStyleProperties.bind(wrapper)
          : null;
        try {
          wrapper.setStyleProperties = (styles) => {
            if (orig) {
              try {
                orig(styles);
                return;
              } catch {
                /* web: wrapper.setProperty missing — fall through */
              }
            }
            safe.setStyleProperties(styles);
          };
          wrapper.__sigxWebSafe = true;
        } catch {
          /* frozen wrapper — degrade to no press visual */
        }
      }
    }
  }
  // Record wvid → raw elementId so SET_GESTURE_DETECTOR can resolve
  // the unwrapped MainThreadElement for `__SetAttribute` /
  // `__SetGestureDetector` (which require RefCounted handles, not
  // upstream's Element wrapper).
  elementIdByWvid.set(wvid, elementId);
}

/** Drop one binding (RELEASE_MT_REF). */
export function releaseMtRefBinding(wvid: number): void {
  elementIdByWvid.delete(wvid);
}

/** Hot-reload / test reset hook. */
export function resetMtRefBindings(): void {
  elementIdByWvid.clear();
}
