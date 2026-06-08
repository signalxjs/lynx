/**
 * Regression tests for #334 — the Android version catalog must stay in lockstep
 * with the managed `build.gradle.kts` (which references its aliases), and
 * `--clean` does a full native re-scaffold.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    scaffoldAndroid,
    scaffoldIos,
    refreshAndroidManagedFiles,
    cleanPrebuild,
} from '../src/prebuild.js';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

const BASE_CONFIG: LynxConfig = {
    name: 'TestApp',
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `sigx-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

const catalogPath = () => join(testDir, 'android', 'gradle', 'libs.versions.toml');
const gradlePath = () => join(testDir, 'android', 'app', 'build.gradle.kts');

describe('libs.versions.toml is a managed file (catalog tracks build.gradle.kts)', () => {
    it('refresh re-adds an alias dropped from a stale catalog', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);

        // build.gradle.kts (managed) references the fragment-ktx alias…
        expect(readFileSync(gradlePath(), 'utf-8')).toContain('libs.androidx.fragment.ktx');
        // …and a fresh scaffold's catalog defines it.
        expect(readFileSync(catalogPath(), 'utf-8')).toContain('androidx-fragment-ktx');

        // Simulate a pre-#276 stale catalog: strip every `fragment` line.
        const stale = readFileSync(catalogPath(), 'utf-8')
            .split('\n')
            .filter((l) => !l.toLowerCase().includes('fragment'))
            .join('\n');
        writeFileSync(catalogPath(), stale);
        expect(readFileSync(catalogPath(), 'utf-8')).not.toContain('fragment');

        // Refreshing managed files self-heals the catalog (the bug: before the
        // fix it was scaffold-once, so this drift stayed → Unresolved reference).
        refreshAndroidManagedFiles(testDir, config);
        expect(readFileSync(catalogPath(), 'utf-8')).toContain('androidx-fragment-ktx');
    });
});

describe('cleanPrebuild(full) — what `prebuild --clean` now triggers', () => {
    it('removes the android/ and ios/ projects for a full re-scaffold', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        scaffoldIos(testDir, config);
        expect(existsSync(join(testDir, 'android'))).toBe(true);
        expect(existsSync(join(testDir, 'ios'))).toBe(true);

        cleanPrebuild(testDir, config, true);

        expect(existsSync(join(testDir, 'android'))).toBe(false);
        expect(existsSync(join(testDir, 'ios'))).toBe(false);
    });
});
