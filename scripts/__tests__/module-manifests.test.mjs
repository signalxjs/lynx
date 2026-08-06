import { describe, expect, it } from 'vitest';

import {
    checkModule,
    jsCalledMethods,
    kotlinMethods,
    stripComments,
    swiftLookupMethods,
} from '../lib/module-manifests.mjs';

describe('jsCalledMethods', () => {
    it('reads the method name out of callAsync/callSync', () => {
        const src = [
            `return callAsync<PhotoResult>(MODULE, 'takePicture', options);`,
            `callSync(MODULE, 'selection');`,
            `return callAsync<PermissionResponse>('Camera', 'requestPermission');`,
        ].join('\n');
        expect([...jsCalledMethods(src)].sort()).toEqual(['requestPermission', 'selection', 'takePicture']);
    });

    it('ignores calls inside comments', () => {
        // core's own unwrapNative JSDoc shows a Camera takePicture call; counting
        // it made the checker report drift against the wrong package.
        const src = [
            '/**',
            ` * const raw = await callAsync<{ uri?: string }>('Camera', 'takePicture', opts);`,
            ' */',
            `callAsync(MODULE, 'impact');`,
            `// callAsync(MODULE, 'oldName');`,
        ].join('\n');
        expect([...jsCalledMethods(src)]).toEqual(['impact']);
    });

    it('cannot resolve a dynamic name, and does not guess one', () => {
        expect([...jsCalledMethods('callAsync(MODULE, methodName);')]).toEqual([]);
    });
});

describe('stripComments', () => {
    it('leaves a // inside a string alone', () => {
        const out = stripComments(`const url = 'https://example.com'; // trailing`);
        expect(out).toContain("'https://example.com'");
        expect(out).not.toContain('trailing');
    });

    it('preserves line structure so offsets stay usable', () => {
        const src = 'a\n/* x\ny */\nb';
        expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
    });

    it('handles an escaped quote without losing the rest of the file', () => {
        const out = stripComments(`const s = 'it\\'s'; callAsync(M, 'impact');`);
        expect(out).toContain("'impact'");
    });
});

describe('swiftLookupMethods', () => {
    it('reads the methodLookup keys', () => {
        const swift = [
            '    @objc static var methodLookup: [String: String] {',
            '        [',
            '            "impact": NSStringFromSelector(#selector(impact(_:))),',
            '            "selection": NSStringFromSelector(#selector(selection)),',
            '        ]',
            '    }',
        ].join('\n');
        expect([...swiftLookupMethods(swift)].sort()).toEqual(['impact', 'selection']);
    });
});

describe('kotlinMethods', () => {
    it('reads @LynxMethod-annotated functions', () => {
        const kt = [
            '    @LynxMethod',
            '    fun impact(style: String?) {',
            '    }',
            '    private fun vibrate(ms: Long) {}',
        ].join('\n');
        expect([...kotlinMethods(kt)]).toEqual(['impact']);
    });
});

describe('checkModule', () => {
    const base = { declared: [], called: new Set(), swift: new Set(), kotlin: new Set(), hasIos: true, hasAndroid: true };

    it('flags a method called from JS but absent from the manifest', () => {
        // The real lynx-haptics `diagnose` case.
        const v = checkModule({
            ...base,
            declared: ['impact'],
            called: new Set(['impact', 'diagnose']),
            swift: new Set(['impact', 'diagnose']),
            kotlin: new Set(['impact', 'diagnose']),
        });
        expect(v).toEqual([
            { rule: 'C12/called-not-declared', detail: expect.stringContaining('diagnose') },
        ]);
    });

    it('flags a declared method nothing calls', () => {
        const v = checkModule({ ...base, declared: ['getConstants'], hasIos: false, hasAndroid: false });
        expect(v).toEqual([{ rule: 'C12/declared-not-called', detail: expect.stringContaining('getConstants') }]);
    });

    it('flags a JS call with no native implementation on either side', () => {
        const v = checkModule({
            ...base,
            called: new Set(['ghost']),
            swift: new Set(['other']),
            kotlin: new Set(['other']),
        });
        expect(v.map((x) => x.rule)).toEqual(['C12/called-not-in-swift', 'C12/called-not-in-kotlin']);
    });

    it('stays quiet when all four agree', () => {
        expect(
            checkModule({
                declared: ['impact'],
                called: new Set(['impact']),
                swift: new Set(['impact']),
                kotlin: new Set(['impact']),
                hasIos: true,
                hasAndroid: true,
            }),
        ).toEqual([]);
    });

    it('skips the manifest comparison when no methods are declared', () => {
        // Plenty of modules legitimately omit ios.methods; treating that as
        // "declares nothing, so everything is undeclared" would be noise.
        expect(checkModule({ ...base, called: new Set(['x']), swift: new Set(['x']), kotlin: new Set(['x']) })).toEqual([]);
    });

    it('skips a platform the package does not ship', () => {
        expect(
            checkModule({ ...base, called: new Set(['x']), swift: new Set(['x']), hasAndroid: false }),
        ).toEqual([]);
    });
});
