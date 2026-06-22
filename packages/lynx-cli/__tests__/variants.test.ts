import { describe, it, expect } from 'vitest';
import { mergeVariant, deepMerge } from '../src/config/variant.js';
import { resolveConfig } from '../src/config/parser.js';
import { androidDirName, iosDirName } from '../src/config/paths.js';
import type { LynxConfig } from '../src/config/schema.js';

const BASE: LynxConfig = {
    name: 'My App',
    version: '1.0.0',
    scheme: 'myapp',
    android: { applicationId: 'com.example.app', versionCode: 3 },
    ios: { bundleIdentifier: 'com.example.app' },
    variants: {
        dev: { idSuffix: '.dev', nameSuffix: ' (Dev)', schemeSuffix: 'dev' },
        staging: { idSuffix: '.staging', nameSuffix: ' (Staging)', release: true },
        pr: { extends: 'dev', idSuffix: '.pr', nameSuffix: ' (PR)' },
    },
};

describe('deepMerge', () => {
    it('merges nested objects and replaces arrays/scalars', () => {
        const out = deepMerge(
            { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] },
            { a: 2, nested: { y: 3, z: 4 }, list: [9] },
        );
        expect(out).toEqual({ a: 2, nested: { x: 1, y: 3, z: 4 }, list: [9] });
    });

    it('ignores undefined override values', () => {
        const out = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 5 });
        expect(out).toEqual({ a: 1, b: 5 });
    });
});

describe('mergeVariant — identity suffixing', () => {
    it('suffixes id, name and scheme', () => {
        const { config } = mergeVariant(BASE, 'dev');
        expect(config.name).toBe('My App (Dev)');
        expect(config.android!.applicationId).toBe('com.example.app.dev');
        expect(config.ios!.bundleIdentifier).toBe('com.example.app.dev');
        expect(config.scheme).toBe('myappdev');
    });

    it('does not mutate the base config', () => {
        mergeVariant(BASE, 'dev');
        expect(BASE.name).toBe('My App');
        expect(BASE.android!.applicationId).toBe('com.example.app');
        expect(BASE.scheme).toBe('myapp');
    });

    it('pins the id when no idSuffix (keeps base id, not name-derived)', () => {
        const cfg: LynxConfig = { name: 'My App', variants: { qa: { nameSuffix: ' QA' } } };
        const { config } = mergeVariant(cfg, 'qa');
        // No explicit id + no idSuffix → base-derived id, NOT derived from the
        // suffixed display name.
        expect(config.android!.applicationId).toBe('com.sigx.myapp');
        expect(config.ios!.bundleIdentifier).toBe('com.sigx.myapp');
    });

    it('appends idSuffix onto the derived fallback id when id is unset', () => {
        const cfg: LynxConfig = { name: 'My App', variants: { dev: { idSuffix: '.dev' } } };
        const { config } = mergeVariant(cfg, 'dev');
        expect(config.android!.applicationId).toBe('com.sigx.myapp.dev');
    });
});

describe('mergeVariant — defaults', () => {
    it('defaults codeSignStyle to Automatic for a non-release variant', () => {
        const { config } = mergeVariant(BASE, 'dev');
        expect(config.ios!.codeSignStyle).toBe('Automatic');
    });

    it('leaves signing alone for a release variant', () => {
        const { config } = mergeVariant(BASE, 'staging');
        expect(config.ios!.codeSignStyle).toBeUndefined();
    });

    it('never overrides an explicit codeSignStyle', () => {
        const cfg: LynxConfig = {
            name: 'A', ios: { codeSignStyle: 'Manual' },
            variants: { dev: { idSuffix: '.dev' } },
        };
        const { config } = mergeVariant(cfg, 'dev');
        expect(config.ios!.codeSignStyle).toBe('Manual');
    });

    it('auto-binds the OTA channel to the variant name when unset', () => {
        const cfg: LynxConfig = {
            name: 'A', updates: { runtimeVersion: '1.0.0' },
            variants: { dev: { idSuffix: '.dev' } },
        };
        const { config } = mergeVariant(cfg, 'dev');
        expect(config.updates!.defaultChannel).toBe('dev');
    });

    it('does not touch the OTA channel when there is no updates block', () => {
        const { config } = mergeVariant(BASE, 'dev');
        expect(config.updates).toBeUndefined();
    });
});

