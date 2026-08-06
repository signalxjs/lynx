/**
 * Public-surface freeze test for @sigx/lynx-testing.
 *
 * This package's surface is load-bearing in an unusual way: 49 other packages
 * write their tests against it, so a rename here breaks them all at once. Lock
 * it, and update the snapshot deliberately.
 *
 * It ships three entry points — `.`, `./mt` and `./mt/setup` — and all three
 * are public, so all three are pinned. `./mt` had no coverage at all before.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as testing from '../src/index';
import { waitFor, within } from '../src/index';
import type { TestNode, WaitForOptions } from '../src/index';

describe('public runtime exports — "." entry', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(testing).sort()).toEqual([
            'TestNode',
            'act',
            'findByProp',
            'findByText',
            'findByType',
            'fireEvent',
            'formatTree',
            'getAllByType',
            'getByProp',
            'getByText',
            'getByType',
            'queryByProp',
            'queryByText',
            'queryByType',
            'render',
            'touch',
            'waitFor',
            'waitForUpdate',
            'within',
        ]);
    });

    it('offers all three query flavours for every matcher', () => {
        // get/query/find is the @testing-library convention. A matcher missing
        // its `find*` is what pushes a caller back to guessing turn counts.
        for (const matcher of ['Type', 'Text', 'Prop']) {
            expect(testing, `getBy${matcher}`).toHaveProperty(`getBy${matcher}`);
            expect(testing, `queryBy${matcher}`).toHaveProperty(`queryBy${matcher}`);
            expect(testing, `findBy${matcher}`).toHaveProperty(`findBy${matcher}`);
        }
    });
});

describe('public runtime exports — "./mt" entries', () => {
    it('pins the main-thread surface', async () => {
        const mt = await import('../src/mt/index');
        expect(Object.keys(mt).sort()).toMatchSnapshot();
    });

    it('pins the setup entry', async () => {
        const setup = await import('../src/mt/setup');
        expect(Object.keys(setup).sort()).toMatchSnapshot();
    });
});

describe('public types', () => {
    it('keeps waitFor generic in its condition\'s return type', () => {
        // `await waitFor(() => getByText(...))` must give back a TestNode, not
        // unknown — otherwise every call site needs a cast.
        expectTypeOf(waitFor<number>).returns.toEqualTypeOf<Promise<number>>();
    });

    it('pins the waitFor options', () => {
        expectTypeOf<WaitForOptions>().toEqualTypeOf<{
            timeout?: number;
            interval?: number;
            description?: string;
        }>();
    });

    it('gives within() the same matchers as the top-level queries', () => {
        expectTypeOf(within).parameter(0).toEqualTypeOf<TestNode>();
        expectTypeOf(within).returns.toHaveProperty('getByText');
        expectTypeOf(within).returns.toHaveProperty('queryByProp');
    });
});
