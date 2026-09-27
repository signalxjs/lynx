/**
 * #1191: at lg/xl the select's value ran under the clear-trigger chip. The
 * web makes room with `:has(> clear-trigger)`, which the lynx class grammar
 * cannot express, so zero#387 publishes it as a flag — `clearable` on the
 * trigger, value and indicator while the clear-trigger renders — and the
 * skin reserves the chip's width off `zx-f-clearable`.
 *
 * The published zero this package builds against may not declare the flag
 * yet, and the anatomy oracle refuses an undeclared one — so the stamp is
 * read off the anatomy. This file runs against a select anatomy that
 * declares it (zero#387's shape), and `select-clearable-published` against
 * whatever zero is installed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sigx/zero/anatomy', async (importOriginal) => {
    const mod = await importOriginal<typeof import('@sigx/zero/anatomy')>();
    const select = mod.anatomies.select;
    const withFlag = (part: 'trigger' | 'value' | 'indicator') => {
        const spec = select.parts[part]!;
        const flags = spec.flags ?? [];
        return { ...spec, flags: flags.includes('clearable') ? flags : [...flags, 'clearable'] };
    };
    // Keep the anatomy's prototype (its `toJSON` and friends); swap its parts.
    const patched = Object.assign(Object.create(Object.getPrototypeOf(select)), select, {
        parts: { ...select.parts, trigger: withFlag('trigger'), value: withFlag('value'), indicator: withFlag('indicator') },
    });
    return { ...mod, anatomies: { ...mod.anatomies, select: patched } };
});

import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { OverlayHost, Select, clearDismissLayers } from '../src/index';
import { ForceStates, expectAnatomy } from '../src/testing/index';

afterEach(() => clearDismissLayers());

const byPart = (root: TestNode, part: string): TestNode | null => {
    if (root.props['data-scope'] === 'select' && root.props['data-part'] === part) return root;
    for (const child of root.children) {
        const hit = byPart(child, part);
        if (hit) return hit;
    }
    return null;
};

const FRUIT = [
    { value: 'apple', label: 'Apple' },
    { value: 'dragonfruit', label: 'Dragon fruit, the yellow kind' },
];

/**
 * The parts that carry the flag, both halves (class and attribute) agreeing
 * — `expectClassGrammar`'s check for this one flag: the grammar oracle reads
 * the installed zero's FLAG_VOCABULARY, which gains `clearable` with zero#387.
 */
const flagged = (root: TestNode): string[] => ['trigger', 'value', 'indicator'].filter((part) => {
    const node = byPart(root, part)!;
    const cls = node._class.split(' ').includes('zx-f-clearable');
    expect(node.props['data-clearable'] === '', part).toBe(cls);
    return cls;
});

describe('Select — the clearable flag (zero#387, #1191)', () => {
    it('the test anatomy declares the flag on the three parts', () => {
        for (const part of ['trigger', 'value', 'indicator'] as const) {
            expect(anatomies.select.parts[part].flags, part).toContain('clearable');
        }
    });

    it('trigger, value and indicator carry it exactly while the clear-trigger renders', async () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root items={FRUIT} itemValue={(o) => o.value} defaultValue="dragonfruit" placeholder="Pick" clearable size="xl" />
            </OverlayHost>,
        );
        expect(byPart(container, 'clear-trigger')).not.toBeNull();
        expect(flagged(container)).toEqual(['trigger', 'value', 'indicator']);
        expectAnatomy(container as never, anatomies.select);

        await act(() => fireEvent.tap(byPart(container, 'clear-trigger') as never));
        await act(() => {});
        expect(byPart(container, 'clear-trigger')).toBeNull();
        expect(flagged(container)).toEqual([]);
        expectAnatomy(container as never, anatomies.select);
    });

    it('is absent while nothing is selected, disabled, readonly, or not clearable', () => {
        for (const extra of [{ defaultValue: null }, { disabled: true }, { readonly: true }, { clearable: false }]) {
            const { container } = render(
                <OverlayHost>
                    <Select.Root items={FRUIT} itemValue={(o) => o.value} defaultValue="apple" clearable {...extra} />
                </OverlayHost>,
            );
            expect(byPart(container, 'clear-trigger'), JSON.stringify(extra)).toBeNull();
            expect(flagged(container), JSON.stringify(extra)).toEqual([]);
            expectAnatomy(container as never, anatomies.select);
        }
    });

    it('a forced ring on the clear-trigger leaves the flag where it is', () => {
        const { container } = render(
            <OverlayHost>
                <ForceStates flags={{ 'focus-visible': true }} parts={['clear-trigger']}>
                    <Select.Root items={FRUIT} itemValue={(o) => o.value} defaultValue="apple" clearable size="lg" />
                </ForceStates>
            </OverlayHost>,
        );
        expect(flagged(container)).toEqual(['trigger', 'value', 'indicator']);
        expect(byPart(container, 'clear-trigger')!._class).toContain('zx-f-focus-visible');
    });
});
