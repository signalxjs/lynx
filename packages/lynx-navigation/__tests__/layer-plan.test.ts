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
import { computeLayers, animationVariant } from '../src/internal/layer-plan';
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
        expect(layers).toEqual([{ entry: a, animation: null }]);
    });

    it('renders only the top card when the stack is all cards', () => {
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const layers = computeLayers([a, b], null, null);
        // Card pushes replace underneath in the base layer; only `b`
        // renders idle.
        expect(layers.map((l) => l.entry.key)).toEqual(['b']);
        expect(layers[0].animation).toBeNull();
    });

    it('preserves the card base under an overlay', () => {
        const a = entry('a', 'home');
        const m = entry('m', 'modal-route', 'modal');
        const layers = computeLayers([a, m], null, null);
        expect(layers.map((l) => l.entry.key)).toEqual(['a', 'm']);
        expect(layers.every((l) => l.animation === null)).toBe(true);
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

    it('walks past intermediate overlays to find the card base', () => {
        // Mixed stack: card, card-on-card (only top card visible at
        // idle), modal on top. Base = the top card.
        const a = entry('a', 'home');
        const b = entry('b', 'detail');
        const m = entry('m', 'modal-route', 'modal');
        const layers = computeLayers([a, b, m], null, null);
        expect(layers.map((l) => l.entry.key)).toEqual(['b', 'm']);
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

describe('animationVariant — render-key suffix', () => {
    it('returns "static" for null animation', () => {
        expect(animationVariant(null)).toBe('static');
    });

    it('returns distinct strings for different animation specs', () => {
        const progress = fakeProgress();
        const card = animationVariant({
            axis: 'translateX', inputRange: [0, 1], outputRange: [400, 0], progress,
        });
        const modal = animationVariant({
            axis: 'translateY', inputRange: [0, 1], outputRange: [800, 0], progress,
        });
        const popCard = animationVariant({
            axis: 'translateX', inputRange: [0, 1], outputRange: [0, 400], progress,
        });
        expect(card).not.toBe(modal);
        expect(card).not.toBe(popCard);
        expect(modal).not.toBe(popCard);
    });
});
