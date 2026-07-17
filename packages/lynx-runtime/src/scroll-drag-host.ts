import { defineInjectable, onUnmounted } from '@sigx/runtime-core';
import { signal, type PrimitiveSignal } from '@sigx/reactivity';

import { MainThreadRef } from './main-thread-ref.js';
import { useSharedValue, type SharedValue } from './animated/shared-value.js';
import type { MainThread } from './jsx.js';

/**
 * Drag↔scroll coordination host, provided by a full-surface drag container
 * (e.g. lynx-navigation's bottom sheet) and adopted by a scrollable
 * descendant (e.g. lynx-gestures' `<ScrollView>`).
 *
 * Why this exists: Lynx's `<scroll-view>` does not participate in the
 * gesture arena on iOS (see lynx-gestures' `scroll-context.ts`), so a Pan
 * on an ANCESTOR of scrollable content can't arbitrate against the native
 * scroll through arena relations. The working protocol is cooperative:
 * the drag host reads the scrollable's live offset to decide gesture
 * ownership, and the scrollable gates its `enable-scroll` on the host's
 * lock signal while the host owns a drag.
 *
 * The host allocates every cross-thread handle EAGERLY (SharedValues, the
 * element ref) because MT worklet captures are static at register time —
 * the host's pan worklet can only read SharedValue identities that exist
 * when the gesture registers. A scrollable that mounts later ADOPTS the
 * pre-allocated handles (mirrors its offset into `scrollOffsetY`, binds
 * `scrollRef` as its `main-thread:ref`) rather than publishing its own.
 *
 * This lives in the runtime (not lynx-gestures) so that providers and
 * adopters need no dependency edge between them — the same reason
 * SharedValue itself moved gestures → runtime. It is intentionally
 * direction-inverted from lynx-gestures' `ScrollContext` (ScrollView →
 * gesture children); the two are siblings, not replacements.
 */
export interface ScrollDragHost {
  /**
   * BG-side lock. The host flips it true while its drag owns the touch;
   * adopting (and non-adopted vertical) scrollables gate `enable-scroll`
   * on it. Hosts may also hold it true at rest (e.g. a sheet resting
   * below its max detent locks content scroll entirely).
   */
  scrollLock: PrimitiveSignal<boolean>;
  /**
   * Live vertical scroll offset of the adopted scrollable, mirrored from
   * its scroll worklet. Stays 0 while nothing is adopted (release resets
   * it), so host worklets can treat "no scroll" and "at top" uniformly.
   */
  scrollOffsetY: SharedValue<number>;
  /** 1 while a vertical scrollable is adopted, else 0 — host worklets branch on it. */
  hasVerticalScroll: SharedValue<number>;
  /**
   * Host-allocated MT element ref the adopted scrollable binds as its
   * `main-thread:ref`, letting host worklets drive it directly via
   * `invoke('getScrollInfo' | 'scrollBy', ...)`.
   */
  scrollRef: MainThreadRef<MainThread.Element | null>;
  /**
   * Claim the (single) adopted-scrollable slot. First vertical scrollable
   * wins; returns a release fn to call on unmount, or `null` when the slot
   * is already taken (the caller should not adopt, but may still gate on
   * `scrollLock`).
   */
  adoptVerticalScroll(): (() => void) | null;
}

/**
 * Nearest drag↔scroll host, or `null` outside any full-surface drag
 * container. Scrollable components branch on presence.
 */
export const useScrollDragHost = defineInjectable<ScrollDragHost | null>(() => null);

/**
 * Allocate a `ScrollDragHost` (call in the providing component's setup —
 * SharedValue lifecycles bind to it). Adoption bookkeeping lives here:
 * first caller of `adoptVerticalScroll()` wins; its release hands the slot
 * back. The SharedValue writes belong to the ADOPTER (it owns a worklet
 * context; SVs are MT-write-only): set `hasVerticalScroll` to 1 on adopt,
 * and reset it AND `scrollOffsetY` to 0 on release so a stale offset can't
 * outlive the scrollable that produced it. The host itself stays
 * worklet-free and only tracks slot occupancy.
 */
export function useCreateScrollDragHost(): ScrollDragHost {
  const scrollLock = signal(false);
  const scrollOffsetY = useSharedValue(0);
  const hasVerticalScroll = useSharedValue(0);
  const scrollRef = new MainThreadRef<MainThread.Element | null>(null);

  let adopted = false;
  const host: ScrollDragHost = {
    scrollLock,
    scrollOffsetY,
    hasVerticalScroll,
    scrollRef,
    adoptVerticalScroll() {
      if (adopted) return null;
      adopted = true;
      return () => {
        adopted = false;
      };
    },
  };

  onUnmounted(() => {
    adopted = false;
  });

  return host;
}
