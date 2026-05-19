/**
 * Tests for useElementLayout.
 *
 * The hook accepts both the modern cross-platform `detail` payload and the
 * deprecated Android-only `params` payload, and synthesizes missing
 * `right` / `bottom` when only `width` / `height` / `top` / `left` are
 * provided. These assertions pin those behaviors so a future refactor
 * doesn't silently regress consumers that still receive `params`.
 */

import { describe, it, expect } from 'vitest';
import { useElementLayout } from '../src/use-element-layout';

describe('useElementLayout', () => {
    it('starts with a null layout signal', () => {
        const { layout } = useElementLayout();
        expect(layout.value).toBeNull();
    });

    it('reads the modern `detail` payload', () => {
        const { layout, onLayoutChange } = useElementLayout();
        onLayoutChange({
            type: 'layoutchange',
            detail: {
                width: 320,
                height: 48,
                top: 100,
                right: 340,
                bottom: 148,
                left: 20,
            },
        });
        expect(layout.value).toEqual({
            width: 320,
            height: 48,
            top: 100,
            right: 340,
            bottom: 148,
            left: 20,
        });
    });

    it('synthesizes right/bottom when only width/height/top/left are present', () => {
        const { layout, onLayoutChange } = useElementLayout();
        onLayoutChange({
            type: 'layoutchange',
            detail: {
                width: 100,
                height: 40,
                top: 10,
                left: 5,
            },
        });
        expect(layout.value).toEqual({
            width: 100,
            height: 40,
            top: 10,
            right: 105,
            bottom: 50,
            left: 5,
        });
    });

    it('falls back to the deprecated Android-only `params` shape', () => {
        const { layout, onLayoutChange } = useElementLayout();
        onLayoutChange({
            params: { width: 200, height: 60, left: 8, top: 16, right: 208, bottom: 76 },
        });
        expect(layout.value).toEqual({
            width: 200,
            height: 60,
            top: 16,
            right: 208,
            bottom: 76,
            left: 8,
        });
    });

    it('ignores events with neither detail nor params', () => {
        const { layout, onLayoutChange } = useElementLayout();
        onLayoutChange({ type: 'layoutchange' });
        expect(layout.value).toBeNull();
    });

    it('updates the signal on subsequent events', () => {
        const { layout, onLayoutChange } = useElementLayout();
        onLayoutChange({
            detail: { width: 10, height: 10, top: 0, left: 0 },
        });
        onLayoutChange({
            detail: { width: 50, height: 50, top: 0, left: 0 },
        });
        expect(layout.value?.width).toBe(50);
        expect(layout.value?.height).toBe(50);
    });
});
