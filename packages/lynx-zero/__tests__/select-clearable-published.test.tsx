/**
 * #1191 against the INSTALLED zero: the `clearable` stamp follows whatever
 * the published select anatomy declares (zero#387). Before a zero that
 * declares it, no part carries it and the anatomy oracle holds; after, the
 * three parts do. `select-clearable.test.tsx` covers the stamped behavior.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { OverlayHost, Select, clearDismissLayers } from '../src/index';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

afterEach(() => clearDismissLayers());

const byPart = (root: TestNode, part: string): TestNode | null => {
    if (root.props['data-scope'] === 'select' && root.props['data-part'] === part) return root;
    for (const child of root.children) {
        const hit = byPart(child, part);
        if (hit) return hit;
    }
    return null;
};

describe('Select — clearable flag against the installed zero', () => {
    it('stamps it on exactly the parts the anatomy declares it for', () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root items={[{ value: 'apple', label: 'Apple' }]} itemValue={(o) => o.value} defaultValue="apple" clearable />
            </OverlayHost>,
        );
        expect(byPart(container, 'clear-trigger')).not.toBeNull();
        for (const part of ['trigger', 'value', 'indicator'] as const) {
            const declared = anatomies.select.parts[part].flags?.includes('clearable') ?? false;
            expect(byPart(container, part)!._class.split(' ').includes('zx-f-clearable'), part).toBe(declared);
        }
        expectAnatomy(container as never, anatomies.select);
        expectClassGrammar(container as never, anatomies.select);
    });
});
