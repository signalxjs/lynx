/**
 * Native gesture detector — BG-side wrapper around Lynx's
 * `__SetGestureDetector(dom, id, type, config, relationMap)` PAPI.
 *
 * Mirrors the contract from upstream `@lynx-js/react/runtime/lib/gesture/`:
 *   - GestureType enum values match `GestureTypeInner`.
 *   - relationMap keys: `waitFor`, `simultaneous`, `continueWith`.
 *   - COMPOSED gestures are walked client-side and each base is registered
 *     with `__SetGestureDetector` separately (the platform receives bases).
 *
 * Public surface:
 *   - `Gesture.Pan() / .Tap() / .LongPress() / ...` — chainable builders.
 *   - `Gesture.Race(...) / .Simultaneous(...) / .Exclusive(...)` — composers.
 *   - `useGestureDetector(elRef, gesture)` — attaches the gesture to the
 *     element pointed at by elRef. Op-emit is deferred to `onMounted` so the
 *     SET_MT_REF op (pushed during the first JSX render) is applied before
 *     the SET_GESTURE_DETECTOR op tries to resolve the workletRefMap entry.
 */

import { onMounted, onUnmounted } from '@sigx/runtime-core';
import { OP, pushOp, scheduleFlush } from '../op-queue.js';
import { registerWorkletCtx } from '../run-on-background.js';
import { MainThreadRef, sanitizeCaptured } from '../main-thread-ref.js';

// ---------------------------------------------------------------------------
// Gesture type enum
// ---------------------------------------------------------------------------

export const GestureType = {
  COMPOSED: -1,
  PAN: 0,
  FLING: 1,
  DEFAULT: 2,
  TAP: 3,
  LONGPRESS: 4,
  ROTATION: 5,
  PINCH: 6,
  NATIVE: 7,
} as const;

export type GestureTypeValue = (typeof GestureType)[keyof typeof GestureType];

// ---------------------------------------------------------------------------
// Worklet placeholder shape (emitted by @lynx-js/react/transform)
// ---------------------------------------------------------------------------

export interface GestureWorklet {
  _wkltId: string;
  _c?: Record<string, unknown>;
  _jsFn?: Record<string, unknown>;
  _execId?: number;
  _workletType?: string;
}

/**
 * What users write at the source level — a `'main thread'` arrow function.
 * The SWC LEPUS transform replaces it with a `GestureWorklet` placeholder
 * before the BG bundle ships, so by the time the runtime sees the value
 * it's already in placeholder shape. The union lets TypeScript accept the
 * source-level function while the runtime branch treats it as a placeholder.
 */
export type GestureCallback =
  | GestureWorklet
  | ((event: never) => void);

// ---------------------------------------------------------------------------
// Gesture descriptor shapes
// ---------------------------------------------------------------------------

export interface BaseGesture {
  __isSerialized: true;
  type: number;
  id: number;
  callbacks: Record<string, GestureWorklet>;
  waitFor: BaseGesture[];
  simultaneousWith: BaseGesture[];
  continueWith: BaseGesture[];
  config?: Record<string, unknown>;
}

export interface ComposedGesture {
  __isSerialized: true;
  type: -1;
  gestures: AnyGesture[];
}

export type AnyGesture = BaseGesture | ComposedGesture;

// ---------------------------------------------------------------------------
// Gesture id allocator (global counter — relations refer across components)
// ---------------------------------------------------------------------------

let nextGestureId = 1;

export function resetGestureIdCounter(): void {
  nextGestureId = 1;
}

function allocGestureId(): number {
  return nextGestureId++;
}

// ---------------------------------------------------------------------------
// Builder base — uses polymorphic `this` so subclass-specific config setters
// (`PanBuilder.axis`, `LongPressBuilder.duration`, …) chain off shared
// callback / relation methods without losing the concrete type.
// ---------------------------------------------------------------------------

class GestureBuilderBase {
  protected gesture: BaseGesture;

  constructor(type: number) {
    this.gesture = {
      __isSerialized: true,
      type,
      id: allocGestureId(),
      callbacks: {},
      waitFor: [],
      simultaneousWith: [],
      continueWith: [],
    };
  }

  protected setConfigKey(key: string, value: unknown): this {
    if (!this.gesture.config) this.gesture.config = {};
    this.gesture.config[key] = value;
    return this;
  }

  onBegin(cb: GestureCallback): this {
    this.gesture.callbacks['onBegin'] = cb as GestureWorklet;
    return this;
  }
  onStart(cb: GestureCallback): this {
    this.gesture.callbacks['onStart'] = cb as GestureWorklet;
    return this;
  }
  onUpdate(cb: GestureCallback): this {
    this.gesture.callbacks['onUpdate'] = cb as GestureWorklet;
    return this;
  }
  onEnd(cb: GestureCallback): this {
    this.gesture.callbacks['onEnd'] = cb as GestureWorklet;
    return this;
  }
  onFinalize(cb: GestureCallback): this {
    this.gesture.callbacks['onFinalize'] = cb as GestureWorklet;
    return this;
  }

