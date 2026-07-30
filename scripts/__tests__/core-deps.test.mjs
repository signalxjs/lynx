import { describe, expect, it } from 'vitest';
import {
    catalogCoreRanges,
    findCoreResolutionProblems,
    lockCoreResolutions,
    satisfiesCaret,
} from '../lib/core-deps.mjs';

describe('satisfiesCaret', () => {
    it('locks the minor below 1.0.0', () => {
        expect(satisfiesCaret('0.14.0', '^0.14.0')).toBe(true);
        expect(satisfiesCaret('0.14.7', '^0.14.0')).toBe(true);
        expect(satisfiesCaret('0.15.0', '^0.14.0')).toBe(false);
        expect(satisfiesCaret('0.4.9', '^0.14.0')).toBe(false);
        expect(satisfiesCaret('1.0.0', '^0.14.0')).toBe(false);
    });

    it('locks the patch below 0.1.0', () => {
        expect(satisfiesCaret('0.0.3', '^0.0.3')).toBe(true);
        expect(satisfiesCaret('0.0.4', '^0.0.3')).toBe(false);
    });

    it('admits a higher minor at 1.0.0 and up — that still hoists as one copy', () => {
        expect(satisfiesCaret('1.3.0', '^1.2.0')).toBe(true);
        expect(satisfiesCaret('1.2.5', '^1.2.0')).toBe(true);
        expect(satisfiesCaret('1.1.9', '^1.2.0')).toBe(false);
        expect(satisfiesCaret('2.0.0', '^1.2.0')).toBe(false);
    });

    it('compares the numeric core of a prerelease rather than rejecting it outright', () => {
        expect(satisfiesCaret('0.14.0-rc.1', '^0.14.0')).toBe(true);
        expect(satisfiesCaret('0.15.0-rc.1', '^0.14.0')).toBe(false);
    });

    it('returns false rather than throwing on an unparseable version', () => {
        expect(satisfiesCaret('workspace:^', '^0.14.0')).toBe(false);
        expect(satisfiesCaret('0.14.0', 'not-a-range')).toBe(false);
    });
});

describe('catalogCoreRanges', () => {
    const ws = `packages:
  - packages/*

catalog:
  "@sigx/reactivity": ^0.14.0
  # a column-0 comment does not end the block
  '@sigx/runtime-core': ^0.14.0
  lodash: ^4.0.0

onlyBuiltDependencies:
  - esbuild
`;

    it('picks up core entries only, through both quote styles', () => {
        expect(catalogCoreRanges(ws)).toEqual({
            '@sigx/reactivity': '^0.14.0',
            '@sigx/runtime-core': '^0.14.0',
        });
    });

    it('ends the block at the next top-level key, not at a comment', () => {
        // `onlyBuiltDependencies` is past the block; nothing under it leaks in.
        expect(Object.keys(catalogCoreRanges(ws))).toHaveLength(2);
    });

    it('reports nothing for a workspace file with no catalog', () => {
        expect(catalogCoreRanges('packages:\n  - packages/*\n')).toEqual({});
    });
});

describe('lockCoreResolutions', () => {
    const lock = `lockfileVersion: '9.0'

packages:

  '@sigx/reactivity@0.14.0':
    resolution: {integrity: sha512-aaa}

  '@sigx/reactivity@0.4.9':
    resolution: {integrity: sha512-bbb}

  '@sigx/terminal-zero@0.10.0(@sigx/reactivity@0.14.0)(@sigx/runtime-core@0.14.0)':
    resolution: {integrity: sha512-ccc}

  lodash@4.17.21:
    resolution: {integrity: sha512-ddd}

snapshots:

  '@sigx/reactivity@0.14.0': {}
`;

    it('collects every resolved version of each core package', () => {
        expect(lockCoreResolutions(lock)).toEqual({
            '@sigx/reactivity': new Set(['0.14.0', '0.4.9']),
        });
    });

    it('does not mistake a peer-resolution suffix for a resolution of its own', () => {
        // `@sigx/terminal-zero@…(@sigx/runtime-core@0.14.0)` must not register
        // `@sigx/runtime-core`, which nothing in this lockfile actually resolves.
        expect(lockCoreResolutions(lock)['@sigx/runtime-core']).toBeUndefined();
    });

    it('stops at the end of the packages section', () => {
        // The `snapshots:` block repeats the same ids; counting them too would
        // make every package look duplicated.
        expect(lockCoreResolutions(lock)['@sigx/reactivity'].size).toBe(2);
    });
});

describe('findCoreResolutionProblems', () => {
    const ranges = { '@sigx/reactivity': '^0.14.0', '@sigx/runtime-core': '^0.14.0' };
    const lockWith = (ids) => 'packages:\n' + ids.map((id) => `  '${id}':\n    resolution: {}\n`).join('') + '\nsnapshots:\n';

    it('passes a lockfile on one aligned core line', () => {
        expect(findCoreResolutionProblems(lockWith(['@sigx/reactivity@0.14.0', '@sigx/runtime-core@0.14.2']), ranges)).toEqual([]);
    });

    it('flags a core line dragged in transitively', () => {
        const problems = findCoreResolutionProblems(lockWith(['@sigx/reactivity@0.14.0', '@sigx/reactivity@0.4.9']), ranges);
        expect(problems).toHaveLength(1);
        // Names the offender, and only the offender — the in-range copy is not
        // what anyone has to go and fix. (The catalog range it failed appears
        // later in the same line, so assert on the resolves-to clause.)
        expect(problems[0]).toMatch(/^@sigx\/reactivity resolves to "0\.4\.9", outside the catalog/);
    });

    it('names the catalog range once, however many entries share it', () => {
        const problems = findCoreResolutionProblems(lockWith(['@sigx/reactivity@0.4.9']), ranges);
        expect(problems[0]).toContain('(^0.14.0)');
    });

    it('flags two in-range versions at once — satisfying the range is not being deduped', () => {
        const problems = findCoreResolutionProblems(lockWith(['@sigx/reactivity@0.14.0', '@sigx/reactivity@0.14.2']), ranges);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('2 versions');
    });

    it('checks core packages with no catalog entry of their own against the core line', () => {
        // `@sigx/serialize` ships from the same lockstep release as the two
        // catalog entries, so an 0.4 copy of it is the same hazard.
        expect(findCoreResolutionProblems(lockWith(['@sigx/serialize@0.14.0']), ranges)).toEqual([]);
        expect(findCoreResolutionProblems(lockWith(['@sigx/serialize@0.4.9']), ranges)).toHaveLength(1);
    });

    it('reports nothing when there is no catalog to compare against', () => {
        expect(findCoreResolutionProblems(lockWith(['@sigx/reactivity@0.4.9']), {})).toEqual([]);
    });
});
