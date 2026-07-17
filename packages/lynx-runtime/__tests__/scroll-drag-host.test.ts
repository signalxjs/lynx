/**
 * Tests for `ScrollDragHost` — the drag↔scroll coordination primitive a
 * full-surface drag container (bottom sheet) provides and a scrollable
 * descendant adopts. BG-side allocation + adoption bookkeeping only; the
 * MT worklet consumption lives with the providers/adopters (lynx-navigation
 * / lynx-gestures).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { resetOpQueue } from '../src/op-queue';
import { MainThreadRef, resetWvidCounter } from '../src/main-thread-ref';
import { resetBgAvBridge } from '../src/animated-bridge';
import { SharedValue } from '../src/animated/shared-value';
import { useCreateScrollDragHost, useScrollDragHost } from '../src/scroll-drag-host';

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
});

describe('useCreateScrollDragHost', () => {
  it('eagerly allocates every cross-thread handle', () => {
    const host = useCreateScrollDragHost();

    expect(host.scrollOffsetY).toBeInstanceOf(SharedValue);
    expect(host.hasVerticalScroll).toBeInstanceOf(SharedValue);
    expect(host.scrollRef).toBeInstanceOf(MainThreadRef);
    expect(host.scrollOffsetY.value).toBe(0);
    expect(host.hasVerticalScroll.value).toBe(0);
    expect(host.scrollLock.value).toBe(false);
  });

  it('first adopter wins; later adopters get null', () => {
    const host = useCreateScrollDragHost();

    const release = host.adoptVerticalScroll();
    expect(typeof release).toBe('function');
    expect(host.adoptVerticalScroll()).toBeNull();
  });

  it('release frees the slot for re-adoption', () => {
    const host = useCreateScrollDragHost();

    const release = host.adoptVerticalScroll()!;
    release();

    const second = host.adoptVerticalScroll();
    expect(typeof second).toBe('function');
  });

  it('hosts are independent', () => {
    const a = useCreateScrollDragHost();
    const b = useCreateScrollDragHost();

    expect(a.adoptVerticalScroll()).not.toBeNull();
    expect(b.adoptVerticalScroll()).not.toBeNull();
    expect(a.scrollOffsetY._wvid).not.toBe(b.scrollOffsetY._wvid);
  });
});

describe('useScrollDragHost', () => {
  it('defaults to null outside any provider', () => {
    expect(useScrollDragHost()).toBeNull();
  });
});
