/**
 * Source-shape tests for `<SheetDragAdapter>` — MT gesture worklets never
 * execute under vitest (they run in the Lynx main-thread bundle), so these
 * pin the load-bearing shapes of the adapter that wires the navigator into
 * `@sigx/lynx-sheet`'s shared engine/pan (whose arbitration + release math
 * carry their own unit coverage in that package). The BG-side stack model
 * is covered in sheet.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src/components/SheetDragAdapter.tsx');
const STACK_SRC = resolve(HERE, '../src/components/Stack.tsx');

describe('SheetDragAdapter source shape', () => {
    const src = readFileSync(SRC, 'utf8');

    it('is renderless and attaches the shared pan to the sheet host ref', () => {
        expect(src).toMatch(/useGestureDetector\(props\.hostRef, pan\)/);
        expect(src).toMatch(/return \(\) => null;/);
        // No view of its own, no bespoke gesture logic — the engine owns it.
        expect(src).not.toMatch(/<view/);
        expect(src).not.toMatch(/Gesture\.Pan\(\)/);
    });

    it('drives the shared engine with the navigator-injected reveal SV', () => {
        expect(src).toMatch(/useSheetEngine\(\{/);
        expect(src).toMatch(/reveal: sheetReveal/);
        expect(src).toMatch(/createSheetPan\(engine, \{/);
        expect(src).toMatch(/surface: true/);
    });

    it('pushes geometry + gate through syncGeom (a BG SV write never arrives, #758)', () => {
        // dismissible=1 (route sheets drag-dismiss), gate=1 (mount implies
        // drag enabled — the slot unmounts the adapter otherwise).
        expect(src).toMatch(/syncGeom\(floorPx, topPx, detentsPx, 1, 1, SCREEN_HEIGHT\)/);
    });

    it('arbitrates on the drag host handles (adopted scroll offset + presence)', () => {
        expect(src).toMatch(/scrollOffsetY: props\.dragHost\.scrollOffsetY/);
        expect(src).toMatch(/hasVerticalScroll: props\.dragHost\.hasVerticalScroll/);
        // Screen-anchored bottom edge travels via syncGeom (6th arg).
        expect(src).toMatch(/syncGeom\(floorPx, topPx, detentsPx, 1, 1, SCREEN_HEIGHT\)/);
    });

    it('threads grabberPx (#711) into the pan and the Stack remount key', () => {
        expect(src).toContain('grabberPx: props.grabberPx ?? GRABBER_HEIGHT');
        const stack = readFileSync(resolve(HERE, '../src/components/Stack.tsx'), 'utf8');
        expect(stack).toMatch(/key=\{`drag-\$\{props\.detentsPx\.join\('_'\)\}-\$\{props\.dragMode\}-\$\{props\.grabberPx \?\? 'd'\}`\}/);
        expect(stack).toContain('grabberPx: options?.grabberPx');
    });

    it('gen-guards the delayed settle/dismiss commit against a newer grab', () => {
        const release = src.slice(src.indexOf('onRelease'));
        expect(release).toMatch(/setTimeout\(/);
        expect(release).toMatch(/if \(genSignal\.value !== gen\) return;/);
        expect(release).toContain('SNAP_MS');
    });

    it('records the detent before releasing the gesture lock (no unlock gap)', () => {
        const release = src.slice(src.indexOf('onRelease'));
        const settleIdx = release.indexOf('onSettle(');
        const unlockIdx = release.indexOf('onGestureLock(false)');
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

    it('remount-keys the adapter by detent signature + drag mode + grabber (static worklet captures)', () => {
        expect(src).toContain("key={`drag-${props.detentsPx.join('_')}-${props.dragMode}-${props.grabberPx ?? 'd'}`}");
    });

    it('composes rest-lock and gesture-lock into the single host scrollLock', () => {
        expect(src).toContain('dragHost.scrollLock.value = restLock || gestureLock.value');
        // Rest-lock only when the body can drag the sheet — 'grabber'/'none'
        // modes must keep content scrollable at every detent.
        expect(src).toMatch(/props\.restingBelowMax\s*&&\s*props\.dragEnabled\s*&&\s*props\.dragMode === 'surface'/);
    });

    it('the bespoke controller and grabber-strip overlay are fully gone', () => {
        expect(src).not.toContain('SheetDragController');
        expect(src).not.toContain('SheetDragHandle');
        expect(src).not.toContain('sheetHandle');
    });
});
