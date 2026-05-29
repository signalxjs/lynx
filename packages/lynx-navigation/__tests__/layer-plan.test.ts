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
import { computeLayers, MAX_LAYERS } from '../src/internal/layer-plan';
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
        expect(layers[0].animation?.axis).toBe('translateX');
        expect(layers[0].animation?.outputRange[0]).toBe(0);
        expect(layers[0].animation?.outputRange[1]).toBeLessThan(0);
        expect(layers[1].animation?.axis).toBe('translateX');
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
        expect(layers[2].animation?.axis).toBe('translateX');
        expect(layers[3].animation?.axis).toBe('translateX');
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
        expect(layers[1].animation?.axis).toBe('translateY');
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
        expect(layers[2].animation?.axis).toBe('translateY');
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
