/**
 * The axis-defaults registry + resolver (#1070) — the runtime half of the
 * manifest's `components.<scope>.defaults`. The lynx target emits no
 * `:not()` default twins, so an unset axis must resolve to the design
 * system's declared default before `partBag` stamps classes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAxisDefaults, registerAxisDefaults, resolveVariantAxes } from '../src/contract/axis-defaults';
import type { VariantAxes } from '../src/contract/axes-context';

afterEach(() => {
    clearAxisDefaults();
    vi.restoreAllMocks();
});

describe('resolveVariantAxes', () => {
    it('passes through untouched when nothing is registered', () => {
        const axes: VariantAxes = { color: 'primary' };
        expect(resolveVariantAxes('button', axes)).toBe(axes);
    });

    it('passes through untouched for a scope with no registered defaults', () => {
        registerAxisDefaults({ button: { variant: 'solid' } });
        const axes: VariantAxes = {};
        expect(resolveVariantAxes('switch', axes)).toBe(axes);
    });

    it('fills unset named axes from the registered defaults', () => {
        registerAxisDefaults({ button: { color: 'primary', variant: 'solid', size: 'md' } });
        expect(resolveVariantAxes('button', {})).toEqual({
            color: 'primary', variant: 'solid', size: 'md',
        });
    });

    it('lets explicit values win over defaults', () => {
        registerAxisDefaults({ button: { color: 'primary', variant: 'solid', size: 'md' } });
        expect(resolveVariantAxes('button', { color: 'secondary' })).toEqual({
            color: 'secondary', variant: 'solid', size: 'md',
        });
    });

    it('routes a default outside color/size/variant into the custom axes', () => {
        registerAxisDefaults({ button: { density: 'compact' } });
        expect(resolveVariantAxes('button', {})).toEqual({ axes: { density: 'compact' } });
        expect(resolveVariantAxes('button', { axes: { density: 'loose' } }))
            .toEqual({ axes: { density: 'loose' } });
    });

    it('leaves mods untouched and never mutates the input', () => {
        registerAxisDefaults({ button: { size: 'md' } });
        const axes: VariantAxes = { mods: { wide: true } };
        const resolved = resolveVariantAxes('button', axes);
        expect(resolved).toEqual({ size: 'md', mods: { wide: true } });
        expect(axes).toEqual({ mods: { wide: true } });
    });

    it('is idempotent — resolving a resolved bag changes nothing', () => {
        registerAxisDefaults({ button: { color: 'primary', size: 'md' } });
        const once = resolveVariantAxes('button', { variant: 'outline' });
        expect(resolveVariantAxes('button', once)).toEqual(once);
    });
});

describe('registerAxisDefaults', () => {
    it('is silent when re-registering identical values (the HMR case)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerAxisDefaults({ button: { color: 'primary' } });
        registerAxisDefaults({ button: { color: 'primary' } });
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns and replaces when re-registering different values', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerAxisDefaults({ button: { color: 'primary' } });
        registerAxisDefaults({ button: { color: 'neutral' } });
        expect(warn).toHaveBeenCalledOnce();
        expect(resolveVariantAxes('button', {})).toEqual({ color: 'neutral' });
    });

    it('clearAxisDefaults empties the registry', () => {
        registerAxisDefaults({ button: { color: 'primary' } });
        clearAxisDefaults();
        const axes: VariantAxes = {};
        expect(resolveVariantAxes('button', axes)).toBe(axes);
    });
});
