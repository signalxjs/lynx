/**
 * Tests for measureViewportRect / useViewportRect.
 *
 * `measureViewportRect` is a `'main thread'` function, but the directive is
 * just a leading string literal at runtime — the body is directly callable
 * here, which is what makes the normalization and failure paths testable
 * without a main thread.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyViewportRect, measureViewportRect, useViewportRect, type ViewportRect } from '../src/use-viewport-rect';
import type { MainThread } from '../src/jsx';

/** Minimal main-thread element stub: only `invoke` is exercised. */
function fakeElement(invoke: (method: string, params?: Record<string, unknown>) => unknown): MainThread.Element {
    return { invoke } as unknown as MainThread.Element;
}

describe('measureViewportRect', () => {
    it('reports null for a missing element', () => {
        const apply = vi.fn();
        measureViewportRect(null, apply);
        expect(apply).toHaveBeenCalledWith(null);
    });

    it('asks for transform-aware geometry', () => {
        const invoke = vi.fn(() => Promise.resolve({}));
        measureViewportRect(fakeElement(invoke), () => {});
        expect(invoke).toHaveBeenCalledWith('boundingClientRect', {
            androidEnableTransformProps: true,
        });
    });

    it('normalizes the resolved rect, synthesizing right/bottom', async () => {
        let rect: ViewportRect | null = null;
        const el = fakeElement(() => Promise.resolve({ left: 20, top: 100, width: 320, height: 48 }));
        measureViewportRect(el, (r) => { rect = r; });
        await Promise.resolve();
        expect(rect).toEqual({ left: 20, top: 100, width: 320, height: 48, right: 340, bottom: 148 });
    });

    it('keeps right/bottom when the engine already reports them', async () => {
        let rect: ViewportRect | null = null;
        const el = fakeElement(() =>
            Promise.resolve({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }));
        measureViewportRect(el, (r) => { rect = r; });
        await Promise.resolve();
        expect(rect).toMatchObject({ right: 100, bottom: 40 });
    });

    it('derives width/height from edges when the engine reports only those', () => {
        let rect: ViewportRect | null = null;
        const el = fakeElement(() => ({ left: 20, top: 100, right: 340, bottom: 148 }));
        measureViewportRect(el, (r) => { rect = r; });
        expect(rect).toEqual({ left: 20, top: 100, width: 320, height: 48, right: 340, bottom: 148 });
    });

    it('derives the origin from the far edges and the size', () => {
        let rect: ViewportRect | null = null;
        const el = fakeElement(() => ({ right: 340, bottom: 148, width: 320, height: 48 }));
        measureViewportRect(el, (r) => { rect = r; });
        expect(rect).toEqual({ left: 20, top: 100, width: 320, height: 48, right: 340, bottom: 148 });
    });

    it('ignores non-finite numbers rather than propagating NaN', () => {
        let rect: ViewportRect | null = null;
        const el = fakeElement(() => ({ left: Number.NaN, top: 10, width: 100, height: 20 }));
        measureViewportRect(el, (r) => { rect = r; });
        expect(rect).toEqual({ left: 0, top: 10, width: 100, height: 20, right: 100, bottom: 30 });
    });

    it('accepts a synchronous (non-promise) result', () => {
        let rect: ViewportRect | null = null;
        const el = fakeElement(() => ({ left: 1, top: 2, width: 3, height: 4 }));
        measureViewportRect(el, (r) => { rect = r; });
        expect(rect).toEqual({ left: 1, top: 2, width: 3, height: 4, right: 4, bottom: 6 });
    });

    it('reports null when the measurement rejects', async () => {
        const apply = vi.fn();
        const el = fakeElement(() => Promise.reject(new Error('unsupported')));
        measureViewportRect(el, apply);
        await Promise.resolve();
        await Promise.resolve();
        expect(apply).toHaveBeenCalledWith(null);
    });

    it('reports null when invoke throws (UI method unsupported)', () => {
        const apply = vi.fn();
        const el = fakeElement(() => { throw new Error('no such method'); });
        measureViewportRect(el, apply);
        expect(apply).toHaveBeenCalledWith(null);
    });

    it('reports null for a non-object payload', () => {
        const apply = vi.fn();
        measureViewportRect(fakeElement(() => undefined), apply);
        expect(apply).toHaveBeenCalledWith(null);
    });
});

describe('useViewportRect', () => {
    it('starts with a null rect', () => {
        const { rect } = useViewportRect();
        expect(rect.value).toBeNull();
    });

    it('hands out a main-thread ref seeded with null', () => {
        const { ref } = useViewportRect();
        expect(ref.current).toBeNull();
    });

    it('measure() is inert (never throws) without a main thread', async () => {
        const { measure, rect } = useViewportRect();
        expect(() => measure()).not.toThrow();
        // The element ref is null off the main thread, so nothing measures and
        // the rect stays unpublished — no rejection escapes to the caller.
        await Promise.resolve();
        expect(rect.value).toBeNull();
    });

    it('is safe to call repeatedly (chatty layout events)', async () => {
        const { measure } = useViewportRect();
        measure();
        measure();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(() => measure()).not.toThrow();
    });
});

describe('applyViewportRect (#1200)', () => {
    const r = (left: number, top: number, width: number, height: number): ViewportRect => ({
        left, top, width, height, right: left + width, bottom: top + height,
    });

    it('publishes the first measurement and every real change', () => {
        const env: { value: ViewportRect | null } = { value: null };
        const first = r(0, 0, 10, 10);
        applyViewportRect(env, first);
        expect(env.value).toBe(first);
        const moved = r(4, 0, 10, 10);
        applyViewportRect(env, moved);
        expect(env.value).toBe(moved);
    });

    it('does not write an equal rect: the bridge dedupes by identity, so a fresh equal object would publish', () => {
        const first = r(12, 98, 320, 48);
        let writes = 0;
        let stored: ViewportRect | null = first;
        const env = {
            get value() { return stored; },
            set value(v: ViewportRect | null) { writes++; stored = v; },
        };
        applyViewportRect(env, r(12, 98, 320, 48));
        expect(writes).toBe(0);
        expect(env.value).toBe(first);
    });

    it('publishes when only an edge the engine reports changed', () => {
        const env: { value: ViewportRect | null } = { value: r(0, 0, 10, 10) };
        const corrected = { ...r(0, 0, 10, 10), right: 11 };
        applyViewportRect(env, corrected);
        expect(env.value).toBe(corrected);
    });

    it('keeps the last good rect when a measurement fails', () => {
        const first = r(0, 0, 10, 10);
        const env: { value: ViewportRect | null } = { value: first };
        applyViewportRect(env, null);
        expect(env.value).toBe(first);
    });
});
