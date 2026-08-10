/**
 * C10 — the one thrown message this package has.
 *
 * `snapshotCreateList` is reached only from *compiled* `<list>` create bodies,
 * so when it fires there is no callsite in this repo to read: the message is
 * the entire diagnostic, and its `[@sigx/lynx-runtime-internal]` prefix is what
 * tells a reader which of the two bundle layers produced it. Pinned here so a
 * reword keeps the scope prefix (CONVENTIONS.md C10).
 *
 * Loaded through `vi.resetModules()` + dynamic import because `hooks` is module
 * state: "no hooks installed" is the module's initial condition, and a sibling
 * test installing hooks would otherwise decide this one's outcome.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('snapshotCreateList without MT hooks', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('throws a scope-prefixed message', async () => {
        const snapshot = await import('../src/snapshot');
        expect(() => snapshot.snapshotCreateList(0, { __id: 1, __values: [], __elements: null }, 0)).toThrow(
            '[@sigx/lynx-runtime-internal] snapshotCreateList failed: MT hooks are not installed',
        );
    });
});
