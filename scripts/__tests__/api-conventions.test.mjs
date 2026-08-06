import { describe, expect, it } from 'vitest';

import {
    checkPackage,
    countUnprefixedThrows,
    diffAgainstBaseline,
    findAsyncIsAvailable,
    findBareIsAvailable,
    missingWebSection,
    needsPermissionReexport,
    toBaseline,
} from '../lib/api-conventions.mjs';

describe('C2 — bare isAvailable', () => {
    it('flags it in an export clause', () => {
        // The real shape: lynx-appearance and lynx-sqlite both export one, so a
        // consumer importing both barrels gets whichever wins.
        expect(findBareIsAvailable(`export { SQLiteDatabase, openDatabase, isAvailable } from './sqlite.js';`))
            .toHaveLength(1);
    });

    it('flags a direct function export', () => {
        expect(findBareIsAvailable('export function isAvailable(): boolean { return true; }')).toHaveLength(1);
    });

    it('follows a rename to the exported name', () => {
        expect(findBareIsAvailable(`export { isModuleLinked as isAvailable } from './x.js';`)).toHaveLength(1);
        // Renamed *away* from isAvailable is fine — the exported name is what collides.
        expect(findBareIsAvailable(`export { isAvailable as isSQLiteAvailable } from './x.js';`)).toHaveLength(0);
    });

    it('leaves the correct forms alone', () => {
        expect(findBareIsAvailable(`export { Camera } from './camera.js';`)).toEqual([]);
        expect(findBareIsAvailable(`export { isHttpAvailable } from './fetch.js';`)).toEqual([]);
    });
});

describe('C2 — async isAvailable', () => {
    it('flags a Promise return', () => {
        expect(findAsyncIsAvailable('    isAvailable(): Promise<BiometricAvailability> {')).toHaveLength(1);
    });

    it('flags an async method', () => {
        expect(findAsyncIsAvailable('    async isAvailable() { return true; }')).toHaveLength(1);
    });

    it('leaves the synchronous form alone', () => {
        expect(findAsyncIsAvailable('    isAvailable(): boolean { return isModuleAvailable(MODULE); }')).toEqual([]);
    });
});

describe('C6 — PermissionResponse re-export', () => {
    const pair = `requestPermission(): Promise<PermissionResponse> {}\ngetPermissionStatus(): Promise<PermissionResponse> {}`;

    it('flags a permission-bearing package whose barrel omits the type', () => {
        expect(needsPermissionReexport([pair], `export { WebRTC } from './audio-output.js';`)).toBe(true);
    });

    it('accepts one that re-exports it', () => {
        expect(
            needsPermissionReexport([pair], `export type { PermissionResponse } from '@sigx/lynx-core';`),
        ).toBe(false);
    });

    it('ignores packages with no permission surface', () => {
        expect(needsPermissionReexport(['export const Clipboard = {};'], '')).toBe(false);
    });

    it('needs both halves of the pair, not just one', () => {
        expect(needsPermissionReexport(['requestPermission(): Promise<PermissionResponse> {}'], '')).toBe(false);
    });
});

describe('C10 — unprefixed throws', () => {
    it('counts only messages missing the scoped prefix', () => {
        const src = [
            "throw new Error('boom');",
            "throw new Error(`[@sigx/lynx-storage] setItem failed`);",
            'throw new TypeError("bad arg");',
        ].join('\n');
        expect(countUnprefixedThrows(src)).toBe(2);
    });

    it('ignores rethrows and computed messages, which text cannot judge', () => {
        expect(countUnprefixedThrows('throw err;\nthrow new Error(makeMessage());')).toBe(0);
    });
});

describe('C11 — README web section', () => {
    it('requires a level-2 Web heading', () => {
        expect(missingWebSection('# Pkg\n\n## Install\n\n## Web\n\nSupported.')).toBe(false);
        expect(missingWebSection('# Pkg\n\n## Install\n')).toBe(true);
        // A mention in prose is not the section.
        expect(missingWebSection('# Pkg\n\nWorks on web.\n')).toBe(true);
    });
});

describe('checkPackage', () => {
    it('reports the throw count so the baseline can ratchet on it', () => {
        const v = checkPackage({
            dir: 'lynx-demo',
            indexSource: '',
            sources: [{ path: 'a.ts', source: "throw new Error('a');\nthrow new Error('b');" }],
            readme: '## Web',
            isNativeModule: true,
        });
        expect(v).toEqual([{ rule: 'C10/unprefixed-throws', detail: '2', count: 2 }]);
    });

    it('only demands a Web section from native modules', () => {
        const args = { dir: 'lynx-demo', indexSource: '', sources: [], readme: '# Pkg' };
        expect(checkPackage({ ...args, isNativeModule: false })).toEqual([]);
        expect(checkPackage({ ...args, isNativeModule: true })).toHaveLength(1);
    });
});

