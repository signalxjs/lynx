/**
 * Source-shape tests for the unified sheet pan and engine — MT gesture
 * worklets never execute under vitest (they run in the Lynx main-thread
 * bundle), so these pin the load-bearing shapes of the implementation the
 * way lynx-navigation's sheet-drag-controller.test.ts pinned the original.
 * The arbitration decisions themselves are real unit tests in
 * decide-owner.test.ts; the release math in math.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRAG_SRC = resolve(HERE, '../src/drag.ts');
const ENGINE_SRC = resolve(HERE, '../src/engine.ts');

describe('createSheetPan source shape', () => {
    const src = readFileSync(DRAG_SRC, 'utf8');

    it('pan is vertical-only with tap passthrough', () => {
        expect(src).toMatch(/\.axis\('y'\)/);
        expect(src).toMatch(/\.minDistance\(cfg\.minDistance \?\? MIN_DISTANCE\)/);
    });

    it('every claim cancels the in-flight settle tween (plain SV writes do not)', () => {
        // Handle mode claims in onStart; surface mode claims in onUpdate —
        // both must cancel, or the tween fights the finger.
        const onStart = src.slice(src.indexOf('.onStart('), src.indexOf('.onUpdate('));
        const onUpdate = src.slice(src.indexOf('.onUpdate('), src.indexOf('.onEnd('));
        expect(onStart).toContain('cancelAnimation(reveal)');
        expect(onUpdate).toContain('cancelAnimation(reveal)');
    });

    it('surface arbitration delegates to decideDragOwner with live SV reads', () => {
        const onUpdate = src.slice(src.indexOf('.onUpdate('), src.indexOf('.onEnd('));
        expect(onUpdate).toContain('decideDragOwner({');
        expect(onUpdate).toContain('combined.current.value');
        expect(onUpdate).toContain('scrollOffsetY.current.value');
        expect(onUpdate).toContain('hasVerticalScroll.current.value');
    });

    it('non-sheet gestures end passively: no snap, no BG hop (web pointercancel path)', () => {
        const onEnd = src.slice(src.indexOf('.onEnd('));
        const passive = onEnd.slice(0, onEnd.indexOf('drag.current.owner = OWNER_UNDECIDED;', onEnd.indexOf('OWNER_SHEET')));
        expect(passive).not.toContain('runOnBackground');
        expect(passive).not.toContain('withTiming');
    });

    it('release checks dismiss before detent snapping, and hops with the claim gen', () => {
        const onEnd = src.slice(src.indexOf('.onEnd('));
        const dismissIdx = onEnd.indexOf('shouldDismiss(');
        const snapIdx = onEnd.indexOf('nearestDetentIndex(');
        expect(dismissIdx).toBeGreaterThan(-1);
        expect(snapIdx).toBeGreaterThan(dismissIdx);
        const hops = onEnd.match(/runOnBackground\(onRelease\)\((RELEASE_DISMISS|RELEASE_SNAP), [^)]+, drag\.current\.gen\)/g) || [];
        expect(hops.length).toBe(2);
    });

    it('openToLift substitutes the captured rest as the middle snap candidate', () => {
        const onEnd = src.slice(src.indexOf('.onEnd('));
        expect(onEnd).toContain('openRestRef.current.rest');
        expect(onEnd).toContain('geomRef.current.detents');
    });

    it('surface mode fails fast at setup when its required SVs are missing', () => {
        const setup = src.slice(0, src.indexOf('.onBegin('));
        expect(setup).toMatch(/surface === 1 && \(!scrollOffsetY \|\| !hasVerticalScroll\)/);
        expect(setup).toContain('throw new Error');
    });

    it('worklets read geometry from geomRef only — no BG lexical geometry captures (#743)', () => {
        // The drag clamp and candidates must go through the main-thread ref
        // the render syncs, never through captured numbers.
        const handlers = src.slice(src.indexOf('.onStart('));
        expect(handlers).toContain('geomRef.current.min');
        expect(handlers).toContain('geomRef.current.max');
        expect(handlers).toContain('geomRef.current.dismissible');
        // The drag gate too: a render-side `sv.value =` write is a BG
        // no-op (#758), so the gate must be read from the synced ref, and
        // no SV may be render-written anywhere in the sheet component.
        expect(handlers).toContain('geomRef.current.gate');
        expect(handlers).toContain('geomRef.current.bottomEdge');
    });
});

describe('useSheetEngine source shape', () => {
    const src = readFileSync(ENGINE_SRC, 'utf8');

    it('syncGeom clamps stranded reveal and captured rest when detents shrink', () => {
        const sync = src.slice(src.indexOf('const syncGeom'), src.indexOf('const setReveal'));
        expect(sync).toContain('cancelAnimation(reveal)');
        expect(sync).toContain('openRestRef.current.rest = rest');
        // A dismissible sheet parked at reveal 0 must NOT be pulled up to
        // the floor by a geometry sync.
        expect(sync).toContain('dismissible === 0 && r < min');
    });

    it('openToLift capture reads the LIVE combined value on the MT', () => {
        const set = src.slice(src.indexOf('const setReveal'), src.indexOf('// Per-gesture transient'));
        expect(set).toContain('combined.current.value');
        expect(set).toContain('openRestRef.current.rest = c');
        // Jump path writes the SV directly; animate path tweens.
        expect(set).toContain('withTiming(reveal, t');
        expect(set).toContain('reveal.current.value = t');
    });

    it('the snap emit is debounced — only the latest release settles', () => {
        expect(src).toContain('clearTimeout(snapTimer)');
        expect(src).toMatch(/onUnmounted\(/);
    });
});
