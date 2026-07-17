/**
 * MT-side derived SharedValue registry (#710).
 *
 * A *derived* SharedValue is computed on the Main Thread from one or more
 * SOURCE SharedValues via a NAMED reducer (`max` / `min` / `sum` / `scale`).
 * It exists to compose SVs without the silent-summation footgun: two
 * `translateY` bindings on one element CONCATENATE (so they SUM — see
 * `animated-bridge-mt.ts`), which is wrong for "sit above whichever of the
 * keyboard or the sheet is taller". `useDerivedValue([kbLift, sheetH], 'max')`
 * yields ONE SV a single `translateY` binds — the max, not the sum.
 *
 * Reducers are selected by NAME, mirroring the mapper registry: a string is a
 * primitive the BG→MT op layer ships trivially, whereas an arbitrary reducer
 * function can't be captured into the flush loop (the loop is plain MT code,
 * not a worklet). Custom reducers register via `registerReducer`.
 *
 * `flushDerivedValues()` runs FIRST inside the wrapped `__FlushElementTree`
 * (before publishes and style bindings): for each derived whose sources
 * changed since the last compute, it folds the live source values through the
 * reducer and writes the result onto the derived SV's envelope. Because that
 * write lands before `flushAnimatedStyleBindings`, a `useAnimatedStyle` bound
 * to the derived sees the fresh value the SAME frame; because the derived SV
 * is itself a registered auto-flush bridge, `flushAvBridgePublishes` also
 * ships the new value to BG.
 */

import type { DerivedReducer } from '@sigx/lynx-runtime-internal';

interface AvRef {
  current: { value?: unknown };
}

interface WorkletImpl {
  _refImpl?: {
    _workletRefMap: Record<number, AvRef>;
  };
}

// ---------------------------------------------------------------------------
// Reducer registry
// ---------------------------------------------------------------------------

const reducers: Record<string, DerivedReducer> = {
  max: (vs) => {
    let m = -Infinity;
    for (let i = 0; i < vs.length; i++) if (vs[i]! > m) m = vs[i]!;
    return m === -Infinity ? 0 : m;
  },
  min: (vs) => {
    let m = Infinity;
    for (let i = 0; i < vs.length; i++) if (vs[i]! < m) m = vs[i]!;
    return m === Infinity ? 0 : m;
  },
  sum: (vs) => {
    let s = 0;
    for (let i = 0; i < vs.length; i++) s += vs[i]!;
    return s;
  },
  scale: (vs, p) => {
    const params = (p as { factor?: number; offset?: number } | undefined) ?? {};
    return (vs[0] ?? 0) * (params.factor ?? 1) + (params.offset ?? 0);
  },
};

const BUILTIN_REDUCERS = new Set(['max', 'min', 'sum', 'scale']);

/** Look up a reducer by name; `undefined` → the derived recompute is skipped. */
export function lookupReducer(name: string): DerivedReducer | undefined {
  return reducers[name];
}

/** Register a custom MT-side reducer (last write wins per name). */
export function registerReducer(name: string, reducer: DerivedReducer): void {
  reducers[name] = reducer;
}

/** Reset hook — drop custom reducers, keep the built-ins (HMR / tests). */
export function resetReducers(): void {
  for (const k in reducers) if (!BUILTIN_REDUCERS.has(k)) delete reducers[k];
}

// ---------------------------------------------------------------------------
// Derived registry
// ---------------------------------------------------------------------------

interface DerivedBinding {
  derivedWvid: number;
  sourceWvids: number[];
  reducerName: string;
  params: unknown;
  /** Last source values seen, to skip recompute when nothing changed. */
  lastSources: unknown[];
  /** Whether any compute has run yet (first flush always computes). */
  computed: boolean;
}

const derivedBindings = new Map<number, DerivedBinding>();

/**
 * Register (or, for the same `derivedWvid`, RE-register) a derived value.
 * Re-registration swaps the reducer/params/sources while keeping the derived
 * SV identity — this is how a reactive factor (e.g. the active sheet's travel)
 * rebinds without breaking the consumers already bound to the derived SV.
 */
export function registerDerivedValue(
  derivedWvid: number,
  reducerName: string,
  params: unknown,
  sourceWvids: number[],
): void {
  derivedBindings.set(derivedWvid, {
    derivedWvid,
    sourceWvids,
    reducerName,
    params,
    lastSources: [],
    computed: false,
  });
}

export function unregisterDerivedValue(derivedWvid: number): void {
  derivedBindings.delete(derivedWvid);
}

export function resetDerivedValues(): void {
  derivedBindings.clear();
}

export function derivedValueCount(): number {
  return derivedBindings.size;
}

/**
 * Recompute every derived whose source values changed since the last flush,
 * writing the result onto the derived SV's envelope. Runs before the style
 * bindings and the BG publish so downstream consumers see the fresh value the
 * same frame. Skip cases are silent: a missing source/derived envelope (race
 * with unregister) or an unknown reducer name.
 */
export function flushDerivedValues(): void {
  if (derivedBindings.size === 0) return;

  const impl = (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
  const refMap = impl?._refImpl?._workletRefMap;
  if (!refMap) return;

  for (const b of derivedBindings.values()) {
    // Gather live source values; skip if any source envelope is missing.
    const n = b.sourceWvids.length;
    let missing = false;
    let changed = !b.computed;
    const values: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const ref = refMap[b.sourceWvids[i]!];
      if (!ref) { missing = true; break; }
      const v = ref.current?.value;
      values[i] = typeof v === 'number' ? v : Number(v) || 0;
      if (v !== b.lastSources[i]) changed = true;
    }
    if (missing || !changed) continue;

    b.lastSources = values.slice();

    const reducer = lookupReducer(b.reducerName);
    if (!reducer) continue;

    let out: number;
    try {
      out = reducer(values, b.params);
    } catch (e) {
      console.log('[sigx-mt] av-derived reducer threw:', b.reducerName, String(e));
      continue;
    }

    const derivedRef = refMap[b.derivedWvid];
    const env = derivedRef?.current;
    if (!env) continue;
    // Writing `.value` trips the armed auto-flush setter (a coalesced
    // microtask flush) — harmless: the next recompute finds no source change
    // and bails before writing, so it converges in one extra empty pass.
    if (env.value !== out) env.value = out;
    b.computed = true;
  }
}