describe('diffAgainstBaseline', () => {
    it('passes when findings match the baseline exactly', () => {
        const found = { a: [{ rule: 'C2/bare-is-available', detail: 'x' }] };
        const baseline = { a: [{ rule: 'C2/bare-is-available', detail: 'x' }] };
        expect(diffAgainstBaseline(found, baseline)).toEqual({ added: [], stale: [], unknown: [] });
    });

    it('does not match a hand-written baseline entry that omits the detail', () => {
        // Identity for uncounted rules is rule + detail, so a detail-less entry
        // matches nothing. Failing loudly beats silently excusing every
        // violation of that rule — regenerate with --update-baseline instead.
        const { added, stale } = diffAgainstBaseline(
            { a: [{ rule: 'C2/bare-is-available', detail: 'x' }] },
            { a: [{ rule: 'C2/bare-is-available' }] },
        );
        expect(added).toHaveLength(1);
        expect(stale).toHaveLength(1);
    });

    it('fails on a violation the baseline does not cover', () => {
        const { added } = diffAgainstBaseline({ a: [{ rule: 'C2/bare-is-available', detail: 'x' }] }, { a: [] });
        expect(added).toHaveLength(1);
    });

    it('fails when a counted violation grows, and passes when it holds', () => {
        const baseline = { a: [{ rule: 'C10/unprefixed-throws', count: 5 }] };
        expect(
            diffAgainstBaseline({ a: [{ rule: 'C10/unprefixed-throws', detail: '6', count: 6 }] }, baseline).added,
        ).toHaveLength(1);
        expect(
            diffAgainstBaseline({ a: [{ rule: 'C10/unprefixed-throws', detail: '5', count: 5 }] }, baseline).added,
        ).toHaveLength(0);
    });

    it('does not let one entry excuse a second violation of the same rule', () => {
        // lynx-updates really has two C12/declared-not-called methods. Keying
        // the baseline on `rule` alone would let a third slip through silently,
        // which is the exact hole the ratchet exists to close.
        const baseline = {
            a: [
                { rule: 'C12/declared-not-called', detail: 'getState — declared, never called' },
                { rule: 'C12/declared-not-called', detail: 'getCurrentUpdate — declared, never called' },
            ],
        };
        const found = {
            a: [
                { rule: 'C12/declared-not-called', detail: 'getState — declared, never called' },
                { rule: 'C12/declared-not-called', detail: 'getCurrentUpdate — declared, never called' },
                { rule: 'C12/declared-not-called', detail: 'newDrift — declared, never called' },
            ],
        };
        const { added, stale } = diffAgainstBaseline(found, baseline);
        expect(added).toHaveLength(1);
        expect(added[0].detail).toContain('newDrift');
        expect(stale).toEqual([]);
    });

    it('flags the exact one of several same-rule entries that was fixed', () => {
        const baseline = {
            a: [
                { rule: 'C12/declared-not-called', detail: 'getState — declared, never called' },
                { rule: 'C12/declared-not-called', detail: 'getCurrentUpdate — declared, never called' },
            ],
        };
        const found = { a: [{ rule: 'C12/declared-not-called', detail: 'getState — declared, never called' }] };
        const { stale, added } = diffAgainstBaseline(found, baseline);
        expect(added).toEqual([]);
        expect(stale).toHaveLength(1);
        expect(stale[0].detail).toContain('getCurrentUpdate');
    });

    it('treats a changed detail as a new violation, not the baselined one', () => {
        const { added, stale } = diffAgainstBaseline(
            { a: [{ rule: 'C2/bare-is-available', detail: 'export function isAvailable' }] },
            { a: [{ rule: 'C2/bare-is-available', detail: 'export { … isAvailable … }' }] },
        );
        expect(added).toHaveLength(1);
        expect(stale).toHaveLength(1);
    });

    it('fails on a stale entry, so a fix forces the baseline to shrink', () => {
        // This is what makes it a ratchet rather than a permanent excuse list.
        const { stale } = diffAgainstBaseline({ a: [] }, { a: [{ rule: 'C2/bare-is-available' }] });
        expect(stale).toHaveLength(1);
    });

    it('fails when a counted violation drops below its baseline', () => {
        const { stale } = diffAgainstBaseline(
            { a: [{ rule: 'C10/unprefixed-throws', detail: '2', count: 2 }] },
            { a: [{ rule: 'C10/unprefixed-throws', count: 5 }] },
        );
        expect(stale).toHaveLength(1);
    });

    it('fails on a baseline entry for a package that no longer exists', () => {
        const { unknown } = diffAgainstBaseline({}, { gone: [{ rule: 'C2/bare-is-available' }] });
        expect(unknown).toHaveLength(1);
    });
});

describe('toBaseline', () => {
    it('keeps counts and details, and omits clean packages', () => {
        expect(
            toBaseline({
                b: [{ rule: 'C10/unprefixed-throws', detail: '3', count: 3 }],
                a: [{ rule: 'C2/bare-is-available', detail: 'export { … }' }],
                clean: [],
            }),
        ).toEqual({
            // Uncounted rules keep their detail — it is their identity, and it
            // makes the file say *which* thing drifted.
            a: [{ rule: 'C2/bare-is-available', detail: 'export { … }' }],
            b: [{ rule: 'C10/unprefixed-throws', count: 3 }],
        });
    });
});
