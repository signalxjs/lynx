/**
 * `computeLayers` unit tests. This is the pure function that powers
 * Stack's render — given (stack, transition, progress), produce the
 * ordered list of visible layers + their animation specs. Locking the
 * behaviour down here means future transition-rendering tweaks don't
 * silently regress the rules (modal preserves underneath, card
 * replaces, stacked overlays preserve everything below the animated
 * top, etc.) without a noticeable test failure.
 */
import { describe, expect, it } from 'vitest';
import { useSharedValue, type SharedValue } from '@sigx/lynx';
import {
    backdropAnimation,
    computeLayers,
    MAX_LAYERS,
    SHEET_BACKDROP_MAX_OPACITY,
    type SheetLayerContext,
} from '../src/internal/layer-plan';
import { SCREEN_HEIGHT } from '../src/internal/screen-width';
import type { Presentation, StackEntry, TransitionState } from '../src/types';

function entry(key: string, route: string, presentation: Presentation = 'card'): StackEntry {
    return {
        key,
        route,
        params: {},
        search: {},
        state: undefined,
        presentation,
    };
}

// `useSharedValue` returns a real SharedValue<number>. Created inside
// the test body, never written to — we just need a reference that can
// flow through the transition spec.
function fakeProgress(): SharedValue<number> {
    return useSharedValue(0);
}

/**
 * Sheet context with snaps [0.4, 0.9]: max fraction 0.9 → fully-open rest
 * offset 0.1 * SCREEN_HEIGHT; covered sheets rest at the same offset via
 * the static lookup.
 */
function sheetCtx(sheetProgress: SharedValue<number> | null): SheetLayerContext {
    return {
        sheetProgress,
        maxSnapFraction: 0.9,
        staticOffsetY: () => 0.1 * SCREEN_HEIGHT,
    };
}

describe('computeLayers — idle (no transition)', () => {
    it('renders just the single entry on a one-deep stack', () => {
        const a = entry('a', 'home');
        const layers = computeLayers([a], null, null);
        expect(layers).toEqual([{ entry: a, animation: null, hidden: false }]);
    });

    it('retains covered cards as hidden layers beneath the top', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const layers = computeLayers([a, b], null, null);
        // Card retention: `a` stays mounted as a hidden layer beneath the
        // visible top `b`, instead of unmounting (issue #124).
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'b']);
        expect(layers.every((l) => l.animation === null)).toBe(true);
        expect(layers.map((l) => l.hidden)).toEqual([true, false]);
    });

    it('retains every covered card in a deep all-card stack, deepest first', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const c = entry('c', 'more');
        const layers = computeLayers([a, b, c], null, null);
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'b', 'c']);
        // Only the top is visible; `a` and `b` are retained hidden.
        expect(layers.map((l) => l.hidden)).toEqual([true, true, false]);
        expect(layers.every((l) => l.animation === null)).toBe(true);
    });

    it('preserves the card base (visible) under an overlay', () => {
        const a = entry('a', 'home');
        const m = entry('m', 'modal-route', 'modal');
        const layers = computeLayers([a, m], null, null);
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'm']);
        expect(layers.every((l) => l.animation === null)).toBe(true);
        // The base card stays visible (transparent-modal shows through);
        // neither layer is hidden.
        expect(layers.every((l) => l.hidden === false)).toBe(true);
    });

    it('retains cards below the base card even when an overlay covers it', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const m = entry('m', 'modal-route', 'modal');
        const layers = computeLayers([a, b, m], null, null);
        // Base card `b` + overlay `m` are visible; `a` is retained hidden.
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'b', 'm']);
        expect(layers.map((l) => l.hidden)).toEqual([true, false, false]);
    });

    it('preserves every overlay between the base and the top of stacked overlays', () => {
        const a = entry('a', 'home');
        const m1 = entry('m1', 'modal-a', 'modal');
        const m2 = entry('m2', 'modal-b', 'transparent-modal');
        const layers = computeLayers([a, m1, m2], null, null);
        // Base + two overlays = three static layers.
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'm1', 'm2']);
        expect(layers.every((l) => l.animation === null)).toBe(true);
    });

    it('walks past intermediate overlays to find the visible card base', () => {
        // Mixed stack: card, card-on-card, modal on top. Visible base =
        // the top card `b`; `a` is retained hidden below it.
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const m = entry('m', 'modal-route', 'modal');
        const layers = computeLayers([a, b, m], null, null);
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'b', 'm']);
        expect(layers.map((l) => l.hidden)).toEqual([true, false, false]);
    });
});

