/**
 * MT-side mapper registry for `useAnimatedStyle`.
 *
 * Maps a `SharedValue`'s current scalar to a partial style object that the
 * binding flush passes to `setStyleProperties` on the bound element. Keyed by
 * a string name (`'translateX'`, `'scale'`, ...) so the SWC worklet transform
 * can capture the selection trivially: a string is a primitive `_c` value
 * with no special lifting required (unlike arbitrary functions, which can't
 * be captured into a worklet's closure).
 *
 * Custom mappers can be registered via `registerMapper(name, fn)` from MT
 * code (e.g. a `'main thread'`-marked module body in a user app). BG-side
 * `useAnimatedStyle` validates the name only against the type union; a
 * lookup mismatch on MT is a silent no-op at flush time.
 *
 * Param shapes are mapper-specific. The `MapperParams` type in
 * `@sigx/lynx-runtime-internal` is the single source of truth — both
 * BG-side `useAnimatedStyle` and the MT runtime import it from there.
 *
 * Range mapping: `translateX` / `translateY` / `scale` / `opacity` accept
 * either their linear `factor`/`offset` shape or a `RangeParams` shape
 * (`{ inputRange, outputRange, extrapolate? }`). The mapper picks the branch
 * by looking for `inputRange` on the params.
 */

import type {
  MapperParams,
  RangeParams,
  AnimatedStyleMapper,
} from '@sigx/lynx-runtime-internal';

// Re-export so that consumers importing from lynx-runtime-main don't have
// to reach into lynx-runtime-internal directly.
export type {
  MapperParams,
  BuiltinMapperName,
  AnimatedStyleMapper,
  RangeParams,
} from '@sigx/lynx-runtime-internal';

function isRangeParams(p: unknown): p is RangeParams {
  return (
    typeof p === 'object' && p !== null
    && 'inputRange' in p
    && 'outputRange' in p
  );
}

/**
 * Linear interpolation across a multi-stop range. Locates the input segment
 * via simple linear scan (inputRange is small in practice — typically 2-4
 * stops) and lerps within it. Out-of-range behavior controlled by
 * `extrapolate`: `'clamp'` (default) caps at endpoint outputs; `'identity'`
 * extends linearly using the slope of the nearest segment.
 */
function interpolateLinear(
  v: number,
  inputRange: number[],
  outputRange: number[],
  extrapolate: 'clamp' | 'identity' = 'clamp',
): number {
  const n = inputRange.length;
  if (n < 2) return outputRange[0] ?? v;

  if (v <= inputRange[0]!) {
    if (extrapolate === 'clamp') return outputRange[0]!;
    const dx = inputRange[1]! - inputRange[0]!;
    const dy = outputRange[1]! - outputRange[0]!;
    return outputRange[0]! + (v - inputRange[0]!) * (dy / dx);
  }
  if (v >= inputRange[n - 1]!) {
    if (extrapolate === 'clamp') return outputRange[n - 1]!;
    const dx = inputRange[n - 1]! - inputRange[n - 2]!;
    const dy = outputRange[n - 1]! - outputRange[n - 2]!;
    return outputRange[n - 1]! + (v - inputRange[n - 1]!) * (dy / dx);
  }
  for (let i = 1; i < n; i++) {
    if (v <= inputRange[i]!) {
      const t = (v - inputRange[i - 1]!) / (inputRange[i]! - inputRange[i - 1]!);
      return outputRange[i - 1]! + t * (outputRange[i]! - outputRange[i - 1]!);
    }
  }
  return outputRange[n - 1]!;
}

