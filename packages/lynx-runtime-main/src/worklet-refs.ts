/**
 * Worklet ref registry — manages MainThreadRef state on the Main Thread.
 *
 * Each ref is identified by a worklet variable ID (wvid) assigned on the
 * BG thread. When INIT_MT_REF arrives, we create a holder. When SET_MT_REF
 * arrives, we set the holder's .current to the real element wrapper.
 */

import { MTElementWrapper } from './mt-element.js';

// ---------------------------------------------------------------------------
// Ref holder — the MT-side counterpart of MainThreadRef
// ---------------------------------------------------------------------------

interface WorkletRefHolder {
  current: unknown;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const workletRefs = new Map<number, WorkletRefHolder>();

/**
 * Initialize a worklet ref on the Main Thread.
 * Called when the BG thread sends INIT_MT_REF(wvid, initValue).
 */
export function initWorkletRef(wvid: number, initValue: unknown): void {
  workletRefs.set(wvid, { current: initValue });
}

/**
 * Bind a worklet ref to a Main Thread element.
 * Called when the BG thread sends SET_MT_REF(elementId, wvid).
 * The ref's .current is set to an MTElementWrapper around the real element.
 */
export function bindWorkletRef(
  wvid: number,
  el: MainThreadElement,
): void {
  const holder = workletRefs.get(wvid);
  if (holder) {
    holder.current = new MTElementWrapper(el);
  }
}

/**
 * Get a worklet ref holder by wvid — used by worklet event handlers
 * to access refs.
 */
export function getWorkletRef(wvid: number): WorkletRefHolder | undefined {
  return workletRefs.get(wvid);
}

/**
 * Reset all worklet refs — for testing and hot reload.
 */
export function resetWorkletRefs(): void {
  workletRefs.clear();
}