describe('computeLayers — card transitions', () => {
    it('emits both participants with parallax + slide on a card push', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'push',
            topEntry: b,
            underneathEntry: a,
            progress,
        };
        const layers = computeLayers([a, b], transition, progress);
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'b']);
        // Underneath parallaxes left; top slides in from right.
        expect(layers[0].animation?.mapperName).toBe('translateX');
        expect(layers[0].animation?.outputRange[0]).toBe(0);
        expect(layers[0].animation?.outputRange[1]).toBeLessThan(0);
        expect(layers[1].animation?.mapperName).toBe('translateX');
        expect(layers[1].animation?.outputRange[0]).toBeGreaterThan(0);
        expect(layers[1].animation?.outputRange[1]).toBe(0);
    });

    it('emits both participants with reverse animation on a card pop', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'pop',
            topEntry: b,           // being animated off
            underneathEntry: a,    // sliding back in
            progress,
        };
        const layers = computeLayers([a, b], transition, progress);
        // Pop reverses the push direction.
        expect(layers[0].animation?.outputRange[1]).toBe(0);     // underneath ends at 0 (centered)
        expect(layers[1].animation?.outputRange[1]).toBeGreaterThan(0); // top slides off right
    });

    it('produces static layers when progress is null (animations disabled)', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const transition: TransitionState = {
            kind: 'push',
            topEntry: b,
            underneathEntry: a,
            progress: null as never,
        };
        const layers = computeLayers([a, b], transition, null);
        expect(layers.every((l) => l.animation === null)).toBe(true);
    });

    it('retains cards below the underneath during a deep-stack push', () => {
        // Push D onto [A,B,C]: the stack appends eagerly, so during the
        // transition stack = [A,B,C,D], top = D, underneath = C.
        const a = entry('a', 'home');
        const b = entry('b', 'b');
        const c = entry('c', 'c');
        const d = entry('d', 'd');
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'push',
            topEntry: d,
            underneathEntry: c,
            progress,
        };
        const layers = computeLayers([a, b, c, d], transition, progress);
        // A and B retained hidden; C + D animate. D is last (highest slot).
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'b', 'c', 'd']);
        expect(layers.map((l) => l.hidden)).toEqual([true, true, false, false]);
        expect(layers[2].animation?.mapperName).toBe('translateX');
        expect(layers[3].animation?.mapperName).toBe('translateX');
    });

    it('retains cards below the underneath during a deep-stack pop (issue #124 deep case)', () => {
        // Animated pop of C from [A,B,C] keeps C on the stack until the
        // slide finishes: top = C, underneath = B.
        const a = entry('a', 'home');
        const b = entry('b', 'b');
        const c = entry('c', 'c');
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'pop',
            topEntry: c,
            underneathEntry: b,
            progress,
        };
        const layers = computeLayers([a, b, c], transition, progress);
        // A stays mounted (hidden) rather than unmounting during the
        // transition; B + C animate.
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'b', 'c']);
        expect(layers.map((l) => l.hidden)).toEqual([true, false, false]);
        expect(layers[0].animation).toBeNull();
    });

    it('retains nothing when the underneath is not on the stack (no negative slice)', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const ghost = entry('ghost', 'detail'); // not in stack
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'pop',
            topEntry: ghost,
            underneathEntry: ghost,
            progress,
        };
        const layers = computeLayers([a, b], transition, progress);
        // visBaseIdx falls back to 0 → no retained layers, just the two
        // animated participants.
        expect(layers.map((l) => l.entry.key)).toEqual(['ghost', 'ghost']);
        expect(layers).toHaveLength(2);
    });
});

describe('computeLayers — retention bounds', () => {
    it('caps retained covered cards at maxRetained, trimming the deepest', () => {
        const a = entry('a', 'a');
        const b = entry('b', 'b');
        const c = entry('c', 'c');
        const d = entry('d', 'd');
        // Idle [a,b,c,d]: c,b,a are covered. maxRetained=1 keeps only the
        // nearest covered card (c); a and b are trimmed off the front.
        const layers = computeLayers([a, b, c, d], null, null, 1);
        expect(layers.map((l) => l.entry.key)).toEqual(['c', 'd']);
        expect(layers.map((l) => l.hidden)).toEqual([true, false]);
    });

    it('retains everything when maxRetained is undefined', () => {
        const a = entry('a', 'a');
        const b = entry('b', 'b');
        const c = entry('c', 'c');
        const layers = computeLayers([a, b, c], null, null);
        expect(layers).toHaveLength(3);
    });

    it('caps total layers at MAX_LAYERS, keeping the visible top', () => {
        const stack = Array.from({ length: MAX_LAYERS + 2 }, (_, i) =>
            entry(`e${i}`, `route-${i}`),
        );
        const layers = computeLayers(stack, null, null);
        expect(layers).toHaveLength(MAX_LAYERS);
        // The visible top (last entry) always survives the front-trim.
        expect(layers[layers.length - 1].entry.key).toBe(`e${MAX_LAYERS + 1}`);
        expect(layers[layers.length - 1].hidden).toBe(false);
        // The deepest entries were trimmed.
        expect(layers[0].entry.key).toBe('e2');
    });
});

