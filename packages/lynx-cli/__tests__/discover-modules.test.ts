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
function writeProject(root: string, opts: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    /** Installed packages — keyed by package name, value: 'with-manifest' | 'no-manifest' */
    installed: Record<string, 'with-manifest' | 'no-manifest'>;
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
    for (const [pkg, kind] of Object.entries(opts.installed)) {
        const pkgDir = join(root, 'node_modules', ...pkg.split('/'));
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(
            join(pkgDir, 'package.json'),
            JSON.stringify({
                name: pkg,
                version: '1.0.0',
                // No `exports` — bare subpath resolution is what discoverSigxPackages relies on.
            }),
        );
        if (kind === 'with-manifest') {
            writeFileSync(
                join(pkgDir, 'signalx-module.json'),
                JSON.stringify({ name: pkg, package: pkg, platforms: ['android', 'ios'] }),
            );
        }
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
