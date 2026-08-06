/**
 * `waitFor` — the primitive whose absence caused both flaky tests in
 * `@sigx/lynx-emoji`. These cover the behaviours those tests needed and had to
 * hand-roll: an unknown number of turns, a condition that throws until ready,
 * and a failure that still says what was missing.
 */
import { describe, expect, it } from 'vitest';

import { waitFor } from '../src/flush';
import { TestNode } from '../src/test-node';
import { findByText, getByText } from '../src/queries';

describe('waitFor', () => {
    it('returns as soon as the condition is truthy', async () => {
        await expect(waitFor(() => 'ready')).resolves.toBe('ready');
    });

    it('keeps polling across however many turns the work takes', async () => {
        // The case a fixed `for (let i = 0; i < 5; i++) await act(…)` gets
        // wrong the moment the machine is busy: the turn count isn't knowable.
        let turns = 0;
        const result = await waitFor(() => (++turns >= 7 ? `settled after ${turns}` : null));
        expect(result).toBe('settled after 7');
    });

    it('treats a throwing condition as "not yet"', async () => {
        // What makes `waitFor(() => getByText(…))` read naturally — the getBy*
        // queries throw rather than returning null.
        let calls = 0;
        const result = await waitFor(() => {
            if (++calls < 3) throw new Error('not there yet');
            return 'found';
        });
        expect(result).toBe('found');
        expect(calls).toBe(3);
    });

    it('does not treat a falsy-but-valid result as success', async () => {
        // `0` and `''` are real values a condition might compute, but as a
        // readiness signal they mean "not yet" — same as testing-library.
        let calls = 0;
        await expect(
            waitFor(() => (++calls < 3 ? 0 : 42), { timeout: 200 }),
        ).resolves.toBe(42);
    });

    it('rethrows the condition\'s own error on timeout, not a bare timeout', async () => {
        // The whole point: `getByText` already explains what was missing and
        // prints the tree. A generic "timed out" would throw that away.
        await expect(
            waitFor(() => { throw new Error('No element found with text "Done".'); }, { timeout: 30 }),
        ).rejects.toThrow(/timed out after 30ms.*No element found with text "Done"/s);
    });

    it('reports attempts and the description in the timeout message', async () => {
        await expect(
            waitFor(() => false, { timeout: 30, description: 'the tab bar' }),
        ).rejects.toThrow(/timed out after 30ms waiting for the tab bar \(\d+ attempts\)/);
    });

    it('explains a never-truthy condition when nothing ever threw', async () => {
        await expect(waitFor(() => null, { timeout: 30 })).rejects.toThrow(
            /never returned a truthy value/,
        );
    });

    it('awaits an async condition', async () => {
        let ready = false;
        setTimeout(() => { ready = true; }, 5);
        await expect(waitFor(async () => ready)).resolves.toBe(true);
    });

    it('always attempts at least once, even with a zero timeout', async () => {
        // A condition that is already true must not fail just because the
        // deadline has passed by the time we look.
        await expect(waitFor(() => 'immediate', { timeout: 0 })).resolves.toBe('immediate');
    });

    it('rejects a non-finite or negative timeout rather than hanging', async () => {
        // `Date.now() >= NaN` is false forever, so the loop would never give
        // up — the test hangs until the runner kills it, with no clue why.
        for (const bad of [NaN, Infinity, -1]) {
            await expect(waitFor(() => false, { timeout: bad })).rejects.toThrow(
                /`timeout` must be a finite, non-negative number/,
            );
        }
    });

    it('rejects a bad interval the same way', async () => {
        await expect(waitFor(() => false, { timeout: 10, interval: NaN })).rejects.toThrow(
            /`interval` must be a finite, non-negative number/,
        );
    });

    it('honours an explicit interval between attempts', async () => {
        const started = Date.now();
        let calls = 0;
        await waitFor(() => ++calls >= 3, { interval: 10 });
        expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    });
});

describe('findBy* async queries', () => {
    /** A node that gains a child only after several turns. */
    function lateTree(afterTurns: number) {
        const root = new TestNode('view');
        let turns = 0;
        const tick = () => {
            if (++turns >= afterTurns) {
                const child = new TestNode('text');
                child.text = 'Loaded';
                root.children.push(child);
                return;
            }
            setTimeout(tick, 0);
        };
        setTimeout(tick, 0);
        return root;
    }

    it('waits for a node that appears later', async () => {
        const root = lateTree(6);
        expect(() => getByText(root, 'Loaded')).toThrow();

        const found = await findByText(root, 'Loaded');
        expect(found.text).toBe('Loaded');
    });

    it('fails with the tree and the text it wanted', async () => {
        const root = new TestNode('view');
        const child = new TestNode('text');
        child.text = 'Something else';
        root.children.push(child);

        await expect(findByText(root, 'Loaded', { timeout: 30 })).rejects.toThrow(
            /No element found with text "Loaded"[\s\S]*Tree searched:[\s\S]*Something else/,
        );
    });
});

describe('the flake this replaces', () => {
    it('a fixed turn count is wrong when the work takes longer', async () => {
        // Reproduces `picker-layout.test.tsx` before #926: pump N turns, then
        // assert. With the work needing more than N, the assertion ran against
        // an unmounted tree and reported a bare -1.
        const root = new TestNode('view');
        let turns = 0;
        const tick = () => {
            if (++turns >= 8) {
                root.children.push(new TestNode('tabbar'));
                return;
            }
            setTimeout(tick, 0);
        };
        setTimeout(tick, 0);

        // The old shape — five fixed turns.
        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }
        expect(root.children).toHaveLength(0); // still not there: the flake

        // The new shape — wait for the condition.
        const found = await waitFor(() => root.children[0]);
        expect(found?.type).toBe('tabbar');
    });
});

describe('within() scoping', () => {
    it('offers all three flavours, so scoping never drops the async one', async () => {
        const { within } = await import('../src/queries');
        const scoped = within(new TestNode('view'));
        for (const matcher of ['Type', 'Text', 'Prop']) {
            expect(scoped, `getBy${matcher}`).toHaveProperty(`getBy${matcher}`);
            expect(scoped, `queryBy${matcher}`).toHaveProperty(`queryBy${matcher}`);
            expect(scoped, `findBy${matcher}`).toHaveProperty(`findBy${matcher}`);
        }
    });

    it('confines the search to the subtree', async () => {
        const { within, getByText } = await import('../src/queries');
        const root = new TestNode('view');
        const a = new TestNode('view');
        const b = new TestNode('view');
        for (const [node, text] of [[a, 'in-a'], [b, 'in-b']] as const) {
            const t = new TestNode('text');
            t.text = text;
            node.children.push(t);
        }
        root.children.push(a, b);

        expect(within(a).getByText('in-a').text).toBe('in-a');
        expect(within(a).queryByText('in-b')).toBeNull();
        expect(getByText(root, 'in-b').text).toBe('in-b'); // unscoped still finds it
    });

    it('waits within the subtree', async () => {
        const { within } = await import('../src/queries');
        const root = new TestNode('view');
        const target = new TestNode('view');
        root.children.push(target);
        setTimeout(() => {
            const t = new TestNode('text');
            t.text = 'late';
            target.children.push(t);
        }, 5);

        await expect(within(target).findByText('late')).resolves.toMatchObject({ text: 'late' });
    });
});