describe('computeLayers — overlay transitions', () => {
    it('keeps the card base static and animates only the overlay top on a modal push', () => {
        const a = entry('a', 'home');
        const m = entry('m', 'modal-route', 'modal');
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'push',
            topEntry: m,
            underneathEntry: a,
            progress,
        };
        const layers = computeLayers([a, m], transition, progress);
        // Base stays static; modal animates in via translateY.
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'm']);
        expect(layers[0].animation).toBeNull();
        expect(layers[1].animation?.mapperName).toBe('translateY');
        expect(layers[1].animation?.outputRange[0]).toBeGreaterThan(0);
        expect(layers[1].animation?.outputRange[1]).toBe(0);
    });

    it('preserves every static layer below the popping overlay on a stacked-overlay pop', () => {
        // Stack: card base + two modals. Pop the topmost modal.
        const a = entry('a', 'home');
        const m1 = entry('m1', 'modal-a', 'modal');
        const m2 = entry('m2', 'modal-b', 'transparent-modal');
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'pop',
            topEntry: m2,           // animating off
            underneathEntry: m1,    // the destination
            progress,
        };
        // During the pop, `m2` is still in the stack (animated-pop
        // defers the stack mutation until the animation completes).
        const layers = computeLayers([a, m1, m2], transition, progress);
        // The base + every static layer up through underneath (m1)
        // stays mounted. The animating m2 is the last layer.
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'm1', 'm2']);
        expect(layers[0].animation).toBeNull();
        expect(layers[1].animation).toBeNull();
        expect(layers[2].animation?.mapperName).toBe('translateY');
    });

    it('keeps a covered sheet at its static offset during a modal push above it', () => {
        // Stack: card base + resting sheet; push a modal on top. The sheet
        // joins the static run but must keep its partial-height position.
        const a = entry('a', 'home');
        const s = entry('s', 'sheet-route', 'sheet');
        const m = entry('m', 'modal-route', 'modal');
        const progress = fakeProgress();
        const sv = fakeProgress();
        const transition: TransitionState = {
            kind: 'push',
            topEntry: m,
            underneathEntry: s,
            progress,
        };
        const layers = computeLayers([a, s, m], transition, progress, undefined, sheetCtx(sv));
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 's', 'm']);
        expect(layers[1].animation).toBeNull();
        expect(layers[1].staticOffsetY).toBe(0.1 * SCREEN_HEIGHT);
        expect(layers[2].animation?.mapperName).toBe('translateY');
    });

    it('falls back to the stack top when the underneath has already been removed', () => {
        // Defensive: if the underneath isn't found in the stack (e.g.
        // mid-pop where setStack ran before setTransition cleared),
        // anchor on the current top.
        const a = entry('a', 'home');
        const m = entry('m', 'modal-route', 'modal');
        const dropped = entry('dropped', 'modal-route', 'modal'); // not in stack
        const progress = fakeProgress();
        const transition: TransitionState = {
            kind: 'pop',
            topEntry: dropped,
            underneathEntry: dropped,
            progress,
        };
        const layers = computeLayers([a, m], transition, progress);
        // Falls back to base + m + animated dropped (off-stack).
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'm', 'dropped']);
    });
});