  waitFor(...gestures: BaseGesture[]): this {
    this.gesture.waitFor.push(...gestures);
    return this;
  }
  simultaneousWith(...gestures: BaseGesture[]): this {
    this.gesture.simultaneousWith.push(...gestures);
    return this;
  }
  continueWith(...gestures: BaseGesture[]): this {
    this.gesture.continueWith.push(...gestures);
    return this;
  }

  build(): BaseGesture {
    return this.gesture;
  }
}

// ---------------------------------------------------------------------------
// Per-type builders
// ---------------------------------------------------------------------------

class PanBuilder extends GestureBuilderBase {
  constructor() {
    super(GestureType.PAN);
  }
  axis(a: 'x' | 'y' | 'xy'): this {
    return this.setConfigKey('axis', a);
  }
  minDistance(n: number): this {
    return this.setConfigKey('minDistance', n);
  }
}

class FlingBuilder extends GestureBuilderBase {
  constructor() {
    super(GestureType.FLING);
  }
  /**
   * Minimum release velocity for the fling to be recognized, in **px/ms**
   * (0.3 px/ms = 300 px/s; the web recognizer defaults to 0.3). For a
   * directional fling the configured axis's component must clear this; for a
   * direction-less fling the overall magnitude must.
   */
  minVelocity(n: number): this {
    return this.setConfigKey('minVelocity', n);
  }
  direction(d: 'left' | 'right' | 'up' | 'down'): this {
    return this.setConfigKey('direction', d);
  }
}

class TapBuilder extends GestureBuilderBase {
  constructor() {
    super(GestureType.TAP);
  }
  numberOfTaps(n: number): this {
    return this.setConfigKey('numberOfTaps', n);
  }
  maxDistance(n: number): this {
    return this.setConfigKey('maxDistance', n);
  }
  maxDuration(ms: number): this {
    return this.setConfigKey('maxDuration', ms);
  }
}

class LongPressBuilder extends GestureBuilderBase {
  constructor() {
    super(GestureType.LONGPRESS);
  }
  /**
   * Minimum hold duration in ms before the gesture activates and `onStart`
   * fires. Native iOS handler (`LynxLongPressGestureHandler`) reads the
   * `minDuration` config key — defaults to 500 ms if not set.
   */
  minDuration(ms: number): this {
    return this.setConfigKey('minDuration', ms);
  }
  /**
   * @deprecated alias for `minDuration` kept for source compatibility. The
   * native handler only honours `minDuration`; this method now writes both
   * keys so older call sites keep working until they migrate.
   */
  duration(ms: number): this {
    this.setConfigKey('duration', ms);
    return this.setConfigKey('minDuration', ms);
  }
  maxDistance(n: number): this {
    return this.setConfigKey('maxDistance', n);
  }
}

class PinchBuilder extends GestureBuilderBase {
  constructor() {
    super(GestureType.PINCH);
  }
}

class RotationBuilder extends GestureBuilderBase {
  constructor() {
    super(GestureType.ROTATION);
  }
}

class NativeBuilder extends GestureBuilderBase {
  constructor() {
    super(GestureType.NATIVE);
  }
}

// ---------------------------------------------------------------------------
// Compose helpers
// ---------------------------------------------------------------------------

function asBaseGestures(g: AnyGesture | { build(): BaseGesture }): BaseGesture[] {
  const resolved = resolveGesture(g);
  const out: BaseGesture[] = [];
  collectBases(resolved, out);
  return out;
}

function collectBases(g: AnyGesture, out: BaseGesture[]): void {
  if (g.type === GestureType.COMPOSED) {
    for (const sub of (g as ComposedGesture).gestures) collectBases(sub, out);
    return;
  }
  out.push(g as BaseGesture);
}

function resolveGesture(
  g: AnyGesture | { build(): BaseGesture },
): AnyGesture {
  if (g && typeof (g as { build?: () => BaseGesture }).build === 'function') {
    if ((g as Partial<BaseGesture>).__isSerialized !== true) {
      return (g as { build(): BaseGesture }).build();
    }
  }
  return g as AnyGesture;
}

function makeComposed(gestures: AnyGesture[]): ComposedGesture {
  return {
    __isSerialized: true,
    type: GestureType.COMPOSED,
    gestures,
  };
}

// ---------------------------------------------------------------------------
// Public Gesture namespace
// ---------------------------------------------------------------------------

