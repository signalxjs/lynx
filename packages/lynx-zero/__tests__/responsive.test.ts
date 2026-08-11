/**
 * Per-breakpoint prop values (#1013) — the pure resolver.
 *
 * The layout primitives' own behaviour is covered by their component tests;
 * this file pins the cascade, the plain-value passthrough, and the
 * `SpacingValue` discrimination that makes `Responsive<SpacingValue>`
 * unambiguous at runtime.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { WidthClass } from '@sigx/lynx';
import { resolveResponsive } from '../src/shared/responsive';
import type { SpacingValue } from '../src/shared/styles';

const ALL: WidthClass[] = ['compact', 'medium', 'expanded', 'large', 'xlarge'];

afterEach(() => {
    vi.restoreAllMocks();
});

describe('resolveResponsive — plain values', () => {
    it('passes a plain value through at every class', () => {
        for (const cls of ALL) expect(resolveResponsive(16, cls)).toBe(16);
    });

    it('passes undefined through', () => {
        expect(resolveResponsive(undefined, 'expanded')).toBeUndefined();
    });

    it('treats a SpacingValue object as a plain value, not a breakpoint map', () => {
        const spacing: SpacingValue = { x: 8, top: 4 };
        expect(resolveResponsive<SpacingValue>(spacing, 'large')).toBe(spacing);
    });

    it('does not mistake an empty object for a breakpoint map', () => {
        const empty = {} as SpacingValue;
        expect(resolveResponsive<SpacingValue>(empty, 'expanded')).toBe(empty);
    });

    it('passes strings, booleans and zero through unchanged', () => {
        expect(resolveResponsive('100%', 'medium')).toBe('100%');
        expect(resolveResponsive(false, 'medium')).toBe(false);
        expect(resolveResponsive(0, 'medium')).toBe(0);
    });
});

describe('resolveResponsive — mobile-first cascade', () => {
    it('applies a key at its breakpoint and every wider one', () => {
        const v = { initial: 16, expanded: 32 };
        expect(resolveResponsive(v, 'compact')).toBe(16);
        expect(resolveResponsive(v, 'medium')).toBe(16);
        expect(resolveResponsive(v, 'expanded')).toBe(32);
        expect(resolveResponsive(v, 'large')).toBe(32);
        expect(resolveResponsive(v, 'xlarge')).toBe(32);
    });

    it('falls back past gaps to the nearest defined narrower key', () => {
        const v = { initial: 1, large: 4 };
        expect(resolveResponsive(v, 'medium')).toBe(1);
        expect(resolveResponsive(v, 'expanded')).toBe(1);
        expect(resolveResponsive(v, 'large')).toBe(4);
    });

    it('honours every key exactly at its own class', () => {
        const v = { initial: 0, medium: 1, expanded: 2, large: 3, xlarge: 4 };
        expect(ALL.map((c) => resolveResponsive(v, c))).toEqual([0, 1, 2, 3, 4]);
    });

    it('returns undefined below the narrowest defined key', () => {
        // `{ expanded: 32 }` contributes nothing on a phone — the caller then
        // treats it exactly like an omitted prop rather than forcing a zero.
        const v = { expanded: 32 };
        expect(resolveResponsive(v, 'compact')).toBeUndefined();
        expect(resolveResponsive(v, 'medium')).toBeUndefined();
        expect(resolveResponsive(v, 'expanded')).toBe(32);
    });

    it('does not skip a key whose value is falsy', () => {
        // `0` and `false` are legitimate values; only `undefined` means "unset".
        expect(resolveResponsive({ initial: 8, expanded: 0 }, 'large')).toBe(0);
        expect(resolveResponsive({ initial: true, expanded: false }, 'expanded')).toBe(false);
    });

    it('skips a key explicitly set to undefined', () => {
        expect(resolveResponsive({ initial: 8, expanded: undefined }, 'expanded')).toBe(8);
    });

    it('resolves nested SpacingValue objects per breakpoint', () => {
        const v = { initial: { x: 8 }, expanded: { x: 24, y: 16 } };
        expect(resolveResponsive<SpacingValue>(v, 'compact')).toEqual({ x: 8 });
        expect(resolveResponsive<SpacingValue>(v, 'large')).toEqual({ x: 24, y: 16 });
    });
});

describe('resolveResponsive — mixed-key objects', () => {
    it('warns and falls back to the plain reading', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // `{ initial: 4, top: 8 }` is a bug: is it a breakpoint map or spacing?
        // Guessing "breakpoint map" would silently drop `top`, so we keep the
        // reading that preserves the spacing keys and say so.
        const mixed = { initial: 4, top: 8 } as unknown as SpacingValue;
        expect(resolveResponsive<SpacingValue>(mixed, 'expanded')).toBe(mixed);
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0])).toContain('top');
    });

    it('does not warn for a clean breakpoint map', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        resolveResponsive({ initial: 4, expanded: 8 }, 'expanded');
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn for a clean spacing object', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        resolveResponsive<SpacingValue>({ x: 4, top: 8 }, 'expanded');
        expect(warn).not.toHaveBeenCalled();
    });
});