describe('computeLayers — sheet presentation', () => {
    it('keeps the base visible and binds the top resting sheet to the sheet SV', () => {
        const a = entry('a', 'home');
        const s = entry('s', 'sheet-route', 'sheet');
        const sv = fakeProgress();
        const layers = computeLayers([a, s], null, null, undefined, sheetCtx(sv));
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 's']);
        expect(layers.map((l) => l.hidden)).toEqual([false, false]);
        // Base card: plain static. Sheet: live binding even at rest, so the
        // drag worklet can move it between snap points without a rebind.
        expect(layers[0].animation).toBeNull();
        const anim = layers[1].animation;
        expect(anim?.mapperName).toBe('translateY');
        expect(anim?.progress).toBe(sv);
        // Partial height: progress 1 rests at (1 - 0.9) * SCREEN_HEIGHT,
        // not 0 like modal/fullScreen.
        expect(anim?.outputRange[0]).toBe(SCREEN_HEIGHT);
        expect(anim?.outputRange[1]).toBeCloseTo(0.1 * SCREEN_HEIGHT);
    });

    it('renders a resting sheet statically at its offset when animations are disabled', () => {
        const a = entry('a', 'home');
        const s = entry('s', 'sheet-route', 'sheet');
        const layers = computeLayers([a, s], null, null, undefined, sheetCtx(null));
        expect(layers[1].animation).toBeNull();
        expect(layers[1].staticOffsetY).toBeCloseTo(0.1 * SCREEN_HEIGHT);
    });

    it('renders a sheet as a plain static layer when no sheet context is given', () => {
        // Defensive: callers that don't resolve a sheet context (older
        // tests, non-Stack consumers) still get a valid plan.
        const a = entry('a', 'home');
        const s = entry('s', 'sheet-route', 'sheet');
        const layers = computeLayers([a, s], null, null);
        expect(layers[1]).toEqual({ entry: s, animation: null, hidden: false });
    });

    it('animates a sheet push on the sheet SV with the same fixed range', () => {
        const a = entry('a', 'home');
        const s = entry('s', 'sheet-route', 'sheet');
        const progress = fakeProgress();
        const sv = fakeProgress();
        const transition: TransitionState = {
            kind: 'push',
            topEntry: s,
            underneathEntry: a,
            progress: sv,
        };
        const layers = computeLayers([a, s], transition, progress, undefined, sheetCtx(sv));
        expect(layers[0].animation).toBeNull(); // base static, like modal
        const anim = layers[1].animation;
        expect(anim?.progress).toBe(sv); // dedicated SV, not the shared progress
        expect(anim?.outputRange[0]).toBe(SCREEN_HEIGHT);
        expect(anim?.outputRange[1]).toBeCloseTo(0.1 * SCREEN_HEIGHT);
    });

    it('uses the identical mapper for a sheet pop (progress encodes position)', () => {
        const a = entry('a', 'home');
        const s = entry('s', 'sheet-route', 'sheet');
        const progress = fakeProgress();
        const sv = fakeProgress();
        const transition: TransitionState = {
            kind: 'pop',
            topEntry: s,
            underneathEntry: a,
            progress: sv,
        };
        const layers = computeLayers([a, s], transition, progress, undefined, sheetCtx(sv));
        const anim = layers[1].animation;
        // Pop does NOT invert the range — the SV animates toward 0 instead.
        expect(anim?.outputRange[0]).toBe(SCREEN_HEIGHT);
        expect(anim?.outputRange[1]).toBeCloseTo(0.1 * SCREEN_HEIGHT);
    });

    it('gives a covered sheet a static offset when a card is pushed above it', () => {
        // Card transition with a sheet underneath: the sheet must keep its
        // vertical position, not parallax horizontally.
        const a = entry('a', 'home');
        const s = entry('s', 'sheet-route', 'sheet');
        const c = entry('c', 'detail');
        const progress = fakeProgress();
        const sv = fakeProgress();
        const transition: TransitionState = {
            kind: 'push',
            topEntry: c,
            underneathEntry: s,
            progress,
        };
        const layers = computeLayers([a, s, c], transition, progress, undefined, sheetCtx(sv));
        const sheetLayer = layers.find((l) => l.entry.key === 's');
        expect(sheetLayer?.animation).toBeNull();
        expect(sheetLayer?.staticOffsetY).toBeCloseTo(0.1 * SCREEN_HEIGHT);
        const topLayer = layers.find((l) => l.entry.key === 'c');
        expect(topLayer?.animation?.mapperName).toBe('translateX');
    });

    it('backdropAnimation maps the sheet SV onto opacity', () => {
        const sv = fakeProgress();
        const anim = backdropAnimation(sv);
        expect(anim.mapperName).toBe('opacity');
        expect(anim.progress).toBe(sv);
        expect(anim.inputRange).toEqual([0, 1]);
        expect(anim.outputRange).toEqual([0, SHEET_BACKDROP_MAX_OPACITY]);
    });
});