export const Gesture = {
  Pan: () => new PanBuilder(),
  Fling: () => new FlingBuilder(),
  Tap: () => new TapBuilder(),
  LongPress: () => new LongPressBuilder(),
  Pinch: () => new PinchBuilder(),
  Rotation: () => new RotationBuilder(),
  Native: () => new NativeBuilder(),

  /**
   * Race — first recognizer to claim wins. Sibling bases mutually waitFor
   * each other so the platform's gesture arena resolves the priority.
   */
  Race(...gs: (AnyGesture | { build(): BaseGesture })[]): ComposedGesture {
    const resolved = gs.map(resolveGesture);
    const composed = makeComposed(resolved);
    const bases = asBaseGestures(composed);
    for (const a of bases) {
      for (const b of bases) {
        if (a !== b) a.waitFor.push(b);
      }
    }
    return composed;
  },

  /**
   * Simultaneous — all recognizers can fire at once. Sibling bases declare
   * mutual `simultaneousWith`.
   */
  Simultaneous(
    ...gs: (AnyGesture | { build(): BaseGesture })[]
  ): ComposedGesture {
    const resolved = gs.map(resolveGesture);
    const composed = makeComposed(resolved);
    const bases = asBaseGestures(composed);
    for (const a of bases) {
      for (const b of bases) {
        if (a !== b) a.simultaneousWith.push(b);
      }
    }
    return composed;
  },

  /**
   * Exclusive — sequential. Later items waitFor all earlier items.
   */
  Exclusive(
    ...gs: (AnyGesture | { build(): BaseGesture })[]
  ): ComposedGesture {
    const resolved = gs.map(resolveGesture);
    const composed = makeComposed(resolved);
    for (let i = 1; i < resolved.length; i++) {
      const laterBases: BaseGesture[] = [];
      collectBases(resolved[i]!, laterBases);
      const earlierBases: BaseGesture[] = [];
      for (let j = 0; j < i; j++) collectBases(resolved[j]!, earlierBases);
      for (const later of laterBases) later.waitFor.push(...earlierBases);
    }
    return composed;
  },
};

// ---------------------------------------------------------------------------
// useGestureDetector — attach a gesture (or composed gesture) to an element
// ---------------------------------------------------------------------------

interface SerializedRelationMap {
  waitFor: number[];
  simultaneous: number[];
  continueWith: number[];
}

interface SerializedConfig {
  callbacks: { name: string; callback: GestureWorklet }[];
  config?: Record<string, unknown>;
}

function appendUniqueBases(
  g: AnyGesture,
  out: BaseGesture[],
  seen: Set<number>,
): void {
  if (g.type === GestureType.COMPOSED) {
    for (const sub of (g as ComposedGesture).gestures) {
      appendUniqueBases(sub, out, seen);
    }
    return;
  }
  const base = g as BaseGesture;
  if (seen.has(base.id)) return;
  seen.add(base.id);
  out.push(base);
}

function buildSerializedConfig(base: BaseGesture): SerializedConfig {
  const callbacks: { name: string; callback: GestureWorklet }[] = [];
  for (const name in base.callbacks) {
    const cb = base.callbacks[name]!;
    // Preserve every field the SWC transform emits — the platform's gesture
    // arena may rely on `_workletType: 'main-thread'` (and any other markers)
    // being present at __SetGestureDetector time. We had previously stripped
    // to `{_wkltId,_c,_jsFn}`; that lost `_workletType`, and the gesture
    // arena silently ignored the registration on-device. Spread first, then
    // sanitize `_c` for wire-safety (MainThreadRef instances → wire shape).
    const wireCtx: GestureWorklet = { ...cb };
    if (cb._c) wireCtx._c = sanitizeCaptured(cb._c);
    // Stamp _execId via registerWorkletCtx so runOnBackground inside the
    // gesture callback can route MT→BG dispatches back through the same
    // pipeline used by SET_WORKLET_EVENT.
    registerWorkletCtx(wireCtx as Parameters<typeof registerWorkletCtx>[0]);
    callbacks.push({ name, callback: wireCtx });
  }
  const out: SerializedConfig = { callbacks };
  if (base.config) out.config = base.config;
  return out;
}

export function useGestureDetector(
  elRef: MainThreadRef<unknown>,
  gesture: AnyGesture | { build(): BaseGesture },
): void {
  const resolved = resolveGesture(gesture);
  const bases: BaseGesture[] = [];
  appendUniqueBases(resolved, bases, new Set());

  if (bases.length === 0) return;

  onMounted(() => {
    for (const base of bases) {
      const config = buildSerializedConfig(base);
      const relationMap: SerializedRelationMap = {
        waitFor: base.waitFor.map((g) => g.id),
        simultaneous: base.simultaneousWith.map((g) => g.id),
        continueWith: base.continueWith.map((g) => g.id),
      };
      pushOp(
        OP.SET_GESTURE_DETECTOR,
        elRef._wvid,
        base.id,
        base.type,
        config,
        relationMap,
      );
    }
    scheduleFlush();
  });

  onUnmounted(() => {
    for (const base of bases) {
      pushOp(OP.REMOVE_GESTURE_DETECTOR, elRef._wvid, base.id);
    }
    scheduleFlush();
  });
}
