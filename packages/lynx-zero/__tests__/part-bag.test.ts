/**
 * `partBag` — the render seam. The load-bearing claim: the class list and
 * the `data-*` attributes derive from the SAME inputs, so the two can never
 * disagree, and both speak the published zero contract (grammar classes on
 * one side, presence-only attributes on the other).
 */
import { describe, expect, it } from 'vitest';
import { anatomies } from '@sigx/zero/anatomy';
import { partA11y, partBag } from '../src/index';

const tabs = anatomies.tabs;
const switchAnatomy = anatomies.switch;

describe('partBag', () => {
    it('derives the class list and the data attrs from one descriptor', () => {
        const bag = partBag(tabs, 'tab', {
            state: 'active',
            flags: { disabled: true, 'focus-visible': false },
            axes: { color: 'primary', size: 'xs', density: 'compact' },
            mods: { block: true },
            orientation: 'horizontal',
            class: 'app-extra',
        });
        expect(bag.class).toBe([
            'zx-tabs__tab',
            'zx-s-active',
            'zx-f-disabled',
            'zx-a-color-primary',
            'zx-a-size-xs',
            'zx-a-density-compact',
            'zx-m-block',
            'zx-o-horizontal',
            'app-extra',
        ].join(' '));
        expect(bag['data-scope']).toBe('tabs');
        expect(bag['data-part']).toBe('tab');
        expect(bag['data-state']).toBe('active');
        expect(bag['data-disabled']).toBe('');
        expect(bag['data-focus-visible']).toBeUndefined();
        expect(bag['data-color']).toBe('primary');
        expect(bag['data-density']).toBe('compact');
        expect(bag['data-mod-block']).toBe('');
        expect(bag['data-orientation']).toBe('horizontal');
    });

    it('a bare part carries only its identity', () => {
        const bag = partBag(switchAnatomy, 'thumb');
        expect(bag.class).toBe('zx-switch__thumb');
        expect(Object.keys(bag).sort()).toEqual(['class', 'data-part', 'data-scope']);
    });

    it('rejects unknown parts and lets zero guard axis names', () => {
        expect(() => partBag(tabs, 'nope')).toThrow(/has no part "nope"/);
        // The reserved-name guard is zero's own — one pass covers both halves.
        expect(() => partBag(tabs, 'tab', { axes: { state: 'x' } })).toThrow(/part of the anatomy contract/);
    });
});

describe('partA11y', () => {
    it('composes the five-prop native mapping', () => {
        expect(partA11y({ trait: 'button', label: 'Save', checked: true, disabled: true })).toEqual({
            'accessibility-element': true,
            'accessibility-trait': 'button',
            'accessibility-label': 'Save',
            'accessibility-status': 'checked, disabled',
        });
    });
});
