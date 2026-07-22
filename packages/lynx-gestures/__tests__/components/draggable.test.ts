import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  effect,
  ingestAvPublishes,
  resetBgAvBridge,
  resetOpQueue,
  resetWvidCounter,
  useSharedValue,
} from '@sigx/lynx';
import { Draggable } from '../../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/Draggable.tsx');

describe('Draggable', () => {
  it('is exported as a component factory', () => {
    expect(typeof Draggable).toBe('function');
  });

  it('source attaches a Gesture.Pan() via useGestureDetector with the four lifecycle worklets', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/Gesture\.Pan\(\)/);
    expect(src).toMatch(/useGestureDetector\(elRef, pan\)/);
    // onBegin (no-op, load-bearing on iOS), onStart, onUpdate, onEnd — all
    // carry the 'main thread' directive so the SWC LEPUS pass extracts them.
    expect(src).toMatch(/\.onBegin\(\(\) => \{/);
    expect(src).toMatch(/\.onStart\(\(e: any\) => \{/);
    expect(src).toMatch(/\.onUpdate\(\(e: any\) => \{/);
    expect(src).toMatch(/\.onEnd\(\(\) => \{/);
    const directiveCount = (src.match(/'main thread'/g) || []).length;
    expect(directiveCount).toBeGreaterThanOrEqual(4);
    // Old bindtouch* path is fully removed — the native gesture arena is the
    // sole source of truth now (enableNewGesture: true in lynx-plugin).
    expect(src).not.toMatch(/main-thread-bindtouch/);
  });

  it('source uses .minDistance(threshold) for native threshold gating', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/\.minDistance\(threshold\)/);
  });

  it('source drives transform via useAnimatedStyle bindings, not direct setStyleProperties', () => {
    // After the Phase 2.7 follow-up refactor, Draggable registers two
    // useAnimatedStyle bindings (translateX + translateY) instead of writing
    // the transform directly from the touchmove worklet. This is what makes
    // external animation of tx/ty (e.g. `withSpring(tx, 0)`) visually move
    // the element.
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/useAnimatedStyle\(elRef, tx, 'translateX'\)/);
    expect(src).toMatch(/useAnimatedStyle\(elRef, ty, 'translateY'\)/);
    // No direct transform write should remain in the worklets.
    expect(src).not.toMatch(/setStyleProperties\(\{[^}]*transform:/);
  });

  it('source flushes the element tree after touchmove SV writes', () => {
    // The bridge applies bindings on flush boundaries. Direct
    // setStyleProperties used to flush as a side effect; after the refactor
    // the worklet must trigger the flush itself (same pattern as ScrollView).
    const src = readFileSync(SRC, 'utf8');
    expect(src).toContain("['__FlushElementTree']");
  });

  it('source emits dragStart and dragEnd via runOnBackground', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toContain('runOnBackground');
    expect(src).toContain("emit('dragStart'");
    expect(src).toContain("emit('dragEnd'");
  });

  it('source picks tx/ty from props with own-SV fallback at setup', () => {
    // The pick lives at setup (outside the render closure) so the
    // useAnimatedStyle bindings hold stable refs. Worklet `_c` captures
    // close over the same identifiers.
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/const tx = props\.translateX \?\? ownTx;/);
    expect(src).toMatch(/const ty = props\.translateY \?\? ownTy;/);
  });

  it('source wires edgeScroll: prop + viewport measure + scrollBy invoke + rAF tick', () => {
    // Phase 2.13 source-shape audit. Pin to the load-bearing pieces of the
    // edge-scroll path so a refactor that removes one of them surfaces here
    // before the MT e2e suite catches the behavior regression.
    const src = readFileSync(SRC, 'utf8');
    // Prop is part of the public type.
    expect(src).toMatch(/EdgeScrollConfig/);
    expect(src).toMatch(/props\.edgeScroll/);
    // Lazy viewport measurement in onStart via the context's scrollViewRef.
    // Uses the runtime's measureViewportRect (viewport geometry, transform-
    // aware, consistent across iOS + Android) — getComputedStyleProperty was
    // unreliable on Android.
    expect(src).toMatch(/scrollCtx\.scrollViewRef\.current/);
    expect(src).toMatch(/measureViewportRect\(svRef/);
    // The rAF tick exists and drives scroll via the scroll-view's invoke.
    expect(src).toMatch(/invoke\('scrollBy'/);
    expect(src).toMatch(/requestAnimationFrame/);
    // Active flag is the gate for both schedule + self-cancel.
    expect(src).toMatch(/edgeScrollActive/);
  });

  it('a SharedValue passed to <Draggable translateX> is BG-observable', () => {
    // Phase 2.10 audit: confirms the bridge wired in Phase 2.5 still carries
    // MT writes back to BG for SVs the user hands to <Draggable>. Draggable
    // passes the prop through unchanged (see prop-or-fallback above), so
    // proving the contract on the user-facing SV is sufficient. If a future
    // refactor wraps or replaces the SV internally, this test will need to
    // grow alongside that change — which is the point.
    resetOpQueue();
    resetBgAvBridge();
    resetWvidCounter();

    const tx = useSharedValue(0);
    const seen: number[] = [];
    effect(() => { seen.push(tx.value); });
    ingestAvPublishes([[tx._wvid, 42]]);
    expect(seen).toEqual([0, 42]);
  });
});