const mtMappers: Record<string, AnimatedStyleMapper> = {
  translateX: (v, p) => {
    if (isRangeParams(p)) {
      const out = interpolateLinear(v as number, p.inputRange, p.outputRange, p.extrapolate);
      return { transform: `translateX(${out}px)` };
    }
    const factor = (p as { factor?: number } | undefined)?.factor ?? 1;
    return { transform: `translateX(${(v as number) * factor}px)` };
  },
  translateY: (v, p) => {
    if (isRangeParams(p)) {
      const out = interpolateLinear(v as number, p.inputRange, p.outputRange, p.extrapolate);
      return { transform: `translateY(${out}px)` };
    }
    const factor = (p as { factor?: number } | undefined)?.factor ?? 1;
    return { transform: `translateY(${(v as number) * factor}px)` };
  },
  translate: (v, p) => {
    const params = (p as MapperParams['translate'] | undefined) ?? {};
    const fx = params.factorX ?? 1;
    const fy = params.factorY ?? 1;
    const xy = v as { x: number; y: number };
    return { transform: `translate(${xy.x * fx}px, ${xy.y * fy}px)` };
  },
  scale: (v, p) => {
    if (isRangeParams(p)) {
      const out = interpolateLinear(v as number, p.inputRange, p.outputRange, p.extrapolate);
      return { transform: `scale(${out})` };
    }
    const offset = (p as { offset?: number } | undefined)?.offset ?? 0;
    return { transform: `scale(${(v as number) + offset})` };
  },
  scaleX: (v, p) => {
    if (isRangeParams(p)) {
      const out = interpolateLinear(v as number, p.inputRange, p.outputRange, p.extrapolate);
      return { transform: `scaleX(${out})` };
    }
    const offset = (p as { offset?: number } | undefined)?.offset ?? 0;
    return { transform: `scaleX(${(v as number) + offset})` };
  },
  scaleY: (v, p) => {
    if (isRangeParams(p)) {
      const out = interpolateLinear(v as number, p.inputRange, p.outputRange, p.extrapolate);
      return { transform: `scaleY(${out})` };
    }
    const offset = (p as { offset?: number } | undefined)?.offset ?? 0;
    return { transform: `scaleY(${(v as number) + offset})` };
  },
  opacity: (v, p) => {
    if (isRangeParams(p)) {
      const raw = interpolateLinear(v as number, p.inputRange, p.outputRange, p.extrapolate);
      const out = Math.max(0, Math.min(1, raw));
      return { opacity: String(out) };
    }
    const params = (p as { factor?: number; offset?: number } | undefined) ?? {};
    const factor = params.factor ?? 1;
    const offset = params.offset ?? 0;
    const out = Math.max(0, Math.min(1, (v as number) * factor + offset));
    return { opacity: String(out) };
  },
  rotate: (v) => ({ transform: `rotate(${v as number}deg)` }),
  width: (v, p) => ({ width: `${linearOrRange(v, p)}px` }),
  height: (v, p) => ({ height: `${linearOrRange(v, p)}px` }),
  paddingTop: (v, p) => ({ paddingTop: `${linearOrRange(v, p)}px` }),
  paddingRight: (v, p) => ({ paddingRight: `${linearOrRange(v, p)}px` }),
  paddingBottom: (v, p) => ({ paddingBottom: `${linearOrRange(v, p)}px` }),
  paddingLeft: (v, p) => ({ paddingLeft: `${linearOrRange(v, p)}px` }),
  marginTop: (v, p) => ({ marginTop: `${linearOrRange(v, p)}px` }),
  marginRight: (v, p) => ({ marginRight: `${linearOrRange(v, p)}px` }),
  marginBottom: (v, p) => ({ marginBottom: `${linearOrRange(v, p)}px` }),
  marginLeft: (v, p) => ({ marginLeft: `${linearOrRange(v, p)}px` }),
};

function linearOrRange(v: unknown, p: unknown): number {
  if (isRangeParams(p)) {
    return interpolateLinear(v as number, p.inputRange, p.outputRange, p.extrapolate);
  }
  const factor = (p as { factor?: number } | undefined)?.factor ?? 1;
  return (v as number) * factor;
}

/**
 * Look up a registered mapper by name. Returns `undefined` if the name
 * isn't registered — the binding flush treats that as a no-op.
 */
export function lookupMapper(name: string): AnimatedStyleMapper | undefined {
  return mtMappers[name];
}

/**
 * Register a custom MT-side mapper. Idempotent on (name, fn) — last
 * registration wins for the same name. Intended for `'main thread'`-marked
 * user modules that ship project-specific styling math.
 */
export function registerMapper(name: string, mapper: AnimatedStyleMapper): void {
  mtMappers[name] = mapper;
}

/**
 * Reset hook — drops every custom mapper, reseats the built-ins. Used by
 * the MT-side resetMainThreadState path (HMR / tests).
 */
const BUILTIN_NAMES = new Set([
  'translateX', 'translateY', 'translate', 'scale', 'scaleX', 'scaleY', 'opacity', 'rotate',
  'width', 'height',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
]);

export function resetMappers(): void {
  for (const k in mtMappers) {
    if (!BUILTIN_NAMES.has(k)) {
      delete mtMappers[k];
    }
  }
}
