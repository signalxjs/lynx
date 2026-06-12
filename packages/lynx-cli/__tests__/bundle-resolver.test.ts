/**
 * GeneratedBundleResolver autolinking: with no resolver module the generated
 * delegate must compile to a no-op (apps without @sigx/lynx-updates keep
 * working), with one it must delegate, and with two the prebuild must fail —
 * two packages both claiming startup bundle selection is unresolvable.
 */
import { describe, expect, it } from 'vitest';
import { linkAndroid } from '../src/autolink/android';
import { linkIos } from '../src/autolink/ios';
import { resolveConfig } from '../src/config/parser';
import type { ModuleManifest } from '../src/manifest';

const config = resolveConfig({ name: 'testapp' });

function resolverManifest(pkg: string, kotlinClass: string, swiftClass: string): ModuleManifest {
    return {
        name: pkg.replace('@sigx/lynx-', ''),
        package: pkg,
        description: 'resolver module',
        platforms: ['android', 'ios'],
        android: {
            moduleClass: `${kotlinClass}Module`,
            bundleResolverClass: kotlinClass,
            sourceDir: 'android',
        },
        ios: {
            moduleClass: `${swiftClass}Module`,
            bundleResolverClass: swiftClass,
            sourceDir: 'ios',
        },
    };
}

describe('Android bundle resolver linking', () => {
    it('generates a null-returning delegate when no module declares a resolver', () => {
        const result = linkAndroid(config, []);
        expect(result.bundleResolverClass).toBeUndefined();
        expect(result.bundleResolverCode).toContain('object GeneratedBundleResolver');
        expect(result.bundleResolverCode).toContain('return null');
    });

    it('delegates to the declared resolver class', () => {
        const result = linkAndroid(config, [
            resolverManifest('@sigx/lynx-updates', 'com.sigx.updates.UpdatesBundleResolver', 'UpdatesBundleResolver'),
        ]);
        expect(result.bundleResolverClass).toBe('com.sigx.updates.UpdatesBundleResolver');
        expect(result.bundleResolverCode).toContain(
            'return com.sigx.updates.UpdatesBundleResolver.resolveStartupBundlePath(context)');
    });

    it('fails loudly when two packages both declare a resolver', () => {
        expect(() => linkAndroid(config, [
            resolverManifest('@sigx/lynx-updates', 'com.sigx.updates.UpdatesBundleResolver', 'UpdatesBundleResolver'),
            resolverManifest('@sigx/lynx-other-ota', 'com.sigx.other.OtherResolver', 'OtherResolver'),
        ])).toThrow(/Two packages declare android\.bundleResolverClass/);
    });
});

describe('iOS bundle resolver linking', () => {
    it('generates a nil-returning delegate when no module declares a resolver', () => {
        const result = linkIos(config, []);
        expect(result.bundleResolverClass).toBeUndefined();
        expect(result.bundleResolverCode).toContain('enum GeneratedBundleResolver');
        expect(result.bundleResolverCode).toContain('return nil');
    });

    it('delegates to the declared resolver class', () => {
        const result = linkIos(config, [
            resolverManifest('@sigx/lynx-updates', 'com.sigx.updates.UpdatesBundleResolver', 'UpdatesBundleResolver'),
        ]);
        expect(result.bundleResolverClass).toBe('UpdatesBundleResolver');
        expect(result.bundleResolverCode).toContain(
            'return UpdatesBundleResolver.resolveStartupBundlePath()');
    });

    it('fails loudly when two packages both declare a resolver', () => {
        expect(() => linkIos(config, [
            resolverManifest('@sigx/lynx-updates', 'com.sigx.updates.UpdatesBundleResolver', 'UpdatesBundleResolver'),
            resolverManifest('@sigx/lynx-other-ota', 'com.sigx.other.OtherResolver', 'OtherResolver'),
        ])).toThrow(/Two packages declare ios\.bundleResolverClass/);
    });
});
