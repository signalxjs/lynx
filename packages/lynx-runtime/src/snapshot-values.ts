/**
 * Dynamic-hole value normalization for snapshot templates (#630).
 *
 * The BG build of a template has its `update[]` compiled out, so the
 * renderer cannot know a hole's kind positionally — kinds are detected by
 * VALUE SHAPE, mirroring what the corresponding nodeOps op paths ship:
 *
 *   function                → BG event-registry sign (string). One sign per
 *                             (instance, hole key), stable across re-renders:
 *                             the handler swaps behind the sign, the wire
 *                             value never changes, no op is emitted.
 *   { _wkltId, … }          → sanitized worklet ctx + registerWorkletCtx
 *                             (same wire shape as SET_WORKLET_EVENT), re-shipped
 *                             only when _wkltId changes.
 *   MainThreadRef           → { __wvid } (INIT_MT_REF already flowed at
 *                             useMainThreadRef time).
 *   plain object / array    → entries normalized recursively (spread holes;
 *                             nested functions get signs keyed by entry path).
 *   primitives              → as-is (must survive JSON).
 */

import { MainThreadRef, sanitizeCaptured } from './main-thread-ref.js';
import { register, unregister, updateHandler } from './event-registry.js';
import { registerWorkletCtx } from './run-on-background.js';
import type { ShadowSnapshotElement } from './shadow-snapshot.js';

interface WorkletPlaceholder {
  _wkltId: string;
  _c?: Record<string, unknown>;
  _jsFn?: Record<string, unknown>;
}

function isWorkletPlaceholder(v: unknown): v is WorkletPlaceholder {
  return typeof v === 'object' && v !== null && '_wkltId' in (v as object);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Drop bookkeeping for a hole key whose value changed KIND (function → data,
 * worklet → function, spread key removed, …) so signs never leak in the
 * global registry across re-renders.
 */
function clearStaleFor(el: ShadowSnapshotElement, holeKey: string): void {
  const sign = el.holeSigns.get(holeKey);
  if (sign) {
    unregister(sign);
    el.holeSigns.delete(holeKey);
  }
  el.sentWorkletIds.delete(holeKey);
}

/**
 * Sweep bookkeeping under `prefix` whose immediate sub-key no longer passes
 * `keep` (removed spread keys, shrunk arrays). Sub-keys are delimited by the
 * `:`/`[` the recursion itself appends.
 */
function sweepStaleUnder(
  el: ShadowSnapshotElement,
  prefix: string,
  keep: (subKey: string) => boolean,
): void {
  // Sub-key = everything up to the next delimiter (`:`/`[`) or an array
  // key's own closing `]` — "2[0]:x" under prefix "2[" must yield "0".
  const subKeyOf = (key: string): string =>
    /^[^:[\]]*/.exec(key.slice(prefix.length))![0];
  for (const key of [...el.holeSigns.keys()]) {
    if (!key.startsWith(prefix)) continue;
    if (!keep(subKeyOf(key))) {
      unregister(el.holeSigns.get(key)!);
      el.holeSigns.delete(key);
    }
  }
  for (const key of [...el.sentWorkletIds.keys()]) {
    if (!key.startsWith(prefix)) continue;
    if (!keep(subKeyOf(key))) el.sentWorkletIds.delete(key);
  }
}

function normalizeOne(
  el: ShadowSnapshotElement,
  holeKey: string,
  value: unknown,
  prevWire: unknown,
): unknown {
  if (typeof value === 'function') {
    el.sentWorkletIds.delete(holeKey); // worklet → function kind switch
    const existing = el.holeSigns.get(holeKey);
    if (existing) {
      updateHandler(existing, value as (data: unknown) => void);
      return existing;
    }
    const sign = register(value as (data: unknown) => void);
    el.holeSigns.set(holeKey, sign);
    return sign;
  }

  if (isWorkletPlaceholder(value)) {
    const staleSign = el.holeSigns.get(holeKey);
    if (staleSign) { // function → worklet kind switch
      unregister(staleSign);
      el.holeSigns.delete(holeKey);
    }
    // Same _wkltId → the compiled body is unchanged; reuse the previous wire
    // ctx so the diff gate sees no change (captures re-ship only with a new
    // worklet identity, matching the SET_WORKLET_EVENT dedup).
    if (el.sentWorkletIds.get(holeKey) === value._wkltId && prevWire !== undefined) {
      return prevWire;
    }
    el.sentWorkletIds.set(holeKey, value._wkltId);
    const wireCtx: {
      _wkltId: string;
      _c?: Record<string, unknown>;
      _jsFn?: Record<string, unknown>;
      _execId?: number;
    } = { _wkltId: value._wkltId };
    if (value._c) wireCtx._c = sanitizeCaptured(value._c);
    if (value._jsFn) wireCtx._jsFn = value._jsFn;
    registerWorkletCtx(wireCtx);
    return wireCtx;
  }

  if (value instanceof MainThreadRef) {
    clearStaleFor(el, holeKey);
    return { __wvid: value._wvid };
  }

  if (Array.isArray(value)) {
    clearStaleFor(el, holeKey);
    sweepStaleUnder(el, `${holeKey}[`, (sub) => Number(sub) < value.length);
    const prevArr = Array.isArray(prevWire) ? prevWire : [];
    return value.map((entry, idx) => normalizeOne(el, `${holeKey}[${idx}]`, entry, prevArr[idx]));
  }

  if (isPlainObject(value)) {
    clearStaleFor(el, holeKey);
    sweepStaleUnder(el, `${holeKey}:`, (sub) => sub in value);
    const wire: Record<string, unknown> = {};
    const prevObj = isPlainObject(prevWire) ? prevWire : {};
    for (const [k, v] of Object.entries(value)) {
      wire[k] = normalizeOne(el, `${holeKey}:${k}`, v, prevObj[k]);
    }
    return wire;
  }

  // Primitive / null: any prior function/worklet bookkeeping for this key is
  // a kind switch. undefined normalizes to null explicitly — the op queue
  // JSON.stringifies, and diff baselines must match what the MT decodes.
  clearStaleFor(el, holeKey);
  return value === undefined ? null : value;
}

/** Normalize hole `index` of `el` to its wire form. */
export function normalizeHole(
  el: ShadowSnapshotElement,
  index: number,
  value: unknown,
): unknown {
  return normalizeOne(el, String(index), value, el.wireValues[index]);
}

/**
 * Release every sign this instance registered. Worklet ctx entries follow
 * the SET_WORKLET_EVENT path's lifecycle (no unregistration there either —
 * exec-id handles are dropped with the BG page).
 */
export function releaseHoleValues(el: ShadowSnapshotElement): void {
  for (const sign of el.holeSigns.values()) {
    unregister(sign);
  }
  el.holeSigns.clear();
  el.sentWorkletIds.clear();
}

/**
 * Structural equality on WIRE values (post-normalization: primitives, plain
 * objects, arrays only — signs are stable strings, worklet ctxs are
 * reference-reused when unchanged, so === handles those fast paths).
 */
export function wireEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!wireEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      // Key-set check, not just value check — {x: undefined} and
      // {y: undefined} have equal lengths and undefined lookups both ways.
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!wireEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}
