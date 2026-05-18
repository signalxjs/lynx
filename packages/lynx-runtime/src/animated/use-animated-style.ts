import { onUnmounted } from '@sigx/runtime-core';

import { pushOp, scheduleFlush } from '../op-queue';
import type { MainThreadRef } from '../main-thread-ref';
import type { MainThread } from '../jsx';
import { OP } from '@sigx/lynx-runtime-internal';
import type { BuiltinMapperName, MapperParams } from '@sigx/lynx-runtime-internal';

import type { SharedValue } from './shared-value';

// Re-export the public types so users can write
//   import type { BuiltinMapperName } from '@sigx/lynx'
// without reaching into lynx-runtime-internal directly.
export type { BuiltinMapperName, MapperParams };

let nextBindingId = 1;

/** Reset hook for tests. */
export function resetAnimatedStyleBindingIds(): void {
  nextBindingId = 1;
}

/**
 * Returns the next binding id without incrementing — internal helper used by
 * the `useAnimatedStyle` overloads to share allocation. Not exported.
 */
function allocBindingId(): number {
  return nextBindingId++;
}

/**
 * Bind a `MainThreadRef`'s element style to a `SharedValue` via a named
 * mapper. The MT-side runtime applies the mapper's output via
 * `setStyleProperties` on every flush boundary where the SharedValue's value changed.
 *
 * The mapper runs on the **Main Thread** with no thread crossing per frame —
 * the only inputs are the SharedValue's value (already on MT) and the `params` shipped
 * once in the registration op. Because mappers are looked up by *name*, the
 * SWC worklet transform doesn't have to capture a function reference (which
 * it can't), so this fits the existing worklet pipeline cleanly.
 *
 * Multiple bindings on the same element compose into a single
 * `setStyleProperties` call per flush. `transform` outputs concatenate in
 * registration order (e.g. `translateX(50px) translateY(20px)`); other style
 * keys merge by last-write-wins. When ANY binding on an element is dirty,
 * ALL of that element's bindings re-run so partial outputs don't drop the
 * unchanged-axis contribution.
 *
 * @example Ghost follower at 0.5×
 * ```tsx
 * const tx = useSharedValue(0);
 * const ghostRef = useMainThreadRef<MainThread.Element | null>(null);
 *
 * useAnimatedStyle(ghostRef, tx, 'translateX', { factor: 0.5 });
 *
 * <Draggable translateX={tx} />
 * <view main-thread:ref={ghostRef} style={...} />
 * ```
 */
export function useAnimatedStyle<N extends BuiltinMapperName>(
  elRef: MainThreadRef<MainThread.Element | null>,
  sv: SharedValue<unknown>,
  mapperName: N,
  params?: MapperParams[N],
): void {
  const bindingId = allocBindingId();

  pushOp(
    OP.REGISTER_AV_STYLE_BINDING,
    bindingId,
    elRef._wvid,
    sv._wvid,
    mapperName,
    params ?? null,
  );
  scheduleFlush();

  onUnmounted(() => {
    pushOp(OP.UNREGISTER_AV_STYLE_BINDING, bindingId);
    scheduleFlush();
  });
}
