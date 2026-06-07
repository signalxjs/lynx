import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverSigxPackages } from '../src/prebuild.js';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

// Stand up a fake project tree under tmpdir with `node_modules/<pkg>/` entries.
// Each fake module needs a package.json (so Node's resolver picks it up) and
// a signalx-module.json (the marker discoverSigxPackages looks for).
type InstalledSpec = 'with-manifest' | 'no-manifest' | {
    manifest: boolean;
    /** Runtime dependencies written into the installed package's package.json
     *  — what the transitive discovery walk follows. */
    dependencies?: Record<string, string>;
};

function writeInstalledPackage(nodeModulesDir: string, pkg: string, spec: InstalledSpec): void {
    const { manifest, dependencies } = typeof spec === 'string'
        ? { manifest: spec === 'with-manifest', dependencies: undefined }
        : spec;
    const pkgDir = join(nodeModulesDir, ...pkg.split('/'));
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
            name: pkg,
            version: '1.0.0',
            // No `exports` — bare subpath resolution is what discoverSigxPackages relies on.
            ...(dependencies ? { dependencies } : {}),
        }),
    );
    if (manifest) {
        writeFileSync(
            join(pkgDir, 'signalx-module.json'),
            JSON.stringify({ name: pkg, package: pkg, platforms: ['android', 'ios'] }),
        );
    }
}