describe('mergeVariant — icon badge', () => {
    it('derives a badge from nameSuffix for non-release variants', () => {
        const { controls } = mergeVariant(BASE, 'dev');
        expect(controls.iconBadge).toBe('DEV');
    });

    it('has no badge for release variants by default', () => {
        const { controls } = mergeVariant(BASE, 'staging');
        expect(controls.iconBadge).toBeNull();
    });

    it('honors an explicit badge string and false', () => {
        const cfg: LynxConfig = {
            name: 'A',
            variants: {
                a: { idSuffix: '.a', iconBadge: 'BETA' },
                b: { idSuffix: '.b', iconBadge: false },
            },
        };
        expect(mergeVariant(cfg, 'a').controls.iconBadge).toBe('BETA');
        expect(mergeVariant(cfg, 'b').controls.iconBadge).toBeNull();
    });
});

describe('mergeVariant — extends composition', () => {
    it('inherits then overrides down the chain', () => {
        const { config, controls } = mergeVariant(BASE, 'pr');
        // pr extends dev: pr's idSuffix/nameSuffix win, dev's schemeSuffix is inherited.
        expect(config.android!.applicationId).toBe('com.example.app.pr');
        expect(config.name).toBe('My App (PR)');
        expect(config.scheme).toBe('myappdev');
        expect(controls.iconBadge).toBe('PR');
    });

    it('throws on an unknown variant', () => {
        expect(() => mergeVariant(BASE, 'nope')).toThrow(/Unknown variant "nope"/);
    });

    it('throws on an extends cycle', () => {
        const cfg: LynxConfig = {
            name: 'A',
            variants: { a: { extends: 'b' }, b: { extends: 'a' } },
        };
        expect(() => mergeVariant(cfg, 'a')).toThrow(/circular/);
    });

    it('deep-merges partial config overrides from the variant', () => {
        const cfg: LynxConfig = {
            name: 'A',
            android: { applicationId: 'com.x', minSdk: 24, versionCode: 1 },
            variants: { dev: { idSuffix: '.dev', android: { minSdk: 26 } } },
        };
        const { config } = mergeVariant(cfg, 'dev');
        expect(config.android!.minSdk).toBe(26);
        expect(config.android!.versionCode).toBe(1); // untouched base field survives
        expect(config.android!.applicationId).toBe('com.x.dev');
    });
});

describe('resolveConfig with a variant', () => {
    it('stamps variant + iconBadge and applies the merge', () => {
        const resolved = resolveConfig(BASE, 'dev');
        expect(resolved.variant).toBe('dev');
        expect(resolved.iconBadge).toBe('DEV');
        expect(resolved.name).toBe('My App (Dev)');
        expect(resolved.android.applicationId).toBe('com.example.app.dev');
        expect(process.env['SIGX_LYNX_VARIANT']).toBe('dev');
    });

    it('is unchanged (and unbadged) without a variant', () => {
        const resolved = resolveConfig(BASE);
        expect(resolved.variant).toBeUndefined();
        expect(resolved.iconBadge).toBeNull();
        expect(resolved.name).toBe('My App');
        expect(resolved.android.applicationId).toBe('com.example.app');
        expect(process.env['SIGX_LYNX_VARIANT']).toBe('');
    });
});

describe('output dir names', () => {
    it('maps base vs variant dirs', () => {
        expect(androidDirName()).toBe('android');
        expect(iosDirName()).toBe('ios');
        expect(androidDirName('dev')).toBe('android-dev');
        expect(iosDirName('staging')).toBe('ios-staging');
    });
});
