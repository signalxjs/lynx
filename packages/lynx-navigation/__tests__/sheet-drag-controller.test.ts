/**
 * Source-shape tests for `<SheetDragController>` — MT gesture worklets
 * never execute under vitest (they run in the Lynx main-thread bundle), so
 * these pin the load-bearing shapes of the arbitration implementation the
 * way lynx-gestures' draggable.test.ts pins its flush call. The BG-side
 * stack model is covered in sheet.test.tsx; the release math in
 * sheet-math.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src/components/SheetDragController.tsx');
const STACK_SRC = resolve(HERE, '../src/components/Stack.tsx');

describe('SheetDragController source shape', () => {
    const src = readFileSync(SRC, 'utf8');

    it('is a renderless full-surface pan on the host ref (no strip view)', () => {
        expect(src).toMatch(/useGestureDetector\(hostRef, pan\)/);
        expect(src).toMatch(/return \(\) => null;/);
        // The old 28px overlay strip is gone — no rendered view, no
        // edge-tracking animated binding of its own.
        expect(src).not.toMatch(/<view/);
        expect(src).not.toMatch(/useAnimatedStyle/);
    });

    it('pan is vertical-only with tap passthrough', () => {
        expect(src).toMatch(/\.axis\('y'\)/);
        expect(src).toMatch(/\.minDistance\(MIN_DISTANCE\)/);
    });

    it('claiming cancels the in-flight settle tween (plain SV writes do not)', () => {
        // Slice the onUpdate worklet so the assertion can't be satisfied
        // elsewhere in the file.
        const onUpdate = src.slice(src.indexOf('.onUpdate('), src.indexOf('.onEnd('));
        expect(onUpdate).toContain('cancelAnimation(sheetProgress)');
    });

    it('arbitrates on the drag host handles (adopted scroll offset + presence)', () => {
        const onUpdate = src.slice(src.indexOf('.onUpdate('), src.indexOf('.onEnd('));
        expect(onUpdate).toContain('hasVerticalScroll.current.value');
        expect(onUpdate).toContain('scrollOffsetY.current.value <= 0');
    });

    it('gen-guards every delayed settle/dismiss timeout', () => {
        const onEnd = src.slice(src.indexOf('.onEnd('));
        const guards = onEnd.match(/if \(genSignal\.value !== g\) return;/g) || [];
        expect(guards.length).toBe(2); // dismiss + snap paths
    });

    it('records the detent before releasing the gesture lock (no unlock gap)', () => {
        const onEnd = src.slice(src.indexOf('.onEnd('));
        const settleIdx = onEnd.indexOf('onSettle(t)');
        const unlockIdx = onEnd.indexOf('onGestureLock(false)');
        expect(settleIdx).toBeGreaterThan(-1);
        expect(unlockIdx).toBeGreaterThan(settleIdx);
    });
});

describe('Stack sheet-drag wiring source shape', () => {
    const src = readFileSync(STACK_SRC, 'utf8');

    it('SheetSlot provides the scroll-drag host eagerly and owns the Layer host ref', () => {
        expect(src).toContain('useCreateScrollDragHost()');
        expect(src).toMatch(/defineProvide\(useScrollDragHost/);
        expect(src).toMatch(/hostRef=\{hostRef\}/);
    });

    it('composes rest-lock and gesture-lock into the single host scrollLock', () => {
        expect(src).toContain(
            'dragHost.scrollLock.value = props.restingBelowMax || gestureLock.value',
        );
    });

    it('the old grabber-strip overlay is fully gone', () => {
        expect(src).not.toContain('SheetDragHandle');
        expect(src).not.toContain('sheetHandle');
    });
});