function writeProject(root: string, opts: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    /** Installed packages — keyed by package name. */
    installed: Record<string, InstalledSpec>;
}): void {
    mkdirSync(root, { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'test-project',
            dependencies: opts.dependencies ?? {},
            devDependencies: opts.devDependencies ?? {},
        }),
    );
    for (const [pkg, spec] of Object.entries(opts.installed)) {
        writeInstalledPackage(join(root, 'node_modules'), pkg, spec);
    }
}

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `sigx-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

describe('discoverSigxPackages', () => {
    it('finds installed packages that ship signalx-module.json', async () => {
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-storage': '^1.0.0', '@sigx/lynx-haptics': '^1.0.0' },
            installed: {
                '@sigx/lynx-storage': 'with-manifest',
                '@sigx/lynx-haptics': 'with-manifest',
            },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered.sort()).toEqual(['@sigx/lynx-haptics', '@sigx/lynx-storage']);
    });

    it('ignores deps without a signalx-module.json (not a Lynx native module)', async () => {
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-icons': '^1.0.0', '@sigx/lynx-storage': '^1.0.0' },
            installed: {
                '@sigx/lynx-icons': 'no-manifest', // JS-only package, no native side
                '@sigx/lynx-storage': 'with-manifest',
            },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered).toEqual(['@sigx/lynx-storage']);
    });

    it('skips packages already in existingPackages (declared via modules:)', async () => {
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-storage': '^1.0.0', '@sigx/lynx-haptics': '^1.0.0' },
            installed: {
                '@sigx/lynx-storage': 'with-manifest',
                '@sigx/lynx-haptics': 'with-manifest',
            },
        });
        // Storage is explicit (so it shouldn't be double-included).
        const discovered = await discoverSigxPackages(testDir, ['@sigx/lynx-storage']);
        expect(discovered).toEqual(['@sigx/lynx-haptics']);
    });

    it('skips packages listed in excludeModules', async () => {
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-storage': '^1.0.0', '@sigx/lynx-haptics': '^1.0.0' },
            installed: {
                '@sigx/lynx-storage': 'with-manifest',
                '@sigx/lynx-haptics': 'with-manifest',
            },
        });
        const discovered = await discoverSigxPackages(
            testDir,
            [],
            ['@sigx/lynx-haptics'],
        );
        expect(discovered).toEqual(['@sigx/lynx-storage']);
    });

    it('scans devDependencies too (so @sigx/lynx-dev-client picks up)', async () => {
        writeProject(testDir, {
            devDependencies: { '@sigx/lynx-dev-client': '^1.0.0' },
            installed: { '@sigx/lynx-dev-client': 'with-manifest' },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered).toEqual(['@sigx/lynx-dev-client']);
    });

    it('returns empty array when there is no package.json (non-Lynx context)', async () => {
        mkdirSync(testDir, { recursive: true });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered).toEqual([]);
    });

    it('returns empty array when no deps ship a manifest', async () => {
        writeProject(testDir, {
            dependencies: { lodash: '^4.0.0' },
            installed: { lodash: 'no-manifest' },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered).toEqual([]);
    });

    // ── Transitive discovery (#257) ─────────────────────────────────────
    // @sigx/lynx-core ships shared native helpers but apps never declare it
    // directly — it's a runtime dependency of every native module. Discovery
    // must walk module dependencies to find it.

    it('discovers a module dependency of a discovered module (transitive)', async () => {
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-biometric': '^1.0.0' },
            installed: {
                '@sigx/lynx-biometric': {
                    manifest: true,
                    dependencies: { '@sigx/lynx-core': '^1.0.0' },
                },
                '@sigx/lynx-core': 'with-manifest', // installed, NOT an app dep
            },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered.sort()).toEqual(['@sigx/lynx-biometric', '@sigx/lynx-core']);
    });

    it('sorts @sigx/lynx-core first so its activity hook runs before others', async () => {
        writeProject(testDir, {
            dependencies: {
                '@sigx/lynx-biometric': '^1.0.0',
                '@sigx/lynx-permissions': '^1.0.0',
            },
            installed: {
                '@sigx/lynx-biometric': {
                    manifest: true,
                    dependencies: { '@sigx/lynx-core': '^1.0.0' },
                },
                '@sigx/lynx-permissions': {
                    manifest: true,
                    dependencies: { '@sigx/lynx-core': '^1.0.0' },
                },
                '@sigx/lynx-core': 'with-manifest',
            },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered[0]).toBe('@sigx/lynx-core');
        // Diamond: two dependents, discovered exactly once.
        expect(discovered.filter((p) => p === '@sigx/lynx-core')).toHaveLength(1);
        expect(discovered).toHaveLength(3);
    });

    it('does not walk dependencies of non-module packages', async () => {
        // A manifest-bearing package reachable only through a plain JS dep
        // is NOT discovered — only module dependencies are walked.
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-icons': '^1.0.0' },
            installed: {
                '@sigx/lynx-icons': {
                    manifest: false,
                    dependencies: { '@sigx/lynx-core': '^1.0.0' },
                },
                '@sigx/lynx-core': 'with-manifest',
            },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered).toEqual([]);
    });

    it('does not walk devDependencies of modules (not shipped)', async () => {
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-biometric': '^1.0.0' },
            installed: {
                '@sigx/lynx-biometric': 'with-manifest',
                '@sigx/lynx-testing': 'with-manifest',
            },
        });
        // Hand-edit the module's package.json to carry only a devDependency.
        const pkgJsonPath = join(testDir, 'node_modules', '@sigx', 'lynx-biometric', 'package.json');
        writeFileSync(pkgJsonPath, JSON.stringify({
            name: '@sigx/lynx-biometric',
            version: '1.0.0',
            devDependencies: { '@sigx/lynx-testing': '^1.0.0' },
        }));
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered).toEqual(['@sigx/lynx-biometric']);
    });

    it('excludeModules applies to transitively discovered packages too', async () => {
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-biometric': '^1.0.0' },
            installed: {
                '@sigx/lynx-biometric': {
                    manifest: true,
                    dependencies: { '@sigx/lynx-core': '^1.0.0' },
                },
                '@sigx/lynx-core': 'with-manifest',
            },
        });
        const discovered = await discoverSigxPackages(testDir, [], ['@sigx/lynx-core']);
        expect(discovered).toEqual(['@sigx/lynx-biometric']);
    });

    it('walks the umbrella marker manifest to default-wired modules (@sigx/lynx → lynx-http)', async () => {
        // @sigx/lynx ships a contribution-less marker manifest precisely so
        // this walk happens: an app depending only on the umbrella gets its
        // default-wired native deps (lynx-http) linked, while the umbrella's
        // pure-JS deps stay invisible to the linker.
        writeProject(testDir, {
            dependencies: { '@sigx/lynx': '^1.0.0' },
            installed: {
                '@sigx/lynx': {
                    manifest: true, // the marker — no native contributions
                    dependencies: {
                        '@sigx/lynx-http': '^1.0.0',
                        '@sigx/lynx-runtime': '^1.0.0',
                    },
                },
                '@sigx/lynx-http': 'with-manifest',
                '@sigx/lynx-runtime': 'no-manifest',
            },
        });
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered.sort()).toEqual(['@sigx/lynx', '@sigx/lynx-http']);
        // Opt-out still works for default-wired modules.
        const optedOut = await discoverSigxPackages(testDir, [], ['@sigx/lynx-http']);
        expect(optedOut).toEqual(['@sigx/lynx']);
    });

    it('resolves pnpm-style nested installs from the dependent module', async () => {
        // Strict (non-hoisted) layout: lynx-core only exists under the
        // module's own node_modules — invisible to the app's resolver.
        writeProject(testDir, {
            dependencies: { '@sigx/lynx-biometric': '^1.0.0' },
            installed: {
                '@sigx/lynx-biometric': {
                    manifest: true,
                    dependencies: { '@sigx/lynx-core': '^1.0.0' },
                },
            },
        });
        writeInstalledPackage(
            join(testDir, 'node_modules', '@sigx', 'lynx-biometric', 'node_modules'),
            '@sigx/lynx-core',
            'with-manifest',
        );
        const discovered = await discoverSigxPackages(testDir, []);
        expect(discovered).toEqual(['@sigx/lynx-core', '@sigx/lynx-biometric']);
    });
});

describe('resolveConfig — auto-discovery shape', () => {
    const BASE: LynxConfig = { name: 'T' };

    it('defaults excludeModules to []', () => {
        expect(resolveConfig(BASE).excludeModules).toEqual([]);
    });

    it('passes excludeModules through verbatim', () => {
        const resolved = resolveConfig({ ...BASE, excludeModules: ['@sigx/lynx-camera'] });
        expect(resolved.excludeModules).toEqual(['@sigx/lynx-camera']);
    });

    it('string-form modules default disabled=false', () => {
        const resolved = resolveConfig({ ...BASE, modules: ['@sigx/lynx-storage'] });
        expect(resolved.modules[0]).toMatchObject({
            package: '@sigx/lynx-storage',
            disabled: false,
        });
    });

    it('object-form modules with disabled: true propagate', () => {
        const resolved = resolveConfig({
            ...BASE,
            modules: [{ package: '@sigx/lynx-storage', disabled: true }],
        });
        expect(resolved.modules[0].disabled).toBe(true);
    });

    it('preserves config + platforms when also declared with disabled', () => {
        const resolved = resolveConfig({
            ...BASE,
            modules: [{
                package: '@sigx/lynx-location',
                platforms: ['ios'],
                config: { accuracy: 'high' },
            }],
        });
        expect(resolved.modules[0]).toEqual({
            package: '@sigx/lynx-location',
            platforms: ['ios'],
            config: { accuracy: 'high' },
            disabled: false,
        });
    });
});
